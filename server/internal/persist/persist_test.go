package persist_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist/persisttest"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

var seq atomic.Uint64

func newID() string { return fmt.Sprintf("0b7c1e2a-1111-4000-8000-%012x", seq.Add(1)) }

func TestMemStoreContract(t *testing.T) {
	m := persist.NewMemStore()
	persisttest.Run(t, m, persisttest.Hooks{
		NewAccount: func(*testing.T) string { return newID() },
		AddCharacter: func(_ *testing.T, acc string) string {
			id := newID()
			m.AddCharacter(acc, id)
			return id
		},
		DeleteCharacter: func(_ *testing.T, _, id string) { m.DeleteCharacter(id) },
		Online: func(_ *testing.T, _, id string, now time.Time) bool {
			_, ok := m.Online(id, now)
			return ok
		},
	})
}

// fakeClock is a clock tests move by hand.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

func newSaver(t *testing.T, m *persist.MemStore, lost *[]string) (*persist.Saver, *fakeClock) {
	clock := &fakeClock{t: persisttest.T0}
	s := persist.NewSaver(persist.SaverConfig{Store: m, World: 1, Now: clock.now,
		OnLost: func(id string) { *lost = append(*lost, id) }})
	return s, clock
}

func TestSaverWritesTheNewestSaveAndReleases(t *testing.T) {
	ctx := context.Background()
	m := persist.NewMemStore()
	var lost []string
	s, clock := newSaver(t, m, &lost)
	acc, id := newID(), newID()
	m.AddCharacter(acc, id)
	c, lease, err := s.Claim(ctx, acc, id)
	if err != nil || c.Pos != nil {
		t.Fatalf("claim: %+v %v", c, err)
	}
	if s.Held() != 1 {
		t.Fatal("the saver doesn't hold the lease it took")
	}
	// Three saves before a write: only the newest is written, and the release sticks.
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 1}, HP: persist.HPFull})
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 2}, HP: persist.HPFull, Release: true})
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 3}, HP: persist.HPFull})
	if s.Pending() != 1 {
		t.Fatalf("%d pending, want 1 per character", s.Pending())
	}
	clock.t = clock.t.Add(5 * time.Second)
	if err := s.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	row, _ := m.Get(id)
	if row.Pos == nil || row.Pos.X != 3 || row.World != 0 || !row.LastPlayed.Equal(clock.t) {
		t.Fatalf("row %+v: want X=3, released, last played now", row)
	}
	if s.Held() != 0 || s.Pending() != 0 || len(lost) != 0 {
		t.Fatalf("held %d, pending %d, lost %v after the release", s.Held(), s.Pending(), lost)
	}
}

func TestSaverRenewsLeasesSoTheyDontRunOut(t *testing.T) {
	ctx := context.Background()
	m := persist.NewMemStore()
	var lost []string
	s, clock := newSaver(t, m, &lost)
	acc, id := newID(), newID()
	m.AddCharacter(acc, id)
	if _, _, err := s.Claim(ctx, acc, id); err != nil {
		t.Fatal(err)
	}
	for range 10 { // ten renewals, 200 s in all: well past one lease
		clock.t = clock.t.Add(persist.RenewEvery)
		if err := s.Renew(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, online := m.Online(id, clock.t.Add(persist.LeaseTTL-time.Second)); !online {
		t.Fatal("lease ran out despite renewals")
	}
	if _, online := m.Online(id, clock.t.Add(persist.LeaseTTL)); online {
		t.Fatal("a lease should last LeaseTTL from its last renewal")
	}
}

// After a stall longer than the lease, another world takes the character: the saver finds out when
// it next renews or saves, and tells the world to disconnect that player.
func TestSaverReportsALostLease(t *testing.T) {
	ctx := context.Background()
	m := persist.NewMemStore()
	var lost []string
	s, clock := newSaver(t, m, &lost)
	acc, a, b := newID(), newID(), newID()
	acc2 := newID()
	m.AddCharacter(acc, a)
	m.AddCharacter(acc2, b)
	_, leaseA, _ := s.Claim(ctx, acc, a)
	_, leaseB, _ := s.Claim(ctx, acc2, b)
	later := clock.t.Add(persist.LeaseTTL)
	if _, err := m.Claim(ctx, persist.Claim{AccountID: acc, CharacterID: a, World: 2, Lease: persist.NewLease(),
		Now: later, Until: later.Add(persist.LeaseTTL)}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Claim(ctx, persist.Claim{AccountID: acc2, CharacterID: b, World: 2, Lease: persist.NewLease(),
		Now: later, Until: later.Add(persist.LeaseTTL)}); err != nil {
		t.Fatal(err)
	}
	clock.t = later
	if err := s.Renew(ctx); err != nil {
		t.Fatal(err)
	}
	if len(lost) != 2 || s.Held() != 0 {
		t.Fatalf("lost %v, held %d: want both reported", lost, s.Held())
	}
	// The world's final saves for them change nothing and report nothing more.
	lost = nil
	s.Enqueue(persist.Save{CharacterID: a, Lease: leaseA, Region: "stale", HP: persist.HPFull, Release: true})
	s.Enqueue(persist.Save{CharacterID: b, Lease: leaseB, Region: "stale", HP: persist.HPFull})
	if err := s.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	if row, _ := m.Get(a); row.Region == "stale" || row.World != 2 {
		t.Fatalf("a stale save got through: %+v", row)
	}
	if len(lost) != 0 {
		t.Fatalf("reported again: %v", lost)
	}
}

func TestSaverKeepsSavesWhenTheDatabaseFails(t *testing.T) {
	ctx := context.Background()
	m := persist.NewMemStore()
	var lost []string
	s, _ := newSaver(t, m, &lost)
	acc, id := newID(), newID()
	m.AddCharacter(acc, id)
	_, lease, _ := s.Claim(ctx, acc, id)
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 1}, HP: persist.HPFull, Release: true})
	m.Fail(errors.New("database down"))
	if err := s.Flush(ctx); err == nil {
		t.Fatal("flush succeeded with the database down")
	}
	// A newer save arrives while the database is down; the release must survive it.
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 2}, HP: persist.HPFull})
	m.Fail(nil)
	if err := s.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	row, _ := m.Get(id)
	if row.Pos == nil || row.Pos.X != 2 || row.World != 0 {
		t.Fatalf("row %+v: want the newest position, released", row)
	}
}

// Enqueue is what a region's tick calls. It must return at once even while the database has stopped
// answering and a write is stuck in it.
func TestEnqueueNeverWaitsForTheDatabase(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	m := persist.NewMemStore()
	var lost []string
	s, _ := newSaver(t, m, &lost)
	acc, id := newID(), newID()
	m.AddCharacter(acc, id)
	_, lease, _ := s.Claim(ctx, acc, id)

	m.Block()
	running, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { s.Run(running); close(done) }()
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 1}, HP: persist.HPFull})
	// Run is now (or soon) stuck in Write. Thousands more saves still go straight in.
	enqueued := make(chan struct{})
	go func() {
		for i := range 10000 {
			s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: int32(i)}, HP: persist.HPFull})
		}
		close(enqueued)
	}()
	select {
	case <-enqueued:
	case <-ctx.Done():
		t.Fatal("Enqueue blocked while the database was stuck")
	}
	m.Unblock()
	stop()
	<-done
	if err := s.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if row, _ := m.Get(id); row.Pos == nil || row.Pos.X != 9999 {
		t.Fatalf("row %+v: want the last save", row)
	}
}

func TestReleaseOnlyLeaseKeepsTheState(t *testing.T) {
	ctx := context.Background()
	m := persist.NewMemStore()
	var lost []string
	s, _ := newSaver(t, m, &lost)
	acc, id := newID(), newID()
	m.AddCharacter(acc, id)
	_, lease, _ := s.Claim(ctx, acc, id)
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: proto.Pos{X: 4}, HP: persist.HPFull})
	s.Enqueue(persist.Save{CharacterID: id, Lease: lease, Release: true, LeaseOnly: true})
	if err := s.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	if row, _ := m.Get(id); row.Pos == nil || row.Pos.X != 4 || row.World != 0 {
		t.Fatalf("row %+v: want the earlier save kept and the lease released", row)
	}
}

func TestNewLeaseIsAUUID(t *testing.T) {
	a, b := persist.NewLease(), persist.NewLease()
	if a == b || len(a) != 36 || a[14] != '4' {
		t.Fatalf("leases %q %q", a, b)
	}
}
