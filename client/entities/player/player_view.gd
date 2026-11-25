class_name PlayerView
extends Node3D
## A player as the client draws it: the placeholder caveman (CavemanModel, in his pelt loincloth)
## and a name label. It never decides where it is: its position is its MotionTrack at the tick the
## entity manager passes in, plus any ErrorBlend correction still running. Its height comes from
## the path's waypoints (the server sends y), so it follows the navmesh up slopes and steps.

## How fast the model turns to face where it's going, in radians a second (cosmetic).
const TURN_SPEED := 12.0
## A small up-and-down bob while walking, so you can see who is moving (cosmetic).
const BOB_HEIGHT_M := 0.05
const BOB_STRIDE_M := 0.9
const SELF_NAME_COLOR := Color(1.0, 0.9, 0.45)

var entity_id: int = 0
var is_self: bool = false
var track := MotionTrack.new()
var blend := ErrorBlend.new()

var _yaw: float = 0.0
var _target_yaw: float = 0.0
var _walked_m: float = 0.0

@onready var _model: CavemanModel = $Model
@onready var _label: Label3D = $Name
@onready var _bubble: SpeechBubble = $Bubble


## Sets the entity up from its entity_enter, so it can be drawn from the first frame.
func setup(enter: Proto.EntityEnter, tick_hz: int, self_entity: bool) -> void:
	entity_id = enter.entity
	is_self = self_entity
	name = "Player%d" % enter.entity
	if enter.path != null:
		track.add(PathPlayback.from_proto(enter.path, tick_hz))
	else:
		track.add(PathPlayback.stationary(enter.position, 0, tick_hz))
	if is_node_ready():
		_apply_label(enter.name)
	else:
		ready.connect(_apply_label.bind(enter.name), CONNECT_ONE_SHOT)


func _apply_label(player_name: String) -> void:
	_label.text = player_name
	if is_self:
		_label.modulate = SELF_NAME_COLOR


## Draws the caveman with a look ({bodyType, skinTone, hairStyle, hairColour, beard}).
func apply_look(look: Dictionary) -> void:
	_model.apply(look)


func model() -> CavemanModel:
	return _model


## Shows a chat line over the player's head for a few seconds.
func say(text: String) -> void:
	_bubble.say(text)


func bubble() -> SpeechBubble:
	return _bubble


## Hands the entity a new path, drawn at tick t. If the path has already started at t (always, for
## your own character), the jump from where it was drawn is blended out.
func apply_path(path: PathPlayback, t: float) -> void:
	var drawn := _drawn_at(t)
	track.add(path)
	blend.start(drawn - track.position_at(t))


## The clock estimate stepped: blend from where the entity was drawn to where it is now.
func absorb_time_jump(t: float) -> void:
	blend.start(position - track.position_at(t))


## Turns to face a point straight away (your own click, before the server answers).
func face_point(point: Vector3) -> void:
	var dir := point - position
	dir.y = 0.0
	if dir.length_squared() < 0.0001:
		return
	_target_yaw = _yaw_of(dir)
	_yaw = _target_yaw
	if _model != null:
		_model.rotation.y = _yaw


## Moves the view to tick t. dt_ms is the real time since the last frame.
func update_view(t: float, dt_ms: float) -> void:
	blend.advance(dt_ms)
	var before := position
	position = _drawn_at(t)
	var heading := track.heading_at(t)
	if heading != Vector3.ZERO:
		_target_yaw = _yaw_of(heading)
		var moved := before.distance_to(position)
		_walked_m += moved
	else:
		_walked_m = 0.0
	_yaw = lerp_angle(_yaw, _target_yaw, minf(TURN_SPEED * dt_ms / 1000.0, 1.0))
	_model.rotation.y = _yaw
	_model.position.y = absf(sin(_walked_m * PI / BOB_STRIDE_M)) * BOB_HEIGHT_M
	track.prune(t)


func _drawn_at(t: float) -> Vector3:
	return track.position_at(t) + blend.offset()


## The yaw that points the model's front (−Z) along dir.
static func _yaw_of(dir: Vector3) -> float:
	return atan2(-dir.x, -dir.z)
