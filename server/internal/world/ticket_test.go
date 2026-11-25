package world

import (
	"bytes"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
)

// Real join tickets, signed by the backend API (docs/architecture/backend.md, "Join tickets"). The
// world's clock is fixed, so expiry is tested without waiting.

var (
	ticketKey = bytes.Repeat([]byte{42}, 32)
	ticketNow = time.Unix(1_800_000_000, 0)
)

func ticketWorld(t *testing.T, tweak func(*Config)) *testWorld {
	return startWorld(t, func(c *Config) {
		c.WorldID = "1"
		c.DevTickets = false
		c.TicketKey = ticketKey
		c.Now = func() time.Time { return ticketNow }
		if tweak != nil {
			tweak(c)
		}
	})
}

func joinTicket(t *testing.T, key []byte, mod func(*ticket.Payload)) string {
	t.Helper()
	p := ticket.Payload{
		AccountID: "0b7c1e2a-2222-4000-8000-000000000001", CharacterID: "0b7c1e2a-2222-4000-8000-0000000000c1",
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
