class_name OrbitCamera
extends Node3D
## Third-person camera that orbits and follows a target (your character). Right-drag (or
## middle-drag) orbits, the wheel zooms. Pitch and distance are clamped, and the camera is pulled
## in front of any terrain between it and the target so it never ends up underground.
## All of this is presentation only; the numbers are camera feel, not game rules.

const MIN_PITCH_DEG := 12.0
const MAX_PITCH_DEG := 80.0
const MIN_DISTANCE_M := 4.0
const MAX_DISTANCE_M := 30.0
const ZOOM_STEP := 1.12
## Radians of orbit per pixel dragged.
const ORBIT_SENSITIVITY := 0.006
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
			MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE:
				_dragging = button.pressed
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


func _process(delta: float) -> void:
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
