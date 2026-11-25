package api

import (
	"context"
	"crypto/rand"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"
)

// MemStore is Store in memory, with the same rules as the Postgres store (storetest checks both). It
// keeps the handler tests fast; production always uses Postgres.
type MemStore struct {
	mu      sync.Mutex
	worlds  []World
	chars   map[string]*memChar // by id, deleted ones included until purged
	names   map[string]memName  // by lower-case name
	deleted map[string]time.Time
}

type memChar struct {
	Character
	deletedAt *time.Time
}

type memName struct {
	characterID string
	heldUntil   *time.Time // nil: the character's current name
}

// NewMemStore makes a store with these worlds.
func NewMemStore(worlds ...World) *MemStore {
	return &MemStore{worlds: worlds, chars: map[string]*memChar{}, names: map[string]memName{}, deleted: map[string]time.Time{}}
}

// SetOnline sets a character's online lease (the world servers' job, later).
func (m *MemStore) SetOnline(id string, world int, until time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.chars[id]
	c.OnlineWorld, c.LeaseUntil = &world, &until
}

// SetSkillXP sets a character's XP in a skill.
func (m *MemStore) SetSkillXP(id, skill string, xp int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.chars[id].SkillXP[skill] = xp
}

func (m *MemStore) Ping(context.Context) error { return nil }

func (m *MemStore) AccountDeleted(_ context.Context, accountID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.deleted[accountID]
	return ok, nil
}

func (m *MemStore) RecordDeletedAccount(_ context.Context, accountID string, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.deleted[accountID]; !ok {
		m.deleted[accountID] = now
	}
	return nil
}

func (m *MemStore) DeleteAccount(_ context.Context, accountID string, now time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.deleted[accountID]; !ok {
		m.deleted[accountID] = now
	}
	gone := map[string]bool{}
	for id, c := range m.chars {
		if c.AccountID == accountID {
			delete(m.chars, id)
			gone[id] = true
		}
	}
	for lower, n := range m.names {
		if gone[n.characterID] {
			delete(m.names, lower)
		}
	}
	return len(gone), nil
}

func (m *MemStore) Worlds(context.Context) ([]World, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.worlds), nil
}

func (m *MemStore) Characters(_ context.Context, accountID string) ([]Character, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Character
	for _, c := range m.chars {
		if c.AccountID == accountID && c.deletedAt == nil {
			out = append(out, c.copy())
		}
	}
	slices.SortFunc(out, func(a, b Character) int { return a.Slot - b.Slot })
	return out, nil
}

func (c *memChar) copy() Character {
	out := c.Character
	out.SkillXP = maps.Clone(c.SkillXP)
	return out
}

func (m *MemStore) live(accountID, id string) (*memChar, error) {
	c, ok := m.chars[id]
	if !ok || c.AccountID != accountID || c.deletedAt != nil {
		return nil, ErrNotFound
	}
	return c, nil
}

func (m *MemStore) Character(_ context.Context, accountID, id string) (Character, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, err := m.live(accountID, id)
	if err != nil {
		return Character{}, err
	}
	return c.copy(), nil
}

// claim takes name for the character if it's free, already the character's, or its hold has run out.
func (m *MemStore) claim(name, characterID string, now time.Time) bool {
	lower := strings.ToLower(name)
	if n, ok := m.names[lower]; ok && n.characterID != characterID && (n.heldUntil == nil || now.Before(*n.heldUntil)) {
		return false
	}
	m.names[lower] = memName{characterID: characterID}
	return true
}

func (m *MemStore) CreateCharacter(_ context.Context, accountID string, slot int, name string, look Appearance, now time.Time) (Character, error) {
	if slot < 1 || slot > Slots {
		return Character{}, fmt.Errorf("slot %d out of range", slot)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, gone := m.deleted[accountID]; gone {
		return Character{}, ErrAccountDeleted
	}
	for _, c := range m.chars {
		if c.AccountID == accountID && c.deletedAt == nil && c.Slot == slot {
			return Character{}, ErrSlotUsed
		}
	}
	id := newUUID()
	if !m.claim(name, id, now) {
		return Character{}, ErrNameTaken
	}
	c := &memChar{Character: Character{ID: id, AccountID: accountID, Slot: slot, Name: name, Appearance: look, CreatedAt: now, SkillXP: map[string]int64{}}}
	m.chars[id] = c
	return c.copy(), nil
}

func (m *MemStore) RenameCharacter(_ context.Context, accountID, id, name string, now time.Time) (Character, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, err := m.live(accountID, id)
	if err != nil {
		return Character{}, err
	}
	if c.Online(now) {
		return Character{}, ErrOnline
	}
	if at := c.NextRename(now); !at.IsZero() {
		return Character{}, &RenameTooSoonError{RetryAt: at}
	}
	oldLower, newLower := strings.ToLower(c.Name), strings.ToLower(name)
	if oldLower != newLower {
		if !m.claim(name, id, now) {
			return Character{}, ErrNameTaken
		}
		hold := now.Add(NameHold)
		m.names[oldLower] = memName{characterID: id, heldUntil: &hold}
	}
	c.Name, c.RenamedAt = name, &now
	return c.copy(), nil
}

func (m *MemStore) DeleteCharacter(_ context.Context, accountID, id string, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, err := m.live(accountID, id)
	if err != nil {
		return err
	}
	if c.Online(now) {
		return ErrOnline
	}
	c.deletedAt = &now
	hold := now.Add(DeleteGrace)
	m.names[strings.ToLower(c.Name)] = memName{characterID: id, heldUntil: &hold}
	return nil
}

func (m *MemStore) Purge(_ context.Context, now time.Time) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for id, c := range m.chars {
		if c.deletedAt != nil && !now.Before(c.deletedAt.Add(DeleteGrace)) {
			delete(m.chars, id)
			n++
		}
	}
	for lower, nm := range m.names {
		if _, ok := m.chars[nm.characterID]; !ok || (nm.heldUntil != nil && !now.Before(*nm.heldUntil)) {
			delete(m.names, lower)
		}
	}
	return n, nil
}

// newUUID is a random (version 4) UUID.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
