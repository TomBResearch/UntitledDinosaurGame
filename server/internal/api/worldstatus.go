package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// WorldStatus says whether a world is up and how many players it has.
type WorldStatus interface {
	Status(ctx context.Context, worldID int) (players int, online bool)
}

// HTTPWorldStatus asks each world server's GET /status (inside Docker only), and caches the answer
// for TTL so the world list doesn't hit the worlds on every request.
type HTTPWorldStatus struct {
	// URL has {id} where the world id goes, for example http://world-{id}:8090/status.
	URL  string
	HTTP *http.Client
	TTL  time.Duration
	Now  func() time.Time

	mu    sync.Mutex
	cache map[int]statusEntry
}

type statusEntry struct {
	players int
	online  bool
	at      time.Time
}

// NewHTTPWorldStatus makes a status source with a 5 s cache and a 1 s timeout.
func NewHTTPWorldStatus(url string) *HTTPWorldStatus {
	return &HTTPWorldStatus{URL: url, HTTP: &http.Client{Timeout: time.Second}, TTL: 5 * time.Second, Now: time.Now,
		cache: map[int]statusEntry{}}
}

func (h *HTTPWorldStatus) Status(ctx context.Context, worldID int) (int, bool) {
	now := h.Now()
	h.mu.Lock()
	if e, ok := h.cache[worldID]; ok && now.Sub(e.at) < h.TTL {
		h.mu.Unlock()
		return e.players, e.online
	}
	h.mu.Unlock()
	players, online := h.fetch(ctx, worldID)
	h.mu.Lock()
	h.cache[worldID] = statusEntry{players, online, now}
	h.mu.Unlock()
	return players, online
}

func (h *HTTPWorldStatus) fetch(ctx context.Context, worldID int) (int, bool) {
	id := strconv.Itoa(worldID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.ReplaceAll(h.URL, "{id}", id), nil)
	if err != nil {
		return 0, false
	}
	resp, err := h.HTTP.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	var st struct {
		World   string `json:"world"`
		Players int    `json:"players"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 4<<10)).Decode(&st) != nil || st.World != id {
		return 0, false
	}
	return st.Players, true
}

// Population is how busy a world looks in the list: low under a quarter full, medium under 60 %,
// high below full, then full.
func Population(players, maxPlayers int) string {
	switch {
	case players >= maxPlayers:
		return "full"
	case players*100 < maxPlayers*25:
		return "low"
	case players*100 < maxPlayers*60:
		return "medium"
	default:
		return "high"
	}
}
