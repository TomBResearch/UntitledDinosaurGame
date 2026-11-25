package world

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
)

// These tests run a real world server over loopback. Its region ticks every millisecond rather than
// every 50 ms (the simulation is the same; only the wall clock is faster), and every wait is bounded
// by a context deadline, never a sleep.

var loadData = sync.OnceValues(func() (*content.Content, error) { return content.Load("../../../data") })

type testWorld struct {
	t    *testing.T
	srv  *Server
	http *httptest.Server
	data *content.Content
}

func startWorld(t *testing.T, tweak func(*Config)) *testWorld {
	t.Helper()
	data, err := loadData()
	if err != nil {
		t.Fatal(err)
	}
	var rf *navmesh.Region
	for _, r := range data.Regions {
		if r.ID == "test_greybox" {
			rf = r
		}
	}
	reg, err := region.New(rf, region.ConfigFor(data))
	if err != nil {
		t.Fatal(err)
	}
	ctx, stop := context.WithCancel(context.Background())
	ticking := make(chan struct{})
	go func() { reg.Run(ctx, time.Millisecond); close(ticking) }()

	cfg := DefaultConfig("dev", data.Hash)
	cfg.DevTickets = true
	if tweak != nil {
		tweak(&cfg)
	}
	srv := New(cfg, reg, ctx.Done(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	hs := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		shut, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shut); err != nil {
			t.Error(err)
		}
		hs.Close()
		stop()
		<-ticking
	})
	return &testWorld{t: t, srv: srv, http: hs, data: data}
}

func testCtx(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func (w *testWorld) dial(ctx context.Context, path string) *websocket.Conn {
	w.t.Helper()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(w.http.URL, "http")+path, nil)
	if err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() { _ = c.CloseNow() })
	return c
}

func (w *testWorld) hello(ticket string) *proto.Hello {
	return &proto.Hello{ProtocolHash: proto.ProtocolHash, Ticket: ticket, ContentHash: w.data.Hash, ClientVersion: "test"}
}

func send(t *testing.T, ctx context.Context, c *websocket.Conn, msgs ...proto.Message) {
	t.Helper()
	var b []byte
	for _, m := range msgs {
		var err error
		if b, err = proto.Append(b, m); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.Write(ctx, websocket.MessageBinary, b); err != nil {
		t.Fatal(err)
	}
}

// pending holds decoded messages a test hasn't looked at yet, per connection (a frame often holds
// several).
var pending sync.Map // *websocket.Conn -> *[]proto.Message

// readUntil returns the next message of type T, skipping others.
func readUntil[T proto.Message](t *testing.T, ctx context.Context, c *websocket.Conn) T {
	t.Helper()
	v, _ := pending.LoadOrStore(c, &[]proto.Message{})
	queue := v.(*[]proto.Message)
	for {
		for len(*queue) > 0 {
			m := (*queue)[0]
			*queue = (*queue)[1:]
			if v, ok := m.(T); ok {
				return v
			}
		}
		typ, b, err := c.Read(ctx)
		if err != nil {
			var zero T
			t.Fatalf("waiting for %T: %v", zero, err)
		}
		if typ != websocket.MessageBinary {
			t.Fatal("text frame from the server")
		}
		msgs, err := proto.Decode(b, proto.FromServer)
		if err != nil {
			t.Fatal(err)
		}
		*queue = msgs
	}
}

// expectKick reads the kick, then the close.
func expectKick(t *testing.T, ctx context.Context, c *websocket.Conn, want proto.KickReason) {
	t.Helper()
	if k := readUntil[*proto.Kick](t, ctx, c); k.Reason != want {
		t.Fatalf("kick reason %v, want %v", k.Reason, want)
	}
	expectClosed(t, ctx, c)
}

func expectClosed(t *testing.T, ctx context.Context, c *websocket.Conn) {
	t.Helper()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			if ctx.Err() != nil {
				t.Fatal("connection still open at the deadline")
			}
			return
		}
	}
}

func TestHelloWelcomeMovePath(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	send(t, ctx, c, w.hello("dev:Ugg"))
	welcome := readUntil[*proto.Welcome](t, ctx, c)
	if welcome.Region != "test_greybox" || welcome.TickHz != 20 || welcome.Entity == 0 {
		t.Fatalf("bad welcome %+v", welcome)
	}
	self := readUntil[*proto.EntityEnter](t, ctx, c)
	if self.Entity != welcome.Entity || self.Name != "Ugg" {
		t.Fatalf("bad self entity_enter %+v", self)
	}
	send(t, ctx, c, &proto.MoveTo{Position: proto.Pos{X: 400, Y: 150, Z: 1400}})
	ps := readUntil[*proto.PathStarted](t, ctx, c)
	if ps.Entity != welcome.Entity || len(ps.Path.Waypoints) < 2 || ps.Path.Waypoints[0] != self.Position {
		t.Fatalf("bad path_started %+v", ps)
	}
	if ps.Path.Speed != 400 {
		t.Fatalf("speed %d cm/s, want data/'s 4 m/s", ps.Path.Speed)
	}

	send(t, ctx, c, &proto.Ping{ClientTime: 12345})
	pong := readUntil[*proto.Pong](t, ctx, c)
	if pong.ClientTime != 12345 || pong.ServerTick < ps.Path.StartTick {
		t.Fatalf("bad pong %+v", pong)
	}
}

func TestTwoPlayersSeeEachOther(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	a := w.dial(ctx, "/w/dev")
	send(t, ctx, a, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, a)
	b := w.dial(ctx, "/w/dev")
	send(t, ctx, b, w.hello("dev:Grok Two"))
	idB := readUntil[*proto.Welcome](t, ctx, b).Entity
	for {
		if e := readUntil[*proto.EntityEnter](t, ctx, a); e.Entity == idB {
			if e.Name != "Grok Two" {
				t.Fatalf("A sees B as %q", e.Name)
			}
			break
		}
	}
	_ = a.Close(websocket.StatusNormalClosure, "")
	if l := readUntil[*proto.EntityLeave](t, ctx, b); l.Entity == idB {
		t.Fatal("B was told it left")
	}
}

func TestStaleProtocolIsToldToRefresh(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	h := w.hello("dev:Ugg")
	h.ProtocolHash ^= 1
	send(t, ctx, c, h)
	expectKick(t, ctx, c, proto.KickReasonRefresh)
}

func TestStaleContentIsToldToRefresh(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	h := w.hello("dev:Ugg")
	h.ContentHash = strings.Repeat("0", 64)
	send(t, ctx, c, h)
	expectKick(t, ctx, c, proto.KickReasonRefresh)
}

func TestTicketsAreRefused(t *testing.T) {
	cases := map[string]struct {
		dev    bool
		ticket string
	}{
		"dev ticket without -dev-tickets":  {false, "dev:Ugg"},
		"real ticket without a ticket key": {true, "eyJhbGciOi.c2ln"},
		"empty ticket":                     {true, ""},
		"name too short":                   {true, "dev:Ug"},
		"name too long":                    {true, "dev:Ugg the Mighty"},
		"double space":                     {true, "dev:Ugg  Two"},
		"leading space":                    {true, "dev: Ugg"},
		"symbol":                           {true, "dev:Ugg!"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			w := startWorld(t, func(c *Config) { c.DevTickets = tc.dev })
			ctx := testCtx(t)
			c := w.dial(ctx, "/w/dev")
			send(t, ctx, c, w.hello(tc.ticket))
			expectKick(t, ctx, c, proto.KickReasonBadTicket)
		})
	}
}

func TestGarbageFrameDropsTheConnection(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	send(t, ctx, c, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, c)
	if err := c.Write(ctx, websocket.MessageBinary, []byte{0xee, 0}); err != nil {
		t.Fatal(err)
	}
	expectClosed(t, ctx, c)
}

func TestOversizedFrameDropsTheConnection(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	_ = c.Write(ctx, websocket.MessageBinary, make([]byte, proto.MaxClientMessageSize+1))
	expectClosed(t, ctx, c)
}

// waitFor polls cond until it's true or ctx ends. It waits on a condition, never a fixed time.
func waitFor(t *testing.T, ctx context.Context, what string, cond func() bool) {
	t.Helper()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for !cond() {
		select {
		case <-ctx.Done():
			t.Fatalf("timed out waiting for %s", what)
		case <-tick.C:
		}
	}
}

func quickKeepalive(c *Config) {
	c.SilenceTimeout = 20 * time.Millisecond
	c.KeepaliveInterval = 4 * time.Millisecond
}

// A client that stops reading also stops answering pings (pongs are sent from Read), like a
// crashed browser or a dead network. It's dropped after the silence timeout.
func TestSilentConnectionIsDropped(t *testing.T) {
	w := startWorld(t, quickKeepalive)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	send(t, ctx, c, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, c)
	waitFor(t, ctx, "the silent session to be dropped", func() bool { return w.srv.Sessions() == 0 })
	expectClosed(t, ctx, c)
}

// A background browser tab pauses the game, so the client sends nothing, but the browser still
// answers WebSocket pings. That player stays connected well past the silence timeout.
func TestQuietClientThatAnswersPingsStays(t *testing.T) {
	w := startWorld(t, quickKeepalive)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	send(t, ctx, c, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, c)
	// Keep reading (which answers pings) but never send anything.
	go func() {
		for {
			if _, _, err := c.Read(ctx); err != nil {
				return
			}
		}
	}()
	start := time.Now()
	before := w.srv.keepalivesAnswered.Load()
	waitFor(t, ctx, "15 keepalives", func() bool { return w.srv.keepalivesAnswered.Load() >= before+15 })
	if quiet := time.Since(start); quiet < 2*20*time.Millisecond {
		t.Fatalf("only %v of quiet; want well past the 20 ms silence timeout", quiet)
	}
	if n := w.srv.Sessions(); n != 1 {
		t.Fatalf("%d sessions after a long quiet spell answering pings, want 1", n)
	}
}

func TestWrongWorldIsNotFound(t *testing.T) {
	w := startWorld(t, nil)
	resp, err := http.Get(w.http.URL + "/w/other")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestShutdownKicksEveryone(t *testing.T) {
	w := startWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/dev")
	send(t, ctx, c, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, c)
	go func() { _ = w.srv.Shutdown(ctx) }()
	expectKick(t, ctx, c, proto.KickReasonShutdown)
}

// The tick never waits for a connection: a full queue makes Deliver fail at once, and the region
// then drops the player.
func TestSessionQueueIsBounded(t *testing.T) {
	cfg := DefaultConfig("dev", "")
	cfg.QueueFrames = 3
	s := newSession(&Server{cfg: cfg}, 1, nil)
	for i := range 3 {
		if !s.Deliver([]byte{byte(i)}) {
			t.Fatalf("frame %d refused with room in the queue", i)
		}
	}
	if s.Deliver([]byte{9}) {
		t.Fatal("a full queue accepted a frame")
	}
	s.Disconnect(region.DisconnectTooSlow)
	if s.mode != endAbrupt {
		t.Fatalf("too slow should drop the connection abruptly, got mode %d", s.mode)
	}
}
