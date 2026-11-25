class_name GameScreen
extends Node3D
## The in-world screen: the region, every entity in view, your camera and the click marker, plus a
## HUD with connection status and the chat box. It sends intents (move_to, chat_say) and draws what
## the server sends;
## nothing here decides an outcome (CLAUDE.md rule 2).

## The server refused the dev name: main goes back to the name box with this message.
signal name_refused(message: String)
## The world refused the join ticket, or a new one couldn't be had (platform session): main goes
## back to the world list, with message if there is one.
signal ticket_refused(message: String)
## Reconnect after a drop or a restart (platform session): main asks the API for a new ticket,
## because each ticket works once, and calls reconnect_with().
signal rejoin_requested
## The player pressed Characters (platform session): main closes the connection and shows them.
signal leave_requested
## The player pressed Log out (only shown with a platform session): main ends the session.
signal log_out_requested

const REGION_PATH := "res://regions/%s/region.tscn"
## How far a ground click ray reaches.
const CLICK_RAY_M := 600.0
## Dev aids (LaunchOptions): demo walk interval and radius, screenshot interval.
const DEMO_MIN_S := 2.5
const DEMO_MAX_S := 5.0
const DEMO_RADIUS_M := 9.0
const SCREENSHOT_EVERY_S := 2.0

var options: LaunchOptions = null
var net: NetClient = null
## The join ticket for the next connection: a join ticket from the API (platform session), or a
## dev ticket for options.name.
var ticket: String = ""

var _region_id: String = ""
var _region: Node = null
## Estimated server tick when the last move_to was sent: an own path_stopped from before it is
## the end of an older path and leaves the marker alone.
var _click_tick: float = -INF
var _demo_timer: float = 0.0
var _shot_timer: float = 0.0
var _run_time: float = 0.0
var _overlay_action: Callable = Callable()
var _rng := RandomNumberGenerator.new()

@onready var _entities: EntityManager = $Entities
@onready var _camera: OrbitCamera = $CameraRig
@onready var _marker: ClickMarker = $ClickMarker
@onready var _status: Label = $Hud/Status
@onready var _debug: Label = $Hud/Debug
@onready var _overlay: Control = $Hud/Overlay
@onready var _overlay_text: Label = $Hud/Overlay/Panel/Box/Message
@onready var _overlay_button: Button = $Hud/Overlay/Panel/Box/Button
@onready var _chat: ChatBox = $Hud/ChatBox
@onready var _log_out: Button = $Hud/LogOut
@onready var _characters: Button = $Hud/Characters


func _ready() -> void:
	_overlay_button.pressed.connect(func() -> void: _overlay_action.call())


## Connects to the world with these options. join_ticket is the API's ticket for options.server_url
## (platform session); without one it's a dev ticket for options.name.
func start(opts: LaunchOptions, client: NetClient, join_ticket: String = "") -> void:
	options = opts
	net = client
	ticket = join_ticket if join_ticket != "" else LaunchOptions.dev_ticket(opts.name)
	net.sim_latency_ms = opts.lag_ms
	_entities.attach(net)
	_entities.self_spawned.connect(_on_self_spawned)
	net.welcomed.connect(_on_welcomed)
	net.path_stopped.connect(_on_path_stopped)
	net.kicked.connect(_on_kicked)
	net.chat_received.connect(_on_chat)
	net.system_message_received.connect(_on_system_message)
	_chat.submitted.connect(_on_chat_submitted)
	net.disconnected.connect(_on_disconnected)
	_log_out.visible = opts.use_platform
	_log_out.pressed.connect(func() -> void:
		_log_out.disabled = true
		log_out_requested.emit())
	_characters.visible = opts.use_platform
	_characters.pressed.connect(func() -> void:
		_characters.disabled = true
		leave_requested.emit())
	_demo_timer = DEMO_MIN_S
	_connect()


func _exit_tree() -> void:
	if net != null:
		net.close()


func _connect() -> void:
	_overlay.visible = false
	_status.text = "Connecting to %s as %s…" % [options.server_url, options.name]
	_status.visible = true
	net.connect_to_world(options.server_url, ticket)


## Connects again with a new ticket from the API (after rejoin_requested).
func reconnect_with(url: String, join_ticket: String) -> void:
	options.server_url = url
	ticket = join_ticket
	_connect()


## Shows why a rejoin failed, with a way back to the world list.
func show_rejoin_failed(message: String) -> void:
	_show_overlay(message, "Choose a world", func() -> void: ticket_refused.emit(message))


## Reconnect: a dev ticket can be used again, but a join ticket can't, so with a platform session
## main fetches a new one first.
func _reconnect() -> void:
	if options.use_platform:
		_status.text = "Reconnecting…"
		_status.visible = true
		_overlay.visible = false
		rejoin_requested.emit()
	else:
		_connect()


func _on_welcomed(w: Proto.Welcome) -> void:
	_status.visible = false
	_marker.clear()
	_click_tick = -INF
	if w.region != _region_id:
		_load_region(w.region)


func _load_region(id: String) -> void:
	if _region != null:
		_region.queue_free()
		_region = null
	_region_id = id
	var path := REGION_PATH % id
	if not ResourceLoader.exists(path):
		_show_overlay("This client doesn't have region \"%s\". Please refresh the page." % id, "", Callable())
		return
	var scene: PackedScene = load(path)
	_region = scene.instantiate()
	add_child(_region)
	move_child(_region, 0)


func _on_self_spawned(view: PlayerView) -> void:
	_camera.follow(view)


func _on_path_stopped(m: Proto.PathStopped) -> void:
	if m.entity == net.entity_id and float(m.tick) >= floorf(_click_tick):
		_marker.clear()


## A chat line: in the chat box, and over the speaker's head if they're in view.
func _on_chat(m: Proto.Chat) -> void:
	_chat.add_chat(m.name, m.text, m.role, m.entity == net.entity_id)
	var speaker := _entities.view(m.entity)
	if speaker != null:
		speaker.say(m.text)


func _on_system_message(m: Proto.SystemMessage) -> void:
	_chat.add_system(ChatLog.system_text(m.key, m.seconds))


func _on_chat_submitted(text: String) -> void:
	if net != null and net.state == NetClient.State.IN_WORLD:
		net.send_chat(text)


func _unhandled_input(event: InputEvent) -> void:
	var button := event as InputEventMouseButton
	if button == null or button.button_index != MOUSE_BUTTON_LEFT or not button.pressed:
		return
	var hit: Variant = _pick_ground(button.position)
	if hit != null:
		click_ground(hit as Vector3)
		get_viewport().set_input_as_handled()


## Raycasts from the camera through a screen point. Returns the ground point, or null.
func _pick_ground(screen_point: Vector2) -> Variant:
	var cam := _camera.camera
	var from := cam.project_ray_origin(screen_point)
	var to := from + cam.project_ray_normal(screen_point) * CLICK_RAY_M
	return _ray(from, to)


func _ray(from: Vector3, to: Vector3) -> Variant:
	var hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to))
	if hit.is_empty():
		return null
	var point: Vector3 = hit["position"]
	return point


## Asks to walk to a ground point: shows the marker and turns to face it now, but only moves when
## the server's path_started arrives.
func click_ground(point: Vector3) -> void:
	if net == null or net.state != NetClient.State.IN_WORLD:
		return
	_marker.show_at(point)
	var me := _entities.self_view
	if me != null:
		me.face_point(point)
	_click_tick = net.server_tick_now()
	net.send_move_to(Vector3i((point * 100.0).round()))


func _process(delta: float) -> void:
	_run_time += delta
	_update_debug()
	if options == null:
		return
	if options.demo_walk:
		_demo_walk(delta)
	if options.screenshot_path != "":
		_shot_timer -= delta
		if _shot_timer <= 0.0:
			_shot_timer = SCREENSHOT_EVERY_S
			get_viewport().get_texture().get_image().save_png(options.screenshot_path)
	if options.quit_after_s > 0.0 and _run_time >= options.quit_after_s:
		get_tree().quit()


## Dev aid: clicks a random ground point near you every few seconds.
func _demo_walk(delta: float) -> void:
	var me := _entities.self_view
	if me == null:
		return
	_demo_timer -= delta
	if _demo_timer > 0.0:
		return
	_demo_timer = _rng.randf_range(DEMO_MIN_S, DEMO_MAX_S)
	var angle := _rng.randf() * TAU
	var r := sqrt(_rng.randf()) * DEMO_RADIUS_M
	var above := me.position + Vector3(cos(angle) * r, 50.0, sin(angle) * r)
	var hit: Variant = _ray(above, above + Vector3.DOWN * 100.0)
	if hit != null:
		click_ground(hit as Vector3)


func _update_debug() -> void:
	if net == null or net.state != NetClient.State.IN_WORLD:
		_debug.text = ""
		return
	var me := _entities.self_view
	var at := "(%.0f, %.0f, %.0f)" % [me.position.x, me.position.y, me.position.z] if me != null else "-"
	_debug.text = "%d fps · tick %.1f · rtt %.0f ms · offset %+.1f ms · %d in view · %.1f KB in · at %s" % [
		Engine.get_frames_per_second(), net.server_tick_now(), net.clock.best_rtt_ms(),
		net.clock.offset_ms() - net.clock.target_offset_ms(), _entities.count(), net.bytes_in / 1024.0, at]


func _on_kicked(reason: Proto.KickReason) -> void:
	match reason:
		Proto.KickReason.REFRESH:
			_show_overlay("The game has been updated. Please refresh the page.", "Refresh", _reload_page)
		Proto.KickReason.BAD_TICKET:
			if options.use_platform:
				ticket_refused.emit("")
			else:
				name_refused.emit("The server refused that name. Use letters and digits, with single spaces between words.")
		Proto.KickReason.SHUTDOWN:
			_show_overlay("The world is restarting.", "Reconnect", _reconnect)
		Proto.KickReason.MISBEHAVING:
			_show_overlay("Disconnected: too many invalid messages.", "Reconnect", _reconnect)
		Proto.KickReason.IDLE:
			_show_overlay("You were logged out for being idle. You're saved where you stood.", "Log in again", _reconnect)
		Proto.KickReason.ALREADY_ONLINE:
			_show_overlay("That character, or another on your account, is already online.", "Try again", _reconnect)
		Proto.KickReason.UNAVAILABLE:
			_show_overlay("The world couldn't load your character just now.", "Try again", _reconnect)


func _on_disconnected(detail: String, was_kicked: bool) -> void:
	_entities.clear()
	_marker.clear()
	_camera.follow(null)
	if was_kicked:
		return  # The kick already explained it.
	_show_overlay("Lost the connection to the world (%s)." % detail, "Reconnect", _reconnect)


func _show_overlay(message: String, button: String, action: Callable) -> void:
	_status.visible = false
	_overlay_text.text = message
	_overlay_button.text = button
	_overlay_button.visible = button != ""
	_overlay_action = action
	_overlay.visible = true


func _reload_page() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.location.reload()", true)
	else:
		get_tree().quit()
