package world

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
)

// Persistence over a real connection: the world claims the online lease and loads the character on
// join, and saves and releases it on leave and at shutdown. The store is in memory
// (persist.MemStore); the same rules on Postgres are the slow lane's (internal/persist/pgpersist).

// saveAt gives the character a saved position, as an earlier session would have.
func saveAt(t *testing.T, store *persist.MemStore, account, character string, pos proto.Pos, hp int32) {
	t.Helper()
	ctx := context.Background()
	lease := persist.NewLease()
	if _, err := store.Claim(ctx, persist.Claim{AccountID: account, CharacterID: character, World: 1, Lease: lease,
		Now: ticketNow.Add(-time.Hour), Until: ticketNow.Add(-time.Hour + time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(ctx, 1, []persist.Save{{CharacterID: character, Lease: lease, Region: "test_greybox",
		Pos: pos, HP: hp, Release: true}}, ticketNow.Add(-time.Hour), ticketNow); err != nil {
		t.Fatal(err)
	}
}

// waitRow waits until the character's row satisfies cond (the saver writes moments after the region
// queues a save).
func (w *testWorld) waitRow(ctx context.Context, id, what string, cond func(persist.MemCharacter) bool) persist.MemCharacter {
	w.t.Helper()
	var row persist.MemCharacter
	waitFor(w.t, ctx, what, func() bool {
		row, _ = w.store.Get(id)
		return cond(row)
	})
	return row
}

func TestTicketPlayerStartsWhereSavedAndIsSavedOnLeave(t *testing.T) {
	store := persist.NewMemStore()
	store.AddCharacter(ticketAccount, ticketCharacter)
	saved := proto.Pos{X: 2000, Y: 100, Z: 1000}
	saveAt(t, store, ticketAccount, ticketCharacter, saved, 33)
	w := ticketWorldWith(t, store, nil)
	ctx := testCtx(t)

	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, c)
	self := readUntil[*proto.EntityEnter](t, ctx, c)
	if self.Position.X != saved.X || self.Position.Z != saved.Z {
		t.Fatalf("joined at %+v, want the saved %+v", self.Position, saved)
	}
	if world, online := store.Online(ticketCharacter, ticketNow); !online || world != 1 {
		t.Fatal("the world didn't take the online lease")
	}

	send(t, ctx, c, &proto.MoveTo{Position: proto.Pos{X: 400, Y: 150, Z: 1400}})
	stopped := readUntil[*proto.PathStopped](t, ctx, c) // walked all the way
	_ = c.Close(websocket.StatusNormalClosure, "")

	row := w.waitRow(ctx, ticketCharacter, "the save on leaving", func(r persist.MemCharacter) bool { return r.World == 0 })
	if row.Pos == nil || *row.Pos != stopped.Position || row.Region != "test_greybox" || row.HP != 33 {
		t.Fatalf("saved %+v, want where the player stopped (%+v) with 33 HP", row, stopped.Position)
	}
	if w.saver.Held() != 0 {
		t.Fatal("the saver still holds the released lease")
	}
}

// security.md: an account can't have two characters online at the same time.
func TestASecondLoginOfTheSameAccountIsRefused(t *testing.T) {
	store := persist.NewMemStore()
	store.AddCharacter(ticketAccount, ticketCharacter)
	const second = "0b7c1e2a-2222-4000-8000-0000000000c2"
	store.AddCharacter(ticketAccount, second)
	w := ticketWorldWith(t, store, nil)
	ctx := testCtx(t)

	first := w.dial(ctx, "/w/1")
	send(t, ctx, first, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, first)

	for name, character := range map[string]string{"the same character": ticketCharacter, "another character": second} {
		t.Run(name, func(t *testing.T) {
			c := w.dial(ctx, "/w/1")
			send(t, ctx, c, w.hello(joinTicket(t, ticketKey, func(p *ticket.Payload) { p.CharacterID = character })))
			expectKick(t, ctx, c, proto.KickReasonAlreadyOnline)
		})
	}
	if _, online := store.Online(second, ticketNow); online {
		t.Fatal("the refused character holds a lease")
	}
	// The first player is unaffected.
	send(t, ctx, first, &proto.Ping{ClientTime: 7})
	readUntil[*proto.Pong](t, ctx, first)
}

// A lease left by a crashed world runs out after persist.LeaseTTL; then the character can join.
func TestAStaleLeaseFromACrashedWorldRunsOut(t *testing.T) {
	store := persist.NewMemStore()
	store.AddCharacter(ticketAccount, ticketCharacter)
	if _, err := store.Claim(context.Background(), persist.Claim{AccountID: ticketAccount, CharacterID: ticketCharacter,
		World: 2, Lease: persist.NewLease(), Now: ticketNow.Add(-persist.LeaseTTL), Until: ticketNow}); err != nil {
		t.Fatal(err)
	}
	w := ticketWorldWith(t, store, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, c)
}

func TestTicketForAnotherAccountsCharacterIsRefused(t *testing.T) {
	w := ticketWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, func(p *ticket.Payload) {
		p.AccountID = "0b7c1e2a-2222-4000-8000-000000000099"
	})))
	expectKick(t, ctx, c, proto.KickReasonBadTicket)
}

func TestDatabaseDownAtJoin(t *testing.T) {
	w := ticketWorld(t, nil)
	w.store.Fail(errors.New("database down"))
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	expectKick(t, ctx, c, proto.KickReasonUnavailable)
}

func TestTicketsNeedASaver(t *testing.T) {
	w := startWorld(t, func(c *Config) {
		c.WorldID, c.DevTickets, c.TicketKey = "1", false, ticketKey
		c.Now = func() time.Time { return ticketNow }
	})
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	expectKick(t, ctx, c, proto.KickReasonBadTicket)
}

// The graceful shutdown: a warning, then kick(shutdown), and every player saved with their lease
// released.
func TestShutdownWarnsThenSavesEveryone(t *testing.T) {
	w := ticketWorld(t, func(c *Config) { c.DevTickets = true })
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, c)
	dev := w.dial(ctx, "/w/1")
	send(t, ctx, dev, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, dev)

	w.srv.StopJoins()
	// A connection arriving during the warning is turned away (503).
	if late, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(w.http.URL, "http")+"/w/1", nil); err == nil {
		_ = late.CloseNow()
		t.Fatal("a new connection was accepted during the shutdown warning")
	}

	w.srv.Warn(ctx, 60*time.Second)
	for _, conn := range []*websocket.Conn{c, dev} {
		if n := readUntil[*proto.SystemMessage](t, ctx, conn); n.Key != proto.SystemKeyShutdownWarning || n.Seconds != 60 {
			t.Fatalf("got %+v, want shutdown_warning for 60 s", n)
		}
	}
	go func() { _ = w.srv.Shutdown(ctx) }()
	expectKick(t, ctx, c, proto.KickReasonShutdown)
	expectKick(t, ctx, dev, proto.KickReasonShutdown)
	row := w.waitRow(ctx, ticketCharacter, "the save at shutdown", func(r persist.MemCharacter) bool { return r.World == 0 })
	if row.Pos == nil || row.Region != "test_greybox" {
		t.Fatalf("saved %+v at shutdown", row)
	}
}

// A player still in a region when it stops (a connection that didn't close by the deadline) is saved
// by the region itself.
func TestStoppingTheRegionSavesWhoeverIsLeft(t *testing.T) {
	w := ticketWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, c)
	w.stopRegion()
	<-w.regionDone
	if err := w.saver.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if row, _ := w.store.Get(ticketCharacter); row.World != 0 || row.Pos == nil {
		t.Fatalf("row %+v after the region stopped", row)
	}
}

// If another world takes the character (this world stalled past its lease), this world disconnects
// the player when it finds out, and its stale save changes nothing.
func TestALostLeaseDisconnectsThePlayer(t *testing.T) {
	w := ticketWorld(t, nil)
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello(joinTicket(t, ticketKey, nil)))
	readUntil[*proto.Welcome](t, ctx, c)

	later := ticketNow.Add(persist.LeaseTTL)
	theirs := persist.NewLease()
	if _, err := w.store.Claim(ctx, persist.Claim{AccountID: ticketAccount, CharacterID: ticketCharacter, World: 2,
		Lease: theirs, Now: later, Until: later.Add(persist.LeaseTTL)}); err != nil {
		t.Fatal(err)
	}
	if err := w.saver.Renew(ctx); err != nil {
		t.Fatal(err)
	}
	expectKick(t, ctx, c, proto.KickReasonAlreadyOnline)
	waitFor(t, ctx, "the session to end", func() bool { return w.srv.Sessions() == 0 })
	if err := w.saver.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if row, _ := w.store.Get(ticketCharacter); row.World != 2 || row.Lease != theirs {
		t.Fatalf("row %+v: the other world's lease should stand", row)
	}
}

// Dev tickets need no database and are never saved, even on a world that has one.
func TestDevPlayersArentSaved(t *testing.T) {
	w := ticketWorld(t, func(c *Config) { c.DevTickets = true })
	ctx := testCtx(t)
	c := w.dial(ctx, "/w/1")
	send(t, ctx, c, w.hello("dev:Ugg"))
	readUntil[*proto.Welcome](t, ctx, c)
	_ = c.Close(websocket.StatusNormalClosure, "")
	waitFor(t, ctx, "the session to end", func() bool { return w.srv.Sessions() == 0 })
	if w.saver.Held() != 0 || w.saver.Pending() != 0 {
		t.Fatal("a dev player touched the saver")
	}
}
