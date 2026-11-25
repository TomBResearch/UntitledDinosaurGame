// Package persisttest is the contract every persist.Store must keep. The fast check runs it against
// persist.MemStore; the slow lane runs it against Postgres (pgpersist), so the two can't drift apart.
package persisttest

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// T0 is the contract's start time, whole seconds so Postgres (microseconds) keeps it exactly.
var T0 = time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)

// Hooks do what the world never does itself: the API makes and deletes characters, and reads the
// lease to answer already_online.
type Hooks struct {
	// NewAccount is a fresh account id.
	NewAccount func(t *testing.T) string
	// AddCharacter makes a new character on the account and returns its id.
	AddCharacter func(t *testing.T, accountID string) string
	// DeleteCharacter deletes a character, as a player can while it's offline.
	DeleteCharacter func(t *testing.T, accountID, id string)
	// Online is whether the API sees the character as online at now.
	Online func(t *testing.T, accountID, id string, now time.Time) bool
}

// Worlds 1 and 2 exist in every store (the first migration seeds them).
const world1, world2 = 1, 2

// Run checks a store.
func Run(t *testing.T, store persist.Store, h Hooks) {
	ctx := context.Background()
	claim := func(account, id string, world int, now time.Time) (persist.Character, string, error) {
		lease := persist.NewLease()
		c, err := store.Claim(ctx, persist.Claim{AccountID: account, CharacterID: id, World: world, Lease: lease,
			Now: now, Until: now.Add(persist.LeaseTTL)})
		return c, lease, err
	}
	mustClaim := func(t *testing.T, account, id string, world int, now time.Time) (persist.Character, string) {
		t.Helper()
		c, lease, err := claim(account, id, world, now)
		if err != nil {
			t.Fatalf("claim: %v", err)
		}
		return c, lease
	}
	write := func(t *testing.T, world int, now time.Time, saves ...persist.Save) []string {
		t.Helper()
		lost, err := store.Write(ctx, world, saves, now, now.Add(persist.LeaseTTL))
		if err != nil {
			t.Fatal(err)
		}
		return lost
	}

	t.Run("a new character loads with nothing saved", func(t *testing.T) {
		acc := h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		c, _ := mustClaim(t, acc, id, world1, T0)
		if c.ID != id || c.AccountID != acc || c.Region != "" || c.Pos != nil || c.HP != persist.HPFull {
			t.Fatalf("new character loaded as %+v", c)
		}
		if !h.Online(t, acc, id, T0) {
			t.Fatal("the API doesn't see the claimed character as online")
		}
	})

	t.Run("only the account's live characters can be claimed", func(t *testing.T) {
		acc, other := h.NewAccount(t), h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		if _, _, err := claim(other, id, world1, T0); !errors.Is(err, persist.ErrNotFound) {
			t.Fatalf("another account's character: %v", err)
		}
		gone := h.AddCharacter(t, acc)
		h.DeleteCharacter(t, acc, gone)
		if _, _, err := claim(acc, gone, world1, T0); !errors.Is(err, persist.ErrNotFound) {
			t.Fatalf("a deleted character: %v", err)
		}
		if _, _, err := claim(acc, "0b7c1e2a-9999-4000-8000-000000000000", world1, T0); !errors.Is(err, persist.ErrNotFound) {
			t.Fatalf("an unknown character: %v", err)
		}
	})

	t.Run("one character per account online, on any world", func(t *testing.T) {
		acc := h.NewAccount(t)
		a, b := h.AddCharacter(t, acc), h.AddCharacter(t, acc)
		mustClaim(t, acc, a, world1, T0)
		for _, tc := range []struct {
			what  string
			id    string
			world int
		}{{"the same character, same world", a, world1}, {"the same character, other world", a, world2},
			{"another character, same world", b, world1}, {"another character, other world", b, world2}} {
			if _, _, err := claim(acc, tc.id, tc.world, T0.Add(time.Second)); !errors.Is(err, persist.ErrOnline) {
				t.Errorf("%s: %v, want ErrOnline", tc.what, err)
			}
		}
		// A different account is unaffected.
		acc2 := h.NewAccount(t)
		mustClaim(t, acc2, h.AddCharacter(t, acc2), world1, T0)
	})

	t.Run("saves are loaded next time, and a release lets the character log in again", func(t *testing.T) {
		acc := h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		_, lease := mustClaim(t, acc, id, world1, T0)
		pos := proto.Pos{X: -600, Y: 125, Z: 1400}
		if lost := write(t, world1, T0.Add(10*time.Second), persist.Save{CharacterID: id, Lease: lease,
			Region: "test_greybox", Pos: proto.Pos{X: 1, Y: 2, Z: 3}, HP: persist.HPFull}); len(lost) > 0 {
			t.Fatalf("lost %v", lost)
		}
		if !h.Online(t, acc, id, T0.Add(10*time.Second)) {
			t.Fatal("a save without release should keep the character online")
		}
		write(t, world1, T0.Add(20*time.Second), persist.Save{CharacterID: id, Lease: lease,
			Region: "test_greybox", Pos: pos, HP: 7, Release: true})
		if h.Online(t, acc, id, T0.Add(20*time.Second)) {
			t.Fatal("still online after the release")
		}
		c, _ := mustClaim(t, acc, id, world2, T0.Add(21*time.Second))
		if c.Region != "test_greybox" || c.Pos == nil || *c.Pos != pos || c.HP != 7 {
			t.Fatalf("loaded %+v, want what was saved", c)
		}
	})

	t.Run("a lease-only release keeps the saved state", func(t *testing.T) {
		acc := h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		_, lease := mustClaim(t, acc, id, world1, T0)
		pos := proto.Pos{X: 5, Y: 6, Z: 7}
		write(t, world1, T0, persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: pos, HP: persist.HPFull, Release: true})
		_, lease = mustClaim(t, acc, id, world1, T0.Add(time.Second))
		write(t, world1, T0.Add(2*time.Second), persist.Save{CharacterID: id, Lease: lease, Release: true, LeaseOnly: true})
		c, _ := mustClaim(t, acc, id, world1, T0.Add(3*time.Second))
		if c.Pos == nil || *c.Pos != pos || c.Region != "r" {
			t.Fatalf("loaded %+v after a lease-only release", c)
		}
	})

	t.Run("a crashed world's lease runs out", func(t *testing.T) {
		acc := h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		mustClaim(t, acc, id, world1, T0)
		// The world stops renewing. Just before the lease ends, the character is still online...
		if _, _, err := claim(acc, id, world2, T0.Add(persist.LeaseTTL-time.Second)); !errors.Is(err, persist.ErrOnline) {
			t.Fatalf("before the lease ran out: %v", err)
		}
		// ...and once it has, another world can take it.
		if h.Online(t, acc, id, T0.Add(persist.LeaseTTL)) {
			t.Fatal("the API still sees an expired lease as online")
		}
		mustClaim(t, acc, id, world2, T0.Add(persist.LeaseTTL))
	})

	t.Run("a world that lost its lease can't save, renew or release", func(t *testing.T) {
		acc := h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		_, old := mustClaim(t, acc, id, world1, T0)
		later := T0.Add(persist.LeaseTTL + time.Second)
		_, lease := mustClaim(t, acc, id, world2, later) // world 1 stalled; world 2 took the character
		kept := proto.Pos{X: 9, Y: 9, Z: 9}
		write(t, world2, later, persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: kept, HP: persist.HPFull})

		lost := write(t, world1, later, persist.Save{CharacterID: id, Lease: old, Region: "stale", Pos: proto.Pos{}, HP: 1, Release: true})
		if len(lost) != 1 || lost[0] != id {
			t.Fatalf("world 1's save: lost %v, want [%s]", lost, id)
		}
		if lost, err := store.Renew(ctx, world1, []string{old}, later.Add(time.Minute)); err != nil || len(lost) != 1 || lost[0] != old {
			t.Fatalf("world 1's renew: lost %v, %v", lost, err)
		}
		// The wrong world with the right lease id is refused too.
		if lost := write(t, world1, later, persist.Save{CharacterID: id, Lease: lease, Region: "x", HP: persist.HPFull}); len(lost) != 1 {
			t.Fatalf("a save from another world with the lease id: lost %v", lost)
		}
		if !h.Online(t, acc, id, later) {
			t.Fatal("world 2's lease was released by world 1")
		}
		write(t, world2, later, persist.Save{CharacterID: id, Lease: lease, Region: "r", Pos: kept, HP: persist.HPFull, Release: true})
		c, _ := mustClaim(t, acc, id, world1, later.Add(time.Second))
		if c.Region != "r" || *c.Pos != kept {
			t.Fatalf("loaded %+v: world 1's stale save got through", c)
		}
	})

	t.Run("renewing keeps a lease past its first expiry, even one that has just run out", func(t *testing.T) {
		acc := h.NewAccount(t)
		id := h.AddCharacter(t, acc)
		_, lease := mustClaim(t, acc, id, world1, T0)
		at := T0.Add(persist.LeaseTTL + 5*time.Second) // renewals were late, but nobody took it
		if lost, err := store.Renew(ctx, world1, []string{lease}, at.Add(persist.LeaseTTL)); err != nil || len(lost) != 0 {
			t.Fatalf("renew: lost %v, %v", lost, err)
		}
		if !h.Online(t, acc, id, at.Add(persist.LeaseTTL-time.Second)) {
			t.Fatal("not online after renewing")
		}
		if lost, err := store.Renew(ctx, world1, nil, at); err != nil || len(lost) != 0 {
			t.Fatalf("renewing nothing: %v %v", lost, err)
		}
	})

	t.Run("a starting world releases only its own leases", func(t *testing.T) {
		acc1, acc2 := h.NewAccount(t), h.NewAccount(t)
		a, b := h.AddCharacter(t, acc1), h.AddCharacter(t, acc2)
		mustClaim(t, acc1, a, world1, T0)
		mustClaim(t, acc2, b, world2, T0)
		n, err := store.ReleaseWorld(ctx, world1)
		if err != nil || n < 1 {
			t.Fatalf("released %d, %v", n, err)
		}
		if h.Online(t, acc1, a, T0) || !h.Online(t, acc2, b, T0) {
			t.Fatal("ReleaseWorld(1) should free world 1's characters and only those")
		}
		mustClaim(t, acc1, a, world2, T0)
	})

	t.Run("two claims for one account at once: exactly one wins", func(t *testing.T) {
		for range 5 {
			acc := h.NewAccount(t)
			ids := []string{h.AddCharacter(t, acc), h.AddCharacter(t, acc), h.AddCharacter(t, acc)}
			var wg sync.WaitGroup
			errs := make([]error, len(ids))
			for i, id := range ids {
				wg.Go(func() { _, _, errs[i] = claim(acc, id, world1+i%2, T0) })
			}
			wg.Wait()
			won := 0
			for _, err := range errs {
				switch {
				case err == nil:
					won++
				case !errors.Is(err, persist.ErrOnline):
					t.Fatal(err)
				}
			}
			if won != 1 {
				t.Fatalf("%d of 3 simultaneous claims won, want 1", won)
			}
		}
	})
}
