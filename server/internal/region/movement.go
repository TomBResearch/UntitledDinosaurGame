package region

import (
	"math"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// maxWaypoints is the protocol's limit on a path (Path.waypoints is list<pos, 64>). A longer path is
// cut short and walked as far as it goes.
const maxWaypoints = 64

// minPathCm: a path shorter than this (a click on the spot you're standing on, give or take the
// difference between the drawn ground and the navmesh) stops you instead.
const minPathCm = 10

// startPaths walks this tick's clicks. Only a player's last click in a tick counts.
func (r *Region) startPaths() {
	for _, id := range r.pending {
		e := r.get(id)
		if e == nil || !e.pendingMove {
			continue
		}
		e.pendingMove = false
		r.walkTo(e, e.moveTarget)
	}
	r.pending = r.pending[:0]
}

// walkTo starts a path from where e is this tick towards target, and tells everyone who can see it.
// No path, or a click within minPathCm, stops e where it is.
func (r *Region) walkTo(e *entity, target navmesh.Vec3) {
	wasMoving := e.moving
	if e.moving {
		e.pos, _ = e.positionAt(r.tick, r.cfg.TickHz) // where the old path has it now
	}
	var status navmesh.Status
	r.pathBuf, status = r.pf.FindPath(r.pathBuf[:0], e.pos, target)

	// The broadcast path is the quantised one, starting exactly where e is.
	wps := append(e.path.Waypoints[:0], quantise(e.pos))
	if status != navmesh.NoPath && len(r.pathBuf) > 1 {
		for _, p := range r.pathBuf[1:] {
			if q := quantise(p); q != wps[len(wps)-1] && len(wps) < maxWaypoints {
				wps = append(wps, q)
			}
		}
	}
	e.path.Waypoints = wps
	e.cum = append(e.cum[:0], 0)
	for i := 1; i < len(wps); i++ {
		a, b := wps[i-1], wps[i]
		dx, dy, dz := float64(b.X-a.X), float64(b.Y-a.Y), float64(b.Z-a.Z)
		e.cum = append(e.cum, e.cum[i-1]+math.Sqrt(dx*dx+dy*dy+dz*dz))
	}
	if e.cum[len(e.cum)-1] < minPathCm {
		r.stop(e, wasMoving)
		return
	}
	e.path.StartTick = r.tick
	e.path.Speed = r.speed
	e.seg = 0
	e.moving = true
	e.pos = dequantise(wps[0])
	r.mStarted = proto.PathStarted{Entity: uint32(e.id), Path: e.path}
	r.broadcast(e, &r.mStarted)
}

// stop ends e's movement where it is and sends path_stopped: to everyone who can see it if it was
// moving, otherwise (a failed click while standing) only to e itself.
func (r *Region) stop(e *entity, wasMoving bool) {
	q := quantise(e.pos)
	e.pos = dequantise(q)
	e.moving = false
	e.path.Waypoints = e.path.Waypoints[:0]
	r.mStopped = proto.PathStopped{Entity: uint32(e.id), Tick: r.tick, Position: q}
	switch {
	case wasMoving:
		r.broadcast(e, &r.mStopped)
	case e.kind == proto.EntityKindPlayer:
		e.out = mustAppend(e.out, &r.mStopped)
	}
}

// advance moves every walking entity to where its path has it this tick. One that reached the end
// stops there.
func (r *Region) advance() {
	for i := range r.ents {
		e := &r.ents[i]
		if e.id == 0 || !e.moving || e.path.StartTick == r.tick {
			continue
		}
		var arrived bool
		e.pos, arrived = e.positionAt(r.tick, r.cfg.TickHz)
		if arrived {
			r.stop(e, true)
		}
	}
}

// positionAt is where e's path puts it at tick t (not before its start tick), and whether it has
// reached the end. Every client runs the same calculation (docs/architecture/networking.md):
//
//	distance (cm) = speed (cm/s) × (t − start_tick) / tick_hz
//
// measured along the straight 3D segments between the quantised waypoints, and clamped to the last.
func (e *entity) positionAt(t uint32, tickHz int) (navmesh.Vec3, bool) {
	wps := e.path.Waypoints
	last := len(wps) - 1
	d := float64(e.path.Speed) * float64(t-e.path.StartTick) / float64(tickHz)
	if d >= e.cum[last] {
		return dequantise(wps[last]), true
	}
	for e.seg < last-1 && d >= e.cum[e.seg+1] {
		e.seg++
	}
	a, b := wps[e.seg], wps[e.seg+1]
	f := (d - e.cum[e.seg]) / (e.cum[e.seg+1] - e.cum[e.seg])
	return navmesh.Vec3{
		X: lerp(a.X, b.X, f) / 100,
		Y: lerp(a.Y, b.Y, f) / 100,
		Z: lerp(a.Z, b.Z, f) / 100,
	}, false
}

func lerp(a, b int32, f float64) float64 { return float64(a) + float64(b-a)*f }
