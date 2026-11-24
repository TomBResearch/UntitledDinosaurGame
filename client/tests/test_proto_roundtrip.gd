extends GutTest
## Round trips for the generated codec (res://net/proto/messages.gd). The samples here match
## samples() in server/internal/proto/proto_test.go, and both encoders must produce the bytes in
## protocol/testdata/golden.txt, so the Go and GDScript codecs provably agree.

const GOLDEN_PATH := "../protocol/testdata/golden.txt"


class Sample:
	var name: String
	var messages: Array[Proto.Message]

	func _init(n: String, m: Array[Proto.Message]) -> void:
		name = n
		messages = m


var golden: Dictionary[String, PackedByteArray] = {}


func before_all() -> void:
	var path := ProjectSettings.globalize_path("res://").path_join(GOLDEN_PATH)
	var text := FileAccess.get_file_as_string(path)
	assert(text != "", "can't read %s" % path)
	for line in text.split("\n"):
		if line == "" or line.begins_with("#"):
			continue
		var parts := line.split(" ")
		golden[parts[0]] = parts[1].hex_decode()


func test_every_sample_encodes_to_the_golden_bytes() -> void:
	var list := samples()
	assert_eq(list.size(), golden.size(), "samples and golden.txt list the same cases")
	for s in list:
		assert_true(golden.has(s.name), "golden.txt has %s" % s.name)
		var want: PackedByteArray = golden.get(s.name, PackedByteArray())
		assert_eq(_encode_all(s.messages).hex_encode(), want.hex_encode(), s.name)


func test_golden_frames_decode_and_re_encode_unchanged() -> void:
	for s in samples():
		var frame: PackedByteArray = golden[s.name]
		var got := Proto.decode(frame, s.messages[0].direction())
		assert_eq(got.error, "", s.name)
		assert_eq(got.messages.size(), s.messages.size(), s.name)
		assert_eq(_encode_all(got.messages).hex_encode(), frame.hex_encode(), s.name)


func test_decoded_fields() -> void:
	var enter := _decode_one("entity_enter_moving", Proto.Dir.FROM_SERVER) as Proto.EntityEnter
	assert_not_null(enter)
	if enter != null:
		assert_eq(enter.entity, 1)
		assert_eq(enter.kind, Proto.EntityKind.PLAYER)
		assert_eq(enter.name, "Ugg")
		assert_eq(enter.hp, 128)
		assert_true(enter.in_combat)
		assert_not_null(enter.path)
		if enter.path != null:
			assert_eq(enter.path.speed, 350)
			assert_eq(enter.path.waypoints, [Vector3i(0, 0, 0), Vector3i(100, 0, 100)] as Array[Vector3i])

	var still := _decode_one("entity_enter_still", Proto.Dir.FROM_SERVER) as Proto.EntityEnter
	assert_not_null(still)
	if still != null:
		assert_null(still.path)
		assert_false(still.in_combat)
		assert_eq(still.kind, Proto.EntityKind.CREATURE)

	var move := _decode_one("move_to_extremes", Proto.Dir.FROM_CLIENT) as Proto.MoveTo
	assert_not_null(move)
	if move != null:
		assert_eq(move.position, Vector3i(-2147483648, 2147483647, 0))

	var ping := _decode_one("ping_max", Proto.Dir.FROM_CLIENT) as Proto.Ping
	assert_not_null(ping)
	if ping != null:
		assert_eq(ping.client_time, 0x7fffffffffffffff)

	var say := _decode_one("chat_say", Proto.Dir.FROM_CLIENT) as Proto.ChatSay
	assert_not_null(say)
	if say != null:
		assert_eq(say.text, "Hello, world! Ugg 🦖")

	var frame := Proto.decode(golden["server_frame"], Proto.Dir.FROM_SERVER)
	assert_eq(frame.messages.size(), 3)
	if frame.messages.size() == 3:
		assert_true(frame.messages[0] is Proto.PathStopped)
		assert_true(frame.messages[1] is Proto.EntityLeave)
		assert_true(frame.messages[2] is Proto.Chat)


func test_rejects_malformed_frames() -> void:
	var long_ticket := PackedByteArray([1, 0x81, 0x08])
	long_ticket.resize(3 + 1025)
	long_ticket.append_array(PackedByteArray([0, 0]))
	var cases: Dictionary[String, PackedByteArray] = {
		"unknown id": PackedByteArray([0xee, 0]),
		"server message from a client": golden["welcome"],
		"id only": PackedByteArray([Proto.MSG_PING]),
		"length past the end": PackedByteArray([Proto.MSG_PING, 1]),
		"declared length over the limit": _frame(Proto.MSG_CHAT_SAY, _zeros(483)),
		"huge declared length": PackedByteArray([Proto.MSG_PING, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]),
		"string over its limit": _frame(Proto.MSG_HELLO, long_ticket),
		"trailing bytes": _frame(Proto.MSG_MOVE_TO, PackedByteArray([0, 0, 0, 0])),
		"non-minimal varint": _frame(Proto.MSG_PING, PackedByteArray([0x80, 0x00])),
		"varint too long": _frame(Proto.MSG_HELLO, PackedByteArray([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])),
		"u32 overflow": _frame(Proto.MSG_HELLO, PackedByteArray([0x80, 0x80, 0x80, 0x80, 0x10, 0, 0, 0])),
	}
	for name in cases:
		var got := Proto.decode(cases[name], Proto.Dir.FROM_CLIENT)
		assert_ne(got.error, "", name)
		assert_eq(got.messages.size(), 0, name)

	var server_cases: Dictionary[String, PackedByteArray] = {
		"client message from the server": golden["move_to"],
		"unused flag bit": _frame(Proto.MSG_ENTITY_ENTER, PackedByteArray([0x04, 1, 0, 0, 0, 0, 0, 0, 0])),
		"enum out of range": _frame(Proto.MSG_ENTITY_ENTER, PackedByteArray([0, 1, 5, 0, 0, 0, 0, 0, 0])),
		"list over its limit": _frame(Proto.MSG_PATH_STARTED, PackedByteArray([1, 0, 0, 65]) + _zeros(65 * 3)),
		"list longer than the bytes left": _frame(Proto.MSG_PATH_STARTED, PackedByteArray([1, 0, 0, 10, 0, 0, 0])),
		"good message then garbage": golden["entity_leave"] + PackedByteArray([0xee]),
	}
	for name in server_cases:
		var got := Proto.decode(server_cases[name], Proto.Dir.FROM_SERVER)
		assert_ne(got.error, "", name)
		assert_eq(got.messages.size(), 0, name)


func test_every_truncation_is_rejected() -> void:
	for s in samples():
		if s.messages.size() != 1:
			continue  # a multi-message frame cut at a message boundary is valid
		var frame: PackedByteArray = golden[s.name]
		for n in range(1, frame.size()):
			var got := Proto.decode(frame.slice(0, n), s.messages[0].direction())
			assert_ne(got.error, "", "%s cut to %d bytes" % [s.name, n])


func test_encode_rejects_out_of_range() -> void:
	var say := Proto.ChatSay.new()
	say.text = "a".repeat(481)
	var big_u8 := Proto.Welcome.new()
	big_u8.tick_hz = 256
	var big_u32 := Proto.EntityLeave.new()
	big_u32.entity = 0x100000000
	var negative := Proto.Ping.new()
	negative.client_time = -1
	var far := Proto.MoveTo.new()
	far.position = Vector3i(-2147483648, 0, 0)  # in range: fine
	var long_path := Proto.PathStarted.new()
	long_path.path.waypoints.resize(65)
	var no_path := Proto.PathStarted.new()
	no_path.path = null
	for m: Proto.Message in [say, big_u8, big_u32, negative, long_path, no_path]:
		assert_eq(Proto.encode(m).size(), 0, "%s should fail to encode" % m.message_name())
	assert_gt(Proto.encode(far).size(), 0)

	var w := Proto.Writer.new()
	assert_false(Proto.encode_into(w, say))
	assert_ne(w.error, "")
	assert_eq(w.buf.size(), 0, "a failed encode leaves the buffer unchanged")


func test_protocol_hash_is_set() -> void:
	assert_gt(Proto.PROTOCOL_HASH, 0)


# Keep in step with samples() in server/internal/proto/proto_test.go.
func samples() -> Array[Sample]:
	var hello := Proto.Hello.new()
	hello.protocol_hash = 0x12345678
	hello.ticket = "dev-ticket"
	hello.content_hash = "0123456789abcdef".repeat(4)
	hello.client_version = "0.1.0"

	var ping := Proto.Ping.new()
	ping.client_time = 1_700_000_000_123
	var ping_max := Proto.Ping.new()
	ping_max.client_time = 0x7fffffffffffffff

	var move := Proto.MoveTo.new()
	move.position = Vector3i(-1234, 56, 7890123)
	var move_ext := Proto.MoveTo.new()
	move_ext.position = Vector3i(-2147483648, 2147483647, 0)

	var say := Proto.ChatSay.new()
	say.text = "Hello, world! Ugg 🦖"

	var welcome := Proto.Welcome.new()
	welcome.entity = 42
	welcome.region = "fern_valley"
	welcome.server_tick = 123456
	welcome.tick_hz = 20

	var pong := Proto.Pong.new()
	pong.client_time = 99
	pong.server_tick = 4_000_000_000
	pong.tick_phase = 255

	var started := Proto.PathStarted.new()
	started.entity = 7
	started.path.start_tick = 1000
	started.path.speed = 400
	started.path.waypoints = [Vector3i(0, 0, 0), Vector3i(150, -20, 300), Vector3i(-5000, 100, 25000)]

	var stopped := Proto.PathStopped.new()
	stopped.entity = 7
	stopped.tick = 1234
	stopped.position = Vector3i(10, 20, 30)

	var still := Proto.EntityEnter.new()
	still.entity = 300
	still.kind = Proto.EntityKind.CREATURE
	still.type_id = "raptor"
	still.name = "Raptor"
	still.position = Vector3i(100, 0, -100)
	still.hp = 255

	var moving := Proto.EntityEnter.new()
	moving.entity = 1
	moving.kind = Proto.EntityKind.PLAYER
	moving.name = "Ugg"
	moving.path = Proto.Path.new()
	moving.path.start_tick = 5
	moving.path.speed = 350
	moving.path.waypoints = [Vector3i(0, 0, 0), Vector3i(100, 0, 100)]
	moving.hp = 128
	moving.in_combat = true

	var leave := Proto.EntityLeave.new()
	leave.entity = 300

	var chat := Proto.Chat.new()
	chat.entity = 1
	chat.name = "Ugg"
	chat.role = Proto.Role.MODERATOR
	chat.text = "Rawr"

	var chat_long := Proto.Chat.new()
	chat_long.entity = 2
	chat_long.name = "Grok"
	chat_long.role = Proto.Role.NORMAL
	chat_long.text = "a".repeat(300)

	var kick := Proto.Kick.new()
	kick.reason = Proto.KickReason.REFRESH
	var kick_misbehaving := Proto.Kick.new()
	kick_misbehaving.reason = Proto.KickReason.MISBEHAVING
	var system := Proto.SystemMessage.new()
	system.key = Proto.SystemKey.CHAT_MUTED

	var f_stopped := Proto.PathStopped.new()
	f_stopped.entity = 7
	f_stopped.tick = 1300
	f_stopped.position = Vector3i(1, 2, 3)
	var f_leave := Proto.EntityLeave.new()
	f_leave.entity = 8
	var f_chat := Proto.Chat.new()
	f_chat.entity = 1
	f_chat.name = "Ugg"
	f_chat.role = Proto.Role.OWNER
	f_chat.text = "bye"

	return [
		Sample.new("hello", [hello]),
		Sample.new("ping", [ping]),
		Sample.new("ping_max", [ping_max]),
		Sample.new("move_to", [move]),
		Sample.new("move_to_extremes", [move_ext]),
		Sample.new("chat_say", [say]),
		Sample.new("welcome", [welcome]),
		Sample.new("pong", [pong]),
		Sample.new("path_started", [started]),
		Sample.new("path_stopped", [stopped]),
		Sample.new("entity_enter_still", [still]),
		Sample.new("entity_enter_moving", [moving]),
		Sample.new("entity_leave", [leave]),
		Sample.new("chat", [chat]),
		Sample.new("chat_long", [chat_long]),
		Sample.new("kick", [kick]),
		Sample.new("kick_misbehaving", [kick_misbehaving]),
		Sample.new("system_message", [system]),
		Sample.new("server_frame", [f_stopped, f_leave, f_chat]),
	]


func _encode_all(messages: Array[Proto.Message]) -> PackedByteArray:
	var w := Proto.Writer.new()
	for m in messages:
		assert_true(Proto.encode_into(w, m), "%s: %s" % [m.message_name(), w.error])
	return w.buf


func _decode_one(name: String, direction: Proto.Dir) -> Proto.Message:
	var got := Proto.decode(golden[name], direction)
	assert_eq(got.error, "", name)
	if got.messages.size() != 1:
		return null
	return got.messages[0]


func _frame(id: int, body: PackedByteArray) -> PackedByteArray:
	var w := Proto.Writer.new()
	w.buf.append(id)
	w.uvarint(body.size())
	w.buf.append_array(body)
	return w.buf


func _zeros(n: int) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(n)
	return b
