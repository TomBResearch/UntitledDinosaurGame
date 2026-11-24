class_name NetClient
extends Node
## The connection to a world server (docs/architecture/networking.md): a WebSocketPeer carrying
## binary frames of messages from the generated codec (res://net/proto/messages.gd), decoded and
## passed on as typed signals. Pings double as clock sync (ClockSync).
##
## The client only sends intents (hello, ping, move_to, chat_say). Everything it shows comes from
## these signals.

signal state_changed(state: State)
signal welcomed(msg: Proto.Welcome)
signal entity_entered(msg: Proto.EntityEnter)
signal entity_left(msg: Proto.EntityLeave)
signal path_started(msg: Proto.PathStarted)
signal path_stopped(msg: Proto.PathStopped)
signal chat_received(msg: Proto.Chat)
## The server is closing the connection for this reason. disconnected follows.
signal kicked(reason: Proto.KickReason)
## The connection is gone. kicked is true if a kick explained it first.
signal disconnected(detail: String, was_kicked: bool)

enum State { IDLE, CONNECTING, IN_WORLD, CLOSED }

const CONTENT_HASH_PATH := "res://data/content_hash.txt"
## Pings at connect, a second apart, so the clock settles quickly (the server allows 1/s, burst 3).
const WARMUP_PINGS := 4
const WARMUP_INTERVAL_S := 1.0
## Clock-sync pings. The server's own WebSocket pings keep the connection alive (the browser
## answers them even in a background tab), so these can pause with the game.
const PING_INTERVAL_S := 5.0
## Receive buffer. In a background tab the browser pauses the game loop but keeps receiving, so
## frames queue here until the tab comes back; if it fills, frames are lost and what's on screen
## goes wrong. 8 MB and 65,536 frames hold about an hour of a quiet area (about 2 KB/s, at most
## one frame per tick at 20 Hz) and several minutes of a very busy one. The defaults (64 KB, 4,096
## frames) would fill in about 30 seconds.
const INBOUND_BUFFER_BYTES := 8 * 1024 * 1024
const INBOUND_MAX_FRAMES := 65536

var state: State = State.IDLE
var clock := ClockSync.new()
## From welcome.
var entity_id: int = 0
var region: String = ""
var tick_hz: int = 0
## Frames and bytes received (debug overlay).
var frames_in: int = 0
var bytes_in: int = 0
## Testing aid: adds this much round-trip latency, half each way (LaunchOptions "lag").
var sim_latency_ms: float = 0.0

var _socket: WebSocketPeer = null
var _ticket: String = ""
var _hello_sent_ms: float = 0.0
var _hello_sent: bool = false
var _ping_timer_s: float = 0.0
var _pings_sent: int = 0
var _kicked: bool = false
var _error: String = ""
## Frames held back by sim_latency_ms, with the client time each is due.
var _in_frames: Array[PackedByteArray] = []
var _in_due: PackedFloat64Array = PackedFloat64Array()
var _out_frames: Array[PackedByteArray] = []
var _out_due: PackedFloat64Array = PackedFloat64Array()


## Opens a connection to url (e.g. ws://127.0.0.1:8090/w/dev) and joins with ticket.
func connect_to_world(url: String, ticket: String) -> Error:
	close()
	_reset_session()
	_ticket = ticket
	_socket = WebSocketPeer.new()
	_socket.inbound_buffer_size = INBOUND_BUFFER_BYTES
	_socket.max_queued_packets = INBOUND_MAX_FRAMES
	var err := _socket.connect_to_url(url)
	if err != OK:
		_socket = null
		_set_state(State.CLOSED)
		disconnected.emit("can't connect to %s (%s)" % [url, error_string(err)], false)
		return err
	_set_state(State.CONNECTING)
	return OK


## Closes the connection, if any, without waiting for the server.
func close() -> void:
	if _socket != null:
		_socket.close()
		_socket = null
	if state == State.CONNECTING or state == State.IN_WORLD:
		_set_state(State.CLOSED)


## Asks to walk to a point, in whole centimetres.
func send_move_to(position_cm: Vector3i) -> void:
	var m := Proto.MoveTo.new()
	m.position = position_cm
	_send(m)


func send_chat(text: String) -> void:
	var m := Proto.ChatSay.new()
	m.text = text
	_send(m)


## The estimated server time now, in fractional ticks.
func server_tick_now() -> float:
	return clock.server_tick_at(now_ms())


static func now_ms() -> float:
	return float(Time.get_ticks_usec()) / 1000.0


func _process(delta: float) -> void:
	if _socket == null:
		return
	_socket.poll()
	var ready := _socket.get_ready_state()
	if ready == WebSocketPeer.STATE_OPEN and not _hello_sent:
		_send_hello()
	# Read whatever has arrived even once the socket has closed: a kick is the last frame before
	# the close, and often arrives in the same poll.
	if not _receive():
		return
	if ready == WebSocketPeer.STATE_CLOSED:
		_flush_delayed(INF)
		var code := _socket.get_close_code()
		var reason := _socket.get_close_reason()
		_socket = null
		var detail := _error
		if detail == "":
			detail = "closed (%d%s)" % [code, ", " + reason if reason != "" else ""]
		_set_state(State.CLOSED)
		disconnected.emit(detail, _kicked)
		return
	if not _flush_delayed(now_ms()):
		return
	if ready == WebSocketPeer.STATE_OPEN and state == State.IN_WORLD:
		_tick_pings(delta)


## Reads every frame the socket holds. Returns false if one was bad (the connection is closing).
func _receive() -> bool:
	while _socket != null and _socket.get_available_packet_count() > 0:
		var frame := _socket.get_packet()
		if _socket.was_string_packet():
			_fail("the server sent a text frame")
			return false
		if sim_latency_ms > 0.0:
			_in_frames.append(frame)
			_in_due.append(now_ms() + sim_latency_ms / 2.0)
		elif not handle_frame(frame, now_ms()):
			return false
	return true


## Decodes one frame from the server and emits a signal per message. received_ms is the client
## time it arrived. A malformed frame closes the connection (the server would do the same), and
## returns false.
func handle_frame(frame: PackedByteArray, received_ms: float) -> bool:
	frames_in += 1
	bytes_in += frame.size()
	var decoded := Proto.decode(frame, Proto.Dir.FROM_SERVER)
	if decoded.error != "":
		_fail("bad frame from the server: %s" % decoded.error)
		return false
	for m in decoded.messages:
		_dispatch(m, received_ms)
	return true


func _dispatch(m: Proto.Message, received_ms: float) -> void:
	match m.message_id():
		Proto.MSG_WELCOME:
			var w := m as Proto.Welcome
			entity_id = w.entity
			region = w.region
			tick_hz = w.tick_hz
			clock.tick_hz = w.tick_hz
			clock.add_welcome(_hello_sent_ms, received_ms, w.server_tick)
			_set_state(State.IN_WORLD)
			# First warm-up ping straight away.
			_ping_timer_s = 0.0
			welcomed.emit(w)
		Proto.MSG_PONG:
			var p := m as Proto.Pong
			clock.add_pong(float(p.client_time) / 1000.0, received_ms, p.server_tick, p.tick_phase)
		Proto.MSG_ENTITY_ENTER:
			entity_entered.emit(m as Proto.EntityEnter)
		Proto.MSG_ENTITY_LEAVE:
			entity_left.emit(m as Proto.EntityLeave)
		Proto.MSG_PATH_STARTED:
			path_started.emit(m as Proto.PathStarted)
		Proto.MSG_PATH_STOPPED:
			path_stopped.emit(m as Proto.PathStopped)
		Proto.MSG_CHAT:
			chat_received.emit(m as Proto.Chat)
		Proto.MSG_KICK:
			_kicked = true
			kicked.emit((m as Proto.Kick).reason)


func _send_hello() -> void:
	var h := Proto.Hello.new()
	h.protocol_hash = Proto.PROTOCOL_HASH
	h.ticket = _ticket
	h.content_hash = content_hash()
	h.client_version = str(ProjectSettings.get_setting("application/config/version", ""))
	_hello_sent = true
	_hello_sent_ms = now_ms()
	_send(h)


## The hash of the client's content data, which the server checks in hello.
static func content_hash() -> String:
	return FileAccess.get_file_as_string(CONTENT_HASH_PATH).strip_edges()


func _tick_pings(delta: float) -> void:
	_ping_timer_s -= delta
	if _ping_timer_s > 0.0:
		return
	var p := Proto.Ping.new()
	p.client_time = Time.get_ticks_usec()
	_send(p)
	_pings_sent += 1
	_ping_timer_s = WARMUP_INTERVAL_S if _pings_sent < WARMUP_PINGS else PING_INTERVAL_S


func _send(m: Proto.Message) -> void:
	if _socket == null or _socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	var frame := Proto.encode(m)
	if frame.is_empty():
		push_error("can't encode %s" % m.message_name())
		return
	if sim_latency_ms > 0.0:
		_out_frames.append(frame)
		_out_due.append(now_ms() + sim_latency_ms / 2.0)
		return
	_socket.send(frame, WebSocketPeer.WRITE_MODE_BINARY)


## Releases frames held back by sim_latency_ms that are due by now. Returns false if an incoming
## frame was malformed (the connection is then closing).
func _flush_delayed(now: float) -> bool:
	while not _out_frames.is_empty() and _out_due[0] <= now and _socket != null:
		if _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
			_socket.send(_out_frames[0], WebSocketPeer.WRITE_MODE_BINARY)
		_out_frames.pop_front()
		_out_due.remove_at(0)
	while not _in_frames.is_empty() and _in_due[0] <= now:
		var frame: PackedByteArray = _in_frames.pop_front()
		_in_due.remove_at(0)
		if not handle_frame(frame, minf(now, now_ms())):
			return false
	return true


func _fail(detail: String) -> void:
	_error = detail
	push_warning(detail)
	if _socket != null:
		# 1002: protocol error. The close completes in _process, which emits disconnected.
		_socket.close(1002, "protocol error")
	else:
		_set_state(State.CLOSED)
		disconnected.emit(detail, _kicked)


func _reset_session() -> void:
	clock = ClockSync.new()
	entity_id = 0
	region = ""
	tick_hz = 0
	frames_in = 0
	bytes_in = 0
	_hello_sent = false
	_pings_sent = 0
	_ping_timer_s = 0.0
	_kicked = false
	_error = ""
	_in_frames.clear()
	_in_due.clear()
	_out_frames.clear()
	_out_due.clear()


func _set_state(s: State) -> void:
	if state == s:
		return
	state = s
	state_changed.emit(s)
