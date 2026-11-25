// Package world is a world server's network side: the WebSocket endpoint at /w/<world-id>, the
// handshake, and one session per connection, which feeds a region's inbox and carries its frames back
// (docs/architecture/networking.md). Game logic lives in the region; nothing here decides anything
// about the game.
package world

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/names"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
)

// Config is a world server's network settings. DefaultConfig fills in the spec's values.
type Config struct {
	// WorldID is the world this process serves: clients connect to /w/<WorldID>.
	WorldID string
	// ContentHash is the server's data/ hash. A client whose hello has a different one is out of date
	// and is told to refresh.
	ContentHash string
	// TicketKey is WORLD_TICKET_KEY, shared with the backend API, which signs join tickets with it.
	// Without it, only dev tickets (if on) are accepted.
	TicketKey []byte
	// PremiumOnly refuses tickets from accounts without Premium (staff count as Premium). The API
	// checks this before issuing a ticket; the world checks again.
	PremiumOnly bool
	// DevTickets accepts "dev:<name>" tickets (development only; see networking.md "Dev tickets").
	DevTickets bool
	// Now is the clock for ticket expiry (tests set it). Nil means time.Now.
	Now func() time.Time
	// OriginPatterns are the browser origins allowed to connect besides the server's own host, as
	// github.com/coder/websocket AcceptOptions.OriginPatterns.
	OriginPatterns []string

	// HelloTimeout: a connection must send hello within this.
	HelloTimeout time.Duration
	// SilenceTimeout: a connection we hear nothing from for this long is dropped. Hearing means a
	// message from the client or a pong to one of our WebSocket pings (KeepaliveInterval).
	SilenceTimeout time.Duration
	// KeepaliveInterval: how often the server sends a WebSocket ping. Browsers answer pings
	// themselves, even when a background tab has paused the game, so a player who switches tabs
	// isn't dropped. A client that's really gone stops answering and is dropped after SilenceTimeout.
	KeepaliveInterval time.Duration
	// WriteTimeout: a frame that can't be written within this drops the connection.
	WriteTimeout time.Duration
	// QueueFrames is the per-session outbound queue, in frames (one a tick). If it fills, the
	// connection is too slow and is dropped; the tick never waits for it.
	QueueFrames int
	// Upload limits per connection: bytes per second, with a burst. Going over disconnects.
	BytesPerSecond, BytesBurst int
	// Ping limit: PingPerSecond, with a burst. Extra pings aren't answered and count as invalid.
	PingPerSecond, PingBurst int
	// InvalidPerMinute: more invalid messages than this in a minute disconnect (security.md).
	InvalidPerMinute int
}

// DefaultConfig gives the spec's settings for a world.
func DefaultConfig(worldID, contentHash string) Config {
	return Config{
		WorldID:           worldID,
		ContentHash:       contentHash,
		HelloTimeout:      10 * time.Second,
		SilenceTimeout:    20 * time.Second,
		KeepaliveInterval: 5 * time.Second,
		WriteTimeout:      10 * time.Second,
		QueueFrames:       64, // 3.2 s of ticks at 20 Hz
		BytesPerSecond:    4 << 10,
		BytesBurst:        16 << 10,
		PingPerSecond:     1,
		PingBurst:         3,
		InvalidPerMinute:  50,
	}
}

// Server accepts connections and runs their sessions. Players join the spawn region.
type Server struct {
	cfg   Config
	spawn *region.Region
	// regionDone is closed once the regions have stopped, so a session never blocks on a dead inbox.
	regionDone <-chan struct{}
	log        *slog.Logger

	tickets *ticket.Guard

	nextID atomic.Uint64
	// keepalivesAnswered counts pongs to keepalive pings (tests and, later, metrics).
	keepalivesAnswered atomic.Uint64
	mu                 sync.Mutex
	closing            bool
	sessions           map[*session]struct{}
	wg                 sync.WaitGroup
}

// New makes a server whose players join spawn. regionDone must be closed when the regions stop.
func New(cfg Config, spawn *region.Region, regionDone <-chan struct{}, log *slog.Logger) *Server {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	s := &Server{cfg: cfg, spawn: spawn, regionDone: regionDone, log: log, sessions: map[*session]struct{}{}}
	if len(cfg.TicketKey) > 0 {
		s.tickets = ticket.NewGuard(cfg.TicketKey, cfg.WorldID)
	}
	return s
}

// Handler serves /w/<world-id> (WebSocket), /healthz and /status.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /w/{world}", s.serveWS)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok\n")) })
	mux.HandleFunc("GET /status", s.serveStatus)
	return mux
}

// Status is GET /status: what the backend API shows in the world list. It's only reachable inside
// Docker (Caddy doesn't route it).
type Status struct {
	World   string `json:"world"`
	Players int    `json:"players"`
}

func (s *Server) serveStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(Status{World: s.cfg.WorldID, Players: s.Sessions()})
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("world") != s.cfg.WorldID {
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		http.Error(w, "world shutting down", http.StatusServiceUnavailable)
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.cfg.OriginPatterns})
	if err != nil {
		return // Accept has already answered
	}
	sess := newSession(s, region.SessionID(s.nextID.Add(1)), conn)
	s.mu.Lock()
	if s.closing { // Shutdown started while we were accepting
		s.mu.Unlock()
		sess.end(endKick, kickShutdown)
	} else {
		s.sessions[sess] = struct{}{}
		s.mu.Unlock()
	}
	sess.run()
	s.mu.Lock()
	delete(s.sessions, sess)
	s.mu.Unlock()
}

// Shutdown refuses new connections, tells every session the world is shutting down, closes them and
// waits for them to finish (or for ctx). Stop the regions after it returns.
func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	s.closing = true
	open := make([]*session, 0, len(s.sessions))
	for sess := range s.sessions {
		open = append(open, sess)
	}
	s.mu.Unlock()
	for _, sess := range open {
		sess.end(endKick, kickShutdown)
	}
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return errors.New("world: sessions still open at shutdown deadline")
	}
}

// Sessions is how many connections are open.
func (s *Server) Sessions() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}

// joiner is who a ticket lets in.
type joiner struct {
	name        string
	role        proto.Role
	accountID   string // empty for dev tickets
	characterID string
	look        *proto.Look // nil for dev tickets: clients draw the default look
}

// checkTicket checks hello's ticket. A real ticket is signed by the backend API with TicketKey, for
// this world, unexpired and unused (docs/architecture/backend.md, "Join tickets"). A dev ticket is
// "dev:<name>", accepted only with DevTickets on.
func (s *Server) checkTicket(t string) (joiner, bool) {
	if name, ok := strings.CutPrefix(t, "dev:"); ok {
		if !s.cfg.DevTickets || !names.WellFormed(name) {
			return joiner{}, false
		}
		return joiner{name: name, role: proto.RoleNormal}, true
	}
	if s.tickets == nil {
		return joiner{}, false
	}
	p, err := s.tickets.Check(t, s.cfg.Now())
	if err != nil {
		s.log.Info("join ticket refused", "why", err)
		return joiner{}, false
	}
	role := platform.Role(p.Role)
	switch {
	case !names.WellFormed(p.Name) || !role.Valid() || !platform.ValidAccountID(p.AccountID) || p.CharacterID == "":
		s.log.Warn("join ticket has a valid signature but bad contents", "account", p.AccountID)
		return joiner{}, false
	case s.cfg.PremiumOnly && !p.Premium:
		s.log.Info("join ticket refused", "why", "premium world, no Premium", "account", p.AccountID)
		return joiner{}, false
	}
	return joiner{name: p.Name, role: proto.Role(role.Rank()), accountID: p.AccountID, characterID: p.CharacterID,
		look: lookOf(p.Appearance)}, true
}

// lookOf turns a ticket's appearance into what entity_enter sends. One with a part that isn't
// shaped like an id is dropped (the player is drawn with the default look) rather than refusing
// the ticket: the API signed it, and the look is only cosmetic.
func lookOf(a *content.Look) *proto.Look {
	if a == nil || !a.WellFormed() {
		return nil
	}
	return &proto.Look{BodyType: a.BodyType, SkinTone: a.SkinTone, HairStyle: a.HairStyle,
		HairColour: a.HairColour, Beard: a.Beard}
}
