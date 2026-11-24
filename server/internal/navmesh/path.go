package navmesh

import "math"

// Limits bound path finding. DefaultLimits are the values in docs/architecture/world-server.md.
type Limits struct {
	// SnapRadius (metres): a click further than this from the mesh finds no path.
	SnapRadius float64
	// MaxPathLength (metres): longer paths are cut here, so a far click walks as far as this allows.
	MaxPathLength float64
	// MaxExplored caps how many polygons one search may expand. If it runs out, the path goes to the
	// explored point nearest the target.
	MaxExplored int
}

// DefaultLimits are the spec values: snap within 5 m, paths up to 150 m or 2,000 polygons explored.
var DefaultLimits = Limits{SnapRadius: 5, MaxPathLength: 150, MaxExplored: 2000}

const (
	// heightTol (metres): waypoints are added where the path crosses a polygon edge and straight-line
	// height interpolation between the waypoints around it would be off by more than this.
	heightTol = 0.05
	// sameTol (metres): consecutive waypoints closer than this are merged.
	sameTol = 0.001
)

// Status says how a path turned out.
type Status uint8

const (
	// NoPath: the start or target is off the mesh (beyond SnapRadius), or they're on separate islands.
	NoPath Status = iota
	// Complete: the path reaches the (snapped) target.
	Complete
	// Partial: the target is beyond the limits. The path goes as far as they allow, towards it.
	Partial
)

func (s Status) String() string {
	return [...]string{"NoPath", "Complete", "Partial"}[s]
}

type portal struct{ left, right Vec3 }

type corner struct {
	pos    Vec3
	portal int // index into portals
}

// Pathfinder finds paths on one mesh. It holds scratch memory reused between searches, so FindPath doesn't
// allocate once warmed up. It isn't safe for concurrent use: give each region goroutine its own.
type Pathfinder struct {
	mesh   *Mesh
	limits Limits

	gen     uint32
	stamp   []uint32 // a node's fields below are valid only when stamp == gen
	closed  []bool
	g, f    []float64
	parent  []int32
	pos     []Vec3 // where the path enters the polygon: an edge midpoint, or the start point
	heapIdx []int32
	heap    []int32

	corridor []int32
	portals  []portal
	corners  []corner
	crossing []Vec3
	keep     []bool

	// Explored is how many polygons the last FindPath expanded. For tests and benchmarks.
	Explored int
}

// NewPathfinder makes a Pathfinder for m with the given limits.
func NewPathfinder(m *Mesh, limits Limits) *Pathfinder {
	n := m.PolygonCount()
	return &Pathfinder{
		mesh: m, limits: limits,
		stamp: make([]uint32, n), closed: make([]bool, n),
		g: make([]float64, n), f: make([]float64, n),
		parent: make([]int32, n), pos: make([]Vec3, n), heapIdx: make([]int32, n),
	}
}

// FindPath appends the waypoints of a path from `from` to `to` onto dst and returns it. `to` is snapped
// onto the mesh within SnapRadius, and so is `from` (normally already on it). The first waypoint is the
// start; each has its height (y) on the mesh. A straight line between two waypoints stays on the mesh,
// and its interpolated height is within a few centimetres of the surface.
//
// A click on the spot you're standing on gives a single waypoint. On NoPath, dst comes back unchanged.
func (pf *Pathfinder) FindPath(dst []Vec3, from, to Vec3) ([]Vec3, Status) {
	m := pf.mesh
	pf.Explored = 0
	start, ok := m.ClosestPoint(from, pf.limits.SnapRadius)
	if !ok {
		return dst, NoPath
	}
	end, ok := m.ClosestPoint(to, pf.limits.SnapRadius)
	if !ok || m.island[start.Poly] != m.island[end.Poly] {
		return dst, NoPath
	}
	// Most clicks are in plain sight: if the straight line is clear, walk it and skip A*. This also
	// avoids the small zigzags A* can pick through many small polygons.
	hit, trail, linked := m.castRay(start, end.Pos, pf.corridor[:0], true)
	pf.corridor = trail
	complete, endPos := true, end.Pos
	direct := !hit.Blocked && linked && m.insideXZ(hit.Poly, end.Pos) &&
		math.Abs(m.heightIn(hit.Poly, end.Pos.X, end.Pos.Z)-end.Pos.Y) < rayStepHeight
	if !direct {
		var goal int32
		goal, complete = pf.search(start, end)
		if !complete {
			endPos = m.closestOnPoly(goal, end.Pos)
		}
		pf.corridorTo(goal)
	}
	pf.buildPortals(start.Pos, endPos)
	pf.funnel()
	base := len(dst)
	dst = pf.appendWithHeights(dst)
	dst, cut := truncate(dst, base, pf.limits.MaxPathLength)
	if complete && !cut {
		return dst, Complete
	}
	return dst, Partial
}

// search runs A* from start's polygon to end's. If it can't get there within the limits it returns the
// explored polygon nearest the target instead, with complete false.
func (pf *Pathfinder) search(start, end Location) (goal int32, complete bool) {
	m := pf.mesh
	pf.gen++
	if pf.gen == 0 { // wrapped: old stamps could look current
		clear(pf.stamp)
		pf.gen = 1
	}
	pf.heap = pf.heap[:0]

	pf.open(start.Poly, -1, start.Pos, 0, start.Pos.Dist(end.Pos))
	best, bestD := start.Poly, math.Inf(1)
	for len(pf.heap) > 0 {
		cur := pf.pop()
		if cur == end.Poly {
			return cur, true
		}
		pf.closed[cur] = true
		pf.Explored++
		// Track the polygon that gets nearest the target, in case it can't be reached.
		dx := math.Max(0, math.Max(m.minX[cur]-end.Pos.X, end.Pos.X-m.maxX[cur]))
		dz := math.Max(0, math.Max(m.minZ[cur]-end.Pos.Z, end.Pos.Z-m.maxZ[cur]))
		if dx*dx+dz*dz < bestD {
			if d := m.closestOnPoly(cur, end.Pos).DistSq(end.Pos); d < bestD {
				best, bestD = cur, d
			}
		}
		if pf.Explored >= pf.limits.MaxExplored {
			break
		}
		r := m.ring(cur)
		s := m.polyStart[cur]
		for k := range r {
			nb := m.neighbours[s+int32(k)]
			if nb < 0 || (pf.stamp[nb] == pf.gen && pf.closed[nb]) {
				continue
			}
			mid := m.verts[r[k]].Lerp(m.verts[r[(k+1)%len(r)]], 0.5)
			g := pf.g[cur] + pf.pos[cur].Dist(mid)
			h := mid.Dist(end.Pos)
			if nb == end.Poly {
				g, h = g+h, 0
			}
			if pf.stamp[nb] != pf.gen {
				pf.open(nb, cur, mid, g, h)
			} else if g < pf.g[nb] {
				pf.g[nb], pf.f[nb], pf.parent[nb], pf.pos[nb] = g, g+h, cur, mid
				pf.up(int(pf.heapIdx[nb]))
			}
		}
	}
	return best, false
}

func (pf *Pathfinder) open(p, parent int32, pos Vec3, g, h float64) {
	pf.stamp[p], pf.closed[p] = pf.gen, false
	pf.g[p], pf.f[p], pf.parent[p], pf.pos[p] = g, g+h, parent, pos
	pf.heap = append(pf.heap, p)
	pf.heapIdx[p] = int32(len(pf.heap) - 1)
	pf.up(len(pf.heap) - 1)
}

func (pf *Pathfinder) pop() int32 {
	h := pf.heap
	top := h[0]
	last := len(h) - 1
	h[0] = h[last]
	pf.heapIdx[h[0]] = 0
	pf.heap = h[:last]
	if last > 0 {
		pf.down(0)
	}
	return top
}

// less orders the open list by f, then by polygon index so results never depend on heap history.
func (pf *Pathfinder) less(a, b int32) bool {
	if pf.f[a] != pf.f[b] {
		return pf.f[a] < pf.f[b]
	}
	return a < b
}

func (pf *Pathfinder) up(i int) {
	h := pf.heap
	for i > 0 {
		parent := (i - 1) / 2
		if !pf.less(h[i], h[parent]) {
			break
		}
		h[i], h[parent] = h[parent], h[i]
		pf.heapIdx[h[i]], pf.heapIdx[h[parent]] = int32(i), int32(parent)
		i = parent
	}
}

func (pf *Pathfinder) down(i int) {
	h := pf.heap
	for {
		small := i
		if l := 2*i + 1; l < len(h) && pf.less(h[l], h[small]) {
			small = l
		}
		if r := 2*i + 2; r < len(h) && pf.less(h[r], h[small]) {
			small = r
		}
		if small == i {
			return
		}
		h[i], h[small] = h[small], h[i]
		pf.heapIdx[h[i]], pf.heapIdx[h[small]] = int32(i), int32(small)
		i = small
	}
}

// corridorTo sets pf.corridor to the polygons A* went through from the start to goal.
func (pf *Pathfinder) corridorTo(goal int32) {
	pf.corridor = pf.corridor[:0]
	for p := goal; p >= 0; p = pf.parent[p] {
		pf.corridor = append(pf.corridor, p)
	}
	c := pf.corridor
	for i, j := 0, len(c)-1; i < j; i, j = i+1, j-1 {
		c[i], c[j] = c[j], c[i]
	}
}

// buildPortals lists the edges between the corridor's polygons, as seen walking forwards, with the start
// and end points as zero-width portals at either end.
func (pf *Pathfinder) buildPortals(start, end Vec3) {
	m := pf.mesh
	c := pf.corridor
	pf.portals = append(pf.portals[:0], portal{start, start})
	for i := 0; i+1 < len(c); i++ {
		r, s := m.ring(c[i]), m.polyStart[c[i]]
		for k := range r {
			if m.neighbours[s+int32(k)] == c[i+1] {
				// Interior is on the left of each edge, so leaving through a→b, b is on our left.
				a, b := m.verts[r[k]], m.verts[r[(k+1)%len(r)]]
				pf.portals = append(pf.portals, portal{left: b, right: a})
				break
			}
		}
	}
	pf.portals = append(pf.portals, portal{end, end})
}

func sameXZ(a, b Vec3) bool {
	dx, dz := a.X-b.X, a.Z-b.Z
	return dx*dx+dz*dz < 1e-12
}

// funnel pulls the path through the portals taut (the "simple stupid funnel algorithm"), in XZ.
// It fills pf.corners with the turning points, each with the portal it lies on.
func (pf *Pathfinder) funnel() {
	ps := pf.portals
	last := len(ps) - 1
	apex, left, right := ps[0].left, ps[0].left, ps[0].right
	leftI, rightI := 0, 0
	pf.corners = append(pf.corners[:0], corner{apex, 0})
	restart := func(p Vec3, i int) int {
		apex = p
		left, right, leftI, rightI = p, p, i, i
		if !sameXZ(p, pf.corners[len(pf.corners)-1].pos) {
			pf.corners = append(pf.corners, corner{p, i})
		}
		return i
	}
	for i := 1; i <= last; i++ {
		l, r := ps[i].left, ps[i].right
		// Tighten the right side if the new right point doesn't widen the funnel.
		if cross2(apex, right, r) >= 0 {
			if sameXZ(apex, right) || cross2(apex, left, r) < 0 {
				right, rightI = r, i
			} else { // it crossed the left side: the left point is a corner
				i = restart(left, leftI)
				continue
			}
		}
		if cross2(apex, left, l) <= 0 {
			if sameXZ(apex, left) || cross2(apex, right, l) > 0 {
				left, leftI = l, i
			} else {
				i = restart(right, rightI)
				continue
			}
		}
	}
	end := ps[last].left
	if !sameXZ(end, pf.corners[len(pf.corners)-1].pos) {
		pf.corners = append(pf.corners, corner{end, last})
	} else {
		pf.corners[len(pf.corners)-1] = corner{end, last}
	}
}

// appendWithHeights appends the corners to dst, plus any edge crossings needed to follow the surface's
// height (heightTol).
func (pf *Pathfinder) appendWithHeights(dst []Vec3) []Vec3 {
	cs := pf.corners
	dst = appendPoint(dst, cs[0].pos)
	for k := 0; k+1 < len(cs); k++ {
		a, b := cs[k], cs[k+1]
		pf.crossing = append(pf.crossing[:0], a.pos)
		dx, dz := b.pos.X-a.pos.X, b.pos.Z-a.pos.Z
		for j := a.portal + 1; j < b.portal; j++ {
			L, R := pf.portals[j].left, pf.portals[j].right
			ex, ez := R.X-L.X, R.Z-L.Z
			den := ex*dz - ez*dx
			if math.Abs(den) < 1e-12 {
				continue
			}
			s := ((a.pos.X-L.X)*dz - (a.pos.Z-L.Z)*dx) / den
			pf.crossing = append(pf.crossing, L.Lerp(R, math.Max(0, math.Min(1, s))))
		}
		pf.crossing = append(pf.crossing, b.pos)
		pf.keep = pf.keep[:0]
		for range pf.crossing {
			pf.keep = append(pf.keep, false)
		}
		pf.simplify(0, len(pf.crossing)-1)
		for i := 1; i < len(pf.crossing); i++ {
			if pf.keep[i] || i == len(pf.crossing)-1 {
				dst = appendPoint(dst, pf.crossing[i])
			}
		}
	}
	return dst
}

// simplify marks which crossings between i and j must stay so that heights interpolated along the
// straight line are within heightTol (Douglas–Peucker on height against XZ distance).
func (pf *Pathfinder) simplify(i, j int) {
	if j-i < 2 {
		return
	}
	a, b := pf.crossing[i], pf.crossing[j]
	total := a.DistXZ(b)
	worst, worstK := heightTol, -1
	for k := i + 1; k < j; k++ {
		c := pf.crossing[k]
		t := 0.0
		if total > 0 {
			t = a.DistXZ(c) / total
		}
		if d := math.Abs(c.Y - (a.Y + (b.Y-a.Y)*t)); d > worst {
			worst, worstK = d, k
		}
	}
	if worstK < 0 {
		return
	}
	pf.keep[worstK] = true
	pf.simplify(i, worstK)
	pf.simplify(worstK, j)
}

func appendPoint(dst []Vec3, p Vec3) []Vec3 {
	if n := len(dst); n > 0 && dst[n-1].DistSq(p) < sameTol*sameTol {
		return dst
	}
	return append(dst, p)
}

// truncate cuts the path in dst[base:] to at most maxLen metres (3D), reporting whether it cut anything.
func truncate(dst []Vec3, base int, maxLen float64) ([]Vec3, bool) {
	total := 0.0
	for i := base + 1; i < len(dst); i++ {
		seg := dst[i-1].Dist(dst[i])
		if total+seg > maxLen {
			dst[i] = dst[i-1].Lerp(dst[i], (maxLen-total)/seg)
			return dst[:i+1], true
		}
		total += seg
	}
	return dst, false
}
