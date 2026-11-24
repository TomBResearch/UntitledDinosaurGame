class_name ClockSync
extends RefCounted
## Estimates the server's tick from ping/pong samples (docs/architecture/networking.md, "Clock
## sync"). All times are client milliseconds passed in by the caller, so tests drive it directly.
##
## Each pong gives a sample: the server's time when it replied (server_tick + tick_phase / 256
## ticks) plus half the round trip, minus the client's time on receipt. The target offset averages
## the few samples with the lowest round-trip times of the last WINDOW, since a short round trip can't
## have been delayed much either way. The offset in use slews towards the target, so the
## estimated time never jumps or runs backwards; only a large error (or the first sample) snaps.

## Samples kept.
const WINDOW := 8
## How many of the lowest-RTT samples are averaged...
const BEST := 3
## ...counting only those within this much of the lowest round trip, so one slow sample can't
## drag the average while the window is still filling.
const RTT_SLACK_MS := 20.0
## While converging, the estimate runs at most this much fast or slow (5% of real time).
const SLEW_RATE := 0.05
## A target further than this from the offset in use snaps to it instead of slewing.
const SNAP_MS := 250.0

var tick_hz: int = 20

## Samples as Vector2(rtt_ms, offset_ms), oldest first.
var _samples: Array[Vector2] = []
var _offset_ms: float = 0.0
var _target_ms: float = 0.0
var _synced: bool = false
var _snapped: bool = false
var _last_update_ms: float = 0.0


## True once there is at least one sample.
func is_synced() -> bool:
	return _synced


## Adds a pong: sent_ms is when the ping went out (the echoed client_time), received_ms when the
## pong arrived. server_tick and tick_phase are from the pong.
func add_pong(sent_ms: float, received_ms: float, server_tick: int, tick_phase: int) -> void:
	_add(received_ms - sent_ms, received_ms, float(server_tick) + float(tick_phase) / 256.0)


## Adds the welcome as a first, rougher sample: hello to welcome is a round trip, but welcome has
## no tick_phase, so it counts one tick of round trip worse than it was and real pongs win.
func add_welcome(hello_sent_ms: float, received_ms: float, server_tick: int) -> void:
	var tick_ms := 1000.0 / float(tick_hz)
	_add(received_ms - hello_sent_ms + tick_ms, received_ms, float(server_tick) + 0.5)


func _add(rtt_ms: float, received_ms: float, server_ticks: float) -> void:
	rtt_ms = maxf(rtt_ms, 0.0)
	var server_ms := server_ticks * 1000.0 / float(tick_hz) + rtt_ms / 2.0
	_samples.append(Vector2(rtt_ms, server_ms - received_ms))
	if _samples.size() > WINDOW:
		_samples.pop_front()
	_target_ms = _best_offset()
	if not _synced or absf(_target_ms - _offset_ms) > SNAP_MS:
		_offset_ms = _target_ms
		_snapped = _synced
		_synced = true
		_last_update_ms = received_ms


## The mean offset of the (up to) BEST samples with the lowest round trip.
func _best_offset() -> float:
	var sorted: Array[Vector2] = _samples.duplicate()
	sorted.sort_custom(func(a: Vector2, b: Vector2) -> bool: return a.x < b.x)
	var sum := 0.0
	var n := 0
	for s in sorted:
		if n == BEST or s.x > sorted[0].x + RTT_SLACK_MS:
			break
		sum += s.y
		n += 1
	return sum / float(n)


## Moves the offset in use towards the target, by at most SLEW_RATE of the time since the last
## update. Returns true if the estimate stepped (snapped) since the last call, so the caller can
## blend entities across the jump.
func update(now_ms: float) -> bool:
	var dt := maxf(now_ms - _last_update_ms, 0.0)
	_last_update_ms = now_ms
	var step := SLEW_RATE * dt
	_offset_ms += clampf(_target_ms - _offset_ms, -step, step)
	var snapped := _snapped
	_snapped = false
	return snapped


## The estimated server time at client time now_ms, in (fractional) ticks.
func server_tick_at(now_ms: float) -> float:
	return (now_ms + _offset_ms) * float(tick_hz) / 1000.0


## The offset in use, in ms (server time − client time).
func offset_ms() -> float:
	return _offset_ms


## The offset the samples point to, in ms.
func target_offset_ms() -> float:
	return _target_ms


## The lowest round trip seen in the window, in ms (for the debug overlay).
func best_rtt_ms() -> float:
	var best := INF
	for s in _samples:
		best = minf(best, s.x)
	return best
