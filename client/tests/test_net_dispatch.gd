extends GutTest
## NetClient decoding and dispatch, from frames recorded off a real world server (cmd/world
## -dev-tickets, two clients "Grug" and "Ugg"). No socket is opened: frames go straight into
## handle_frame with an explicit arrival time.

## welcome (Grug, entity 1048577, tick 1385), entity_enter Grug, entity_enter Ugg.
const WELCOME := "40138180400c746573745f67726579626f78e90a1444120081804000000447727567af09a402f015ff44120080808001000003556767af09a402f015ff"
## pong: client_time 222656 µs, server_tick 1385, tick_phase 255.
const PONG := "4106c0cb0de90aff"
## path_started for Ugg: tick 1414, 400 cm/s, 3 waypoints.
const UGG_PATH := "421b80808001860b900303af09a402f015b512ce01ca06b514cc019803"
## path_stopped for Grug at tick 1483.
const GRUG_STOPPED := "430b818040cb0b97059202da07"

const GRUG := 1048577
const UGG := 2097152

var net: NetClient


func before_each() -> void:
	net = autofree(NetClient.new())
	watch_signals(net)


func test_welcome_frame_sets_up_the_session_and_emits_in_order() -> void:
	assert_true(net.handle_frame(WELCOME.hex_decode(), 1000.0))
	assert_eq(net.entity_id, GRUG)
	assert_eq(net.region, "test_greybox")
	assert_eq(net.tick_hz, 20)
	assert_eq(net.state, NetClient.State.IN_WORLD)
	assert_true(net.clock.is_synced(), "welcome is a first clock sample")
	assert_signal_emit_count(net, "welcomed", 1)
	assert_signal_emit_count(net, "entity_entered", 2)
	var first: Proto.EntityEnter = get_signal_parameters(net, "entity_entered", 0)[0]
	var second: Proto.EntityEnter = get_signal_parameters(net, "entity_entered", 1)[0]
	assert_eq(first.entity, GRUG, "your own entity first")
	assert_eq(first.name, "Grug")
	assert_eq(second.name, "Ugg")
	assert_eq(second.position, Vector3i(-600, 146, 1400))
	assert_null(second.path, "standing still")


func test_pong_feeds_the_clock() -> void:
	net.handle_frame(WELCOME.hex_decode(), 200.0)
	# The ping went out at 222.656 ms (client_time is in µs); the pong arrived at 232.656 ms.
	net.handle_frame(PONG.hex_decode(), 232.656)
	assert_almost_eq(net.clock.best_rtt_ms(), 10.0, 0.001)
	# Server time on arrival: tick 1385 + 255/256 (50 ms ticks), plus half the round trip. The
	# welcome's sample had a far longer round trip, so the pong alone sets the target.
	var server_ms := (1385.0 + 255.0 / 256.0) * 50.0 + 5.0
	assert_almost_eq(net.clock.target_offset_ms(), server_ms - 232.656, 0.001)


func test_path_messages_are_dispatched_typed() -> void:
	net.handle_frame(WELCOME.hex_decode(), 0.0)
	net.handle_frame(UGG_PATH.hex_decode(), 10.0)
	net.handle_frame(GRUG_STOPPED.hex_decode(), 20.0)
	var started: Proto.PathStarted = get_signal_parameters(net, "path_started", 0)[0]
	assert_eq(started.entity, UGG)
	assert_eq(started.path.start_tick, 1414)
	assert_eq(started.path.speed, 400)
	assert_eq(started.path.waypoints.size(), 3)
	assert_eq(started.path.waypoints[0], Vector3i(-600, 146, 1400))
	var stopped: Proto.PathStopped = get_signal_parameters(net, "path_stopped", 0)[0]
	assert_eq(stopped.entity, GRUG)
	assert_eq(stopped.tick, 1483)
	assert_eq(stopped.position, Vector3i(-332, 137, 493))


func test_kick_is_reported_before_the_close() -> void:
	var kick := Proto.Kick.new()
	kick.reason = Proto.KickReason.SHUTDOWN
	net.handle_frame(Proto.encode(kick), 0.0)
	assert_signal_emitted_with_parameters(net, "kicked", [Proto.KickReason.SHUTDOWN])


func test_chat_and_system_messages_are_dispatched_typed() -> void:
	var chat := Proto.Chat.new()
	chat.entity = UGG
	chat.name = "Ugg"
	chat.text = "[b]Rawr[/b]"
	var muted := Proto.SystemMessage.new()
	muted.key = Proto.SystemKey.CHAT_MUTED
	var w := Proto.Writer.new()
	assert_true(Proto.encode_into(w, chat))
	assert_true(Proto.encode_into(w, muted))
	assert_true(net.handle_frame(w.buf, 0.0))
	var got: Proto.Chat = get_signal_parameters(net, "chat_received", 0)[0]
	assert_eq(got.entity, UGG)
	assert_eq(got.text, "[b]Rawr[/b]")
	var notice: Proto.SystemMessage = get_signal_parameters(net, "system_message_received", 0)[0]
	assert_eq(notice.key, Proto.SystemKey.CHAT_MUTED)


func test_a_malformed_frame_is_rejected_whole() -> void:
	# The welcome frame with its last byte cut off: the final entity_enter is truncated, so none of
	# the frame's messages are dispatched.
	var frame := WELCOME.hex_decode()
	frame.resize(frame.size() - 1)
	assert_false(net.handle_frame(frame, 0.0))
	assert_signal_not_emitted(net, "welcomed")
	assert_signal_not_emitted(net, "entity_entered")
	assert_signal_emitted(net, "disconnected")


func test_a_client_message_from_the_server_is_rejected() -> void:
	var m := Proto.MoveTo.new()
	assert_false(net.handle_frame(Proto.encode(m), 0.0))
	assert_signal_emitted(net, "disconnected")


func test_entity_manager_builds_views_from_the_frames() -> void:
	var manager: EntityManager = autofree(EntityManager.new())
	add_child(manager)
	manager.attach(net)
	net.handle_frame(WELCOME.hex_decode(), NetClient.now_ms())
	assert_eq(manager.count(), 2)
	assert_not_null(manager.self_view)
	assert_eq(manager.self_view.entity_id, GRUG)
	assert_true(manager.self_view.is_self)
	net.handle_frame(UGG_PATH.hex_decode(), NetClient.now_ms())
	var ugg := manager.view(UGG)
	# 400 cm/s for 10 ticks (0.5 s) = 200 cm along the first segment, whose 3D length is ~1137 cm.
	var at := ugg.track.position_at(1424.0) * 100.0
	var seg := Vector3(-1179 + 600, 103 - 146, 421 - 1400)
	var want := Vector3(-600, 146, 1400) + seg * (200.0 / seg.length())
	assert_almost_eq(at.distance_to(want), 0.0, 0.01)
	# Others are drawn 100 ms (2 ticks) behind the estimate; you aren't.
	assert_almost_eq(manager.draw_tick(UGG, 1500.0), 1498.0, 0.0001)
	assert_eq(manager.draw_tick(GRUG, 1500.0), 1500.0)
	var leave := Proto.EntityLeave.new()
	leave.entity = UGG
	net.handle_frame(Proto.encode(leave), NetClient.now_ms())
	assert_eq(manager.count(), 1)
