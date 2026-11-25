package ticket

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
)

var (
	key   = bytes.Repeat([]byte{7}, 32)
	other = bytes.Repeat([]byte{8}, 32)
	t0    = time.Unix(1_800_000_000, 0)
)

func payload(world string) Payload {
	return Payload{
		AccountID: "0b7c1e2a-0000-4000-8000-000000000001", CharacterID: "0b7c1e2a-0000-4000-8000-0000000000c1",
		WorldID: world, Name: "Ugg", Role: "normal", Nonce: NewNonce(), Exp: t0.Add(TTL).Unix(),
	}
}

func sign(t *testing.T, k []byte, p Payload) string {
	t.Helper()
	s, err := Sign(k, p)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRoundTrip(t *testing.T) {
	p := payload("1")
	got, err := NewGuard(key, "1").Check(sign(t, key, p), t0)
	if err != nil {
		t.Fatal(err)
	}
	if got != p {
		t.Fatalf("got %+v, want %+v", got, p)
	}
}

// The negative cases security.md requires: forged, expired, reused and wrong world.
func TestRefused(t *testing.T) {
	good := sign(t, key, payload("1"))
	body, sig, _ := strings.Cut(good, ".")
	tampered := payload("1")
	tampered.Role = "owner"
	tamperedBody := base64.RawURLEncoding.EncodeToString([]byte(
		`{"accountId":"a","characterId":"c","worldId":"1","name":"Ugg","role":"owner","premium":true,"nonce":"n","exp":` +
			"1800000030}"))
	cases := []struct {
		name   string
		ticket string
		now    time.Time
		want   error
	}{
		{"signed with another key", sign(t, other, payload("1")), t0, ErrSignature},
		{"payload changed after signing", tamperedBody + "." + sig, t0, ErrSignature},
		{"signature from another ticket", strings.SplitN(sign(t, key, tampered), ".", 2)[0] + "." + sig, t0, ErrSignature},
		{"no signature", body, t0, ErrMalformed},
		{"empty signature", body + ".", t0, ErrMalformed},
		{"short signature", body + "." + sig[:20], t0, ErrMalformed},
		{"not base64", "!!!." + sig, t0, ErrMalformed},
		{"empty", "", t0, ErrMalformed},
		{"dev ticket", "dev:Ugg", t0, ErrMalformed},
		{"expired: exactly at exp", good, t0.Add(TTL), ErrExpired},
		{"expired: later", good, t0.Add(time.Hour), ErrExpired},
		{"for another world", sign(t, key, payload("2")), t0, ErrWrongWorld},
		{"expiry too far ahead", sign(t, key, func() Payload { p := payload("1"); p.Exp = t0.Add(time.Hour).Unix(); return p }()), t0, ErrTooFar},
		{"no nonce", sign(t, key, func() Payload { p := payload("1"); p.Nonce = ""; return p }()), t0, ErrMalformed},
		{"signed JSON that isn't a payload", base64.RawURLEncoding.EncodeToString([]byte("[1]")) + "." +
			base64.RawURLEncoding.EncodeToString(mac(key, []byte("[1]"))), t0, ErrMalformed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := NewGuard(key, "1")
			if _, err := g.Check(c.ticket, c.now); !errors.Is(err, c.want) {
				t.Fatalf("got %v, want %v", err, c.want)
			}
			if g.Remembered() != 0 {
				t.Fatal("a refused ticket used up its nonce")
			}
		})
	}
}

func TestReused(t *testing.T) {
	g := NewGuard(key, "1")
	s := sign(t, key, payload("1"))
	if _, err := g.Check(s, t0); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Check(s, t0.Add(10*time.Second)); !errors.Is(err, ErrReused) {
		t.Fatalf("second use: got %v, want ErrReused", err)
	}
	// Another ticket with the same nonce (a replay with a fresh signature can't be made without the
	// key, but a key holder must not reuse nonces either).
	p := payload("1")
	p2 := p
	p2.CharacterID = "other"
	if _, err := g.Check(sign(t, key, p), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Check(sign(t, key, p2), t0); !errors.Is(err, ErrReused) {
		t.Fatalf("same nonce: got %v, want ErrReused", err)
	}
}

// Nonces are kept until their ticket expires, then forgotten, so the map doesn't grow forever.
func TestNoncesForgottenAfterExpiry(t *testing.T) {
	g := NewGuard(key, "1")
	for range 5 {
		if _, err := g.Check(sign(t, key, payload("1")), t0); err != nil {
			t.Fatal(err)
		}
	}
	if g.Remembered() != 5 {
		t.Fatalf("remembered %d, want 5", g.Remembered())
	}
	later := t0.Add(TTL + time.Second)
	p := payload("1")
	p.Exp = later.Add(TTL).Unix()
	if _, err := g.Check(sign(t, key, p), later); err != nil {
		t.Fatal(err)
	}
	if g.Remembered() != 1 {
		t.Fatalf("remembered %d after the first five expired, want 1", g.Remembered())
	}
}

// The biggest ticket the API can make, with the longest name, role and look, must fit in hello's
// ticket field (string<1024>), or the client couldn't send it.
func TestLargestTicketFitsInHello(t *testing.T) {
	id := strings.Repeat("f", 32)
	p := Payload{AccountID: "0b7c1e2a-2222-4000-8000-000000000001", CharacterID: "0b7c1e2a-2222-4000-8000-0000000000c1",
		WorldID: "9999", Name: strings.Repeat("W", 12), Role: "moderator", Premium: true,
		Appearance: &content.Look{BodyType: id, SkinTone: id, HairStyle: id, HairColour: id, Beard: id},
		Nonce:      NewNonce(), Exp: 1 << 40}
	s, err := Sign(bytes.Repeat([]byte{1}, MinKeyBytes), p)
	if err != nil {
		t.Fatal(err)
	}
	if len(s) > 1024 {
		t.Fatalf("largest ticket is %d bytes; hello.ticket holds 1024", len(s))
	}
}
