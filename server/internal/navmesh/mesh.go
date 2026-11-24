// Package navmesh is the server's view of a region's walkable surface: the navmesh Godot bakes and
// tools/export-regions.sh exports (ADR 0004). It answers "where on the mesh is this point?", finds paths
// (A* over polygons, then the funnel), and raycasts along the mesh for line of sight and dashes.
//
// A Mesh is immutable once built and safe to share between goroutines. Path finding needs scratch memory,
// which lives in a Pathfinder owned by one goroutine (the region's tick goroutine).
package navmesh

import (
	"errors"
	"fmt"
	"math"
)

const (
	// MinPolyVerts and MaxPolyVerts bound the vertex count of one polygon (Godot bakes at most 6).
	MinPolyVerts = 3
	MaxPolyVerts = 6
	// mergeDist: vertices closer than this (metres) are treated as one, in case the exporter duplicates them.
	mergeDist = 0.01
	// minPolyArea: polygons with a smaller XZ area (m²) are degenerate.
	minPolyArea = 1e-6
	// convexTol: how far (metres) a vertex may sit on the wrong side of an edge before the polygon counts
	// as non-convex. Allows collinear vertices and float noise.
	convexTol = 1e-3
	// gridCell is the side (metres) of a cell in the polygon lookup grid.
	gridCell = 4.0
	// maxCoord bounds every coordinate, to catch garbage early.
	maxCoord = 1e6
)

// Mesh is a loaded navmesh. Polygons are convex in the XZ plane and wound so their signed XZ area is
// positive (interior on the left of each edge, see cross2).
type Mesh struct {
	verts      []Vec3
	polyStart  []int32 // polygon p's vertices are polyVerts[polyStart[p]:polyStart[p+1]]
	polyVerts  []int32
	neighbours []int32 // parallel to polyVerts: the polygon across edge k (vertex k to k+1), or -1 for a wall
	minX, minZ []float64
	maxX, maxZ []float64
	island     []int32 // connected component of each polygon

	// The lookup grid: cell c holds gridPolys[gridStart[c]:gridStart[c+1]].
	gridX0, gridZ0 float64
	gridW, gridH   int
	gridStart      []int32
	gridPolys      []int32
}

// Build validates a navmesh and prepares it for queries. Polygons index into vertices, 3 to 6 each,
// convex in XZ, in either winding. Adjacency is computed here from shared edges (ADR 0004).
func Build(vertices []Vec3, polygons [][]int) (*Mesh, error) {
	if len(vertices) == 0 || len(polygons) == 0 {
		return nil, errors.New("navmesh: no vertices or no polygons")
	}
	if len(vertices) > math.MaxInt32 || len(polygons) > math.MaxInt32/MaxPolyVerts {
		return nil, errors.New("navmesh: too big")
	}
	for i, v := range vertices {
		for _, c := range [3]float64{v.X, v.Y, v.Z} {
			if math.IsNaN(c) || math.Abs(c) > maxCoord {
				return nil, fmt.Errorf("navmesh: vertex %d has a bad coordinate %v", i, v)
			}
		}
	}
	m := &Mesh{verts: vertices}
	remap := mergeVertices(vertices)

	var problems []error
	bad := func(format string, args ...any) { problems = append(problems, fmt.Errorf("navmesh: "+format, args...)) }
	m.polyStart = make([]int32, 0, len(polygons)+1)
	var ring [MaxPolyVerts]int32
	for p, poly := range polygons {
		m.polyStart = append(m.polyStart, int32(len(m.polyVerts)))
		if len(poly) < MinPolyVerts || len(poly) > MaxPolyVerts {
			bad("polygon %d has %d vertices, want %d to %d", p, len(poly), MinPolyVerts, MaxPolyVerts)
			continue
		}
		n, rangeOK := 0, true
		for i, idx := range poly {
			if idx < 0 || idx >= len(vertices) {
				bad("polygon %d uses vertex index %d, but there are only %d vertices", p, idx, len(vertices))
				rangeOK = false
				break
			}
			for _, prev := range poly[:i] {
				if prev == idx {
					bad("polygon %d is degenerate: vertex %d appears twice", p, idx)
					rangeOK = false
				}
			}
			if !rangeOK {
				break
			}
			v := remap[idx]
			if n > 0 && ring[n-1] == v {
				continue // merged with its neighbour
			}
			ring[n] = v
			n++
		}
		if !rangeOK {
			continue
		}
		if n > 1 && ring[0] == ring[n-1] {
			n--
		}
		if err := checkPolygon(vertices, ring[:n]); err != nil {
			bad("polygon %d %v", p, err)
			continue
		}
		if signedArea(vertices, ring[:n]) < 0 {
			for i, j := 0, n-1; i < j; i, j = i+1, j-1 {
				ring[i], ring[j] = ring[j], ring[i]
			}
		}
		m.polyVerts = append(m.polyVerts, ring[:n]...)
	}
	m.polyStart = append(m.polyStart, int32(len(m.polyVerts)))
	if len(problems) == 0 {
		problems = append(problems, m.link()...)
	}
	if len(problems) > 0 {
		return nil, errors.Join(problems...)
	}
	m.computeBounds()
	m.computeIslands()
	m.buildGrid()
	return m, nil
}

// mergeVertices maps each vertex index to the lowest index of a vertex within mergeDist of it.
func mergeVertices(vs []Vec3) []int32 {
	type key struct{ x, y, z int64 }
	cell := func(v Vec3) key {
		return key{int64(math.Floor(v.X / mergeDist)), int64(math.Floor(v.Y / mergeDist)), int64(math.Floor(v.Z / mergeDist))}
	}
	buckets := make(map[key][]int32, len(vs))
	remap := make([]int32, len(vs))
	for i, v := range vs {
		remap[i] = int32(i)
		k := cell(v)
		found := false
		for dx := int64(-1); dx <= 1 && !found; dx++ {
			for dy := int64(-1); dy <= 1 && !found; dy++ {
				for dz := int64(-1); dz <= 1 && !found; dz++ {
					for _, j := range buckets[key{k.x + dx, k.y + dy, k.z + dz}] {
						if vs[j].DistSq(v) < mergeDist*mergeDist {
							remap[i] = j
							found = true
							break
						}
					}
				}
			}
		}
		if !found {
			buckets[k] = append(buckets[k], int32(i))
		}
	}
	return remap
}

func signedArea(vs []Vec3, ring []int32) float64 {
	a := 0.0
	for i := range ring {
		p, q := vs[ring[i]], vs[ring[(i+1)%len(ring)]]
		a += p.X*q.Z - q.X*p.Z
	}
	return a / 2
}

// checkPolygon rejects polygons that are degenerate or not convex in XZ (in either winding).
func checkPolygon(vs []Vec3, ring []int32) error {
	n := len(ring)
	if n < MinPolyVerts {
		return fmt.Errorf("is degenerate: only %d distinct vertices", n)
	}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if ring[i] == ring[j] {
				return fmt.Errorf("is degenerate: vertex %d appears twice", ring[i])
			}
		}
	}
	area := signedArea(vs, ring)
	if math.Abs(area) < minPolyArea {
		return fmt.Errorf("is degenerate: XZ area %.2g m²", math.Abs(area))
	}
	sign := 1.0
	if area < 0 {
		sign = -1
	}
	// Convex means every vertex is on the inner side of every edge. This also rejects self-intersecting rings.
	for i := 0; i < n; i++ {
		a, b := vs[ring[i]], vs[ring[(i+1)%n]]
		l := a.DistXZ(b)
		if l < minPolyArea {
			return fmt.Errorf("is degenerate: edge %d has zero length in XZ", i)
		}
		for j := 0; j < n; j++ {
			if dist := sign * cross2(a, b, vs[ring[j]]) / l; dist < -convexTol {
				return fmt.Errorf("is not convex: vertex %d is %.3f m outside edge %d", ring[j], -dist, i)
			}
		}
	}
	return nil
}

// link fills in neighbours from edges whose two (merged) vertex indices match.
func (m *Mesh) link() []error {
	m.neighbours = make([]int32, len(m.polyVerts))
	type half struct{ poly, slot int32 }
	open := make(map[uint64]half, len(m.polyVerts))
	var problems []error
	for i := range m.neighbours {
		m.neighbours[i] = -1
	}
	for p := 0; p < m.PolygonCount(); p++ {
		s, e := m.polyStart[p], m.polyStart[p+1]
		for k := s; k < e; k++ {
			a, b := m.polyVerts[k], m.polyVerts[s+(k-s+1)%(e-s)]
			key := uint64(min(a, b))<<32 | uint64(max(a, b))
			other, ok := open[key]
			if !ok {
				open[key] = half{int32(p), k}
				continue
			}
			switch {
			case other.poly < 0:
				problems = append(problems, fmt.Errorf("navmesh: edge %d-%d is shared by more than two polygons (polygon %d)", a, b, p))
			case m.polyVerts[other.slot] == a:
				problems = append(problems, fmt.Errorf("navmesh: polygons %d and %d overlap: both run edge %d→%d the same way", other.poly, p, a, b))
			default:
				m.neighbours[k] = other.poly
				m.neighbours[other.slot] = int32(p)
			}
			open[key] = half{-1, -1}
		}
	}
	return problems
}

func (m *Mesh) computeBounds() {
	n := m.PolygonCount()
	m.minX, m.minZ, m.maxX, m.maxZ = make([]float64, n), make([]float64, n), make([]float64, n), make([]float64, n)
	for p := 0; p < n; p++ {
		m.minX[p], m.minZ[p] = math.Inf(1), math.Inf(1)
		m.maxX[p], m.maxZ[p] = math.Inf(-1), math.Inf(-1)
		for _, vi := range m.ring(int32(p)) {
			v := m.verts[vi]
			m.minX[p], m.maxX[p] = math.Min(m.minX[p], v.X), math.Max(m.maxX[p], v.X)
			m.minZ[p], m.maxZ[p] = math.Min(m.minZ[p], v.Z), math.Max(m.maxZ[p], v.Z)
		}
	}
}

func (m *Mesh) computeIslands() {
	m.island = make([]int32, m.PolygonCount())
	for i := range m.island {
		m.island[i] = -1
	}
	var queue []int32
	next := int32(0)
	for p := range m.island {
		if m.island[p] >= 0 {
			continue
		}
		m.island[p] = next
		queue = append(queue[:0], int32(p))
		for len(queue) > 0 {
			q := queue[len(queue)-1]
			queue = queue[:len(queue)-1]
			for _, nb := range m.neighbours[m.polyStart[q]:m.polyStart[q+1]] {
				if nb >= 0 && m.island[nb] < 0 {
					m.island[nb] = next
					queue = append(queue, nb)
				}
			}
		}
		next++
	}
}

func (m *Mesh) buildGrid() {
	n := m.PolygonCount()
	x0, z0, x1, z1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for p := 0; p < n; p++ {
		x0, z0 = math.Min(x0, m.minX[p]), math.Min(z0, m.minZ[p])
		x1, z1 = math.Max(x1, m.maxX[p]), math.Max(z1, m.maxZ[p])
	}
	m.gridX0, m.gridZ0 = x0, z0
	m.gridW = int((x1-x0)/gridCell) + 1
	m.gridH = int((z1-z0)/gridCell) + 1
	counts := make([]int32, m.gridW*m.gridH+1)
	each := func(p int, f func(c int)) {
		cx0, cz0 := m.cellOf(m.minX[p]-locateTol, m.minZ[p]-locateTol)
		cx1, cz1 := m.cellOf(m.maxX[p]+locateTol, m.maxZ[p]+locateTol)
		for cz := cz0; cz <= cz1; cz++ {
			for cx := cx0; cx <= cx1; cx++ {
				f(cz*m.gridW + cx)
			}
		}
	}
	for p := 0; p < n; p++ {
		each(p, func(c int) { counts[c+1]++ })
	}
	for c := 1; c < len(counts); c++ {
		counts[c] += counts[c-1]
	}
	m.gridStart = counts
	m.gridPolys = make([]int32, counts[len(counts)-1])
	fill := make([]int32, m.gridW*m.gridH)
	copy(fill, counts)
	for p := 0; p < n; p++ {
		each(p, func(c int) { m.gridPolys[fill[c]] = int32(p); fill[c]++ })
	}
}

// cellOf returns the grid cell holding (x, z), clamped to the grid.
func (m *Mesh) cellOf(x, z float64) (int, int) {
	cx := int(math.Floor((x - m.gridX0) / gridCell))
	cz := int(math.Floor((z - m.gridZ0) / gridCell))
	return max(0, min(m.gridW-1, cx)), max(0, min(m.gridH-1, cz))
}

// PolygonCount is the number of polygons.
func (m *Mesh) PolygonCount() int { return len(m.polyStart) - 1 }

// Polygon returns polygon p's vertices in the normalised winding. For tests and debugging; it allocates.
func (m *Mesh) Polygon(p int) []Vec3 {
	out := make([]Vec3, 0, MaxPolyVerts)
	for _, vi := range m.ring(int32(p)) {
		out = append(out, m.verts[vi])
	}
	return out
}

// Neighbours returns the polygons sharing an edge with p (-1 for a wall), one per edge. It allocates.
func (m *Mesh) Neighbours(p int) []int {
	out := make([]int, 0, MaxPolyVerts)
	for _, nb := range m.neighbours[m.polyStart[p]:m.polyStart[p+1]] {
		out = append(out, int(nb))
	}
	return out
}

// Connected reports whether polygons a and b are on the same island.
func (m *Mesh) Connected(a, b int) bool { return m.island[a] == m.island[b] }

func (m *Mesh) ring(p int32) []int32 { return m.polyVerts[m.polyStart[p]:m.polyStart[p+1]] }
