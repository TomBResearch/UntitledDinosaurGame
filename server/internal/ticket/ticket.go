// Package ticket makes and checks join tickets: the backend API signs one when a player picks a
// character and a world, and that world server checks it in hello (docs/architecture/backend.md,
// "Join tickets").
//
//	ticket  = base64url(payload) + "." + base64url(HMAC-SHA256(WORLD_TICKET_KEY, payload))
//	payload = JSON {accountId, characterId, worldId, name, role, premium, nonce, exp}
//
// base64url has no padding. exp is in Unix seconds.
package ticket

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// TTL is how long a ticket is valid for.
const TTL = 30 * time.Second

// maxAhead is the furthest in the future a ticket's exp may be. A ticket that claims to last longer
// than this wasn't made by our API, even with a valid signature (a leaked key, or a bug).
const maxAhead = 2 * TTL

// MinKeyBytes is the shortest WORLD_TICKET_KEY accepted: 32 bytes, the size of the HMAC.
const MinKeyBytes = 32

// ParseKey turns the WORLD_TICKET_KEY environment variable into a key: its bytes as they are, at
// least MinKeyBytes of them (make one with openssl rand -base64 36).
func ParseKey(env string) ([]byte, error) {
	if len(env) < MinKeyBytes {
		return nil, fmt.Errorf("WORLD_TICKET_KEY must be at least %d characters (openssl rand -base64 36)", MinKeyBytes)
	}
	return []byte(env), nil
}

// Payload is what a ticket says. The role and Premium are as they were when the API issued it.
type Payload struct {
	AccountID   string `json:"accountId"`
	CharacterID string `json:"characterId"`
	WorldID     string `json:"worldId"`
	// Name is the character's display name.
	Name string `json:"name"`
	// Role is the account's platform role ("normal", "premium", "moderator", "admin", "owner").
	Role string `json:"role"`
	// Premium is true for Premium accounts and for staff (staff count as Premium).
	Premium bool   `json:"premium"`
	Nonce   string `json:"nonce"`
	Exp     int64  `json:"exp"`
}

// Errors from Verify and Guard.Check. They're for logs and tests; a player is only ever told
// bad_ticket.
var (
	ErrMalformed  = errors.New("ticket: malformed")
	ErrSignature  = errors.New("ticket: bad signature")
	ErrExpired    = errors.New("ticket: expired")
	ErrTooFar     = errors.New("ticket: expiry too far ahead")
	ErrWrongWorld = errors.New("ticket: for another world")
	ErrReused     = errors.New("ticket: already used")
)

var b64 = base64.RawURLEncoding

// NewNonce is 16 random bytes, base64url.
func NewNonce() string {
	var b [16]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails
	return b64.EncodeToString(b[:])
}

// Sign makes a ticket. The caller fills in every field, including Nonce and Exp.
func Sign(key []byte, p Payload) (string, error) {
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return b64.EncodeToString(body) + "." + b64.EncodeToString(mac(key, body)), nil
}

func mac(key, body []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(body)
	return h.Sum(nil)
}

// Verify checks a ticket's signature and expiry and returns its payload. It doesn't check the world
// or whether the ticket was used before: Guard.Check does all of it.
func Verify(key []byte, s string, now time.Time) (Payload, error) {
	var p Payload
	body64, sig64, ok := strings.Cut(s, ".")
	if !ok || len(key) == 0 {
		return p, ErrMalformed
	}
	body, err1 := b64.DecodeString(body64)
	sig, err2 := b64.DecodeString(sig64)
	if err1 != nil || err2 != nil || len(sig) != sha256.Size {
		return p, ErrMalformed
	}
	if !hmac.Equal(sig, mac(key, body)) {
		return p, ErrSignature
	}
	if err := json.Unmarshal(body, &p); err != nil || p.Nonce == "" || len(p.Nonce) > 64 || p.Exp == 0 {
		return Payload{}, ErrMalformed
	}
	exp := time.Unix(p.Exp, 0)
	if !now.Before(exp) {
		return Payload{}, ErrExpired
	}
	if exp.Sub(now) > maxAhead {
		return Payload{}, ErrTooFar
	}
	return p, nil
}

// Guard is a world server's ticket check: Verify, the world, and single use. It remembers each used
// nonce until its ticket expires. Safe for concurrent use.
type Guard struct {
	key     []byte
	worldID string

	mu        sync.Mutex
	used      map[string]int64 // nonce -> exp (Unix seconds)
	nextPrune int64
}

// NewGuard makes a guard for one world.
func NewGuard(key []byte, worldID string) *Guard {
	return &Guard{key: key, worldID: worldID, used: map[string]int64{}}
}

// Check accepts a ticket at most once, and only for this guard's world.
func (g *Guard) Check(s string, now time.Time) (Payload, error) {
	p, err := Verify(g.key, s, now)
	if err != nil {
		return p, err
	}
	if p.WorldID != g.worldID {
		return Payload{}, ErrWrongWorld
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	t := now.Unix()
	if t >= g.nextPrune { // forget nonces whose tickets have expired anyway
		for n, exp := range g.used {
			if exp <= t {
				delete(g.used, n)
			}
		}
		g.nextPrune = t + int64(TTL/time.Second)
	}
	if _, seen := g.used[p.Nonce]; seen {
		return Payload{}, ErrReused
	}
	g.used[p.Nonce] = p.Exp
	return p, nil
}

// Remembered is how many nonces the guard is holding (tests).
func (g *Guard) Remembered() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.used)
}
