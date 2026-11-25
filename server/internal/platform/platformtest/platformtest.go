// Package platformtest is a stand-in account platform for tests: it signs access tokens the way the
// platform does, and holds accounts' fresh state.
package platformtest

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
)

// Issuer and Audience are the production values, which tests use too.
const (
	Issuer   = "https://accounts.untitledgames.co.uk"
	Audience = "tomblundell-games"
)

// Platform signs tokens with one Ed25519 key (id "test-key") and serves it as a KeySource. Its
// accounts are an AccountSource.
type Platform struct {
	Kid  string
	Priv ed25519.PrivateKey
	Pub  ed25519.PublicKey

	mu       sync.Mutex
	accounts map[string]platform.Account
	// Down makes Account fail as if the service API were unreachable.
	Down bool
	// Lookups counts Account calls.
	Lookups int
}

// New makes a platform with a fresh key.
func New() *Platform {
	pub, priv, _ := ed25519.GenerateKey(nil)
	return &Platform{Kid: "test-key", Priv: priv, Pub: pub, accounts: map[string]platform.Account{}}
}

// Key is the KeySource.
func (p *Platform) Key(_ context.Context, kid string) (ed25519.PublicKey, error) {
	if kid != p.Kid {
		return nil, errors.New("unknown key id")
	}
	return p.Pub, nil
}

// JWKS is the key set as the platform publishes it.
func (p *Platform) JWKS() []byte {
	b, _ := json.Marshal(map[string]any{"keys": []map[string]string{{
		"kty": "OKP", "crv": "Ed25519", "x": base64.RawURLEncoding.EncodeToString(p.Pub),
		"kid": p.Kid, "alg": "EdDSA", "use": "sig",
	}}})
	return b
}

// Set stores an account's fresh state.
func (p *Platform) Set(a platform.Account) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accounts[a.ID] = a
}

// Account is the AccountSource.
func (p *Platform) Account(_ context.Context, id string) (platform.Account, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Lookups++
	if p.Down {
		return platform.Account{}, platform.ErrUnavailable
	}
	a, ok := p.accounts[id]
	if !ok {
		return platform.Account{}, platform.ErrNoAccount
	}
	return a, nil
}

// Token signs an access token for the account, valid for 15 minutes from now, with the account's
// stored role and Premium (or normal if it isn't stored).
func (p *Platform) Token(accountID string, now time.Time) string {
	p.mu.Lock()
	a := p.accounts[accountID]
	p.mu.Unlock()
	role := a.Role
	if role == "" {
		role = platform.RoleNormal
	}
	return p.Sign(map[string]any{
		"sub": accountID, "username": a.Username, "role": role, "premium": a.Premium,
		"iss": Issuer, "aud": Audience, "iat": now.Unix(), "exp": now.Add(15 * time.Minute).Unix(),
	})
}

// Sign signs any claims with the platform's key, as an EdDSA JWT.
func (p *Platform) Sign(claims map[string]any) string {
	return p.SignWith(map[string]any{"alg": "EdDSA", "kid": p.Kid, "typ": "JWT"}, claims, p.Priv)
}

// SignWith signs with any header and key (for forged tokens).
func (p *Platform) SignWith(header, claims map[string]any, key ed25519.PrivateKey) string {
	enc := base64.RawURLEncoding
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	signing := enc.EncodeToString(h) + "." + enc.EncodeToString(c)
	return signing + "." + enc.EncodeToString(ed25519.Sign(key, []byte(signing)))
}
