package navmesh

import "math"

// Vec3 is a position in metres on Godot's axes: +Y is up, the walkable plane is XZ.
type Vec3 struct{ X, Y, Z float64 }

func (a Vec3) Add(b Vec3) Vec3             { return Vec3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func (a Vec3) Sub(b Vec3) Vec3             { return Vec3{a.X - b.X, a.Y - b.Y, a.Z - b.Z} }
func (a Vec3) Scale(s float64) Vec3        { return Vec3{a.X * s, a.Y * s, a.Z * s} }
func (a Vec3) Lerp(b Vec3, t float64) Vec3 { return a.Add(b.Sub(a).Scale(t)) }

// Dist is the 3D distance between a and b.
func (a Vec3) Dist(b Vec3) float64 { return math.Sqrt(a.DistSq(b)) }

// DistSq is the squared 3D distance between a and b.
func (a Vec3) DistSq(b Vec3) float64 {
	dx, dy, dz := a.X-b.X, a.Y-b.Y, a.Z-b.Z
	return dx*dx + dy*dy + dz*dz
}

// DistXZ is the horizontal distance between a and b, ignoring height.
func (a Vec3) DistXZ(b Vec3) float64 { return math.Hypot(a.X-b.X, a.Z-b.Z) }

// cross2 is twice the signed area of triangle abc in the XZ plane. Positive means c is to the left of a→b,
// using the polygon winding the loader normalises to (see Build).
func cross2(a, b, c Vec3) float64 {
	return (b.X-a.X)*(c.Z-a.Z) - (b.Z-a.Z)*(c.X-a.X)
}

// closestOnSegmentXZ returns the parameter t in [0, 1] of the point on segment a→b nearest to p, in XZ.
func closestOnSegmentXZ(p, a, b Vec3) float64 {
	dx, dz := b.X-a.X, b.Z-a.Z
	l := dx*dx + dz*dz
	if l == 0 {
		return 0
	}
	t := ((p.X-a.X)*dx + (p.Z-a.Z)*dz) / l
	return math.Max(0, math.Min(1, t))
}
