package navmesh

import (
	"math"
	"math/rand/v2"
	"testing"
)

// genMesh builds a size×size metre field of cell-metre squares (every fifth one split into two triangles)
// on gentle hills, with rectangular obstacles cut out at places chosen by seed. It stands in for a test
// region when benchmarking, and is harder than a Godot bake of the same area: Godot merges flat ground
// into far fewer, larger polygons.
func genMesh(t testing.TB, size, cell float64, obstacles int, seed uint64) *Mesh {
	t.Helper()
	n := int(size / cell)
	rng := rand.New(rand.NewPCG(seed, 1))
	blocked := make([]bool, n*n)
	for range obstacles {
		w, d := 2+rng.IntN(10), 2+rng.IntN(10)
		x0, z0 := rng.IntN(n-w), rng.IntN(n-d)
		for z := z0; z < z0+d; z++ {
			for x := x0; x < x0+w; x++ {
				blocked[z*n+x] = true
			}
		}
	}
	verts := make([]Vec3, 0, (n+1)*(n+1))
	for z := 0; z <= n; z++ {
		for x := 0; x <= n; x++ {
			px, pz := float64(x)*cell, float64(z)*cell
			verts = append(verts, Vec3{px, 3 * math.Sin(px/23) * math.Cos(pz/17), pz})
		}
	}
	vi := func(x, z int) int { return z*(n+1) + x }
	var polys [][]int
	for z := 0; z < n; z++ {
		for x := 0; x < n; x++ {
			if blocked[z*n+x] {
				continue
			}
			a, b, c, d := vi(x, z), vi(x+1, z), vi(x+1, z+1), vi(x, z+1)
			if (x*7+z*3)%5 == 0 {
				polys = append(polys, []int{a, b, c}, []int{a, c, d})
			} else {
				polys = append(polys, []int{a, b, c, d})
			}
		}
	}
	m, err := Build(verts, polys)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

type query struct{ from, to Vec3 }

// randomQueries picks pairs of polygon centres on the same island.
func randomQueries(m *Mesh, count int, seed uint64) []query {
	rng := rand.New(rand.NewPCG(seed, 2))
	centre := func(p int) Vec3 {
		var c Vec3
		ring := m.ring(int32(p))
		for _, v := range ring {
			c = c.Add(m.verts[v])
		}
		return c.Scale(1 / float64(len(ring)))
	}
	qs := make([]query, 0, count)
	for len(qs) < count {
		a, b := rng.IntN(m.PolygonCount()), rng.IntN(m.PolygonCount())
		if m.Connected(a, b) {
			qs = append(qs, query{centre(a), centre(b)})
		}
	}
	return qs
}
