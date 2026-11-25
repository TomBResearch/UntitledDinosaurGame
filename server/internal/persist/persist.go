// Package persist is a world server's side of saving characters (docs/architecture/world-server.md,
// "Saving characters", and ADR 0017): taking and keeping the online lease, loading a character on
// join, and writing its position, region and HP.
//
// Store is the database. The world talks to Postgres directly (pgpersist), as the restricted
// udg_world role; MemStore is the same rules in memory, for fast tests. persisttest runs one contract
// against both. Saver sits between the regions and the store: regions hand it saves without ever
// waiting, and it writes them on its own goroutine.
package persist

import (
	"context"
	"errors"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// HPFull is the HP of a character at full health. Maximum HP comes with combat (M3); until then
// nothing changes HP, and the database stores full HP as null.
const HPFull int32 = -1

// Lease timing (world-server.md): a world renews its leases every RenewEvery, each lasting LeaseTTL.
// A world that crashes stops renewing, so its characters can log in again within LeaseTTL.
const (
	LeaseTTL   = 60 * time.Second
	RenewEvery = 20 * time.Second
)

// Character is what a world loads when a player joins.
type Character struct {
	ID        string
	AccountID string
	// Region is where the character was last saved, or "" if it never has been (a new character).
	Region string
	// Pos is where in Region, or nil if it was never saved.
	Pos *proto.Pos
	// HP is the saved HP, or HPFull.
	HP int32
}

// Claim asks for a character's online lease.
type Claim struct {
	AccountID   string
	CharacterID string
	// World is the world's id in the worlds table.
	World int
	// Lease is the new lease's id: a fresh random UUID (NewLease).
	Lease string
	// Now is the world's clock; the lease lasts until Until.
	Now, Until time.Time
}

// Save is one character's state, or the end of its lease.
type Save struct {
	CharacterID string
	// Lease is the lease id the world took the character with. A save for a lease the world no
	// longer holds changes nothing.
	Lease  string
	Region string
	Pos    proto.Pos
	HP     int32
	// Release ends the lease after saving: the character is offline.
	Release bool
	// LeaseOnly releases the lease without writing Region, Pos or HP: a lease taken for a player who
	// then never joined a region (the world was stopping).
	LeaseOnly bool
}

// Store errors.
var (
	// ErrNotFound: no such live character on that account.
	ErrNotFound = errors.New("persist: character not found")
	// ErrOnline: the character, or another character on the same account, holds an unexpired
	// lease, on any world (one character online per account).
	ErrOnline = errors.New("persist: already online")
)

// Store is the world's database. Times always come from the world's clock, never the database's.
type Store interface {
	// Claim takes the online lease for a character and loads it. It refuses (ErrOnline) if any of
	// the account's characters holds an unexpired lease, on any world, and gives ErrNotFound if the
	// character isn't one of the account's live characters. Two claims for the same account at the
	// same moment can't both succeed.
	Claim(ctx context.Context, c Claim) (Character, error)
	// Write applies saves, in order, for leases this world holds. It records now as the
	// characters' last played time, and extends each kept lease to until. Saves whose lease isn't
	// held (by id, on this world) change nothing: their character ids are returned in lost. All the
	// saves are written in one transaction.
	Write(ctx context.Context, world int, saves []Save, now, until time.Time) (lost []string, err error)
	// Renew extends the given leases (ids) to until. Ids this world no longer holds are returned in
	// lost. A lease that has run out but that nobody else has taken is renewed.
	Renew(ctx context.Context, world int, leases []string, until time.Time) (lost []string, err error)
	// ReleaseWorld ends every lease on the world. A world calls it as it starts: any lease it holds
	// then is left over from a crash. It returns how many it ended.
	ReleaseWorld(ctx context.Context, world int) (int, error)
}
