class_name PathPlayback
extends RefCounted
## Where a path puts an entity at a given server tick. This is the same calculation the world
## server runs (server/internal/region/movement.go, positionAt), so every client and the server
## agree to float rounding (docs/architecture/networking.md, "Movement playback"):
##
##     distance_cm = speed × (t − start_tick) / tick_hz
##
## measured along the straight 3D segments between the whole-centimetre waypoints, and clamped
## to the last waypoint. t is fractional on the client. Before start_tick the entity is at the
## first waypoint.

var start_tick: int = 0
## Centimetres per second, as sent. 0 for a stationary entity.
var speed: int = 0
var tick_hz: int = 1
## Whole centimetres, region coordinates (the same axes as Godot's, in metres × 100).
var waypoints: Array[Vector3i] = []
## _cum[i] = distance in cm from waypoints[0] to waypoints[i] along the path.
var _cum: PackedFloat64Array = PackedFloat64Array()


## A path from the wire. tick_hz comes from welcome.
static func from_proto(path: Proto.Path, hz: int) -> PathPlayback:
	return create(path.start_tick, path.speed, path.waypoints, hz)


## An entity standing still at position (cm) from tick on, e.g. after path_stopped.
static func stationary(position: Vector3i, tick: int, hz: int) -> PathPlayback:
	var wps: Array[Vector3i] = [position]
	return create(tick, 0, wps, hz)


static func create(start: int, speed_cm_s: int, wps: Array[Vector3i], hz: int) -> PathPlayback:
	assert(not wps.is_empty(), "a path needs at least one waypoint")
	assert(hz > 0, "tick_hz must be positive")
	var p := PathPlayback.new()
	p.start_tick = start
	p.speed = speed_cm_s
	p.tick_hz = hz
	p.waypoints = wps.duplicate()
	p._cum.resize(wps.size())
	p._cum[0] = 0.0
	for i in range(1, wps.size()):
		# Vector3 is 32-bit floats; do the sum in float64 like the server does.
		var dx: float = float(wps[i].x - wps[i - 1].x)
		var dy: float = float(wps[i].y - wps[i - 1].y)
		var dz: float = float(wps[i].z - wps[i - 1].z)
		p._cum[i] = p._cum[i - 1] + sqrt(dx * dx + dy * dy + dz * dz)
	return p


## Total length in cm along the 3D segments.
func length_cm() -> float:
	return _cum[_cum.size() - 1]


## Distance in cm walked by tick t (0 before start_tick, not clamped to the length).
func distance_at(t: float) -> float:
	if t <= start_tick:
		return 0.0
	return float(speed) * (t - float(start_tick)) / float(tick_hz)


## The fractional tick at which the entity reaches the last waypoint.
func end_tick() -> float:
	if speed <= 0 or length_cm() <= 0.0:
		return float(start_tick)
	return float(start_tick) + length_cm() * float(tick_hz) / float(speed)


## True once t is at or past the end of the path.
func is_finished(t: float) -> bool:
	return distance_at(t) >= length_cm()


## Position in centimetres (fractional) at tick t.
func position_cm_at(t: float) -> Vector3:
	var last := waypoints.size() - 1
	var d := distance_at(t)
	if d >= _cum[last]:
		return _cm(waypoints[last])
	var seg := _segment_for(d)
	var a := waypoints[seg]
	var b := waypoints[seg + 1]
	var f: float = (d - _cum[seg]) / (_cum[seg + 1] - _cum[seg])
	return Vector3(_lerp(a.x, b.x, f), _lerp(a.y, b.y, f), _lerp(a.z, b.z, f))


## Position in metres (Godot units) at tick t.
func position_at(t: float) -> Vector3:
	return position_cm_at(t) / 100.0


## The horizontal direction of travel at tick t (normalised), or zero when standing still or
## past the end.
func heading_at(t: float) -> Vector3:
	if speed <= 0 or waypoints.size() < 2 or is_finished(t):
		return Vector3.ZERO
	var seg := _segment_for(distance_at(t))
	var dir := Vector3(waypoints[seg + 1] - waypoints[seg])
	dir.y = 0.0
	return dir.normalized() if dir.length_squared() > 0.0 else Vector3.ZERO


## The index of the segment holding distance d (d < length), skipping zero-length segments.
func _segment_for(d: float) -> int:
	var lo := 0
	var hi := _cum.size() - 2
	# The last segment whose start is at or before d.
	while lo < hi:
		var mid := (lo + hi + 1) >> 1
		if _cum[mid] <= d:
			lo = mid
		else:
			hi = mid - 1
	return lo


static func _cm(v: Vector3i) -> Vector3:
	return Vector3(float(v.x), float(v.y), float(v.z))


static func _lerp(a: int, b: int, f: float) -> float:
	return float(a) + float(b - a) * f
