package api

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Rate is a token bucket: Burst requests at once, refilled at Burst per Per.
type Rate struct {
	Burst int
	Per   time.Duration
}

// Limits are the API's rate limits (docs/architecture/backend.md).
type Limits struct {
	PerIP, PerAccount Rate
	// CreateCharacter is per account, on top of the others.
	CreateCharacter Rate
}

// DefaultLimits: 60 a minute per IP and per account, and 10 character creations an hour.
var DefaultLimits = Limits{
	PerIP:           Rate{Burst: 60, Per: time.Minute},
	PerAccount:      Rate{Burst: 60, Per: time.Minute},
	CreateCharacter: Rate{Burst: 10, Per: time.Hour},
}

// limiter holds a bucket per key, in memory. Each API copy limits on its own, which is fine at our
// size. Full buckets are forgotten, so it doesn't grow without bound.
type limiter struct {
	mu        sync.Mutex
	buckets   map[string]*bucket
	nextPrune time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
	rate   Rate
}

func newLimiter() *limiter { return &limiter{buckets: map[string]*bucket{}} }

// take spends one token from key's bucket. If there's none, it says how long until there is.
func (l *limiter) take(key string, r Rate, now time.Time) (time.Duration, bool) {
	if r.Burst <= 0 {
		return 0, true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if !now.Before(l.nextPrune) {
		for k, b := range l.buckets {
			if b.level(now) >= float64(b.rate.Burst) {
				delete(l.buckets, k)
			}
		}
		l.nextPrune = now.Add(time.Minute)
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(r.Burst), at: now, rate: r}
		l.buckets[key] = b
	}
	b.tokens, b.at = b.level(now), now
	if b.tokens < 1 {
		perToken := r.Per / time.Duration(r.Burst)
		return time.Duration((1 - b.tokens) * float64(perToken)), false
	}
	b.tokens--
	return 0, true
}

func (b *bucket) level(now time.Time) float64 {
	refill := float64(now.Sub(b.at)) / float64(b.rate.Per) * float64(b.rate.Burst)
	return min(float64(b.rate.Burst), b.tokens+max(0, refill))
}

func tooMany(w http.ResponseWriter, wait time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
	writeError(w, http.StatusTooManyRequests, "rate_limited")
}
