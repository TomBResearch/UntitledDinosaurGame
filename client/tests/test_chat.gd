extends GutTest
## Local chat in the client: the chat log keeps the last 50 lines, bubbles last 5 seconds, and
## player text is always shown as plain text, never parsed as BBCode.

const CHAT_BOX := preload("res://ui/chat/chat_box.tscn")
const PLAYER := preload("res://entities/player/player_view.tscn")


func _line(i: int) -> ChatLog.Line:
	return ChatLog.Line.new("Ugg", "line %d" % i, Proto.Role.NORMAL, false)


func test_log_keeps_the_last_50_lines() -> void:
	var log := ChatLog.new()
	for i in 50:
		assert_false(log.add(_line(i)), "no trimming up to 50")
	assert_eq(log.size(), 50)
	assert_true(log.add(_line(50)), "the 51st line drops the oldest")
	assert_eq(log.size(), 50)
	assert_eq(log.lines[0].text, "line 1")
	assert_eq(log.lines[49].text, "line 50")
	for i in range(51, 200):
		log.add(_line(i))
	assert_eq(log.size(), 50)
	assert_eq(log.lines[0].text, "line 150")


func test_badges_and_system_text() -> void:
	assert_eq(ChatLog.badge(Proto.Role.NORMAL), "", "normal players have no badge")
	assert_eq(ChatLog.badge(Proto.Role.MODERATOR), "Mod")
	assert_ne(ChatLog.system_text(Proto.SystemKey.CHAT_MUTED), "")
	assert_true(ChatLog.Line.new("", "x", Proto.Role.NORMAL, false).is_system())


func test_bubble_shows_for_5_seconds() -> void:
	var b := SpeechBubble.new()
	add_child_autofree(b)
	assert_false(b.visible, "hidden until someone speaks")
	b.say("Rawr")
	assert_true(b.visible)
	assert_eq(b.text, "Rawr")
	assert_true(b.advance(4.9), "still up at 4.9 s")
	assert_false(b.advance(0.2), "gone after 5 s")
	assert_false(b.visible)
	assert_eq(b.text, "")
	assert_false(b.advance(1.0), "stays gone")


func test_a_new_line_replaces_the_bubble_and_restarts_it() -> void:
	var b := SpeechBubble.new()
	add_child_autofree(b)
	b.say("first")
	b.advance(4.0)
	b.say("second")
	assert_eq(b.text, "second")
	assert_true(b.advance(4.5), "the timer restarted")
	assert_false(b.advance(0.6))


func test_bubble_is_plain_text_and_wraps() -> void:
	var view: PlayerView = PLAYER.instantiate()
	add_child_autofree(view)
	view.say("[color=red]hi[/color]")
	var b := view.bubble()
	assert_eq(b.text, "[color=red]hi[/color]", "Label3D shows text as is")
	assert_true(b.visible)
	assert_ne(b.autowrap_mode, TextServer.AUTOWRAP_OFF, "long lines wrap")
	assert_gt(b.width, 0.0)


func test_chat_box_shows_bbcode_literally() -> void:
	var box: ChatBox = CHAT_BOX.instantiate()
	add_child_autofree(box)
	box.add_chat("Ugg", "[color=red]hi[/color]", Proto.Role.NORMAL, false)
	box.add_chat("Grok", "[url=https://example.com]click[/url] [img]res://icon.svg[/img]", Proto.Role.NORMAL, true)
	box.add_chat("Zog", "[b]x", Proto.Role.MODERATOR, false)
	box.add_system("You're muted.")
	assert_eq(box.shown_text(), "\n".join([
		"Ugg: [color=red]hi[/color]",
		"Grok: [url=https://example.com]click[/url] [img]res://icon.svg[/img]",
		"[Mod] Zog: [b]x",
		"You're muted.",
	]))


func test_chat_box_trims_to_50_lines() -> void:
	var box: ChatBox = CHAT_BOX.instantiate()
	add_child_autofree(box)
	for i in 60:
		box.add_chat("Ugg", "line %d" % i, Proto.Role.NORMAL, false)
	var shown := box.shown_text().split("\n")
	assert_eq(shown.size(), 50)
	assert_eq(shown[0], "Ugg: line 10")
	assert_eq(shown[49], "Ugg: line 59")


func test_input_is_capped_from_data() -> void:
	var box: ChatBox = CHAT_BOX.instantiate()
	add_child_autofree(box)
	assert_eq(box.input_max_length(), 120, "data/progression.json chat.max_chars")


func test_enter_sends_a_stripped_line_and_closes() -> void:
	var box: ChatBox = CHAT_BOX.instantiate()
	add_child_autofree(box)
	watch_signals(box)
	assert_false(box.is_open)
	box.open()
	assert_true(box.is_open)
	box._input.text = "  hello there  "
	box._input.text_submitted.emit(box._input.text)
	assert_signal_emitted_with_parameters(box, "submitted", ["hello there"])
	assert_false(box.is_open)
	assert_eq(box._input.text, "", "the input is cleared")


func test_empty_line_sends_nothing() -> void:
	var box: ChatBox = CHAT_BOX.instantiate()
	add_child_autofree(box)
	watch_signals(box)
	box.open()
	box._input.text_submitted.emit("   ")
	assert_signal_not_emitted(box, "submitted")
	assert_false(box.is_open)


func test_escape_cancels() -> void:
	var box: ChatBox = CHAT_BOX.instantiate()
	add_child_autofree(box)
	watch_signals(box)
	box.open()
	box._input.text = "never mind"
	var esc := InputEventKey.new()
	esc.keycode = KEY_ESCAPE
	esc.pressed = true
	box._on_input_gui_input(esc)
	assert_false(box.is_open)
	assert_eq(box._input.text, "")
	assert_signal_not_emitted(box, "submitted")
