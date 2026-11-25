class_name CavemanPreview
extends SubViewportContainer
## A turning 3D preview of the caveman, for the character and creation screens. It has its own 3D
## world, so it never shows the game's world behind it. Drag across it to turn him by hand.

## How fast he turns on his own, in radians a second.
const SPIN := 0.5
## Radians of turn per pixel dragged.
const DRAG_TURN := 0.012

var _dragging: bool = false

@onready var _caveman: CavemanModel = $View/Stage/Caveman
@onready var _camera: Camera3D = $View/Stage/Camera
@onready var _sun: DirectionalLight3D = $View/Stage/Sun


func _ready() -> void:
	_camera.look_at_from_position(Vector3(0.0, 1.25, -3.1), Vector3(0.0, 0.95, 0.0))
	# Light from in front, above and to one side, so the face is lit.
	_sun.look_at_from_position(Vector3(1.6, 3.2, -2.6), Vector3(0.0, 1.0, 0.0))
	_caveman.rotation.y = 0.0


## Shows a look, or nobody for an empty slot.
func show_look(look: Dictionary) -> void:
	_caveman.visible = not look.is_empty()
	if not look.is_empty():
		_caveman.apply(look)


## The model (tests).
func caveman() -> CavemanModel:
	return _caveman


func _process(delta: float) -> void:
	if not _dragging and is_visible_in_tree():
		_caveman.rotation.y = wrapf(_caveman.rotation.y + SPIN * delta, -PI, PI)


func _gui_input(event: InputEvent) -> void:
	var button := event as InputEventMouseButton
	if button != null and button.button_index == MOUSE_BUTTON_LEFT:
		_dragging = button.pressed
		accept_event()
		return
	var motion := event as InputEventMouseMotion
	if motion != null and _dragging:
		_caveman.rotation.y += motion.relative.x * DRAG_TURN
		accept_event()
