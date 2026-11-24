package navmesh

import (
	"math"
	"testing"
)

func TestRaycast(t *testing.T) {
	cases := []struct {
		name, region string
		from, to     Vec3
		blocked      bool
		t            float64
		pos          Vec3
	}{
		{"clear down the corridor", "corridor", Vec3{1, 0, 1}, Vec3{19, 0, 1}, false, 1, Vec3{19, 0, 1}},
		{"into the corridor wall", "corridor", Vec3{1, 0, 1}, Vec3{10, 0, 5}, true, 0.25, Vec3{3.25, 0, 2}},
		{"out of the end", "corridor", Vec3{15, 0, 1}, Vec3{25, 0, 1}, true, 0.5, Vec3{20, 0, 1}},
		{"zero length", "corridor", Vec3{3, 0, 1}, Vec3{3, 0, 1}, false, 1, Vec3{3, 0, 1}},
		{"cutting the L corner", "lbend", Vec3{1, 0, 1}, Vec3{9, 0, 9}, true, 1.0 / 8, Vec3{2, 0, 2}},
		{"round the L corner", "lbend", Vec3{8, 0, 2}, Vec3{9, 0, 9}, false, 1, Vec3{9, 0, 9}},
		{"through the U wall", "uturn", Vec3{1, 0, 2}, Vec3{1, 0, 8}, true, 1.0 / 3, Vec3{1, 0, 4}},
		{"along the U wall's end", "uturn", Vec3{8, 0, 4}, Vec3{8, 0, 6}, false, 1, Vec3{8, 0, 6}},
		{"from the U wall's corner", "uturn", Vec3{8, 0, 6}, Vec3{1, 0, 8}, false, 1, Vec3{1, 0, 8}},
		{"between islands", "islands", Vec3{2, 0, 2}, Vec3{12, 0, 2}, true, 0.2, Vec3{4, 0, 2}},
		{"up the ramp", "stairs", Vec3{1, 0, 2}, Vec3{13, 3, 2}, false, 1, Vec3{13, 3, 2}},
		{"off the side of the ramp", "stairs", Vec3{7, 1.5, 2}, Vec3{7, 1.5, 6}, true, 0.5, Vec3{7, 1.5, 4}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := loadFixture(t, tc.region).Mesh
			hit, ok := m.Raycast(tc.from, tc.to)
			if !ok {
				t.Fatal("start not on the mesh")
			}
			if hit.Blocked != tc.blocked || math.Abs(hit.T-tc.t) > 1e-9 || !near(hit.Pos, tc.pos, 1e-9) {
				t.Errorf("got %+v, want blocked %v at t %g, %v", hit, tc.blocked, tc.t, tc.pos)
			}
		})
	}
}

func TestRaycastNeedsAStartOnTheMesh(t *testing.T) {
	m := loadFixture(t, "corridor").Mesh
	if _, ok := m.Raycast(Vec3{1, 0, 5}, Vec3{1, 0, 1}); ok {
		t.Error("a start 3 m off the mesh should fail")
	}
}

func TestRaycastAgreesWithPaths(t *testing.T) {
	// Where the ray is clear, the path between the two points is the straight line, and vice versa.
	m := genMesh(t, 200, 2, 60, 7)
	pf := NewPathfinder(m, DefaultLimits)
	clear := 0
	for _, q := range randomQueries(m, 300, 8) {
		if q.from.DistXZ(q.to) > 40 {
			continue
		}
		hit, ok := m.Raycast(q.from, q.to)
		if !ok {
			t.Fatal("start not on the mesh")
		}
		path, st := pf.FindPath(nil, q.from, q.to)
		if st != Complete {
			continue
		}
		straight := true // every waypoint on the from→to line in XZ (extra ones follow the height)
		for _, w := range path {
			straight = straight && math.Abs(cross2(q.from, q.to, w))/q.from.DistXZ(q.to) < 1e-6
		}
		if !hit.Blocked {
			clear++
			if !straight {
				t.Errorf("%v→%v: ray clear but path %v isn't straight", q.from, q.to, path)
			}
		} else if straight {
			t.Errorf("%v→%v: ray blocked at %+v but the path is a straight line", q.from, q.to, hit)
		}
	}
	if clear == 0 {
		t.Error("no clear rays tested")
	}
}

func TestRayAlongADiagonalWall(t *testing.T) {
	// From the greybox region: a funnel leg runs exactly along a slanted wall edge, corner to corner, and
	// float error made the edge look like the ray was leaving through it.
	m, err := Build([]Vec3{{32.2, -0.5, 2.4}, {30.333, 0.1, 5.533}, {29.6, -0.3, 3.8}, {29.6, 0.1, 5.533}},
		[][]int{{0, 1, 2}, {2, 1, 3}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range [][2]Vec3{{{29.6, -0.3, 3.8}, {32.2, -0.5, 2.4}}, {{32.2, -0.5, 2.4}, {29.6, -0.3, 3.8}}} {
		if hit, ok := m.Raycast(tc[0], tc[1]); !ok || hit.Blocked {
			t.Errorf("%v→%v: %+v, %v; want clear", tc[0], tc[1], hit, ok)
		}
	}
}
