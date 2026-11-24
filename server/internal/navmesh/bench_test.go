package navmesh

import (
	"errors"
	"io/fs"
	"testing"
	"time"
)

// The greybox test region, once it's exported (M0 "Test region and export").
const greyboxRegion = "../../../data/regions/test_greybox.region.json"

// budget is the spec's per-path budget (docs/architecture/world-server.md). tools/slow-tests.sh checks the
// benchmark against it.
const budget = 200 * time.Microsecond

func benchMeshes(b *testing.B) map[string]*Mesh {
	meshes := map[string]*Mesh{"generated_200m": genMesh(b, 200, 2, 60, 7)}
	r, err := LoadRegion(greyboxRegion)
	switch {
	case err == nil:
		meshes["test_greybox"] = r.Mesh
	case !errors.Is(err, fs.ErrNotExist):
		b.Fatal(err)
	}
	return meshes
}

// BenchmarkFindPath times paths between random points on the same island, most of them too far apart
// to see each other, so A* runs. ns/op is the time per path.
func BenchmarkFindPath(b *testing.B) {
	for name, m := range benchMeshes(b) {
		b.Run(name, func(b *testing.B) {
			pf := NewPathfinder(m, DefaultLimits)
			qs := randomQueries(m, 512, 11)
			buf := make([]Vec3, 0, 256)
			explored, partial := 0, 0
			b.ReportAllocs()
			b.ResetTimer()
			for i := range b.N {
				q := qs[i%len(qs)]
				var st Status
				buf, st = pf.FindPath(buf[:0], q.from, q.to)
				explored += pf.Explored
				if st == Partial {
					partial++
				}
			}
			b.ReportMetric(float64(explored)/float64(b.N), "polys/op")
			b.ReportMetric(float64(partial)/float64(b.N), "partial/op")
		})
	}
}

func BenchmarkRaycast(b *testing.B) {
	for name, m := range benchMeshes(b) {
		b.Run(name, func(b *testing.B) {
			qs := randomQueries(m, 512, 12)
			b.ReportAllocs()
			b.ResetTimer()
			for i := range b.N {
				q := qs[i%len(qs)]
				m.Raycast(q.from, q.to)
			}
		})
	}
}

// TestPathBudget is the fast check's quick look at speed: a coarse bound (5× the budget) that only a
// gross regression would break, so a busy CI machine doesn't fail it. The real check against the budget is
// the benchmark in tools/slow-tests.sh.
func TestPathBudget(t *testing.T) {
	if raceEnabled || testing.Short() {
		t.Skip("timing is meaningless under -race or -short")
	}
	m := genMesh(t, 200, 2, 60, 7)
	pf := NewPathfinder(m, DefaultLimits)
	qs := randomQueries(m, 300, 13)
	buf := make([]Vec3, 0, 256)
	for _, q := range qs { // warm up
		buf, _ = pf.FindPath(buf[:0], q.from, q.to)
	}
	start := time.Now()
	for _, q := range qs {
		buf, _ = pf.FindPath(buf[:0], q.from, q.to)
	}
	per := time.Since(start) / time.Duration(len(qs))
	t.Logf("%v per path (budget %v)", per, budget)
	if per > 5*budget {
		t.Errorf("%v per path is over 5× the %v budget", per, budget)
	}
}
