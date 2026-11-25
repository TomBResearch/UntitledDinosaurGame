package platform

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Claims are what an access token says about its account. Role and Premium can be up to 15 minutes
// old; use the service API (Accounts) for anything that must be current.
type Claims struct {
	AccountID string
	Username  string
	Role      Role
	Premium   bool
	Expires   time.Time
}

// ErrBadToken is any reason a token is refused. The reason is wrapped for logs; callers answer 401
// without details.
var ErrBadToken = errors.New("platform: bad access token")

// KeySource finds a token signing key by its id.
type KeySource interface {
	Key(ctx context.Context, kid string) (ed25519.PublicKey, error)
}

// Verifier checks platform access tokens locally: EdDSA (Ed25519) signatures against the platform's
// published keys, plus iss, aud and exp.
type Verifier struct {
	Keys     KeySource
	Issuer   string
	Audience string
	// Now is the clock (tests set it).
	Now func() time.Time
}

// leeway allows for clock drift between the platform and us when checking exp.
const leeway = 10 * time.Second

var b64 = base64.RawURLEncoding

// Verify checks a compact JWS and returns its claims.
func (v *Verifier) Verify(ctx context.Context, token string) (Claims, error) {
	bad := func(why string) (Claims, error) { return Claims{}, fmt.Errorf("%w: %s", ErrBadToken, why) }
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(token) > 8<<10 {
		return bad("not a compact JWS")
	}
	headerJSON, err1 := b64.DecodeString(parts[0])
	payloadJSON, err2 := b64.DecodeString(parts[1])
	sig, err3 := b64.DecodeString(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return bad("not base64url")
	}
	var header struct {
		Alg  string          `json:"alg"`
		Kid  string          `json:"kid"`
		Crit json.RawMessage `json:"crit"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return bad("header")
	}
	// Only EdDSA: never "none", never an HMAC algorithm keyed with a public key.
	if header.Alg != "EdDSA" || header.Kid == "" || header.Crit != nil {
		return bad("algorithm or key id")
	}
	key, err := v.Keys.Key(ctx, header.Kid)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrBadToken, err)
	}
	if len(sig) != ed25519.SignatureSize || !ed25519.Verify(key, []byte(parts[0]+"."+parts[1]), sig) {
		return bad("signature")
	}

	var c struct {
		Iss      string          `json:"iss"`
		Aud      json.RawMessage `json:"aud"`
		Sub      string          `json:"sub"`
		Exp      *float64        `json:"exp"`
		Nbf      *float64        `json:"nbf"`
		Username string          `json:"username"`
		Role     Role            `json:"role"`
		Premium  bool            `json:"premium"`
	}
	if err := json.Unmarshal(payloadJSON, &c); err != nil {
		return bad("claims")
	}
	now := v.Now()
	switch {
	case c.Iss != v.Issuer:
		return bad("issuer")
	case !audienceHas(c.Aud, v.Audience):
		return bad("audience")
	case c.Exp == nil:
		return bad("no exp")
	case !now.Before(unix(*c.Exp).Add(leeway)):
		return bad("expired")
	case c.Nbf != nil && now.Add(leeway).Before(unix(*c.Nbf)):
		return bad("not yet valid")
	case !ValidAccountID(c.Sub):
		return bad("subject")
	case !c.Role.Valid():
		return bad("role")
	}
	return Claims{AccountID: c.Sub, Username: c.Username, Role: c.Role, Premium: c.Premium, Expires: unix(*c.Exp)}, nil
}

func unix(s float64) time.Time { return time.Unix(int64(s), 0) }

// aud is a string or an array of strings.
func audienceHas(raw json.RawMessage, want string) bool {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return one == want
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		for _, a := range many {
			if a == want {
				return true
			}
		}
	}
	return false
}

// ValidAccountID reports whether id looks like a platform account id: a UUID in lower-case hex.
func ValidAccountID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
	}
	return true
}

// JWKS fetches and caches the platform's public keys (/.well-known/jwks.json). Keys are cached for
// TTL. An unknown key id triggers a refetch (the platform rotated its key), at most once per
// MinRefetch so a flood of made-up key ids can't hammer the platform. If a fetch fails, the keys
// already held keep working.
type JWKS struct {
	URL        string
	HTTP       *http.Client
	TTL        time.Duration
	MinRefetch time.Duration
	Now        func() time.Time
	Log        *slog.Logger

	mu        sync.Mutex
	keys      map[string]ed25519.PublicKey
	fetchedAt time.Time
	triedAt   time.Time
}

// NewJWKS makes a key cache with the defaults from backend.md: keys kept for 5 minutes.
func NewJWKS(url string, log *slog.Logger) *JWKS {
	return &JWKS{URL: url, HTTP: &http.Client{Timeout: 5 * time.Second}, TTL: 5 * time.Minute,
		MinRefetch: 30 * time.Second, Now: time.Now, Log: log}
}

// Key returns the public key with id kid.
func (j *JWKS) Key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	now := j.Now()
	key, known := j.keys[kid]
	stale := j.keys == nil || now.Sub(j.fetchedAt) >= j.TTL
	if (stale || !known) && now.Sub(j.triedAt) >= j.MinRefetch {
		j.triedAt = now
		// Fetching under the lock: requests queue behind one fetch rather than each sending their own.
		keys, err := j.fetch(ctx)
		if err != nil {
			if j.Log != nil {
				j.Log.Warn("fetching the platform's JWKS failed; keeping the keys we have", "err", err)
			}
		} else {
			j.keys, j.fetchedAt = keys, now
			key, known = keys[kid]
		}
	}
	if !known {
		return nil, errors.New("unknown key id")
	}
	return key, nil
}

func (j *JWKS) fetch(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, j.URL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := j.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS: HTTP %d", resp.StatusCode)
	}
	return ParseJWKS(io.LimitReader(resp.Body, 64<<10))
}

// ParseJWKS reads a JWK set, keeping only Ed25519 signing keys with an id.
func ParseJWKS(r io.Reader) (map[string]ed25519.PublicKey, error) {
	var set struct {
		Keys []struct {
			Kty, Crv, X, Kid, Use, Alg string
		} `json:"keys"`
	}
	if err := json.NewDecoder(r).Decode(&set); err != nil {
		return nil, fmt.Errorf("JWKS: %w", err)
	}
	keys := map[string]ed25519.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "OKP" || k.Crv != "Ed25519" || k.Kid == "" || (k.Use != "" && k.Use != "sig") ||
			(k.Alg != "" && k.Alg != "EdDSA") {
			continue
		}
		x, err := b64.DecodeString(k.X)
		if err != nil || len(x) != ed25519.PublicKeySize {
			continue
		}
		keys[k.Kid] = ed25519.PublicKey(x)
	}
	if len(keys) == 0 {
		return nil, errors.New("JWKS: no Ed25519 keys")
	}
	return keys, nil
}
