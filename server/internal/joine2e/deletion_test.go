package joine2e

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// The deletion hook end to end (the M1 milestone's deletion test): an account with two characters,
// one of them playing on World 1, is deleted through the hook as the platform calls it. Its
// characters are gone, the player is disconnected, its names are free, and its token (still
// unexpired, as it can be for 15 minutes) is refused.
//
// Live, the API's store and the worlds share one Postgres, so the hook's DELETE is what the world
// sees. Here they're two memory stores, so the test removes the characters from the worlds' store
// too, as Postgres would; pgpersist's TestDeletingAnOnlineAccount checks that part on Postgres.

// hook calls the deletion hook as the platform does: DELETE with "Authorization: Service <key>".
func (s *stack) hook(accountID, auth string) int {
	s.t.Helper()
	req, _ := http.NewRequest("DELETE", s.internal.URL+"/internal/players/"+accountID, nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

// play joins the world and stays connected; it returns the open connection.
func (s *stack) play(ctx context.Context, worldID int, tk string) *websocket.Conn {
	t := s.t
	t.Helper()
	url := "ws" + strings.TrimPrefix(s.worlds[worldID].URL, "http") + "/w/1"
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	hello, _ := proto.Append(nil, &proto.Hello{ProtocolHash: proto.ProtocolHash, Ticket: tk, ContentHash: s.data.Hash, ClientVersion: "test"})
	if err := c.Write(ctx, websocket.MessageBinary, hello); err != nil {
		t.Fatal(err)
	}
	if kick := nextKickOrEnter(t, ctx, c, true); kick != nil {
		t.Fatalf("kicked on joining: %v", kick.Reason)
	}
	return c
}

// nextKickOrEnter reads until the player's entity_enter (if wantEnter) or a kick.
func nextKickOrEnter(t *testing.T, ctx context.Context, c *websocket.Conn, wantEnter bool) *proto.Kick {
	t.Helper()
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("connection ended without a kick: %v", err)
		}
		msgs, err := proto.Decode(b, proto.FromServer)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range msgs {
			switch m := m.(type) {
			case *proto.Kick:
				return m
			case *proto.EntityEnter:
				if wantEnter {
					return nil
				}
			}
		}
	}
}

func TestDeleteAccountEndToEnd(t *testing.T) {
	// Leases renew every 10 ms here, so the world notices within the test's deadline.
	s := startWith(t, 10*time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	acct := s.account(platform.RoleNormal, false)
	grug := s.createCharacter(acct, "Grug")
	var ugg character
	if code, e := s.call("POST", "/api/characters", acct,
		map[string]any{"name": "Ugg", "slot": 2, "appearance": s.data.Appearance.Default}, &ugg); code != 201 {
		t.Fatalf("create Ugg: %d %s", code, e)
	}
	s.chars.AddCharacter(acct, ugg.ID)
	bystander := s.account(platform.RoleNormal, false)
	keep := s.createCharacter(bystander, "Bystander")

	// Grug is playing on World 1.
	code, e, j := s.join(acct, grug.ID, 1)
	if code != 200 {
		t.Fatalf("join: %d %s", code, e)
	}
	conn := s.play(ctx, 1, j.Ticket)
	// A ticket issued just before the deletion, not yet used.
	_, _, spare := s.join(acct, ugg.ID, 1)

	// The platform's call: the wrong key is refused and changes nothing.
	if code := s.hook(acct, "Service wrong"); code != http.StatusUnauthorized {
		t.Fatalf("hook with the wrong key: %d, want 401", code)
	}
	if code, _ := s.call("GET", "/api/characters", acct, nil, nil); code != 200 {
		t.Fatalf("after a refused hook: %d", code)
	}
	if code := s.hook(acct, "Service "+serviceKey); code != http.StatusNoContent {
		t.Fatalf("hook: %d, want 204", code)
	}
	// The shared database: the same rows are gone for the worlds.
	s.chars.RemoveCharacter(grug.ID)
	s.chars.RemoveCharacter(ugg.ID)

	// The player is disconnected at the world's next lease renewal.
	if kick := nextKickOrEnter(t, ctx, conn, false); kick.Reason != proto.KickReasonAlreadyOnline {
		t.Fatalf("kick %v, want already_online (the lease is gone)", kick.Reason)
	}
	// The unused ticket can't bring a character back.
	if self, kick := s.enter(1, spare.Ticket); kick == nil {
		t.Fatalf("a ticket from before the deletion joined as %q", self.Name)
	}
	// The token is refused for everything.
	for _, r := range []struct{ method, path string }{{"GET", "/api/characters"}, {"POST", "/api/join"}, {"POST", "/api/characters"}} {
		if code, _ := s.call(r.method, r.path, acct, map[string]any{}, nil); code != http.StatusUnauthorized {
			t.Errorf("%s %s after deletion: %d, want 401", r.method, r.path, code)
		}
	}
	// The names are free for anyone straight away.
	other := s.account(platform.RoleNormal, false)
	s.createCharacter(other, "Grug")
	if code, e := s.call("POST", "/api/characters", other,
		map[string]any{"name": "Ugg", "slot": 2, "appearance": s.data.Appearance.Default}, nil); code != 201 {
		t.Fatalf("name Ugg after deletion: %d %s", code, e)
	}
	// Someone else's character is untouched.
	var list []character
	if code, _ := s.call("GET", "/api/characters", bystander, nil, &list); code != 200 || len(list) != 1 || list[0].ID != keep.ID {
		t.Fatalf("bystander: %d %+v", code, list)
	}
	// The platform may call again (a retry): still 204.
	if code := s.hook(acct, "Service "+serviceKey); code != http.StatusNoContent {
		t.Fatalf("hook again: %d, want 204", code)
	}
}
