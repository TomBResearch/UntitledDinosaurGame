package persist

import (
	"cmp"
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"
)

// NewLease is a fresh lease id: a random (version 4) UUID.
func NewLease() string {
	var b [16]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// SaverConfig sets up a Saver.
type SaverConfig struct {
	Store Store
	// World is this world's id in the worlds table.
	World int
	// Now is the clock for leases and last played times. Nil means time.Now.
	Now func() time.Time
	Log *slog.Logger
	// LeaseTTL and RenewEvery default to the package's constants.
	LeaseTTL, RenewEvery time.Duration
	// RetryAfter is how long Run waits to try again after a failed write. Default 2 s.
	RetryAfter time.Duration
	// OnLost is told when the world turns out not to hold a character's lease any more (another
	// world took it after this one stopped renewing for longer than LeaseTTL). The world then
	// disconnects that player. It's called from the saver's goroutine and must not block.
	OnLost func(characterID string)
}

// Saver hands character saves from the regions to the store. Enqueue never blocks and never waits
// for the database, so a region's tick can't be held up by it: saves wait in memory, one per
// character (a newer save replaces an older one that hasn't been written yet), until Run writes them.
// Run also renews the world's leases every RenewEvery.
type Saver struct {
	cfg  SaverConfig
	wake chan struct{}

	mu      sync.Mutex
	pending map[string]Save   // by character id: the newest save not yet written
	held    map[string]string // character id -> lease id, for every lease the world holds

	// writing serialises Flush and Renew, so saves for one character are written in order.
	writing sync.Mutex
}

// NewSaver makes a saver. Start Run on its own goroutine.
func NewSaver(cfg SaverConfig) *Saver {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Log == nil {
		cfg.Log = slog.New(slog.DiscardHandler)
	}
	if cfg.LeaseTTL == 0 {
		cfg.LeaseTTL = LeaseTTL
	}
	if cfg.RenewEvery == 0 {
		cfg.RenewEvery = RenewEvery
	}
	if cfg.RetryAfter == 0 {
		cfg.RetryAfter = 2 * time.Second
	}
	return &Saver{cfg: cfg, wake: make(chan struct{}, 1), pending: map[string]Save{}, held: map[string]string{}}
}

// SetOnLost sets SaverConfig.OnLost, for a world made after its saver. Call it before Run.
func (s *Saver) SetOnLost(fn func(characterID string)) { s.cfg.OnLost = fn }

// Claim takes a character's online lease and loads it. On success it returns the lease id, which
// every save for the character must carry, and the saver renews the lease until a save releases it.
// It talks to the database, so call it from the joining connection's goroutine, never a region's.
func (s *Saver) Claim(ctx context.Context, accountID, characterID string) (Character, string, error) {
	now := s.cfg.Now()
	lease := NewLease()
	c, err := s.cfg.Store.Claim(ctx, Claim{AccountID: accountID, CharacterID: characterID, World: s.cfg.World,
		Lease: lease, Now: now, Until: now.Add(s.cfg.LeaseTTL)})
	if err != nil {
		return c, "", err
	}
	s.mu.Lock()
	s.held[characterID] = lease
	s.mu.Unlock()
	return c, lease, nil
}

// Enqueue queues a save. It never blocks: safe to call from a region's tick.
func (s *Saver) Enqueue(sv Save) {
	s.mu.Lock()
	if old, ok := s.pending[sv.CharacterID]; ok && old.Lease == sv.Lease {
		// A release can't be undone by a later save of the same lease, and a lease-only save keeps
		// the state it replaces.
		sv.Release = sv.Release || old.Release
		if sv.LeaseOnly && !old.LeaseOnly {
			sv.Region, sv.Pos, sv.HP, sv.LeaseOnly = old.Region, old.Pos, old.HP, false
		}
	}
	s.pending[sv.CharacterID] = sv
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Pending is how many saves are waiting to be written.
func (s *Saver) Pending() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.pending)
}

// Held is how many leases the world holds.
func (s *Saver) Held() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.held)
}

// Flush writes every pending save in one transaction. If the write fails, the saves go back in the
// queue (behind any newer ones) and the error is returned.
func (s *Saver) Flush(ctx context.Context) error {
	s.writing.Lock()
	defer s.writing.Unlock()
	s.mu.Lock()
	if len(s.pending) == 0 {
		s.mu.Unlock()
		return nil
	}
	batch := make([]Save, 0, len(s.pending))
	for _, sv := range s.pending {
		batch = append(batch, sv)
	}
	clear(s.pending)
	s.mu.Unlock()
	slices.SortFunc(batch, func(a, b Save) int { return cmp.Compare(a.CharacterID, b.CharacterID) })

	now := s.cfg.Now()
	lost, err := s.cfg.Store.Write(ctx, s.cfg.World, batch, now, now.Add(s.cfg.LeaseTTL))
	if err != nil {
		s.mu.Lock()
		for _, sv := range batch {
			if newer, ok := s.pending[sv.CharacterID]; ok {
				if newer.Lease == sv.Lease {
					newer.Release = newer.Release || sv.Release
					if newer.LeaseOnly && !sv.LeaseOnly {
						newer.Region, newer.Pos, newer.HP, newer.LeaseOnly = sv.Region, sv.Pos, sv.HP, false
					}
					s.pending[sv.CharacterID] = newer
				}
				continue
			}
			s.pending[sv.CharacterID] = sv
		}
		s.mu.Unlock()
		return err
	}
	lostSet := map[string]bool{}
	for _, id := range lost {
		lostSet[id] = true
	}
	var tell []string
	s.mu.Lock()
	for _, sv := range batch {
		switch {
		case lostSet[sv.CharacterID]:
			if s.held[sv.CharacterID] == sv.Lease {
				delete(s.held, sv.CharacterID)
				if !sv.Release {
					tell = append(tell, sv.CharacterID)
				}
			}
		case sv.Release:
			if s.held[sv.CharacterID] == sv.Lease {
				delete(s.held, sv.CharacterID)
			}
		}
	}
	s.mu.Unlock()
	for _, id := range lost {
		s.cfg.Log.Warn("save refused: this world no longer holds the character's lease", "character", id)
	}
	s.tell(tell)
	return nil
}

// Renew extends every lease the world holds.
func (s *Saver) Renew(ctx context.Context) error {
	s.writing.Lock()
	defer s.writing.Unlock()
	s.mu.Lock()
	leases := make([]string, 0, len(s.held))
	byLease := make(map[string]string, len(s.held))
	for id, lease := range s.held {
		leases = append(leases, lease)
		byLease[lease] = id
	}
	s.mu.Unlock()
	if len(leases) == 0 {
		return nil
	}
	slices.Sort(leases)
	lost, err := s.cfg.Store.Renew(ctx, s.cfg.World, leases, s.cfg.Now().Add(s.cfg.LeaseTTL))
	if err != nil {
		return err
	}
	var tell []string
	s.mu.Lock()
	for _, lease := range lost {
		id := byLease[lease]
		if s.held[id] == lease {
			delete(s.held, id)
			tell = append(tell, id)
		}
	}
	s.mu.Unlock()
	for _, id := range tell {
		s.cfg.Log.Warn("lease lost: another world has the character", "character", id)
	}
	s.tell(tell)
	return nil
}

func (s *Saver) tell(ids []string) {
	if s.cfg.OnLost == nil {
		return
	}
	for _, id := range ids {
		s.cfg.OnLost(id)
	}
}

// Run writes saves as they arrive and renews the leases every RenewEvery, until ctx ends. A failed
// write is tried again after RetryAfter. Run never drops a save; Drain writes whatever is left at
// shutdown.
func (s *Saver) Run(ctx context.Context) {
	renew := time.NewTicker(s.cfg.RenewEvery)
	defer renew.Stop()
	retry := time.NewTimer(0)
	<-retry.C
	defer retry.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-retry.C:
		case <-renew.C:
			if err := s.Renew(ctx); err != nil && ctx.Err() == nil {
				s.cfg.Log.Error("renewing leases failed", "err", err)
			}
		}
		if err := s.Flush(ctx); err != nil && ctx.Err() == nil {
			s.cfg.Log.Error("saving characters failed; trying again", "err", err, "pending", s.Pending())
			retry.Reset(s.cfg.RetryAfter)
		}
	}
}

// Drain writes every pending save, trying again after RetryAfter until ctx ends. Call it at
// shutdown, after the regions have stopped (they queue a final save, releasing the lease, for every
// player). It returns an error if saves are still waiting at the deadline.
func (s *Saver) Drain(ctx context.Context) error {
	for {
		err := s.Flush(ctx)
		if err == nil {
			if s.Pending() == 0 {
				return nil
			}
			continue // more arrived while writing
		}
		s.cfg.Log.Error("saving characters at shutdown failed; trying again", "err", err, "pending", s.Pending())
		t := time.NewTimer(s.cfg.RetryAfter)
		select {
		case <-ctx.Done():
			t.Stop()
			return fmt.Errorf("persist: %d saves not written at the shutdown deadline", s.Pending())
		case <-t.C:
		}
	}
}
