class_name ErrorBlend
extends RefCounted
## Smooths a jump in where the server's numbers put an entity (docs/architecture/networking.md,
## "Correction"). The entity is drawn at target + offset, and the offset eases to zero over
## BLEND_MS. A jump happens when a path is replaced (your own character is drawn ahead of the
## server, so a repath lands a little away from where it was drawn) or the clock estimate steps.
##
## The docs require errors over 0.5 m to blend over 150 ms. Smaller ones blend the same way
## rather than snapping, because at 150 ms of latency a repath of your own character moves the
## target by up to about 0.6 m and a snap would show as a pop. Only a teleport-sized jump snaps.

## How long a correction takes.
const BLEND_MS := 150.0
## Errors at or above this are the docs' "lag correction" case (blended, never snapped).
const CORRECTION_M := 0.5
## Errors below this are float rounding: ignored.
const IGNORE_M := 0.01
## Errors this large are a teleport (respawn, region change): snap instead of sliding across.
const SNAP_M := 20.0

var _start := Vector3.ZERO
var _elapsed_ms := BLEND_MS


## Starts a correction for a jump. error is drawn − target at the moment of the change, where drawn
## already includes any correction still in progress.
func start(error: Vector3) -> void:
	var size := error.length()
	if size < IGNORE_M or size >= SNAP_M:
		reset()
		return
	_start = error
	_elapsed_ms = 0.0


## Stops any correction: the entity is drawn exactly at its target.
func reset() -> void:
	_start = Vector3.ZERO
	_elapsed_ms = BLEND_MS


## Advances the correction by dt_ms.
func advance(dt_ms: float) -> void:
	_elapsed_ms = minf(_elapsed_ms + maxf(dt_ms, 0.0), BLEND_MS)


## The offset to add to the target position right now.
func offset() -> Vector3:
	if _elapsed_ms >= BLEND_MS:
		return Vector3.ZERO
	var f := 1.0 - _elapsed_ms / BLEND_MS
	# Smoothstep: no sudden change of speed at either end.
	return _start * (f * f * (3.0 - 2.0 * f))


func is_active() -> bool:
	return _elapsed_ms < BLEND_MS
