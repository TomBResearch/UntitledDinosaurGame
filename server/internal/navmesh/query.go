package navmesh

import "math"

const (
	// insideTol: how far (in cross-product units, m²) a point may sit outside an edge and still count as
	// inside.
	insideTol = 1e-9
	// locateTol (metres): bounding boxes are this much bigger for lookups, so a point that float error put
	// a hair outside its polygon (at a vertex, say) is still found.
	locateTol = 1e-6
)

// Location is a point on the mesh and the polygon it lies in.
type Location struct {
	Pos  Vec3
	Poly int32
}

// ClosestPoint returns the point on the mesh nearest to p (3D distance), if one is within maxDist metres.
// Used to snap a click onto the mesh (SnapRadius) and to find which polygon an entity stands in.
func (m *Mesh) ClosestPoint(p Vec3, maxDist float64) (Location, bool) {
	best, bestD := Location{Poly: -1}, maxDist*maxDist
	// The point itself is usually inside a polygon of its own cell: try that first so the wider search
	// below can reject most candidates on their bounding boxes.
	if poly, y, ok := m.locateXZ(p); ok && (y-p.Y)*(y-p.Y) <= bestD {
		best, bestD = Location{Vec3{p.X, y, p.Z}, poly}, (y-p.Y)*(y-p.Y)
	}
	cx0, cz0 := m.cellOf(p.X-maxDist, p.Z-maxDist)
	cx1, cz1 := m.cellOf(p.X+maxDist, p.Z+maxDist)
	for cz := cz0; cz <= cz1; cz++ {
		for cx := cx0; cx <= cx1; cx++ {
			c := cz*m.gridW + cx
			for _, poly := range m.gridPolys[m.gridStart[c]:m.gridStart[c+1]] {
				dx := math.Max(0, math.Max(m.minX[poly]-p.X, p.X-m.maxX[poly]))
				dz := math.Max(0, math.Max(m.minZ[poly]-p.Z, p.Z-m.maxZ[poly]))
				if dx*dx+dz*dz > bestD {
					continue
				}
				q := m.closestOnPoly(poly, p)
				if d := q.DistSq(p); d < bestD || (d == bestD && poly < best.Poly) {
					best, bestD = Location{q, poly}, d
				}
			}
		}
	}
	return best, best.Poly >= 0
}

// HeightAt returns the height of the mesh at (p.X, p.Z). Where polygons overlap (a bridge over a path),
// it picks the one whose surface is nearest p.Y. ok is false if no polygon covers that spot.
func (m *Mesh) HeightAt(p Vec3) (y float64, ok bool) {
	_, y, ok = m.locateXZ(p)
	return y, ok
}

// locateXZ finds the polygon covering (p.X, p.Z) whose surface is nearest p.Y.
func (m *Mesh) locateXZ(p Vec3) (poly int32, y float64, ok bool) {
	cx, cz := m.cellOf(p.X, p.Z)
	c := cz*m.gridW + cx
	poly, bestDY := -1, math.Inf(1)
	for _, cand := range m.gridPolys[m.gridStart[c]:m.gridStart[c+1]] {
		if p.X < m.minX[cand]-locateTol || p.X > m.maxX[cand]+locateTol ||
			p.Z < m.minZ[cand]-locateTol || p.Z > m.maxZ[cand]+locateTol || !m.insideXZ(cand, p) {
			continue
		}
		h := m.heightIn(cand, p.X, p.Z)
		if dy := math.Abs(h - p.Y); dy < bestDY {
			poly, y, bestDY = cand, h, dy
		}
	}
	return poly, y, poly >= 0
}

func (m *Mesh) insideXZ(poly int32, p Vec3) bool {
	r := m.ring(poly)
	for i := range r {
		if cross2(m.verts[r[i]], m.verts[r[(i+1)%len(r)]], p) < -insideTol {
			return false
		}
	}
	return true
}

// closestOnPoly is the point of polygon poly nearest p: straight below or above p if p is over the polygon,
// otherwise the nearest point on its boundary.
func (m *Mesh) closestOnPoly(poly int32, p Vec3) Vec3 {
	if m.insideXZ(poly, p) {
		return Vec3{p.X, m.heightIn(poly, p.X, p.Z), p.Z}
	}
	r := m.ring(poly)
	var best Vec3
	bestD := math.Inf(1)
	for i := range r {
		a, b := m.verts[r[i]], m.verts[r[(i+1)%len(r)]]
		q := a.Lerp(b, closestOnSegmentXZ(p, a, b))
		if d := q.DistSq(p); d < bestD {
			best, bestD = q, d
		}
	}
	return best
}

// heightIn interpolates the height of polygon poly at (x, z) over a fan of triangles from its first vertex.
// Points slightly outside the polygon get the height of the nearest fan triangle's plane.
func (m *Mesh) heightIn(poly int32, x, z float64) float64 {
	r := m.ring(poly)
	a := m.verts[r[0]]
	bestY, bestMin := a.Y, math.Inf(-1)
	for k := 1; k+1 < len(r); k++ {
		b, c := m.verts[r[k]], m.verts[r[k+1]]
		bx, bz, cx, cz := b.X-a.X, b.Z-a.Z, c.X-a.X, c.Z-a.Z
		det := bx*cz - cx*bz
		if det <= 0 {
			continue // collinear fan triangle
		}
		px, pz := x-a.X, z-a.Z
		u := (px*cz - cx*pz) / det
		w := (bx*pz - px*bz) / det
		s := 1 - u - w
		y := a.Y*s + b.Y*u + c.Y*w
		lowest := math.Min(s, math.Min(u, w))
		if lowest >= 0 {
			return y
		}
		if lowest > bestMin {
			bestY, bestMin = y, lowest
		}
	}
	return bestY
}
