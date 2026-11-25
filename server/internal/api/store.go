package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
)

// Character rules (docs/architecture/backend.md). Player-facing numbers; change them only with the
// owner, and update the wiki in the same change.
const (
	// Slots is how many characters an account can have.
	Slots = 3
	// RenameGap is the shortest time between two renames of a character.
	RenameGap = 30 * 24 * time.Hour
	// NameHold is how long a character's old name stays reserved for it after a rename.
	NameHold = 30 * 24 * time.Hour
	// DeleteGrace is how long a deleted character is kept (soft-deleted) before it's removed. Its
	// name stays reserved until then.
	DeleteGrace = 7 * 24 * time.Hour
)

// World is a row of the worlds table.
type World struct {
	ID          int
	Name        string
	PremiumOnly bool
	MaxPlayers  int
	// WSPath is the world's WebSocket path, for example /w/1.
	WSPath string
}

// Appearance is what a player picks at character creation (open question S2, answered 2026-11-25):
// body type, skin tone, hair style, hair colour and beard, each the id of a choice in
// data/appearance.json. The API refuses ids that aren't there (content.Appearance.Valid).
type Appearance = content.Look

// Character is a live (not deleted) character.
type Character struct {
	ID        string
	AccountID string
	Slot      int
	Name      string
	// Appearance is stored as JSON. Characters made before it existed have the zero value.
	Appearance Appearance
	// Region is where the character last was. Empty until persistence (a later M1 task) saves it.
	Region       string
	CreatedAt    time.Time
	LastPlayedAt *time.Time
	RenamedAt    *time.Time
	// OnlineWorld and LeaseUntil: the character is online in OnlineWorld until LeaseUntil. The world
	// servers keep the lease (persistence, a later M1 task); until then they're always empty.
	OnlineWorld *int
	LeaseUntil  *time.Time
	// SkillXP is XP by skill id. Skills without a row have 0 XP.
	SkillXP map[string]int64
}

// Online reports whether the character holds an unexpired online lease.
func (c Character) Online(now time.Time) bool {
	return c.OnlineWorld != nil && c.LeaseUntil != nil && now.Before(*c.LeaseUntil)
}

// NextRename is when the character may next be renamed (zero if now).
func (c Character) NextRename(now time.Time) time.Time {
	if c.RenamedAt == nil {
		return time.Time{}
	}
	if at := c.RenamedAt.Add(RenameGap); at.After(now) {
		return at
	}
	return time.Time{}
}

// Store errors.
var (
	ErrNotFound      = errors.New("store: not found")
	ErrSlotUsed      = errors.New("store: slot already used")
	ErrNameTaken     = errors.New("store: name taken")
	ErrOnline        = errors.New("store: character is online")
	ErrRenameTooSoon = errors.New("store: renamed too recently")
	// ErrAccountDeleted: the account is on the deleted-accounts list, so nothing new is made for it.
	ErrAccountDeleted = errors.New("store: account deleted")
)

// RenameTooSoonError says when the character may be renamed again. It matches ErrRenameTooSoon.
type RenameTooSoonError struct{ RetryAt time.Time }

func (e *RenameTooSoonError) Error() string {
	return fmt.Sprintf("%v (again at %s)", ErrRenameTooSoon, e.RetryAt.Format(time.RFC3339))
}

// Is makes errors.Is(err, ErrRenameTooSoon) true.
func (e *RenameTooSoonError) Is(target error) bool { return target == ErrRenameTooSoon }

// Store is the API's database. Times come from the caller (the API's clock), never from the
// database, so tests control them. The Postgres store is pgstore; MemStore is the same rules in
// memory, for fast tests. storetest runs one contract against both.
type Store interface {
	// Ping checks the database is reachable.
	Ping(ctx context.Context) error
	// AccountDeleted reports whether the platform told us the account was deleted.
	AccountDeleted(ctx context.Context, accountID string) (bool, error)
	// DeleteAccount is the deletion hook's work, in one step: it removes every character of the
	// account for good (soft-deleted ones too, online ones too), with their names (current and
	// held), skills and everything else that hangs off a character, and records the account as
	// deleted. It's idempotent, and fine for an account it never saw. It returns how many
	// characters it removed. A CreateCharacter racing it either finishes first (and is removed)
	// or fails with ErrAccountDeleted.
	DeleteAccount(ctx context.Context, accountID string, now time.Time) (int, error)
	// RecordDeletedAccount adds the account to the deleted-accounts list (idempotent). The deletion
	// hook (a later M1 task) calls it and also removes the account's characters.
	RecordDeletedAccount(ctx context.Context, accountID string, now time.Time) error
	// Worlds lists every world, by id.
	Worlds(ctx context.Context) ([]World, error)
	// Characters lists the account's live characters, by slot.
	Characters(ctx context.Context, accountID string) ([]Character, error)
	// Character is one of the account's live characters, or ErrNotFound.
	Character(ctx context.Context, accountID, id string) (Character, error)
	// CreateCharacter makes a character in an empty slot (1..Slots) with a free name. The name must
	// already have passed the name rules. ErrSlotUsed, ErrNameTaken, ErrAccountDeleted.
	CreateCharacter(ctx context.Context, accountID string, slot int, name string, look Appearance, now time.Time) (Character, error)
	// RenameCharacter renames a character if it hasn't been renamed within RenameGap and the new
	// name is free (or is one this character holds). The old name is held for NameHold.
	// ErrNotFound, ErrOnline, *RenameTooSoonError, ErrNameTaken.
	RenameCharacter(ctx context.Context, accountID, id, name string, now time.Time) (Character, error)
	// DeleteCharacter soft-deletes a character: it's gone from the account at once (its slot is
	// free), and removed for good after DeleteGrace. ErrNotFound, ErrOnline.
	DeleteCharacter(ctx context.Context, accountID, id string, now time.Time) error
	// Purge removes characters deleted more than DeleteGrace before now, and frees names whose hold
	// has run out. It returns how many characters it removed.
	Purge(ctx context.Context, now time.Time) (int, error)
}
