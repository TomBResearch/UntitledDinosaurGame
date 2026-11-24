package navmesh

import (
	"math"
	"path/filepath"
	"strings"
	"testing"
)

func loadFixture(t testing.TB, name string) *Region {
	t.Helper()
	r, err := LoadRegion(filepath.Join("testdata", name+".region.json"))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func near(a, b Vec3, tol float64) bool { return a.Dist(b) <= tol }

func TestFixturesLoad(t *testing.T) {
	for name, want := range map[string]int{"corridor": 4, "lbend": 3, "uturn": 6, "islands": 2, "stairs": 4} {
		r := loadFixture(t, name)
		if r.ID != name {
			t.Errorf("%s: region id %q", name, r.ID)
		}
		if got := r.Mesh.PolygonCount(); got != want {
			t.Errorf("%s: %d polygons, want %d", name, got, want)
		}
		if len(r.PlayerSpawns) != 1 || len(r.RespawnPoints) != 1 {
			t.Errorf("%s: spawns not loaded", name)
		}
	}
}

func TestAdjacencyIsBuiltFromSharedEdges(t *testing.T) {
	m := loadFixture(t, "corridor").Mesh
	// The quads are in a row; each links to the ones beside it, whatever its winding, and the third one
	// links through the near-duplicate vertex the loader merges.
	for p, want := range [][]int{{1}, {0, 2}, {1, 3}, {2}} {
		var got []int
		for _, nb := range m.Neighbours(p) {
			if nb >= 0 {
				got = append(got, nb)
			}
		}
		if len(got) != len(want) {
			t.Fatalf("polygon %d neighbours %v, want %v", p, got, want)
		}
		for _, w := range want {
			found := false
			for _, g := range got {
				found = found || g == w
			}
			if !found {
				t.Errorf("polygon %d neighbours %v, want %v", p, got, want)
			}
		}
	}
}

func TestWindingIsNormalised(t *testing.T) {
	for _, name := range []string{"corridor", "lbend", "uturn", "stairs"} {
		m := loadFixture(t, name).Mesh
		for p := range m.PolygonCount() {
			ring := m.ring(int32(p))
			if signedArea(m.verts, ring) <= 0 {
				t.Errorf("%s: polygon %d not normalised", name, p)
			}
		}
	}
}

func TestVerticesFurtherThanOneCentimetreStaySeparate(t *testing.T) {
	square := func(x0 float64) []Vec3 {
		return []Vec3{{x0, 0, 0}, {x0 + 2, 0, 0}, {x0 + 2, 0, 2}, {x0, 0, 2}}
	}
	for _, tc := range []struct {
		gap       float64
		connected bool
	}{{0.004, true}, {0.02, false}} {
		verts := append(square(0), square(2+tc.gap)...)
		m, err := Build(verts, [][]int{{0, 1, 2, 3}, {4, 5, 6, 7}})
		if err != nil {
			t.Fatal(err)
		}
		if got := m.Connected(0, 1); got != tc.connected {
			t.Errorf("gap %g m: connected %v, want %v", tc.gap, got, tc.connected)
		}
	}
}

func TestIslands(t *testing.T) {
	m := loadFixture(t, "islands").Mesh
	if m.Connected(0, 1) {
		t.Error("separate squares should be separate islands")
	}
}

func TestRejectsBadMeshes(t *testing.T) {
	sq := []Vec3{{0, 0, 0}, {2, 0, 0}, {2, 0, 2}, {0, 0, 2}}
	cases := []struct {
		name  string
		verts []Vec3
		polys [][]int
		want  string
	}{
		{"index out of range", sq, [][]int{{0, 1, 4}}, "vertex index 4, but there are only 4"},
		{"negative index", sq, [][]int{{0, -1, 2}}, "vertex index -1"},
		{"too few vertices", sq, [][]int{{0, 1}}, "has 2 vertices"},
		{"too many vertices", append(sq, Vec3{1, 0, -1}, Vec3{3, 0, 1}, Vec3{1, 0, 3}), [][]int{{0, 4, 1, 5, 2, 6, 3}}, "has 7 vertices"},
		{"repeated vertex", sq, [][]int{{0, 1, 1, 2}}, "vertex 1 appears twice"},
		{"collinear", []Vec3{{0, 0, 0}, {1, 0, 0}, {2, 0, 0}}, [][]int{{0, 1, 2}}, "degenerate"},
		{"vertical", []Vec3{{0, 0, 0}, {1, 0, 0}, {1, 5, 0}}, [][]int{{0, 1, 2}}, "degenerate"},
		{"merged away", []Vec3{{0, 0, 0}, {0.001, 0, 0}, {2, 0, 2}}, [][]int{{0, 1, 2}}, "degenerate"},
		{"non-convex arrow", []Vec3{{0, 0, 0}, {2, 0, 1}, {0, 0, 2}, {1, 0, 1}}, [][]int{{0, 1, 2, 3}}, "not convex"},
		{"bow tie", sq, [][]int{{0, 2, 1, 3}}, "degenerate"},
		{"pentagram", pentagram(), [][]int{{0, 2, 4, 1, 3}}, "not convex"},
		{"overlapping", sq, [][]int{{0, 1, 2}, {0, 1, 3}}, "overlap"},
		{"edge shared three times", append(sq, Vec3{1, 1, -2}), [][]int{{0, 1, 2}, {1, 0, 4}, {0, 1, 3}}, "more than two"},
		{"NaN", []Vec3{{0, 0, 0}, {1, 0, 0}, {math.NaN(), 0, 1}}, [][]int{{0, 1, 2}}, "bad coordinate"},
		{"empty", nil, nil, "no vertices"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Build(tc.verts, tc.polys)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("got %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func pentagram() []Vec3 {
	var vs []Vec3
	for k := range 5 {
		a := math.Pi/2 + float64(k)*2*math.Pi/5
		vs = append(vs, Vec3{3 * math.Cos(a), 0, 3 * math.Sin(a)})
	}
	return vs
}

func TestAcceptsCollinearVertices(t *testing.T) {
	// Godot can leave a vertex in the middle of a straight edge (the stairs fixture has one too).
	_, err := Build([]Vec3{{0, 0, 0}, {1, 0, 0}, {2, 0, 0}, {2, 0, 2}, {0, 0, 2}}, [][]int{{0, 1, 2, 3, 4}})
	if err != nil {
		t.Fatal(err)
	}
}

const goodRegion = `{
  "format": 1, "region_id": "tiny", "source_hash": "` + "abababababababababababababababababababababababababababababababab" + `",
  "navmesh": {"vertices": [[0,0,0],[4,0,0],[4,0,4],[0,0,4]], "polygons": [[0,1,2,3]]},
  "player_spawns": [{"pos": [1,0,1]}], "respawn_points": [], "creature_spawns": [], "resource_nodes": [], "exits": []
}`

func TestParseRegion(t *testing.T) {
	r, err := ParseRegion([]byte(goodRegion))
	if err != nil {
		t.Fatal(err)
	}
	if r.ID != "tiny" || r.Mesh.PolygonCount() != 1 || r.PlayerSpawns[0] != (Vec3{1, 0, 1}) {
		t.Errorf("unexpected region %+v", r)
	}
}

func TestRejectsBadRegionFiles(t *testing.T) {
	cases := []struct{ name, from, to, want string }{
		{"wrong format", `"format": 1`, `"format": 2`, "format 2, but this server reads format 1"},
		{"no format", `"format": 1,`, ``, `no "format"`},
		{"unknown field", `"exits": []`, `"exits": [], "colour": "red"`, `unknown field "colour"`},
		{"unknown navmesh field", `"polygons"`, `"adjacency": [], "polygons"`, `unknown field "adjacency"`},
		{"out-of-range index", `[[0,1,2,3]]`, `[[0,1,2,9]]`, "vertex index 9"},
		{"degenerate", `[[0,1,2,3]]`, `[[0,1,1]]`, "appears twice"},
		{"non-convex", `[4,0,4],[0,0,4]]`, `[1,0,1],[0,0,4]]`, "not convex"},
		{"two coordinates", `[4,0,0]`, `[4,0]`, "vertex 1 has 2 coordinates"},
		{"bad id", `"tiny"`, `"Tiny Region"`, "bad region_id"},
		{"bad hash", `"abab`, `"zzab`, "source_hash"},
		{"spawn off the mesh", `[1,0,1]`, `[1,0,20]`, "player_spawns[0]"},
		{"no navmesh", `"navmesh"`, `"navmesh_old"`, "unknown field"},
		{"trailing data", "\n}", "\n} {}", "after top-level value"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := strings.Replace(goodRegion, tc.from, tc.to, 1)
			if src == goodRegion {
				t.Fatalf("replacement %q didn't apply", tc.from)
			}
			_, err := ParseRegion([]byte(src))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("got %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func TestClosestPointAndHeight(t *testing.T) {
	stairs := loadFixture(t, "stairs").Mesh
	for _, tc := range []struct{ x, z, y float64 }{{2, 2, 0}, {4, 1, 0}, {7, 2, 1.5}, {8.5, 0.5, 2.25}, {12, 3, 3}} {
		y, ok := stairs.HeightAt(Vec3{tc.x, 0, tc.z})
		if !ok || math.Abs(y-tc.y) > 1e-9 {
			t.Errorf("height at (%g, %g) = %g, %v; want %g", tc.x, tc.z, y, ok, tc.y)
		}
	}
	if _, ok := stairs.HeightAt(Vec3{20, 0, 2}); ok {
		t.Error("height off the mesh should fail")
	}

	corridor := loadFixture(t, "corridor").Mesh
	for _, tc := range []struct {
		p, want Vec3
		ok      bool
	}{
		{Vec3{10, 0, 1}, Vec3{10, 0, 1}, true},   // on the mesh
		{Vec3{10, 4.5, 1}, Vec3{10, 0, 1}, true}, // 4.5 m above it
		{Vec3{10, 0, 6}, Vec3{10, 0, 2}, true},   // 4 m to the side
		{Vec3{-3, 0, -3}, Vec3{0, 0, 0}, true},   // beyond a corner, 4.2 m away
		{Vec3{10, 0, 7.5}, Vec3{}, false},        // 5.5 m to the side
		{Vec3{10, 0, -5.01}, Vec3{}, false},      // just over 5 m
		{Vec3{30, 0, 1}, Vec3{}, false},          // past the end
	} {
		loc, ok := corridor.ClosestPoint(tc.p, DefaultLimits.SnapRadius)
		if ok != tc.ok || (ok && !near(loc.Pos, tc.want, 1e-9)) {
			t.Errorf("ClosestPoint(%v) = %v, %v; want %v, %v", tc.p, loc.Pos, ok, tc.want, tc.ok)
		}
	}
}

func TestOverlappingLevelsPickTheNearestHeight(t *testing.T) {
	// A walkway at y=5 directly over the ground at y=0, not connected (a bridge without its ramps).
	m, err := Build([]Vec3{{0, 0, 0}, {4, 0, 0}, {4, 0, 4}, {0, 0, 4}, {0, 5, 1}, {4, 5, 1}, {4, 5, 3}, {0, 5, 3}},
		[][]int{{0, 1, 2, 3}, {4, 5, 6, 7}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ y, want float64 }{{0.3, 0}, {2, 0}, {3, 5}, {6, 5}} {
		if got, _ := m.HeightAt(Vec3{2, tc.y, 2}); got != tc.want {
			t.Errorf("standing at y=%g: height %g, want %g", tc.y, got, tc.want)
		}
	}
	pf := NewPathfinder(m, DefaultLimits)
	if _, st := pf.FindPath(nil, Vec3{2, 0, 2}, Vec3{2, 5, 2}); st != NoPath {
		t.Errorf("ground to walkway: %v, want NoPath", st)
	}
}
