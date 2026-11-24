package navmesh

import (
	"math"
	"testing"
)

func pathLength(path []Vec3) float64 {
	l := 0.0
	for i := 1; i < len(path); i++ {
		l += path[i-1].Dist(path[i])
	}
	return l
}

// checkPath asserts the properties every path has: each straight leg stays on the mesh, and heights
// interpolated along it match the surface.
func checkPath(t *testing.T, m *Mesh, path []Vec3) {
	t.Helper()
	if len(path) < 2 {
		t.Fatalf("path %v has fewer than 2 waypoints", path)
	}
	for i := 1; i < len(path); i++ {
		a, b := path[i-1], path[i]
		if hit, ok := m.Raycast(a, b); !ok || (hit.Blocked && hit.T < 1-1e-6) {
			t.Fatalf("leg %d %v→%v leaves the mesh (hit %+v, ok %v); path %v", i, a, b, hit, ok, path)
		}
		for k := 0; k <= 10; k++ {
			p := a.Lerp(b, float64(k)/10)
			y, ok := m.HeightAt(p)
			if !ok || math.Abs(y-p.Y) > 2*heightTol {
				t.Fatalf("leg %d at %v: surface height %g (ok %v); path %v", i, p, y, ok, path)
			}
		}
	}
}

func wantPath(t *testing.T, got, want []Vec3) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("path %v, want %v", got, want)
	}
	for i := range got {
		if !near(got[i], want[i], 1e-6) {
			t.Fatalf("path %v, want %v", got, want)
		}
	}
}

func TestFixturePaths(t *testing.T) {
	cases := []struct {
		name, region string
		from, to     Vec3
		want         []Vec3
	}{
		{"straight corridor", "corridor", Vec3{1, 0, 1}, Vec3{19, 0, 1}, []Vec3{{1, 0, 1}, {19, 0, 1}}},
		{"corridor diagonal", "corridor", Vec3{0.5, 0, 0.5}, Vec3{19.5, 0, 1.5}, []Vec3{{0.5, 0, 0.5}, {19.5, 0, 1.5}}},
		{"same polygon", "corridor", Vec3{1, 0, 1}, Vec3{3, 0, 1.5}, []Vec3{{1, 0, 1}, {3, 0, 1.5}}},
		{"L-bend", "lbend", Vec3{1, 0, 1}, Vec3{9, 0, 9}, []Vec3{{1, 0, 1}, {8, 0, 2}, {9, 0, 9}}},
		{"L-bend backwards", "lbend", Vec3{9, 0, 9}, Vec3{1, 0, 1}, []Vec3{{9, 0, 9}, {8, 0, 2}, {1, 0, 1}}},
		{"U-turn", "uturn", Vec3{1, 0, 2}, Vec3{1, 0, 8}, []Vec3{{1, 0, 2}, {8, 0, 4}, {8, 0, 6}, {1, 0, 8}}},
		{"U-turn backwards", "uturn", Vec3{1, 0, 8}, Vec3{1, 0, 2}, []Vec3{{1, 0, 8}, {8, 0, 6}, {8, 0, 4}, {1, 0, 2}}},
		{"target snapped", "corridor", Vec3{1, 0, 1}, Vec3{10, 0, 6}, []Vec3{{1, 0, 1}, {10, 0, 2}}},
		{"target above", "corridor", Vec3{1, 0, 1}, Vec3{10, 3, 1}, []Vec3{{1, 0, 1}, {10, 0, 1}}},
		// The heights follow the ramp: waypoints are added where its slope starts and ends.
		{"up the stairs", "stairs", Vec3{1, 0, 2}, Vec3{13, 3, 2}, []Vec3{{1, 0, 2}, {4, 0, 2}, {10, 3, 2}, {13, 3, 2}}},
		{"down the stairs", "stairs", Vec3{13, 3, 2}, Vec3{1, 0, 2}, []Vec3{{13, 3, 2}, {10, 3, 2}, {4, 0, 2}, {1, 0, 2}}},
		{"along the ramp", "stairs", Vec3{5, 0.5, 1}, Vec3{9, 2.5, 3}, []Vec3{{5, 0.5, 1}, {9, 2.5, 3}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := loadFixture(t, tc.region).Mesh
			path, st := NewPathfinder(m, DefaultLimits).FindPath(nil, tc.from, tc.to)
			if st != Complete {
				t.Fatalf("status %v, want Complete", st)
			}
			wantPath(t, path, tc.want)
			checkPath(t, m, path)
		})
	}
}

func TestDiagonalUpTheStairsFollowsTheSurface(t *testing.T) {
	m := loadFixture(t, "stairs").Mesh
	path, st := NewPathfinder(m, DefaultLimits).FindPath(nil, Vec3{0.5, 0, 0.5}, Vec3{13.5, 3, 3.5})
	if st != Complete {
		t.Fatalf("status %v", st)
	}
	checkPath(t, m, path)
	if len(path) != 4 {
		t.Errorf("want start, the foot and top of the ramp, and the end; got %v", path)
	}
}

func TestNoPath(t *testing.T) {
	cases := []struct {
		name, region string
		from, to     Vec3
	}{
		{"other island", "islands", Vec3{1, 0, 1}, Vec3{12, 0, 2}},
		{"target too far from the mesh", "corridor", Vec3{1, 0, 1}, Vec3{10, 0, 7.5}},
		{"target too far below", "corridor", Vec3{1, 0, 1}, Vec3{10, -6, 1}},
		{"start off the mesh", "corridor", Vec3{1, 0, 9}, Vec3{10, 0, 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pf := NewPathfinder(loadFixture(t, tc.region).Mesh, DefaultLimits)
			dst := []Vec3{{7, 7, 7}}
			got, st := pf.FindPath(dst, tc.from, tc.to)
			if st != NoPath || len(got) != 1 || got[0] != dst[0] {
				t.Errorf("got %v, %v; want NoPath with dst unchanged", got, st)
			}
		})
	}
}

func TestLongClickWalksAsFarAsTheCapAllows(t *testing.T) {
	// A 300 m corridor of 10 m quads.
	var verts []Vec3
	var polys [][]int
	for i := 0; i <= 30; i++ {
		verts = append(verts, Vec3{float64(i) * 10, 0, 0}, Vec3{float64(i) * 10, 0, 2})
		if i > 0 {
			polys = append(polys, []int{2*i - 2, 2 * i, 2*i + 1, 2*i - 1})
		}
	}
	m, err := Build(verts, polys)
	if err != nil {
		t.Fatal(err)
	}
	path, st := NewPathfinder(m, DefaultLimits).FindPath(nil, Vec3{1, 0, 1}, Vec3{299, 0, 1})
	if st != Partial {
		t.Errorf("status %v, want Partial", st)
	}
	wantPath(t, path, []Vec3{{1, 0, 1}, {151, 0, 1}})

	// Within the cap it's complete.
	path, st = NewPathfinder(m, DefaultLimits).FindPath(nil, Vec3{1, 0, 1}, Vec3{150, 0, 1})
	if st != Complete || len(path) != 2 {
		t.Errorf("149 m: %v %v, want Complete", path, st)
	}
}

func TestLengthCapAroundACorner(t *testing.T) {
	m := loadFixture(t, "uturn").Mesh
	// The way round the wall is 16.6 m. With a 12 m cap the path is cut 12 m along it.
	path, st := NewPathfinder(m, Limits{SnapRadius: 5, MaxPathLength: 12, MaxExplored: 2000}).FindPath(nil, Vec3{1, 0, 2}, Vec3{1, 0, 8})
	if st != Partial {
		t.Fatalf("status %v, want Partial", st)
	}
	checkPath(t, m, path)
	if l := pathLength(path); math.Abs(l-12) > 1e-9 {
		t.Errorf("length %g, want 12", l)
	}
	if len(path) != 4 || !near(path[1], Vec3{8, 0, 4}, 1e-9) || !near(path[2], Vec3{8, 0, 6}, 1e-9) {
		t.Errorf("should go round the wall: %v", path)
	}

	// If the search runs out before it gets round, it walks to the explored point nearest the target.
	path, st = NewPathfinder(m, Limits{SnapRadius: 5, MaxPathLength: 150, MaxExplored: 2}).FindPath(nil, Vec3{1, 0, 2}, Vec3{1, 0, 8})
	if st != Partial {
		t.Fatalf("status %v, want Partial", st)
	}
	wantPath(t, path, []Vec3{{1, 0, 2}, {1, 0, 4}})
}

func TestExploredCapGivesAPartialPathTowardsTheTarget(t *testing.T) {
	m := genMesh(t, 100, 2, 20, 1)
	pf := NewPathfinder(m, Limits{SnapRadius: 5, MaxPathLength: 150, MaxExplored: 50})
	var from, to Vec3
	for _, q := range randomQueries(m, 100, 9) { // one far enough, with no straight line
		if hit, _ := m.Raycast(q.from, q.to); hit.Blocked && q.from.DistXZ(q.to) > 60 {
			from, to = q.from, q.to
			break
		}
	}
	path, st := pf.FindPath(nil, from, to)
	if st != Partial || pf.Explored != 50 {
		t.Fatalf("status %v after %d polygons, want Partial after 50", st, pf.Explored)
	}
	checkPath(t, m, path)
	if end := path[len(path)-1]; end.DistXZ(to) >= path[0].DistXZ(to)-5 {
		t.Errorf("partial path %v doesn't head for the target", path)
	}
}

func TestRandomPathsOnAGeneratedMesh(t *testing.T) {
	m := genMesh(t, 200, 2, 60, 7)
	pf := NewPathfinder(m, DefaultLimits)
	var path []Vec3
	counts := map[Status]int{}
	for _, q := range randomQueries(m, 300, 3) {
		var st Status
		path, st = pf.FindPath(path[:0], q.from, q.to)
		counts[st]++
		if st == NoPath {
			t.Fatalf("%v→%v: NoPath on one island", q.from, q.to)
		}
		checkPath(t, m, path)
		l := pathLength(path)
		if l > DefaultLimits.MaxPathLength+1e-6 {
			t.Fatalf("path is %g m, over the cap", l)
		}
		if st == Complete {
			if path[len(path)-1].DistXZ(q.to) > 1e-6 {
				t.Fatalf("complete path ends at %v, not %v", path[len(path)-1], q.to)
			}
			xz := 0.0
			for i := 1; i < len(path); i++ {
				xz += path[i-1].DistXZ(path[i])
			}
			if xz < q.from.DistXZ(q.to)-1e-6 {
				t.Fatalf("path %g m is shorter than the straight line", xz)
			}
		}
		if pf.Explored > DefaultLimits.MaxExplored {
			t.Fatalf("explored %d polygons", pf.Explored)
		}
	}
	t.Logf("statuses: %v", counts)
	if counts[Complete] < 100 {
		t.Errorf("too few complete paths: %v", counts)
	}
}

func TestPathsAreDeterministic(t *testing.T) {
	m := genMesh(t, 200, 2, 60, 7)
	a, b := NewPathfinder(m, DefaultLimits), NewPathfinder(m, DefaultLimits)
	qs := randomQueries(m, 50, 4)
	// Run b on other queries first so its scratch state differs.
	for _, q := range randomQueries(m, 20, 5) {
		b.FindPath(nil, q.from, q.to)
	}
	for _, q := range qs {
		pa, sa := a.FindPath(nil, q.from, q.to)
		pb, sb := b.FindPath(nil, q.from, q.to)
		if sa != sb || len(pa) != len(pb) {
			t.Fatalf("different results for %v", q)
		}
		for i := range pa {
			if pa[i] != pb[i] {
				t.Fatalf("different results for %v", q)
			}
		}
	}
}

func TestFindPathDoesNotAllocate(t *testing.T) {
	m := genMesh(t, 200, 2, 60, 7)
	pf := NewPathfinder(m, DefaultLimits)
	qs := randomQueries(m, 64, 6)
	buf := make([]Vec3, 0, 256)
	for _, q := range qs { // warm the scratch buffers
		buf, _ = pf.FindPath(buf[:0], q.from, q.to)
	}
	i := 0
	allocs := testing.AllocsPerRun(200, func() {
		q := qs[i%len(qs)]
		i++
		buf, _ = pf.FindPath(buf[:0], q.from, q.to)
	})
	if allocs != 0 {
		t.Errorf("FindPath allocates %v times per call", allocs)
	}
}
