// Package storetest is the contract every api.Store must keep. The fast check runs it against
// api.MemStore; the slow lane runs it against Postgres (pgstore), so the two can't drift apart.
package storetest

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
)

// T0 is the contract's start time, whole seconds so Postgres (microseconds) keeps it exactly.
var T0 = time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)

var accountSeq atomic.Uint64

// look is an appearance; the store keeps whatever it's given (the API checks it).
var look = api.Appearance{BodyType: "b1", SkinTone: "s2", HairStyle: "h3", HairColour: "c4", Beard: "none"}

// NewAccount is a fresh account id, so tests sharing a database don't collide.
func NewAccount() string {
	return fmt.Sprintf("0b7c1e2a-%04x-4000-8000-%012x", time.Now().UnixNano()&0xffff, accountSeq.Add(1))
}

// uniqueName is a fresh valid name, so tests sharing a database don't collide on names.
func uniqueName(prefix string) string {
	n := accountSeq.Add(1)
	const digits = "abcdefghijklmnopqrstuvwxyz"
	s := ""
	for range 6 {
		s += string(digits[n%26])
		n /= 26
	}
	return prefix + s
}

// Hooks set state the API never writes itself: the world servers will (persistence, a later M1
// task), so each store says how.
type Hooks struct {
	SetOnline  func(t *testing.T, s api.Store, characterID string, world int, until time.Time)
	SetSkillXP func(t *testing.T, s api.Store, characterID, skill string, xp int64)
}

// Run checks a store. newStore gives a store with worlds 1 (free) and 2 (premium only); it may be
// the same store each time.
func Run(t *testing.T, newStore func(t *testing.T) api.Store, hooks Hooks) {
	setOnline := hooks.SetOnline
	ctx := context.Background()

	t.Run("worlds", func(t *testing.T) {
		ws, err := newStore(t).Worlds(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if len(ws) < 2 || ws[0].ID != 1 || ws[0].PremiumOnly || ws[1].ID != 2 || !ws[1].PremiumOnly || ws[0].WSPath != "/w/1" {
			t.Fatalf("worlds: %+v", ws)
		}
	})

	t.Run("create and list", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		name := uniqueName("Ug")
		c, err := s.CreateCharacter(ctx, acct, 2, name, look, T0)
		if err != nil {
			t.Fatal(err)
		}
		if c.ID == "" || c.Slot != 2 || c.Name != name || c.Appearance != look || !c.CreatedAt.Equal(T0) || c.Online(T0) || len(c.SkillXP) != 0 {
			t.Fatalf("created %+v", c)
		}
		if _, err := s.CreateCharacter(ctx, acct, 1, uniqueName("Gr"), look, T0); err != nil {
			t.Fatal(err)
		}
		list, err := s.Characters(ctx, acct)
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 2 || list[0].Slot != 1 || list[1].ID != c.ID {
			t.Fatalf("list %+v", list)
		}
		if other, _ := s.Characters(ctx, NewAccount()); len(other) != 0 {
			t.Fatal("another account sees the characters")
		}
		got, err := s.Character(ctx, acct, c.ID)
		if err != nil || got.Name != name || got.Appearance != look {
			t.Fatalf("Character: %+v %v", got, err)
		}
		if _, err := s.Character(ctx, NewAccount(), c.ID); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("another account's character: %v", err)
		}
	})

	t.Run("slot used", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		if _, err := s.CreateCharacter(ctx, acct, 1, uniqueName("Ug"), look, T0); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateCharacter(ctx, acct, 1, uniqueName("Ug"), look, T0); !errors.Is(err, api.ErrSlotUsed) {
			t.Fatalf("got %v, want ErrSlotUsed", err)
		}
		// Another account's slot 1 is its own.
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, uniqueName("Ug"), look, T0); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("names are unique ignoring case", func(t *testing.T) {
		s := newStore(t)
		name := uniqueName("Ug")
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, name, look, T0); err != nil {
			t.Fatal(err)
		}
		for _, n := range []string{name, lower(name), upper(name)} {
			if _, err := s.CreateCharacter(ctx, NewAccount(), 1, n, look, T0); !errors.Is(err, api.ErrNameTaken) {
				t.Fatalf("%q: got %v, want ErrNameTaken", n, err)
			}
		}
	})

	t.Run("a refused create leaves nothing behind", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		name := uniqueName("Ug")
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, name, look, T0); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateCharacter(ctx, acct, 1, name, look, T0); !errors.Is(err, api.ErrNameTaken) {
			t.Fatal(err)
		}
		if list, _ := s.Characters(ctx, acct); len(list) != 0 {
			t.Fatalf("a character was left behind: %+v", list)
		}
	})

	t.Run("concurrent creates with one name: exactly one wins", func(t *testing.T) {
		s := newStore(t)
		name := uniqueName("Ug")
		var wg sync.WaitGroup
		var won atomic.Int32
		for range 8 {
			wg.Go(func() {
				if _, err := s.CreateCharacter(ctx, NewAccount(), 1, name, look, T0); err == nil {
					won.Add(1)
				} else if !errors.Is(err, api.ErrNameTaken) {
					t.Error(err)
				}
			})
		}
		wg.Wait()
		if won.Load() != 1 {
			t.Fatalf("%d creates won", won.Load())
		}
	})

	t.Run("rename: once per 30 days, old name held 30 days", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		oldName, newName := uniqueName("Ug"), uniqueName("Gr")
		c, err := s.CreateCharacter(ctx, acct, 1, oldName, look, T0)
		if err != nil {
			t.Fatal(err)
		}
		r, err := s.RenameCharacter(ctx, acct, c.ID, newName, T0)
		if err != nil {
			t.Fatal(err)
		}
		if r.Name != newName || r.RenamedAt == nil || !r.RenamedAt.Equal(T0) {
			t.Fatalf("renamed %+v", r)
		}
		// Too soon, even a day before the 30 are up.
		var soon *api.RenameTooSoonError
		_, err = s.RenameCharacter(ctx, acct, c.ID, uniqueName("Zo"), T0.Add(api.RenameGap-24*time.Hour))
		if !errors.As(err, &soon) || !errors.Is(err, api.ErrRenameTooSoon) || !soon.RetryAt.Equal(T0.Add(api.RenameGap)) {
			t.Fatalf("got %v, want RenameTooSoonError at %v", err, T0.Add(api.RenameGap))
		}
		// The old name is held for everyone else for 30 days...
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, oldName, look, T0.Add(api.NameHold-time.Second)); !errors.Is(err, api.ErrNameTaken) {
			t.Fatalf("old name during the hold: got %v, want ErrNameTaken", err)
		}
		// ...but its owner can take it back once it may rename again.
		back, err := s.RenameCharacter(ctx, acct, c.ID, oldName, T0.Add(api.RenameGap))
		if err != nil || back.Name != oldName {
			t.Fatalf("taking the old name back: %+v %v", back, err)
		}
		// Now the name it gave up is held for it.
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, newName, look, T0.Add(api.RenameGap)); !errors.Is(err, api.ErrNameTaken) {
			t.Fatalf("given-up name: got %v, want ErrNameTaken", err)
		}
		// And after its hold it's free.
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, newName, look, T0.Add(api.RenameGap+api.NameHold)); err != nil {
			t.Fatalf("name after its hold: %v", err)
		}
	})

	t.Run("rename to a taken name, or a case change", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		taken := uniqueName("Ug")
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, taken, look, T0); err != nil {
			t.Fatal(err)
		}
		name := uniqueName("gr")
		c, err := s.CreateCharacter(ctx, acct, 1, name, look, T0)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.RenameCharacter(ctx, acct, c.ID, upper(taken), T0); !errors.Is(err, api.ErrNameTaken) {
			t.Fatalf("got %v, want ErrNameTaken", err)
		}
		if got, _ := s.Character(ctx, acct, c.ID); got.Name != name || got.RenamedAt != nil {
			t.Fatalf("a refused rename changed the character: %+v", got)
		}
		r, err := s.RenameCharacter(ctx, acct, c.ID, upper(name), T0)
		if err != nil || r.Name != upper(name) {
			t.Fatalf("case change: %+v %v", r, err)
		}
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, name, look, T0.Add(api.NameHold*2)); !errors.Is(err, api.ErrNameTaken) {
			t.Fatalf("a case change released the name: %v", err)
		}
	})

	t.Run("rename or delete someone else's character", func(t *testing.T) {
		s := newStore(t)
		c, err := s.CreateCharacter(ctx, NewAccount(), 1, uniqueName("Ug"), look, T0)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.RenameCharacter(ctx, NewAccount(), c.ID, uniqueName("Gr"), T0); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("rename: %v", err)
		}
		if err := s.DeleteCharacter(ctx, NewAccount(), c.ID, T0); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("delete: %v", err)
		}
	})

	t.Run("delete: slot free at once, name held, removed after 7 days", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		name := uniqueName("Ug")
		c, err := s.CreateCharacter(ctx, acct, 1, name, look, T0)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteCharacter(ctx, acct, c.ID, T0); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Character(ctx, acct, c.ID); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("deleted character still found: %v", err)
		}
		if err := s.DeleteCharacter(ctx, acct, c.ID, T0); !errors.Is(err, api.ErrNotFound) {
			t.Fatalf("deleting twice: %v", err)
		}
		if _, err := s.CreateCharacter(ctx, acct, 1, uniqueName("Gr"), look, T0); err != nil {
			t.Fatalf("the slot wasn't freed: %v", err)
		}
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, name, look, T0.Add(api.DeleteGrace-time.Second)); !errors.Is(err, api.ErrNameTaken) {
			t.Fatalf("the name wasn't held: %v", err)
		}
		if n, err := s.Purge(ctx, T0.Add(api.DeleteGrace-time.Second)); err != nil {
			t.Fatal(err)
		} else if n != 0 {
			t.Fatalf("purged %d before 7 days", n)
		}
		if n, err := s.Purge(ctx, T0.Add(api.DeleteGrace)); err != nil || n < 1 {
			t.Fatalf("purge after 7 days: %d, %v", n, err)
		}
		if _, err := s.CreateCharacter(ctx, NewAccount(), 1, name, look, T0.Add(api.DeleteGrace)); err != nil {
			t.Fatalf("the name wasn't freed after 7 days: %v", err)
		}
	})

	t.Run("online characters can't be renamed or deleted", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		c, err := s.CreateCharacter(ctx, acct, 1, uniqueName("Ug"), look, T0)
		if err != nil {
			t.Fatal(err)
		}
		setOnline(t, s, c.ID, 1, T0.Add(time.Minute))
		got, _ := s.Character(ctx, acct, c.ID)
		if !got.Online(T0) || got.Online(T0.Add(time.Minute)) || *got.OnlineWorld != 1 {
			t.Fatalf("lease: %+v", got)
		}
		if _, err := s.RenameCharacter(ctx, acct, c.ID, uniqueName("Gr"), T0); !errors.Is(err, api.ErrOnline) {
			t.Fatalf("rename while online: %v", err)
		}
		if err := s.DeleteCharacter(ctx, acct, c.ID, T0); !errors.Is(err, api.ErrOnline) {
			t.Fatalf("delete while online: %v", err)
		}
		// An expired lease doesn't count.
		if err := s.DeleteCharacter(ctx, acct, c.ID, T0.Add(time.Minute)); err != nil {
			t.Fatalf("delete after the lease: %v", err)
		}
	})

	t.Run("skill XP", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		c, err := s.CreateCharacter(ctx, acct, 1, uniqueName("Ug"), look, T0)
		if err != nil {
			t.Fatal(err)
		}
		hooks.SetSkillXP(t, s, c.ID, "lumberjacking", 1234)
		hooks.SetSkillXP(t, s, c.ID, "angling", 5)
		list, err := s.Characters(ctx, acct)
		if err != nil || len(list) != 1 || len(list[0].SkillXP) != 2 || list[0].SkillXP["lumberjacking"] != 1234 {
			t.Fatalf("list: %+v %v", list, err)
		}
	})

	t.Run("deleted accounts", func(t *testing.T) {
		s, acct := newStore(t), NewAccount()
		if del, err := s.AccountDeleted(ctx, acct); err != nil || del {
			t.Fatalf("new account deleted: %v %v", del, err)
		}
		for range 2 { // idempotent
			if err := s.RecordDeletedAccount(ctx, acct, T0); err != nil {
				t.Fatal(err)
			}
		}
		if del, err := s.AccountDeleted(ctx, acct); err != nil || !del {
			t.Fatalf("recorded account not deleted: %v %v", del, err)
		}
	})
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}
