package navmesh

import "math"

const (
	// rayStartSnap (metres): Raycast's `from` must be this close to the mesh.
	rayStartSnap = 0.5
	// rayProbe (metres): the start polygon is the one a point this far along the ray lies in, so a ray
	// leaving a corner shared by several polygons starts in the one it heads into.
	rayProbe = 0.01
	// rayStepHeight (metres): the most the surface may jump where a ray steps between polygons through a
	// vertex. Stops a ray hopping onto a bridge overhead.
	rayStepHeight = 0.5
)

// RayHit is the result of a Raycast.
type RayHit struct {
	// Blocked is true if the edge of the mesh (a wall) stopped the ray before it reached `to`.
	Blocked bool
	// T is the fraction of from→to (in XZ) travelled before stopping: 1 if not blocked.
	T float64
	// Pos is where the ray stopped, with the mesh's height there.
	Pos Vec3
	// Poly is the polygon Pos is in.
	Poly int32
}

// Raycast walks the straight line from→to across the mesh in XZ, polygon to polygon, and reports where the
// mesh's edge stops it. Used for line of sight (not Blocked means visible) and to clamp dashes (Pos).
// ok is false if `from` isn't within half a metre of the mesh.
func (m *Mesh) Raycast(from, to Vec3) (hit RayHit, ok bool) {
	start, ok := m.ClosestPoint(from, rayStartSnap)
	if !ok {
		return RayHit{}, false
	}
	hit, _, _ = m.castRay(start, to, nil, false)
	return hit, true
}

// castRay walks from start towards to. If record is set, it appends each polygon it passes through to
// trail. linked is false if it had to step between two polygons that only share a vertex.
func (m *Mesh) castRay(start Location, to Vec3, trail []int32, record bool) (hit RayHit, _ []int32, linked bool) {
	o, poly := start.Pos, start.Poly
	dx, dz := to.X-o.X, to.Z-o.Z
	length := math.Hypot(dx, dz)
	if length < 1e-9 {
		if record {
			trail = append(trail, poly)
		}
		return RayHit{T: 1, Pos: o, Poly: poly}, trail, true
	}
	step := math.Min(rayProbe, length/2) / length
	if p, ok := m.ahead(o, to, step, 0, o.Y, poly); ok {
		poly = p
	}
	if record {
		trail = append(trail, poly)
	}
	linked = true

	t := 0.0
	for range 2*m.PolygonCount() + 8 {
		r, s := m.ring(poly), m.polyStart[poly]
		exitT, exitK := math.Inf(1), int32(-1)
		for k := range r {
			a, b := m.verts[r[k]], m.verts[r[(k+1)%len(r)]]
			ex, ez := b.X-a.X, b.Z-a.Z
			dn := ex*dz - ez*dx
			if dn >= 0 {
				continue // parallel to this edge, or heading inwards across it
			}
			tk := -cross2(a, b, o) / dn
			slot := s + int32(k)
			// Where the ray leaves through a vertex, prefer an edge that leads somewhere over a wall.
			better := tk < exitT-1e-9 ||
				(exitK >= 0 && tk <= exitT+1e-9 && m.neighbours[slot] >= 0 && m.neighbours[exitK] < 0)
			if better {
				exitT, exitK = tk, slot
			}
		}
		if exitK < 0 || exitT >= 1 {
			return RayHit{T: 1, Pos: Vec3{to.X, m.heightIn(poly, to.X, to.Z), to.Z}, Poly: poly}, trail, linked
		}
		t = math.Max(t, exitT)
		x, z := o.X+dx*t, o.Z+dz*t
		next := m.neighbours[exitK]
		if next < 0 {
			y := m.heightIn(poly, x, z)
			// A ray running along a straight wall leaves each polygon through the vertex where the next one
			// starts, which may not share an edge with this one. Carry on in the polygon just ahead.
			if p, ok := m.ahead(o, to, step, t, y, poly); ok {
				poly, linked = p, false
				if record {
					trail = append(trail, poly)
				}
				continue
			}
			return RayHit{Blocked: true, T: t, Pos: Vec3{x, y, z}, Poly: poly}, trail, linked
		}
		poly = next
		if record {
			trail = append(trail, poly)
		}
	}
	// Only reachable if float trouble made the walk cycle. Treat it as blocked where it got to.
	x, z := o.X+dx*t, o.Z+dz*t
	return RayHit{Blocked: true, T: t, Pos: Vec3{x, m.heightIn(poly, x, z), z}, Poly: poly}, trail, linked
}

// ahead returns the polygon other than poly just past t+step along o→to, if it carries on the surface at
// height y.
func (m *Mesh) ahead(o, to Vec3, step, t, y float64, poly int32) (int32, bool) {
	pt := math.Min(1, t+step)
	p, py, found := m.locateXZ(Vec3{o.X + (to.X-o.X)*pt, y, o.Z + (to.Z-o.Z)*pt})
	return p, found && p != poly && m.island[p] == m.island[poly] && math.Abs(py-y) < rayStepHeight
}
