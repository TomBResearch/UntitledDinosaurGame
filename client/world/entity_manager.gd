class_name EntityManager
extends Node3D
## Keeps a view for every entity the server says is in view, and moves each one to its place on
## the estimated server clock every frame (docs/architecture/networking.md, "Clock sync" and
## "Movement playback"):
## - your own character at the current estimated tick, so your movement shows as soon as the path
##   arrives;
## - everyone else INTERPOLATION_DELAY_MS in the past, which absorbs jitter and lets their repaths
##   take over exactly on their start tick.

signal self_spawned(view: PlayerView)

const PLAYER_SCENE := preload("res://entities/player/player_view.tscn")
## How far behind the current estimate other entities are drawn.
const INTERPOLATION_DELAY_MS := 100.0

var net: NetClient = null
var self_view: PlayerView = null
## Your own character's look, from the character you joined with. Everyone else is drawn with the
## default look until the world sends appearance in entity_enter (a later task).
var self_look: Dictionary = {}
var _views: Dictionary[int, PlayerView] = {}
var _last_frame_ms: float = 0.0


## Starts listening to a connection.
func attach(client: NetClient) -> void:
	net = client
	net.entity_entered.connect(_on_entity_entered)
	net.entity_left.connect(_on_entity_left)
	net.path_started.connect(_on_path_started)
	net.path_stopped.connect(_on_path_stopped)
	net.welcomed.connect(_on_welcomed)


## Removes every view (on welcome and on disconnect).
func clear() -> void:
	for v: PlayerView in _views.values():
		v.queue_free()
	_views.clear()
	self_view = null


func view(entity: int) -> PlayerView:
	return _views.get(entity, null)


func count() -> int:
	return _views.size()


## The tick an entity is drawn at, given the current estimated tick.
func draw_tick(entity: int, now_tick: float) -> float:
	if net != null and entity == net.entity_id:
		return now_tick
	return now_tick - INTERPOLATION_DELAY_MS * float(_tick_hz()) / 1000.0


func _process(_delta: float) -> void:
	if net == null or net.state != NetClient.State.IN_WORLD:
		return
	var now := NetClient.now_ms()
	var dt := now - _last_frame_ms if _last_frame_ms > 0.0 else 0.0
	_last_frame_ms = now
	var jumped := net.clock.update(now)
	var now_tick := net.clock.server_tick_at(now)
	for v: PlayerView in _views.values():
		var t := draw_tick(v.entity_id, now_tick)
		if jumped:
			v.absorb_time_jump(t)
		v.update_view(t, dt)


func _on_welcomed(_w: Proto.Welcome) -> void:
	clear()


func _on_entity_entered(m: Proto.EntityEnter) -> void:
	if m.kind != Proto.EntityKind.PLAYER:
		return  # Creatures, nodes and items arrive in later milestones.
	_remove(m.entity)
	var v: PlayerView = PLAYER_SCENE.instantiate()
	v.setup(m, _tick_hz(), net != null and m.entity == net.entity_id)
	add_child(v)
	_views[m.entity] = v
	v.update_view(draw_tick(m.entity, net.server_tick_now()), 0.0)
	if v.is_self:
		if not self_look.is_empty():
			v.apply_look(self_look)
		self_view = v
		self_spawned.emit(v)


func _on_entity_left(m: Proto.EntityLeave) -> void:
	_remove(m.entity)


func _on_path_started(m: Proto.PathStarted) -> void:
	var v := view(m.entity)
	if v == null:
		return
	v.apply_path(PathPlayback.from_proto(m.path, _tick_hz()), draw_tick(m.entity, net.server_tick_now()))


func _on_path_stopped(m: Proto.PathStopped) -> void:
	var v := view(m.entity)
	if v == null:
		return
	var still := PathPlayback.stationary(m.position, m.tick, _tick_hz())
	v.apply_path(still, draw_tick(m.entity, net.server_tick_now()))


func _remove(entity: int) -> void:
	var v := view(entity)
	if v == null:
		return
	_views.erase(entity)
	if v == self_view:
		self_view = null
	v.queue_free()


func _tick_hz() -> int:
	# Entities only exist after welcome, which sets tick_hz.
	return maxi(net.tick_hz, 1) if net != null else 1
