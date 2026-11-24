class_name ClickMarker
extends Node3D
## The ring shown where you clicked to walk. Cosmetic: it shows the click straight away and is
## cleared when the server says you've stopped (your own path_stopped).

## The ring pulses while it's up.
const PULSE_HZ := 1.6
const PULSE_SCALE := 0.15
## Lifted a little so it doesn't z-fight with the ground.
const LIFT_M := 0.05

var _time: float = 0.0


func _ready() -> void:
	visible = false


func show_at(point: Vector3) -> void:
	global_position = point + Vector3.UP * LIFT_M
	_time = 0.0
	visible = true


func clear() -> void:
	visible = false


func _process(delta: float) -> void:
	if not visible:
		return
	_time += delta
	var s := 1.0 + sin(_time * TAU * PULSE_HZ) * PULSE_SCALE
	scale = Vector3(s, 1.0, s)
