package platform_test

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform/platformtest"
)

const acct = "0b7c1e2a-1111-4000-8000-000000000001"

var t0 = time.Unix(1_800_000_000, 0)

func verifier(p *platformtest.Platform, now *time.Time) *platform.Verifier {
	return &platform.Verifier{Keys: p, Issuer: platformtest.Issuer, Audience: platformtest.Audience,
		Now: func() time.Time { return *now }}
}

func claims(mod func(map[string]any)) map[string]any {
	c := map[string]any{"sub": acct, "username": "grug", "role": "normal", "premium": false,
		"iss": platformtest.Issuer, "aud": platformtest.Audience, "iat": t0.Unix(), "exp": t0.Add(15 * time.Minute).Unix()}
	if mod != nil {
		mod(c)
	}
	return c
}

func TestVerifyAccepts(t *testing.T) {
	p := platformtest.New()
	now := t0
	v := verifier(p, &now)
	got, err := v.Verify(context.Background(), p.Sign(claims(func(c map[string]any) { c["role"] = "admin"; c["premium"] = true })))
	if err != nil {
		t.Fatal(err)
	}
	if got.AccountID != acct || got.Role != platform.RoleAdmin || !got.Premium || got.Username != "grug" {
		t.Fatalf("claims: %+v", got)
	}
	// aud may be an array.
	if _, err := v.Verify(context.Background(), p.Sign(claims(func(c map[string]any) { c["aud"] = []string{"x", platformtest.Audience} }))); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyRefuses(t *testing.T) {
	p := platformtest.New()
	_, otherKey, _ := ed25519.GenerateKey(nil)
	enc := base64.RawURLEncoding
	good := p.Sign(claims(nil))
	parts := strings.Split(good, ".")
	cases := map[string]struct {
		token string
		at    time.Time
	}{
		"expired":                 {good, t0.Add(16 * time.Minute)},
		"wrong issuer":            {p.Sign(claims(func(c map[string]any) { c["iss"] = "https://evil.example" })), t0},
		"wrong audience":          {p.Sign(claims(func(c map[string]any) { c["aud"] = "other-games" })), t0},
		"no audience":             {p.Sign(claims(func(c map[string]any) { delete(c, "aud") })), t0},
		"no exp":                  {p.Sign(claims(func(c map[string]any) { delete(c, "exp") })), t0},
		"not yet valid":           {p.Sign(claims(func(c map[string]any) { c["nbf"] = t0.Add(time.Hour).Unix() })), t0},
		"subject not a uuid":      {p.Sign(claims(func(c map[string]any) { c["sub"] = "1" })), t0},
		"unknown role":            {p.Sign(claims(func(c map[string]any) { c["role"] = "god" })), t0},
		"signed by another key":   {p.SignWith(map[string]any{"alg": "EdDSA", "kid": p.Kid}, claims(nil), otherKey), t0},
		"unknown key id":          {p.SignWith(map[string]any{"alg": "EdDSA", "kid": "nope"}, claims(nil), p.Priv), t0},
		"no key id":               {p.SignWith(map[string]any{"alg": "EdDSA"}, claims(nil), p.Priv), t0},
		"alg none":                {enc.EncodeToString([]byte(`{"alg":"none","kid":"test-key"}`)) + "." + parts[1] + ".", t0},
		"alg HS256":               {p.SignWith(map[string]any{"alg": "HS256", "kid": p.Kid}, claims(nil), p.Priv), t0},
		"crit header":             {p.SignWith(map[string]any{"alg": "EdDSA", "kid": p.Kid, "crit": []string{"x"}}, claims(nil), p.Priv), t0},
		"claims changed":          {parts[0] + "." + enc.EncodeToString([]byte(`{"sub":"`+acct+`","role":"owner"}`)) + "." + parts[2], t0},
		"two parts":               {parts[0] + "." + parts[1], t0},
		"garbage":                 {"not a token", t0},
		"empty":                   {"", t0},
		"signature not base64url": {parts[0] + "." + parts[1] + ".***", t0},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			now := c.at
			if _, err := verifier(p, &now).Verify(context.Background(), c.token); !errors.Is(err, platform.ErrBadToken) {
				t.Fatalf("got %v, want ErrBadToken", err)
			}
		})
	}
}

func TestJWKSCaching(t *testing.T) {
	p := platformtest.New()
	var fetches atomic.Int32
	fail := atomic.Bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fetches.Add(1)
		if fail.Load() {
			http.Error(w, "down", http.StatusBadGateway)
			return
		}
		_, _ = w.Write(p.JWKS())
	}))
	defer srv.Close()
	now := t0
	j := platform.NewJWKS(srv.URL, nil)
	j.Now = func() time.Time { return now }
	ctx := context.Background()

	if _, err := j.Key(ctx, p.Kid); err != nil {
		t.Fatal(err)
	}
	if _, err := j.Key(ctx, p.Kid); err != nil || fetches.Load() != 1 {
		t.Fatalf("second lookup: err %v, fetches %d (want 1: cached)", err, fetches.Load())
	}
	// An unknown key id refetches (the platform may have rotated its key), but at most once per
	// MinRefetch (30 s): not again straight away, and not for a flood of made-up ids.
	if _, err := j.Key(ctx, "rotated"); err == nil || fetches.Load() != 1 {
		t.Fatalf("unknown key just after a fetch: err %v, fetches %d (want refused, 1)", err, fetches.Load())
	}
	now = now.Add(30 * time.Second)
	if _, err := j.Key(ctx, "rotated"); err == nil {
		t.Fatal("unknown key accepted")
	}
	for range 10 {
		_, _ = j.Key(ctx, "made-up")
	}
	if fetches.Load() != 2 {
		t.Fatalf("fetches %d after unknown key ids, want 2", fetches.Load())
	}
	// After the TTL it refetches; if that fails, the old keys keep working.
	now = now.Add(5 * time.Minute) // the TTL since the last successful fetch
	fail.Store(true)
	if _, err := j.Key(ctx, p.Kid); err != nil {
		t.Fatalf("stale key after a failed fetch: %v", err)
	}
	if fetches.Load() != 3 {
		t.Fatalf("fetches %d, want 3", fetches.Load())
	}
}

func TestParseJWKSSkipsOtherKeys(t *testing.T) {
	keys, err := platform.ParseJWKS(strings.NewReader(`{"keys":[
		{"kty":"RSA","kid":"r","n":"x","e":"AQAB"},
		{"kty":"OKP","crv":"X25519","kid":"x","x":"` + strings.Repeat("A", 43) + `"},
		{"kty":"OKP","crv":"Ed25519","kid":"short","x":"AAAA"},
		{"kty":"OKP","crv":"Ed25519","kid":"enc","use":"enc","x":"` + strings.Repeat("A", 43) + `"},
		{"kty":"OKP","crv":"Ed25519","kid":"good","x":"` + strings.Repeat("A", 43) + `"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys["good"] == nil {
		t.Fatalf("keys: %v", keys)
	}
}

func TestAccountsClient(t *testing.T) {
	var calls atomic.Int32
	var gotAuth atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		gotAuth.Store(r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/service/accounts/" + acct:
			_, _ = w.Write([]byte(`{"id":"` + acct + `","username":"grug","role":"moderator","premium":false,"emailVerified":true,"banned":false,"banEndsAt":null}`))
		case "/service/accounts/0b7c1e2a-1111-4000-8000-000000000002":
			http.NotFound(w, r)
		default:
			http.Error(w, "boom", http.StatusInternalServerError)
		}
	}))
	defer srv.Close()
	now := t0
	a := platform.NewAccounts(srv.URL, "sekrit")
	a.Now = func() time.Time { return now }
	ctx := context.Background()

	got, err := a.Account(ctx, acct)
	if err != nil {
		t.Fatal(err)
	}
	if got.Role != platform.RoleModerator || !got.HasPremium() || got.Banned {
		t.Fatalf("account: %+v", got)
	}
	if gotAuth.Load() != "Service sekrit" {
		t.Fatalf("Authorization header %q", gotAuth.Load())
	}
	now = now.Add(29 * time.Second)
	if _, err := a.Account(ctx, acct); err != nil || calls.Load() != 1 {
		t.Fatalf("within 30 s: err %v, calls %d (want cached)", err, calls.Load())
	}
	now = now.Add(time.Second)
	if _, err := a.Account(ctx, acct); err != nil || calls.Load() != 2 {
		t.Fatalf("at 30 s: err %v, calls %d (want refetched)", err, calls.Load())
	}
	if _, err := a.Account(ctx, "0b7c1e2a-1111-4000-8000-000000000002"); !errors.Is(err, platform.ErrNoAccount) {
		t.Fatalf("404: got %v, want ErrNoAccount", err)
	}
	if _, err := a.Account(ctx, "0b7c1e2a-1111-4000-8000-000000000003"); !errors.Is(err, platform.ErrUnavailable) {
		t.Fatalf("500: got %v, want ErrUnavailable", err)
	}
	if _, err := a.Account(ctx, "../admin"); !errors.Is(err, platform.ErrNoAccount) {
		t.Fatalf("bad id: got %v, want ErrNoAccount without a request", err)
	}
}

func TestPremiumAndRanks(t *testing.T) {
	for _, r := range platform.Roles {
		a := platform.Account{Role: r}
		if want := r != platform.RoleNormal; a.HasPremium() != want {
			t.Errorf("%s without the Premium flag: HasPremium %v, want %v (staff count as Premium)", r, a.HasPremium(), want)
		}
	}
	if !(platform.Account{Role: platform.RoleNormal, Premium: true}).HasPremium() {
		t.Error("Premium flag ignored")
	}
	if platform.Role("god").AtLeast(platform.RoleNormal) {
		t.Error("an unknown role ranks")
	}
}
