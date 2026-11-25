package world

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
)

// Real join tickets, signed by the backend API (docs/architecture/backend.md, "Join tickets"). The
// world's clock is fixed, so expiry is tested without waiting.

var (
	ticketKey = bytes.Repeat([]byte{42}, 32)
	ticketNow = time.Unix(1_800_000_000, 0)
)

// The ticket's account and character (joinTicket's defaults), which the world's store knows.
const (
	ticketAccount   = "0b7c1e2a-2222-4000-8000-000000000001"
	ticketCharacter = "0b7c1e2a-2222-4000-8000-0000000000c1"
)

// ticketWorld is a world that takes join tickets, saving to an in-memory store that has the default
// ticket's character. Its saver runs for real (writes happen moments after they're queued); its clock
// is fixed at ticketNow.
func ticketWorld(t *testing.T, tweak func(*Config)) *testWorld {
	store := persist.NewMemStore()
	store.AddCharacter(ticketAccount, ticketCharacter)
	return ticketWorldWith(t, store, tweak)
}

func ticketWorldWith(t *testing.T, store *persist.MemStore, tweak func(*Config)) *testWorld {
	saver := persist.NewSaver(persist.SaverConfig{Store: store, World: 1, Now: func() time.Time { return ticketNow }})
	running, stop := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { saver.Run(running); close(done) }()
	t.Cleanup(func() { stop(); <-done }) // runs after the world's cleanup (LIFO)
	w := startWorld(t, func(c *Config) {
		c.WorldID = "1"
		c.DevTickets = false
		c.TicketKey = ticketKey
		c.Now = func() time.Time { return ticketNow }
		c.Saver = saver
		if tweak != nil {
			tweak(c)
		}
	})
	saver.SetOnLost(w.srv.LostLease)
	w.store, w.saver = store, saver
	return w
}

func joinTicket(t *testing.T, key []byte, mod func(*ticket.Payload)) string {
	t.Helper()
	p := ticket.Payload{
		AccountID: ticketAccount, CharacterID: ticketCharacter,
		WorldID: "1", Name: "Grug", Role: "moderator", Premium: true,
		Nonce: ticket.NewNonce(), Exp: ticketNow.Add(ticket.TTL).Unix(),
	}
	if mod != nil {
		mod(&p)
	}
	s, err := ticket.Sign(key, p)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestJoinTicketAccepted(t *testing.T) {
	w := ticketWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	welcome := readUntil[*proto.Welcome](t, ctx, c)
	self := readUntil[*proto.EntityEnter](t, ctx, c)
	if self.Entity != welcome.Entity || self.Name != "Grug" {
		t.Fatalf("bad self entity_enter %+v", self)
	}
	// The ticket's role is the chat badge.
	send(t, ctx, c, &proto.ChatSay{Text: "hello"})
	if line := readUntil[*proto.Chat](t, ctx, c); line.Role != proto.RoleModerator {
		t.Fatalf("chat badge %v, want moderator", line.Role)
	}
}

// security.md: an invalid ticket, an expired ticket, a reused nonce, or a ticket for the wrong world
// is refused.
func TestJoinTicketsRefused(t *testing.T) {
	cases := map[string]struct {
		tweak  func(*Config)
		ticket func(t *testing.T) string
	}{
		"forged: signed with another key": {nil, func(t *testing.T) string {
			return joinTicket(t, bytes.Repeat([]byte{1}, 32), nil)
		}},
		"forged: garbage": {nil, func(*testing.T) string { return "abc.def" }},
		"expired": {nil, func(t *testing.T) string {
			return joinTicket(t, ticketKey, func(p *ticket.Payload) { p.Exp = ticketNow.Unix() })
		}},
		"for another world": {nil, func(t *testing.T) string {
			return joinTicket(t, ticketKey, func(p *ticket.Payload) { p.WorldID = "2" })
		}},
		"premium world, no Premium": {func(c *Config) { c.PremiumOnly = true }, func(t *testing.T) string {
			return joinTicket(t, ticketKey, func(p *ticket.Payload) { p.Role = "normal"; p.Premium = false })
		}},
		"signed, but a bad name": {nil, func(t *testing.T) string {
			return joinTicket(t, ticketKey, func(p *ticket.Payload) { p.Name = "x" })
		}},
		"signed, but an unknown role": {nil, func(t *testing.T) string {
			return joinTicket(t, ticketKey, func(p *ticket.Payload) { p.Role = "god" })
		}},
		"dev ticket while dev tickets are off": {nil, func(*testing.T) string { return "dev:Grug" }},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			w := ticketWorld(t, tc.tweak)
			ctx := testCtx(t)
			c := w.dial(ctx, "/w/1")
			send(t, ctx, c, w.hello(tc.ticket(t)))
			expectKick(t, ctx, c, proto.KickReasonBadTicket)
		})
	}
}

func TestJoinTicketReused(t *testing.T) {
	w := ticketWorld(t, nil)
	ctx := testCtx(t)
	tk := joinTicket(t, ticketKey, nil)
	first := w.dial(ctx, "/w/1")
	send(t, ctx, first, w.hello(tk))
	readUntil[*proto.Welcome](t, ctx, first)
	_ = first.Close(websocket.StatusNormalClosure, "")

	again := w.dial(ctx, "/w/1")
	send(t, ctx, again, w.hello(tk))
	expectKick(t, ctx, again, proto.KickReasonBadTicket)
}

func TestPremiumWorldAcceptsPremiumAndStaff(t *testing.T) {
	for _, role := range []string{"premium", "moderator", "admin", "owner"} {
		t.Run(role, func(t *testing.T) {
			w := ticketWorld(t, func(c *Config) { c.PremiumOnly = true })
			ctx := testCtx(t)
			c := w.dial(ctx, "/w/1")
			// The API sets premium for staff (staff count as Premium).
			send(t, ctx, c, w.hello(joinTicket(t, ticketKey, func(p *ticket.Payload) { p.Role = role; p.Premium = true })))
			readUntil[*proto.Welcome](t, ctx, c)
		})
	}
}

// Dev tickets keep working next to real ones, exactly as before.
func TestDevTicketsStillWorkWithAKey(t *testing.T) {
	w := ticketWorld(t, func(c *Config) { c.DevTickets = true })
	ctx := testCtx(t)
	for _, tk := range []string{"dev:Ugg", joinTicket(t, ticketKey, nil)} {
		c := w.dial(ctx, "/w/1")
		send(t, ctx, c, w.hello(tk))
		readUntil[*proto.Welcome](t, ctx, c)
	}
}

func TestStatus(t *testing.T) {
	w := ticketWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, c)
	resp, err := w.http.Client().Get(w.http.URL + "/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	if got := buf.String(); got != `{"world":"1","players":1}`+"\n" {
		t.Fatalf("status %q", got)
	}
}

// The look in a join ticket is shown to everyone: in the player's own entity_enter and in the one
// other players get. Dev players have none (clients draw the default), and a look that isn't
// shaped like ids is dropped rather than refusing the ticket.
func TestJoinTicketLookIsShownToEveryone(t *testing.T) {
	const zogAccount, zogCharacter = "0b7c1e2a-2222-4000-8000-000000000002", "0b7c1e2a-2222-4000-8000-0000000000c2"
	store := persist.NewMemStore()
	store.AddCharacter(ticketAccount, ticketCharacter)
	store.AddCharacter(zogAccount, zogCharacter)
	w := ticketWorldWith(t, store, func(c *Config) { c.DevTickets = true })
	ctx := testCtx(t)
	grugLook := content.Look{BodyType: "broad", SkinTone: "tone_5", HairStyle: "topknot", HairColour: "grey", Beard: "long"}
	want := &proto.Look{BodyType: "broad", SkinTone: "tone_5", HairStyle: "topknot", HairColour: "grey", Beard: "long"}

	grug := w.dial(ctx, "/w/1")
	send(t, ctx, grug, w.hello(joinTicket(t, ticketKey, func(p *ticket.Payload) { p.Appearance = &grugLook })))
	if self := readUntil[*proto.EntityEnter](t, ctx, grug); self.Look == nil || *self.Look != *want {
		t.Fatalf("own entity_enter look %+v, want %+v", self.Look, want)
	}

	// Another player sees Grug's look; Grug sees the dev player with none.
	ugg := w.dial(ctx, "/w/1")
	send(t, ctx, ugg, w.hello("dev:Ugg"))
	seen := map[string]*proto.Look{}
	for len(seen) < 2 {
		e := readUntil[*proto.EntityEnter](t, ctx, ugg)
		seen[e.Name] = e.Look
	}
	if l := seen["Grug"]; l == nil || *l != *want {
		t.Errorf("Ugg sees Grug's look as %+v, want %+v", l, want)
	}
	if seen["Ugg"] != nil {
		t.Errorf("a dev player has a look: %+v", seen["Ugg"])
	}
	if e := readUntil[*proto.EntityEnter](t, ctx, grug); e.Name != "Ugg" || e.Look != nil {
		t.Errorf("Grug sees %q with look %+v, want Ugg with none", e.Name, e.Look)
	}

	// A signed ticket with a badly shaped look still joins, with no look.
	odd := content.Look{BodyType: "Broad Shoulders", SkinTone: "tone_5", HairStyle: "topknot", HairColour: "grey", Beard: "long"}
	zog := w.dial(ctx, "/w/1")
	send(t, ctx, zog, w.hello(joinTicket(t, ticketKey, func(p *ticket.Payload) {
		p.AccountID, p.CharacterID, p.Name, p.Appearance = zogAccount, zogCharacter, "Zog", &odd
	})))
	if self := readUntil[*proto.EntityEnter](t, ctx, zog); self.Name != "Zog" || self.Look != nil {
		t.Errorf("badly shaped look: got %q with %+v, want Zog with none", self.Name, self.Look)
	}
}
