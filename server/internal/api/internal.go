package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
)

// InternalHandler serves the routes only the account platform calls: the deletion hook. cmd/api
// serves it on its own listener (-internal-addr, port 3001 in production), which Caddy never
// proxies to and which is published only on the Docker networks, so it can't be reached from the
// internet even if a Caddy route went wrong. The public Handler has no /internal routes at all.
func (s *Server) InternalHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /internal/players/{id}", s.deletePlayer)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, http.StatusNotFound, "not_found") })
	return mux
}

// serviceKeyOK checks Authorization: Service <key> in constant time. An unset key refuses everyone.
func (s *Server) serviceKeyOK(r *http.Request) bool {
	got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Service ")
	if !ok || s.cfg.ServiceKey == "" {
		return false
	}
	a, b := sha256.Sum256([]byte(got)), sha256.Sum256([]byte(s.cfg.ServiceKey))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// deletePlayer is the platform's deletion hook (docs/architecture/accounts.md, and the platform's
// docs/spec.md "Account deletion"). The platform calls it before it deletes an account, and goes
// ahead only on a 2xx: anything else, or no answer in 10 s, stops the deletion and the player can
// try again. So it answers 204 for any account, seen or not, deleted before or not, and only fails
// when the database does (503, which the platform treats as "try again").
//
// An account that's online is deleted anyway: its characters' rows go, so the world holding the
// lease can't save them any more (it only ever updates rows by lease id), and its next lease renewal
// finds the lease gone and disconnects the player (persist.Saver, at most RenewEvery later).
func (s *Server) deletePlayer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.serviceKeyOK(r) {
		s.cfg.Log.Warn("deletion hook: refused a request without the service key", "remote", r.RemoteAddr)
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id := r.PathValue("id")
	if !platform.ValidAccountID(id) {
		writeError(w, http.StatusBadRequest, "bad_account_id")
		return
	}
	n, err := s.cfg.Store.DeleteAccount(r.Context(), id, s.cfg.Now())
	if err != nil {
		s.cfg.Log.Error("deletion hook: database error", "account", id, "err", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable")
		return
	}
	if f, ok := s.cfg.Accounts.(interface{ Forget(string) }); ok {
		f.Forget(id)
	}
	s.cfg.Log.Info("deletion hook: account deleted", "account", id, "characters", n)
	w.WriteHeader(http.StatusNoContent)
}
