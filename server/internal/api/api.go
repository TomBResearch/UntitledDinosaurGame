// Package api is the backend API (cmd/api): worlds, characters and join tickets, for players logged
// in on the shared account platform (docs/architecture/backend.md). It's stateless; everything lasting
// is in the Store.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
)

// Config is everything the API needs. Tests fill it with fakes.
type Config struct {
	Store Store
	// Tokens checks platform access tokens.
	Tokens interface {
		Verify(ctx context.Context, token string) (platform.Claims, error)
	}
	// Accounts gives an account's fresh role, Premium and ban state (the service API, cached ≤ 30 s).
	Accounts platform.AccountSource
	// Worlds says whether each world is up and how many players it has.
	Worlds WorldStatus
	// TicketKey is WORLD_TICKET_KEY.
	TicketKey []byte
	// PublicWS is where players' browsers reach the worlds, without the path: for example
	// wss://dinosaur.untitledgames.co.uk. A world's ws_path is added to it. {id} in it is replaced by
	// the world's id, so local worlds can each have their own port (ws://127.0.0.1:809{id}).
	PublicWS string
	// Data is the game content: skills and the XP table (character levels), and the name filter.
	Data *content.Content
	// TrustProxy takes the client's IP from X-Real-IP (set by Caddy), not the connection.
	TrustProxy bool
	Version    string
	Now        func() time.Time
	Log        *slog.Logger
	// Limits are the rate limits; zero means DefaultLimits.
	Limits Limits
}

// Server serves the API.
type Server struct {
	cfg     Config
	limiter *limiter
	routes  []route
}

// authLevel is who may call a route.
type authLevel uint8

const (
	// public routes need no login.
	public authLevel = iota
	// player routes need a valid access token for an account that isn't deleted.
	player
	// staff routes are player routes that also need a fresh role (from the service API) of at least
	// minRole. The token's role is never enough (CLAUDE.md rule 8).
	staff
)

type route struct {
	pattern string // a net/http pattern, "METHOD /path"
	auth    authLevel
	minRole platform.Role // staff routes
	// limit is an extra per-account rate limit for this route, on top of the general ones.
	limit *Rate
	h     func(w http.ResponseWriter, r *http.Request, who *caller)
}

// caller is who is calling a player or staff route.
type caller struct {
	claims platform.Claims
	// fresh is the service API's answer, for staff routes (and join, which fetches it itself).
	fresh *platform.Account
}

// New makes a server.
func New(cfg Config) *Server {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Log == nil {
		cfg.Log = slog.New(slog.DiscardHandler)
	}
	if cfg.Limits == (Limits{}) {
		cfg.Limits = DefaultLimits
	}
	s := &Server{cfg: cfg, limiter: newLimiter()}
	createLimit := cfg.Limits.CreateCharacter
	s.routes = []route{
		{pattern: "GET /api/health", auth: public, h: s.health},
		{pattern: "GET /api/worlds", auth: public, h: s.worlds},
		{pattern: "GET /api/characters", auth: player, h: s.listCharacters},
		{pattern: "POST /api/characters", auth: player, limit: &createLimit, h: s.createCharacter},
		{pattern: "PATCH /api/characters/{id}", auth: player, h: s.renameCharacter},
		{pattern: "DELETE /api/characters/{id}", auth: player, h: s.deleteCharacter},
		{pattern: "POST /api/join", auth: player, h: s.join},
	}
	return s
}

// Handler is the API's HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	for _, rt := range s.routes {
		mux.Handle(rt.pattern, s.wrap(rt))
	}
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, http.StatusNotFound, "not_found") })
	return mux
}

// wrap applies rate limits and auth to a route.
func (s *Server) wrap(rt route) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		now := s.cfg.Now()
		if wait, ok := s.limiter.take("ip:"+s.clientIP(r), s.cfg.Limits.PerIP, now); !ok {
			tooMany(w, wait)
			return
		}
		if rt.auth == public {
			rt.h(w, r, nil)
			return
		}
		who, status, code := s.authenticate(r)
		if who == nil {
			writeError(w, status, code)
			return
		}
		if wait, ok := s.limiter.take("acct:"+who.claims.AccountID, s.cfg.Limits.PerAccount, now); !ok {
			tooMany(w, wait)
			return
		}
		if rt.limit != nil {
			if wait, ok := s.limiter.take(rt.pattern+":"+who.claims.AccountID, *rt.limit, now); !ok {
				tooMany(w, wait)
				return
			}
		}
		if rt.auth == staff {
			acct, err := s.cfg.Accounts.Account(r.Context(), who.claims.AccountID)
			if err != nil {
				s.freshError(w, err)
				return
			}
			if acct.Banned || !acct.Role.AtLeast(rt.minRole) {
				s.cfg.Log.Warn("staff action refused", "route", rt.pattern, "account", who.claims.AccountID, "role", acct.Role)
				writeError(w, http.StatusForbidden, "forbidden")
				return
			}
			who.fresh = &acct
		}
		rt.h(w, r, who)
	})
}

// authenticate checks the bearer token and the deleted-accounts list.
func (s *Server) authenticate(r *http.Request) (*caller, int, string) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || token == "" {
		return nil, http.StatusUnauthorized, "unauthorized"
	}
	claims, err := s.cfg.Tokens.Verify(r.Context(), token)
	if err != nil {
		return nil, http.StatusUnauthorized, "unauthorized"
	}
	deleted, err := s.cfg.Store.AccountDeleted(r.Context(), claims.AccountID)
	if err != nil {
		s.cfg.Log.Error("deleted-accounts check failed", "err", err)
		return nil, http.StatusServiceUnavailable, "unavailable"
	}
	if deleted {
		return nil, http.StatusUnauthorized, "unauthorized"
	}
	return &caller{claims: claims}, 0, ""
}

// freshError answers a failed service API lookup.
func (s *Server) freshError(w http.ResponseWriter, err error) {
	if errors.Is(err, platform.ErrNoAccount) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	s.cfg.Log.Error("service API lookup failed", "err", err)
	writeError(w, http.StatusServiceUnavailable, "accounts_unavailable")
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// maxBody is the largest request body the API reads.
const maxBody = 4 << 10

// readJSON decodes a small JSON body into v. Unknown fields are ignored, so an older API accepts a
// newer client's extra fields.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	if err := dec.Decode(v); err != nil || dec.Decode(&struct{}{}) != io.EOF {
		writeError(w, http.StatusBadRequest, "bad_request")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// apiError is every error body: {"error": "<code>"} plus any detail fields.
type apiError struct {
	Error   string     `json:"error"`
	Reason  string     `json:"reason,omitempty"`
	RetryAt *time.Time `json:"retryAt,omitempty"`
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, apiError{Error: code})
}
