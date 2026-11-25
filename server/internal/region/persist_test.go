package region

import (
	"context"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// Saving, loading and the idle logout, all tick-stepped: 15 minutes of idling is 18,000 Step calls
// and takes milliseconds.

// fakeSaver records what the region hands over.
type fakeSaver struct{ saves []persist.Save }

func (f *fakeSaver) Enqueue(s persist.Save) { f.saves = append(f.saves, s) }

func (f *fakeSaver) take() []persist.Save {
	out := f.saves
	f.saves = nil
	return out
}

func saverHarness(t *testing.T) (*harness, *fakeSaver) {
	h := newHarness(t)
	f := &fakeSaver{}
	h.r.cfg.Saver = f
	return h, f
}

// joinSaved joins a saved character, starting at start (nil for a new one).
func (h *harness) joinSaved(s SessionID, character string, start *proto.Pos, hp int32) *fakeClient {
	h.t.Helper()
	c := &fakeClient{t: h.t, r: h.r}
	h.clients[s] = c
	h.send(Input{Kind: InputJoin, Session: s, Client: c, Name: "Grug", Character: character,
		Lease: "lease-" + character, Start: start, HP: hp})
	h.r.Step()
	w, ok := first[*proto.Welcome](c.take())
	if !ok {
		h.t.Fatal("no welcome")
	}
	h.ids[s] = EntityID(w.Entity)
	return c
}

func TestASavedCharacterStartsWhereItWasSaved(t *testing.T) {
	h, _ := saverHarness(t)
	saved := quantise(h.ground(20, 10))
	h.joinSaved(1, "c1", &saved, 42)
	e := h.entity(1)
	if quantise(e.pos) != saved || e.hp != 42 {
		t.Fatalf("started at %v with %d HP, want %v and 42", quantise(e.pos), e.hp, saved)
	}
}

func TestANewCharacterOrOneOffTheMeshStartsAtASpawn(t *testing.T) {
	h, _ := saverHarness(t)
	h.joinSaved(1, "new", nil, persist.HPFull)
	if quantise(h.entity(1).pos) != h.spawn() {
		t.Fatalf("a new character started at %v, want the spawn", quantise(h.entity(1).pos))
	}
	far := proto.Pos{X: 900000, Y: 0, Z: 900000} // 9 km away: off this region's mesh
	h.joinSaved(2, "lost", &far, persist.HPFull)
	if quantise(h.entity(2).pos) != h.spawn() {
		t.Fatalf("an off-mesh save started at %v, want the spawn", quantise(h.entity(2).pos))
	}
}

func TestPeriodicSavesOnlyWhenSomethingChanged(t *testing.T) {
	h, f := saverHarness(t)
	every := int(h.r.cfg.SaveEvery)
	if every != 60*h.hz {
		t.Fatalf("SaveEvery is %d ticks, want 60 s", every)
	}
	saved := quantise(h.ground(-6, 14))
	h.joinSaved(1, "c1", &saved, persist.HPFull)
	h.steps(3 * every)
	if got := f.take(); len(got) != 0 {
		t.Fatalf("a player standing still was saved %d times", len(got))
	}
	h.moveTo(1, h.ground(4, 14)) // 10 m: 2.5 s of walking
	h.steps(every)
	got := f.take()
	if len(got) != 1 {
		t.Fatalf("%d saves in the minute after walking, want 1", len(got))
	}
	s := got[0]
	if s.CharacterID != "c1" || s.Lease != "lease-c1" || s.Region != "test_greybox" || s.Release ||
		s.Pos != quantise(h.entity(1).pos) || s.HP != persist.HPFull {
		t.Fatalf("periodic save %+v", s)
	}
	h.steps(2 * every)
	if got := f.take(); len(got) != 0 {
		t.Fatalf("saved again with nothing changed: %+v", got)
	}
}

func TestANewCharacterIsSavedAtTheFirstChance(t *testing.T) {
	h, f := saverHarness(t)
	h.joinSaved(1, "new", nil, persist.HPFull)
	h.steps(int(h.r.cfg.SaveEvery))
	if got := f.take(); len(got) != 1 || got[0].Pos != h.spawn() {
		t.Fatalf("saves %+v: want one at the spawn", got)
	}
}

// Leaving for any reason saves where you stand, mid-walk included, and releases the lease.
func TestLeavingSavesAndReleases(t *testing.T) {
	cases := map[string]func(h *harness){
		"disconnect": func(h *harness) { h.send(Input{Kind: InputLeave, Session: 1}) },
		"too slow": func(h *harness) {
			h.clients[1].full = true
			h.send(Input{Kind: InputIntent, Session: 1, Msg: &proto.ChatSay{Text: "hi"}}) // a frame to refuse
		},
		"misbehaving": func(h *harness) {
			for range 200 {
				h.send(Input{Kind: InputIntent, Session: 1, Msg: &proto.Ping{}}) // not an intent: invalid
			}
		},
	}
	for name, cause := range cases {
		t.Run(name, func(t *testing.T) {
			h, f := saverHarness(t)
			saved := quantise(h.ground(-6, 14))
			h.joinSaved(1, "c1", &saved, 9)
			h.moveTo(1, h.ground(30, 14))
			h.steps(20) // a second into a 9 s walk
			f.take()
			cause(h)
			h.steps(3)
			got := f.take()
			if len(got) != 1 || !got[0].Release || got[0].HP != 9 || got[0].Region != "test_greybox" {
				t.Fatalf("saves on leaving: %+v, want one releasing the lease", got)
			}
			if got[0].Pos == saved || got[0].Pos.X <= saved.X {
				t.Fatalf("saved at %v: want where the player had walked to, past %v", got[0].Pos, saved)
			}
			if h.r.Players() != 0 {
				t.Fatal("still in the region")
			}
		})
	}
}

func TestDevPlayersAreNeverSaved(t *testing.T) {
	h, f := saverHarness(t)
	h.join(1, "Ugg")
	h.moveTo(1, h.ground(4, 14))
	h.steps(2 * int(h.r.cfg.SaveEvery))
	h.send(Input{Kind: InputLeave, Session: 1})
	h.r.Step()
	if len(f.saves) != 0 {
		t.Fatalf("a dev player was saved: %+v", f.saves)
	}
}

// Stop (the end of Run, at shutdown) saves everyone still in the region and releases their leases,
// including players whose leave is still in the inbox.
func TestStopSavesEveryone(t *testing.T) {
	h, f := saverHarness(t)
	for i := range 3 {
		h.joinSaved(SessionID(i+1), string(rune('a'+i)), nil, persist.HPFull)
	}
	h.send(Input{Kind: InputLeave, Session: 2})
	h.r.Stop()
	got := f.take()
	if len(got) != 3 || h.r.Players() != 0 {
		t.Fatalf("%d saves, %d players left after Stop", len(got), h.r.Players())
	}
	for _, s := range got {
		if !s.Release {
			t.Fatalf("save %+v didn't release", s)
		}
	}
}

func TestRunStopsWithSaves(t *testing.T) {
	h, f := saverHarness(t)
	h.joinSaved(1, "c1", nil, persist.HPFull)
	f.take()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h.r.Run(ctx, time.Hour) // returns at once: the context has ended
	if got := f.take(); len(got) != 1 || !got[0].Release {
		t.Fatalf("saves %+v after Run ended", got)
	}
}

func idleHarness(t *testing.T) (*harness, *fakeSaver) {
	h, f := saverHarness(t)
	if h.r.cfg.IdleTicks != uint32(15*60*h.hz) || h.r.cfg.IdleWarnTicks != uint32(60*h.hz) {
		t.Fatalf("idle logout %d ticks, warning %d: want data/'s 15 minutes and 1 minute",
			h.r.cfg.IdleTicks, h.r.cfg.IdleWarnTicks)
	}
	return h, f
}

func TestIdlePlayersAreWarnedThenLoggedOut(t *testing.T) {
	h, f := idleHarness(t)
	saved := quantise(h.ground(-6, 14))
	c := h.joinSaved(1, "c1", &saved, persist.HPFull)
	idle, warn := int(h.r.cfg.IdleTicks), int(h.r.cfg.IdleWarnTicks)

	h.steps(idle - warn - 1)
	if _, warned := first[*proto.SystemMessage](c.take()); warned {
		t.Fatal("warned too early")
	}
	h.r.Step() // 14 minutes
	notes := all[*proto.SystemMessage](c.take())
	if len(notes) != 1 || notes[0].Key != proto.SystemKeyIdleWarning || notes[0].Seconds != 60 {
		t.Fatalf("at 14 minutes got %+v, want one idle_warning for 60 s", notes)
	}
	h.steps(warn - 1)
	if c.gone != 0 || len(all[*proto.SystemMessage](c.take())) != 0 {
		t.Fatal("logged out (or warned twice) before 15 minutes")
	}
	f.take()
	h.r.Step() // 15 minutes
	if c.gone != DisconnectIdle || h.r.Players() != 0 || h.r.Stats.Idle != 1 {
		t.Fatalf("at 15 minutes: disconnect %v, %d players", c.gone, h.r.Players())
	}
	if got := f.take(); len(got) != 1 || !got[0].Release || got[0].Pos != saved {
		t.Fatalf("idle logout saves %+v, want one where the player stood, releasing the lease", got)
	}
}

// A click or a chat line resets the clock, and a later warning comes a full 14 minutes after it.
func TestInputResetsTheIdleClock(t *testing.T) {
	h, _ := idleHarness(t)
	c := h.joinSaved(1, "c1", nil, persist.HPFull)
	idle, warn := int(h.r.cfg.IdleTicks), int(h.r.cfg.IdleWarnTicks)
	h.steps(idle - warn) // warned
	if _, warned := first[*proto.SystemMessage](c.take()); !warned {
		t.Fatal("no warning")
	}
	h.send(Input{Kind: InputIntent, Session: 1, Msg: &proto.ChatSay{Text: "still here"}})
	h.steps(warn + 10) // past the first logout time
	if c.gone != 0 {
		t.Fatal("logged out despite the chat line")
	}
	h.moveTo(1, h.ground(0, 14))
	h.steps(idle - warn) // the click is read in the first of these ticks
	if _, warned := first[*proto.SystemMessage](c.take()); warned {
		t.Fatal("warned again too soon after the click")
	}
	h.steps(warn + 1)
	if c.gone != DisconnectIdle {
		t.Fatal("not logged out 15 minutes after the last click")
	}
}

// Pings and keepalives come from the client's clock sync and the browser, not the player: they
// never reach the region, so a background tab is logged out after 15 minutes like any idle player.
// Walking a long path isn't input either; only the click that started it is.
func TestWalkingIsNotInput(t *testing.T) {
	h, _ := idleHarness(t)
	c := h.joinSaved(1, "c1", nil, persist.HPFull)
	h.moveTo(1, h.ground(58, -52)) // a long walk to the NE hill
	h.steps(int(h.r.cfg.IdleTicks) + 1)
	if c.gone != DisconnectIdle {
		t.Fatal("not logged out 15 minutes after the only click")
	}
}

func TestShutdownNoticeReachesEveryone(t *testing.T) {
	h := newHarness(t)
	a, b := h.join(1, "Ugg"), h.join(2, "Grok")
	a.take()
	b.take()
	h.send(Input{Kind: InputNotice, Msg: &proto.SystemMessage{Key: proto.SystemKeyShutdownWarning, Seconds: 60}})
	h.r.Step()
	for _, c := range []*fakeClient{a, b} {
		if n, ok := first[*proto.SystemMessage](c.take()); !ok || n.Key != proto.SystemKeyShutdownWarning || n.Seconds != 60 {
			t.Fatalf("got %+v, want shutdown_warning for 60 s", n)
		}
	}
}

func TestIdleSettingsAreChecked(t *testing.T) {
	c, rf := testData(t)
	cfg := ConfigFor(c)
	cfg.IdleWarnTicks = cfg.IdleTicks
	if _, err := New(rf, cfg); err == nil {
		t.Fatal("a warning as long as the logout was accepted")
	}
	cfg.IdleWarnTicks = 0
	if _, err := New(rf, cfg); err == nil {
		t.Fatal("no warning was accepted")
	}
	cfg.IdleTicks = 0
	if _, err := New(rf, cfg); err != nil {
		t.Fatalf("idle logout off: %v", err)
	}
}

// The tick hands saves to the real Saver while the database has stopped answering and a write is
// stuck in it: every tick still finishes at once, and once the database is back, the last state of
// every player is written.
func TestTheTickNeverWaitsForTheDatabase(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	store := persist.NewMemStore()
	saver := persist.NewSaver(persist.SaverConfig{Store: store, World: 1})
	h := newHarness(t)
	h.r.cfg.Saver = saver
	h.r.cfg.SaveEvery = 2 // a save attempt for every walker every other tick

	ids := make([]string, 20)
	for i := range ids {
		ids[i] = "0b7c1e2a-3333-4000-8000-0000000000" + string(rune('a'+i/10)) + string(rune('0'+i%10))
		store.AddCharacter("0b7c1e2a-4444-4000-8000-0000000000"+string(rune('a'+i/10))+string(rune('0'+i%10)), ids[i])
	}
	leases := make([]string, len(ids))
	for i, id := range ids {
		c, _ := store.Get(id)
		_, lease, err := saver.Claim(ctx, c.AccountID, id)
		if err != nil {
			t.Fatal(err)
		}
		leases[i] = lease
	}

	store.Block()
	running, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { saver.Run(running); close(done) }()

	stepped := make(chan struct{})
	go func() {
		defer close(stepped)
		for i, id := range ids {
			c := &fakeClient{t: t, r: h.r}
			h.send(Input{Kind: InputJoin, Session: SessionID(i + 1), Client: c, Name: "Grug", Character: id, Lease: leases[i], HP: persist.HPFull})
		}
		h.r.Step()
		for i := range ids {
			h.moveTo(SessionID(i+1), h.ground(30, 14))
		}
		for range 400 { // 20 s of walking, saving all the way
			h.r.Step()
		}
		for i := range ids {
			h.send(Input{Kind: InputLeave, Session: SessionID(i + 1)})
		}
		h.r.Step()
	}()
	select {
	case <-stepped:
	case <-ctx.Done():
		t.Fatal("the tick waited for the database")
	}
	store.Unblock()
	stop()
	<-done
	if err := saver.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		row, _ := store.Get(id)
		if row.World != 0 || row.Pos == nil || row.Region != "test_greybox" {
			t.Fatalf("character %s: %+v, want saved and released", id, row)
		}
	}
}
