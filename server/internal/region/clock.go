package region

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"
)

// bucket is a token bucket counted in ticks, so rate limits are deterministic in tests. A token is
// worth ticksPerMinute units and the bucket gains PerMinute units a tick, which is PerMinute tokens a
// minute exactly.
type bucket struct {
	level int64
	last  uint32
}

func (b *bucket) fill(l Limit, now uint32, ticksPerMinute int64) {
	b.level, b.last = int64(l.Burst)*ticksPerMinute, now
}

// take spends a token if there is one.
func (b *bucket) take(l Limit, now uint32, ticksPerMinute int64) bool {
	b.level = min(int64(l.Burst)*ticksPerMinute, b.level+int64(now-b.last)*int64(l.PerMinute))
	b.last = now
	if b.level < ticksPerMinute {
		return false
	}
	b.level -= ticksPerMinute
	return true
}

// Clock is the region's tick clock, for answering ping from other goroutines: which tick the region
// is on and how far through it.
type Clock struct {
	tick     atomic.Uint32
	start    atomic.Int64 // unix nanoseconds when the current tick was due
	interval atomic.Int64 // nanoseconds per tick
}

// Now returns the current tick and how far through it the server is, in 256ths.
func (c *Clock) Now() (tick uint32, phase uint8) {
	tick = c.tick.Load()
	elapsed := time.Now().UnixNano() - c.start.Load()
	p := elapsed * 256 / max(1, c.interval.Load())
	return tick, uint8(max(0, min(255, p)))
}

func (c *Clock) set(tick uint32, due time.Time) {
	c.start.Store(due.UnixNano())
	c.tick.Store(tick)
}

// TickBudget is the p99 tick time a region must stay under (docs/architecture/world-server.md). Run
// logs any tick that takes longer.
const TickBudget = 10 * time.Millisecond

// Run steps the region every interval until ctx is done. A late tick is followed straight away by the
// next one, so the simulation catches up rather than skipping. Normally interval is 1 s / TickHz;
// tests may run faster.
func (r *Region) Run(ctx context.Context, interval time.Duration) {
	r.clock.interval.Store(int64(interval))
	timer := time.NewTimer(0)
	defer timer.Stop()
	due := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		for {
			began := time.Now()
			r.Step()
			r.clock.set(r.tick, due)
			if took := time.Since(began); took > TickBudget {
				slog.Warn("slow tick", "region", r.id, "tick", r.tick, "took", took)
			}
			due = due.Add(interval)
			wait := time.Until(due)
			if wait > 0 {
				timer.Reset(wait)
				break
			}
			if ctx.Err() != nil {
				return
			}
		}
	}
}
