// Package world is a world server's network side: the WebSocket endpoint at /w/<world-id>, the
// handshake, and one session per connection, which feeds a region's inbox and carries its frames back
// (docs/architecture/networking.md). Game logic lives in the region; nothing here decides anything
// about the game.
package world

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
)

// Config is a world server's network settings. DefaultConfig fills in the spec's values.
type Config struct {
	// WorldID is the world this process serves: clients connect to /w/<WorldID>.
	WorldID string
	// ContentHash is the server's data/ hash. A client whose hello has a different one is out of date
	// and is told to refresh.
	ContentHash string
	// DevTickets accepts "dev:<name>" tickets (development only; see networking.md "Dev tickets").
	DevTickets bool
	// OriginPatterns are the browser origins allowed to connect besides the server's own host, as
	// github.com/coder/websocket AcceptOptions.OriginPatterns.
	OriginPatterns []string

	// HelloTimeout: a connection must send hello within this.
	HelloTimeout time.Duration
	// SilenceTimeout: a connection that sends nothing for this long is dropped. Clients ping every 5 s.
	SilenceTimeout time.Duration
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
		WorldID:          worldID,
		ContentHash:      contentHash,
		HelloTimeout:     10 * time.Second,
		SilenceTimeout:   20 * time.Second,
		WriteTimeout:     10 * time.Second,
		QueueFrames:      64, // 3.2 s of ticks at 20 Hz
		BytesPerSecond:   4 << 10,
		BytesBurst:       16 << 10,
		PingPerSecond:    1,
		PingBurst:        3,
		InvalidPerMinute: 50,
	}
}

// Server accepts connections and runs their sessions. Players join the spawn region.
type Server struct {
	cfg   Config
	spawn *region.Region
	// regionDone is closed once the regions have stopped, so a session never blocks on a dead inbox.
	regionDone <-chan struct{}
	log        *slog.Logger

	nextID   atomic.Uint64
	mu       sync.Mutex
	closing  bool
	sessions map[*session]struct{}
	wg       sync.WaitGroup
}

// New makes a server whose players join spawn. regionDone must be closed when the regions stop.
func New(cfg Config, spawn *region.Region, regionDone <-chan struct{}, log *slog.Logger) *Server {
	return &Server{cfg: cfg, spawn: spawn, regionDone: regionDone, log: log, sessions: map[*session]struct{}{}}
}

// Handler serves /w/<world-id> (WebSocket) and /healthz.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /w/{world}", s.serveWS)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok\n")) })
	return mux
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

// checkTicket returns the display name a ticket joins as. Real tickets (signed by the backend API)
// arrive in M1; until then only dev tickets exist, and only with DevTickets on.
func (s *Server) checkTicket(ticket string) (string, bool) {
	name, ok := strings.CutPrefix(ticket, "dev:")
	if !ok || !s.cfg.DevTickets || !ValidName(name) {
		return "", false
	}
	return name, true
}

// ValidName reports whether name follows the character name rules (docs/architecture/backend.md):
// 3–12 characters, letters and numbers with single spaces between words, no space at either end.
// Dev tickets use plain ASCII letters and digits; the word filter and uniqueness come with real
// characters in M1.
func ValidName(name string) bool {
	if len(name) < 3 || len(name) > 12 || name[0] == ' ' || name[len(name)-1] == ' ' {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == ' ' && name[i-1] != ' ':
		default:
			return false
		}
	}
	return true
}
