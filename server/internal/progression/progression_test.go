package progression

import "testing"

func defaultTable(t *testing.T) *Table {
	t.Helper()
	tab, err := NewTable(Curve{Base: 50, Growth: 1.1, Linear: 25}, 100, 200_000_000)
	if err != nil {
		t.Fatal(err)
	}
	return tab
}

// The anchors in docs/design/progression.md and wiki/levels-and-xp.md. The client's GUT test checks the same.
func TestAnchorTotals(t *testing.T) {
	tab := defaultTable(t)
	for level, want := range map[int]int64{1: 0, 2: 75, 10: 1805, 30: 18309, 50: 83486, 70: 418851, 80: 1009592, 92: 3026312, 99: 5815243, 100: 6387165} {
		if got := tab.XPForLevel(level); got != want {
			t.Errorf("XPForLevel(%d) = %d, want %d", level, got, want)
		}
	}
}

func TestLevelForXPBoundaries(t *testing.T) {
	tab := defaultTable(t)
	for _, c := range []struct {
		xp   int64
		want int
	}{{0, 1}, {74, 1}, {75, 2}, {6387164, 99}, {6387165, 100}, {200_000_000, 100}, {-5, 1}} {
		if got := tab.LevelForXP(c.xp); got != c.want {
			t.Errorf("LevelForXP(%d) = %d, want %d", c.xp, got, c.want)
		}
	}
}

func TestEveryLevelRoundTrips(t *testing.T) {
	tab := defaultTable(t)
	for level := 1; level <= 100; level++ {
		xp := tab.XPForLevel(level)
		if got := tab.LevelForXP(xp); got != level {
			t.Fatalf("LevelForXP(XPForLevel(%d)) = %d", level, got)
		}
		if level > 1 && tab.LevelForXP(xp-1) != level-1 {
			t.Fatalf("one XP short of level %d should be level %d", level, level-1)
		}
	}
}

func TestAddXPCapsAndIgnoresNegatives(t *testing.T) {
	tab := defaultTable(t)
	if got := tab.AddXP(199_999_990, 50); got != 200_000_000 {
		t.Errorf("AddXP over cap = %d", got)
	}
	if got := tab.AddXP(100, -10); got != 100 {
		t.Errorf("AddXP negative = %d", got)
	}
}

func TestRejectsBadCurves(t *testing.T) {
	if _, err := NewTable(Curve{Base: -100, Growth: 1, Linear: 0}, 100, 1e9); err == nil {
		t.Error("expected an error for a non-positive step")
	}
	if _, err := NewTable(Curve{Base: 50, Growth: 1.1, Linear: 25}, 100, 1000); err == nil {
		t.Error("expected an error when level 100 needs more than max_xp")
	}
}
