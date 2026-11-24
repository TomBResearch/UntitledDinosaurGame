// Package progression turns XP into levels. The server stores XP; levels are always derived from it,
// so the curve can be retuned without losing anyone's progress (docs/design/progression.md).
package progression

import (
	"fmt"
	"math"
)

// Curve is the XP curve from data/progression.json: the XP to go from level L to L+1 is
// round(Base·Growth^(L−1) + Linear·L).
type Curve struct {
	Base   float64 `json:"base"`
	Growth float64 `json:"growth"`
	Linear float64 `json:"linear"`
}

// Table is a precomputed XP table for levels 1..MaxLevel.
type Table struct {
	MaxLevel int
	MaxXP    int64
	totals   []int64 // totals[L] = total XP to reach level L; totals[0] unused, totals[1] = 0
}

// NewTable builds the table. It fails on settings that would make levels non-increasing or overflow MaxXP.
func NewTable(c Curve, maxLevel int, maxXP int64) (*Table, error) {
	if maxLevel < 2 {
		return nil, fmt.Errorf("max_level must be at least 2, got %d", maxLevel)
	}
	t := &Table{MaxLevel: maxLevel, MaxXP: maxXP, totals: make([]int64, maxLevel+1)}
	for level := 1; level < maxLevel; level++ {
		step := int64(math.Round(c.Base*math.Pow(c.Growth, float64(level-1)) + c.Linear*float64(level)))
		if step <= 0 {
			return nil, fmt.Errorf("xp_curve gives a non-positive step (%d) at level %d", step, level)
		}
		t.totals[level+1] = t.totals[level] + step
	}
	if t.totals[maxLevel] > maxXP {
		return nil, fmt.Errorf("level %d needs %d XP, above max_xp %d", maxLevel, t.totals[maxLevel], maxXP)
	}
	return t, nil
}

// XPForLevel is the total XP needed to reach level (clamped to 1..MaxLevel).
func (t *Table) XPForLevel(level int) int64 {
	return t.totals[min(max(level, 1), t.MaxLevel)]
}

// LevelForXP is the level that a total of xp gives.
func (t *Table) LevelForXP(xp int64) int {
	lo, hi := 1, t.MaxLevel
	for lo < hi { // highest level whose total is <= xp
		mid := (lo + hi + 1) / 2
		if t.totals[mid] <= xp {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo
}

// AddXP adds gained XP to a total, capped at MaxXP. Negative gains are ignored.
func (t *Table) AddXP(total, gained int64) int64 {
	if gained <= 0 {
		return total
	}
	return min(total+gained, t.MaxXP)
}
