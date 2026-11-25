package persist

import (
	"context"
	"slices"
	"sync"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// MemStore is Store in memory, with the same rules as the Postgres store, for fast tests. Characters
// are added with AddCharacter (the API makes them in real life).
type MemStore struct {
	mu    sync.Mutex
	chars map[string]*MemCharacter
	err   error
	gate  chan struct{}
}

// MemCharacter is a character row as MemStore holds it.
type MemCharacter struct {
	AccountID  string
	Deleted    bool
	Region     string
	Pos        *proto.Pos
	HP         int32
	World      int // 0: no lease
	LeaseUntil time.Time
	Lease      string
	LastPlayed time.Time
}

var _ Store = (*MemStore)(nil)

// NewMemStore makes an empty store.
func NewMemStore() *MemStore { return &MemStore{chars: map[string]*MemCharacter{}} }

// AddCharacter adds a new character, as the API does at character creation.
func (m *MemStore) AddCharacter(accountID, id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.chars[id] = &MemCharacter{AccountID: accountID, HP: HPFull}
}

// DeleteCharacter marks a character deleted, as the API does.
func (m *MemStore) DeleteCharacter(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if c := m.chars[id]; c != nil {
		c.Deleted = true
	}
}

// Get is a copy of a character's row (tests).
func (m *MemStore) Get(id string) (MemCharacter, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.chars[id]
	if c == nil {
		return MemCharacter{}, false
	}
	out := *c
	if c.Pos != nil {
		p := *c.Pos
		out.Pos = &p
	}
	return out, true
}

// Online reports whether the character holds an unexpired lease at now, and on which world, the way
// the API reads it.
func (m *MemStore) Online(id string, now time.Time) (int, bool) {
	c, ok := m.Get(id)
	if !ok || c.World == 0 || !now.Before(c.LeaseUntil) {
		return 0, false
	}
	return c.World, true
}

// Fail makes every later call return err (nil to stop), like a database that's down.
func (m *MemStore) Fail(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.err = err
}

// Block makes every later call wait until Unblock (or its context ends), like a database that has
// stopped answering.
func (m *MemStore) Block() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.gate == nil {
		m.gate = make(chan struct{})
	}
}

// Unblock lets blocked calls go on.
func (m *MemStore) Unblock() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.gate != nil {
		close(m.gate)
		m.gate = nil
	}
}

// enter waits out Block and returns Fail's error; on nil, the caller holds m.mu.
func (m *MemStore) enter(ctx context.Context) error {
	m.mu.Lock()
	gate := m.gate
	m.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	m.mu.Lock()
	if m.err != nil {
		err := m.err
		m.mu.Unlock()
		return err
	}
	return nil
}

func (m *MemStore) Claim(ctx context.Context, c Claim) (Character, error) {
	if err := m.enter(ctx); err != nil {
		return Character{}, err
	}
	defer m.mu.Unlock()
	row := m.chars[c.CharacterID]
	if row == nil || row.Deleted || row.AccountID != c.AccountID {
		return Character{}, ErrNotFound
	}
	for _, other := range m.chars {
		if other.AccountID == c.AccountID && other.World != 0 && c.Now.Before(other.LeaseUntil) {
			return Character{}, ErrOnline
		}
	}
	row.World, row.LeaseUntil, row.Lease = c.World, c.Until, c.Lease
	out := Character{ID: c.CharacterID, AccountID: c.AccountID, Region: row.Region, HP: row.HP}
	if row.Pos != nil {
		p := *row.Pos
		out.Pos = &p
	}
	return out, nil
}

// held finds the character holding lease on world.
func (m *MemStore) held(world int, characterID, lease string) *MemCharacter {
	row := m.chars[characterID]
	if row == nil || row.World != world || row.Lease != lease || lease == "" {
		return nil
	}
	return row
}

func (m *MemStore) Write(ctx context.Context, world int, saves []Save, now, until time.Time) ([]string, error) {
	if err := m.enter(ctx); err != nil {
		return nil, err
	}
	defer m.mu.Unlock()
	var lost []string
	for _, s := range saves {
		row := m.held(world, s.CharacterID, s.Lease)
		if row == nil {
			lost = append(lost, s.CharacterID)
			continue
		}
		if !s.LeaseOnly {
			p := s.Pos
			row.Region, row.Pos, row.HP, row.LastPlayed = s.Region, &p, s.HP, now
		}
		if s.Release {
			row.World, row.LeaseUntil, row.Lease = 0, time.Time{}, ""
		} else {
			row.LeaseUntil = until
		}
	}
	return lost, nil
}

func (m *MemStore) Renew(ctx context.Context, world int, leases []string, until time.Time) ([]string, error) {
	if err := m.enter(ctx); err != nil {
		return nil, err
	}
	defer m.mu.Unlock()
	var lost []string
	for _, lease := range leases {
		found := false
		for _, row := range m.chars {
			if row.World == world && row.Lease == lease {
				row.LeaseUntil, found = until, true
			}
		}
		if !found {
			lost = append(lost, lease)
		}
	}
	slices.Sort(lost)
	return lost, nil
}

func (m *MemStore) ReleaseWorld(ctx context.Context, world int) (int, error) {
	if err := m.enter(ctx); err != nil {
		return 0, err
	}
	defer m.mu.Unlock()
	n := 0
	for _, row := range m.chars {
		if row.World == world {
			row.World, row.LeaseUntil, row.Lease = 0, time.Time{}, ""
			n++
		}
	}
	return n, nil
}
