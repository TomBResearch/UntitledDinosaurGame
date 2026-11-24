class_name OrbitCamera
extends Node3D
## Third-person camera that orbits and follows a target (your character). Middle-drag orbits, the
## arrow keys orbit smoothly, and the wheel zooms. Pitch and distance are clamped, and the camera is
## pulled in front of any terrain between it and the target so it never ends up underground.
## Right click is left free for the context menu.
## All of this is presentation only; the numbers are camera feel, not game rules.

const MIN_PITCH_DEG := 12.0
const MAX_PITCH_DEG := 80.0
const MIN_DISTANCE_M := 4.0
const MAX_DISTANCE_M := 30.0
const ZOOM_STEP := 1.12
## Radians of orbit per pixel dragged.
const ORBIT_SENSITIVITY := 0.006
## Arrow-key orbit at full speed, in degrees per second.
const KEY_YAW_SPEED_DEG := 120.0
const KEY_PITCH_SPEED_DEG := 70.0
## How quickly arrow-key orbiting eases in and out (per second). Higher is snappier.
const KEY_EASE_RATE := 10.0
## Look at this point above the target's feet.
const FOCUS_HEIGHT_M := 1.4
## How quickly the focus catches up with the target (per second); high enough to feel attached.
const FOLLOW_RATE := 14.0
## Distance kept between the camera and terrain it would otherwise be behind.
const WALL_MARGIN_M := 0.3

var target: Node3D = null
var yaw: float = deg_to_rad(35.0)
var pitch: float = deg_to_rad(42.0)
var distance: float = 13.0

var _focus: Vector3 = Vector3.ZERO
var _dragging: bool = false
## Current arrow-key orbit speed (x: yaw, y: pitch) as a fraction of full speed, -1 to 1.
var _key_velocity: Vector2 = Vector2.ZERO

@onready var camera: Camera3D = $Camera3D


func _ready() -> void:
	_place()


## Follows a new target, jumping straight to it.
func follow(node: Node3D) -> void:
	target = node
	if target != null:
		_focus = target.global_position + Vector3.UP * FOCUS_HEIGHT_M
	_place()


func _unhandled_input(event: InputEvent) -> void:
	var button := event as InputEventMouseButton
	if button != null:
		match button.button_index:
			MOUSE_BUTTON_MIDDLE:
				_dragging = button.pressed
				get_viewport().set_input_as_handled()
			MOUSE_BUTTON_WHEEL_UP:
				if button.pressed:
					zoom(1.0 / ZOOM_STEP)
					get_viewport().set_input_as_handled()
			MOUSE_BUTTON_WHEEL_DOWN:
				if button.pressed:
					zoom(ZOOM_STEP)
					get_viewport().set_input_as_handled()
		return
	var motion := event as InputEventMouseMotion
	if motion != null and _dragging:
		orbit(motion.relative)
		get_viewport().set_input_as_handled()


## Orbits by a mouse movement in pixels.
func orbit(relative: Vector2) -> void:
	yaw -= relative.x * ORBIT_SENSITIVITY
	pitch = clampf(pitch + relative.y * ORBIT_SENSITIVITY, deg_to_rad(MIN_PITCH_DEG), deg_to_rad(MAX_PITCH_DEG))


## Multiplies the distance by factor, within the clamps.
func zoom(factor: float) -> void:
	distance = clampf(distance * factor, MIN_DISTANCE_M, MAX_DISTANCE_M)


## Orbits from held arrow keys over delta seconds. input.x is -1 (left) to 1 (right), input.y is
## -1 (up) to 1 (down). Left and right turn the same way as dragging the mouse left and right; up
## raises the camera to look down more, and down lowers it. The speed eases in and out, so a tap
## nudges the view and a hold turns it smoothly.
func key_orbit(input: Vector2, delta: float) -> void:
	_key_velocity = _key_velocity.lerp(input.limit_length(1.0), minf(KEY_EASE_RATE * delta, 1.0))
	if _key_velocity.length_squared() < 1e-6:
		_key_velocity = Vector2.ZERO
		return
	yaw -= _key_velocity.x * deg_to_rad(KEY_YAW_SPEED_DEG) * delta
	pitch = clampf(pitch - _key_velocity.y * deg_to_rad(KEY_PITCH_SPEED_DEG) * delta,
			deg_to_rad(MIN_PITCH_DEG), deg_to_rad(MAX_PITCH_DEG))


## The arrow keys held right now, unless a text field has the keyboard (chat, later).
func _arrow_input() -> Vector2:
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit:
		return Vector2.ZERO
	var x := float(Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_LEFT))
	var y := float(Input.is_physical_key_pressed(KEY_DOWN)) - float(Input.is_physical_key_pressed(KEY_UP))
	return Vector2(x, y)


func _process(delta: float) -> void:
	key_orbit(_arrow_input(), delta)
	if target != null and is_instance_valid(target):
		var want := target.global_position + Vector3.UP * FOCUS_HEIGHT_M
		_focus = _focus.lerp(want, minf(FOLLOW_RATE * delta, 1.0))
	_place()


func _place() -> void:
	if camera == null:
		return
	var offset := Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * distance
	var eye := _focus + offset
	if is_inside_tree():
		var space := get_world_3d().direct_space_state
		var query := PhysicsRayQueryParameters3D.create(_focus, eye)
		var hit := space.intersect_ray(query)
		if not hit.is_empty():
			var at: Vector3 = hit["position"]
			eye = at + (_focus - at).normalized() * WALL_MARGIN_M
	global_position = _focus
	camera.global_position = eye
	camera.look_at(_focus, Vector3.UP)
