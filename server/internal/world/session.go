package world

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
)

// How a session ends.
type endMode uint8

const (
	// endQuiet: the peer went away (or the read failed). Close without ceremony.
	endQuiet endMode = iota
	// endKick: send kick(reason) as the last frame, then close.
	endKick
	// endProtocol: the client broke the protocol (a text or undecodable frame). Close with s.code.
	endProtocol
	// endAbrupt: the client can't keep up. Drop the connection without a close handshake.
	endAbrupt
)

const kickShutdown = proto.KickReasonShutdown

// kickWriteTimeout bounds the last frame and close handshake of a kicked connection.
const kickWriteTimeout = 2 * time.Second

// session is one connection. Its reader runs in the HTTP handler's goroutine (run); its writer in
// writeLoop. The region talks to it only through Deliver and Disconnect, which never block.
type session struct {
	srv  *Server
	id   region.SessionID
	conn *websocket.Conn
	out  chan []byte

	done       chan struct{} // closed by end: the session is over
	once       sync.Once
	mode       endMode
	kick       proto.KickReason
	code       websocket.StatusCode
	writerDone chan struct{}

	name                   string
	upload, pings, invalid rate

	// heard is when we last heard from the client (unix nanoseconds): a message or a keepalive pong.
	heard atomic.Int64
}

func newSession(srv *Server, id region.SessionID, conn *websocket.Conn) *session {
	c := srv.cfg
	return &session{
		srv: srv, id: id, conn: conn,
		out:        make(chan []byte, c.QueueFrames),
		done:       make(chan struct{}),
		writerDone: make(chan struct{}),
		upload:     rate{perSec: float64(c.BytesPerSecond), burst: float64(c.BytesBurst)},
		pings:      rate{perSec: float64(c.PingPerSecond), burst: float64(c.PingBurst)},
		invalid:    rate{perSec: float64(c.InvalidPerMinute) / 60, burst: float64(c.InvalidPerMinute)},
	}
}

// Deliver queues a frame for the writer. False means the queue is full: the client is too slow.
func (s *session) Deliver(frame []byte) bool {
	select {
	case <-s.done:
		return true // closing anyway; the frame is dropped
	default:
	}
	select {
	case s.out <- frame:
		return true
	default:
		return false
	}
}

// Disconnect is the region dropping this player.
func (s *session) Disconnect(why region.DisconnectReason) {
	if why == region.DisconnectMisbehaving {
		s.end(endKick, proto.KickReasonMisbehaving)
		return
	}
	s.end(endAbrupt, 0)
}

// end ends the session; the first call wins. The writer then sends any kick and closes.
func (s *session) end(mode endMode, kick proto.KickReason) {
	s.endWith(mode, kick, 0)
}

func (s *session) endWith(mode endMode, kick proto.KickReason, code websocket.StatusCode) {
	s.once.Do(func() {
		s.mode, s.kick, s.code = mode, kick, code
		close(s.done)
	})
}

// run is the session's reader: the handshake, then intents until the connection ends.
func (s *session) run() {
	go s.writeLoop()
	defer func() { <-s.writerDone }()
	defer s.end(endQuiet, 0)
	s.conn.SetReadLimit(proto.MaxClientMessageSize)
	if !s.handshake() {
		return
	}
	defer s.toRegion(region.Input{Kind: region.InputLeave, Session: s.id})
	// Cancelling readCtx ends the read loop: that's how a silent connection is dropped.
	readCtx, cancelRead := context.WithCancel(context.Background())
	defer cancelRead()
	s.touch()
	go s.keepalive(readCtx, cancelRead)
	s.readLoop(readCtx)
	s.srv.log.Info("player left", "session", s.id, "name", s.name)
}

// handshake reads hello and joins the player to the spawn region (which then sends welcome).
func (s *session) handshake() bool {
	ctx, cancel := context.WithTimeout(context.Background(), s.srv.cfg.HelloTimeout)
	typ, data, err := s.conn.Read(ctx)
	cancel()
	if err != nil {
		return false
	}
	if typ != websocket.MessageBinary {
		s.endWith(endProtocol, 0, websocket.StatusUnsupportedData)
		return false
	}
	hello, err := proto.CheckHello(data)
	switch {
	case errors.Is(err, proto.ErrProtocolMismatch):
		s.end(endKick, proto.KickReasonRefresh)
		return false
	case err != nil:
		s.endWith(endProtocol, 0, websocket.StatusProtocolError)
		return false
	case hello.ContentHash != s.srv.cfg.ContentHash:
		s.end(endKick, proto.KickReasonRefresh)
		return false
	}
	who, ok := s.srv.checkTicket(hello.Ticket)
	if !ok {
		s.end(endKick, proto.KickReasonBadTicket)
		return false
	}
	s.name = who.name
	if !s.toRegion(region.Input{Kind: region.InputJoin, Session: s.id, Client: s, Name: who.name, Role: who.role, Look: who.look}) {
		s.end(endKick, kickShutdown)
		return false
	}
	s.srv.log.Info("player joined", "session", s.id, "name", who.name, "account", who.accountID,
		"character", who.characterID, "region", s.srv.spawn.ID(), "client_version", hello.ClientVersion)
	return true
}

func (s *session) readLoop(ctx context.Context) {
	for {
		// Read also answers the client's control frames and delivers pongs to keepalive.
		typ, data, err := s.conn.Read(ctx)
		if err != nil {
			return
		}
		s.touch()
		if typ != websocket.MessageBinary {
			s.endWith(endProtocol, 0, websocket.StatusUnsupportedData)
			return
		}
		now := time.Now()
		if !s.upload.take(now, float64(len(data))) {
			s.end(endKick, proto.KickReasonMisbehaving)
			return
		}
		msgs, err := proto.Decode(data, proto.FromClient)
		if err != nil {
			s.endWith(endProtocol, 0, websocket.StatusProtocolError)
			return
		}
		for _, m := range msgs {
			switch m := m.(type) {
			case *proto.Ping:
				if !s.pings.take(now, 1) {
					if !s.invalid.take(now, 1) {
						s.end(endKick, proto.KickReasonMisbehaving)
						return
					}
					continue
				}
				tick, phase := s.srv.spawn.Clock().Now()
				frame, _ := proto.Append(nil, &proto.Pong{ClientTime: m.ClientTime, ServerTick: tick, TickPhase: phase})
				if !s.Deliver(frame) {
					s.end(endAbrupt, 0)
					return
				}
			case *proto.Hello: // only ever the first message
				s.endWith(endProtocol, 0, websocket.StatusProtocolError)
				return
			default:
				if !s.toRegion(region.Input{Kind: region.InputIntent, Session: s.id, Msg: m}) {
					return
				}
			}
		}
	}
}

// touch records that we've just heard from the client.
func (s *session) touch() { s.heard.Store(time.Now().UnixNano()) }

// keepalive pings the client every KeepaliveInterval and drops the connection (by cancelling the
// read) once nothing has been heard for SilenceTimeout. Browsers answer WebSocket pings without the
// page's help, so a background tab whose game loop is paused stays connected; the client's own
// pings (clock sync) resume when the tab does.
func (s *session) keepalive(ctx context.Context, cancelRead context.CancelFunc) {
	cfg := s.srv.cfg
	t := time.NewTicker(cfg.KeepaliveInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.done:
			return
		case <-t.C:
		}
		if time.Since(time.Unix(0, s.heard.Load())) > cfg.SilenceTimeout {
			s.srv.log.Info("connection silent", "session", s.id, "name", s.name)
			cancelRead()
			return
		}
		pctx, cancel := context.WithTimeout(ctx, cfg.KeepaliveInterval)
		err := s.conn.Ping(pctx)
		cancel()
		if err == nil {
			s.touch()
			s.srv.keepalivesAnswered.Add(1)
		}
	}
}

// toRegion sends to the spawn region's inbox, unless the regions have stopped.
func (s *session) toRegion(in region.Input) bool {
	select {
	case s.srv.spawn.Inbox() <- in:
		return true
	case <-s.srv.regionDone:
		return false
	}
}

func (s *session) writeLoop() {
	defer close(s.writerDone)
	for {
		select {
		case f := <-s.out:
			ctx, cancel := context.WithTimeout(context.Background(), s.srv.cfg.WriteTimeout)
			err := s.conn.Write(ctx, websocket.MessageBinary, f)
			cancel()
			if err != nil {
				s.end(endAbrupt, 0)
				s.finish()
				return
			}
		case <-s.done:
			s.finish()
			return
		}
	}
}

// finish closes the connection the way end asked for.
func (s *session) finish() {
	switch s.mode {
	case endKick:
		frame, _ := proto.Append(nil, &proto.Kick{Reason: s.kick})
		ctx, cancel := context.WithTimeout(context.Background(), kickWriteTimeout)
		_ = s.conn.Write(ctx, websocket.MessageBinary, frame)
		cancel()
		code, why := websocket.StatusPolicyViolation, kickText[s.kick]
		if s.kick == proto.KickReasonShutdown {
			code = websocket.StatusGoingAway
		}
		_ = s.conn.Close(code, why)
	case endProtocol:
		_ = s.conn.Close(s.code, "protocol error")
	default:
		_ = s.conn.CloseNow()
	}
	if s.mode != endQuiet {
		s.srv.log.Info("connection closed by server", "session", s.id, "why", closeText(s))
	}
}

var kickText = map[proto.KickReason]string{
	proto.KickReasonRefresh:     "client out of date: refresh",
	proto.KickReasonBadTicket:   "ticket refused",
	proto.KickReasonShutdown:    "world shutting down",
	proto.KickReasonMisbehaving: "too many invalid messages",
}

func closeText(s *session) string {
	switch s.mode {
	case endKick:
		return kickText[s.kick]
	case endProtocol:
		return "protocol error"
	case endAbrupt:
		return "too slow"
	}
	return "closed"
}

// rate is a real-time token bucket for limits the session checks itself.
type rate struct {
	tokens, perSec, burst float64
	last                  time.Time
}

func (r *rate) take(now time.Time, n float64) bool {
	if r.last.IsZero() {
		r.tokens = r.burst
	} else {
		r.tokens = min(r.burst, r.tokens+now.Sub(r.last).Seconds()*r.perSec)
	}
	r.last = now
	if r.tokens < n {
		return false
	}
	r.tokens -= n
	return true
}
