class_name ChatBox
extends Control
## The chat box at the bottom left: the last ChatLog.MAX_LINES lines, and a one-line input.
## Enter opens the input, Enter sends, Escape cancels. While it's open, keys go to the input
## (the camera ignores the arrow keys) but clicks on the game still walk.
##
## Player text is only ever added with RichTextLabel.add_text, which never parses BBCode, so
## "[color=red]hi[/color]" shows exactly as typed. The server is the judge of what may be said;
## the input's length cap (chat.max_chars from data/) is only a convenience.

## A line to send. Already stripped, never empty.
signal submitted(text: String)

const DATA_PATH := "res://data/progression.json"
const NAME_COLOR := Color(0.55, 0.82, 1.0)
const SELF_NAME_COLOR := Color(1.0, 0.9, 0.45)
const BADGE_COLOR := Color(1.0, 0.6, 0.3)
const SYSTEM_COLOR := Color(1.0, 0.55, 0.5)

var chat_log := ChatLog.new()
var is_open: bool = false

@onready var _view: RichTextLabel = $Panel/Box/Log
@onready var _input: LineEdit = $Panel/Box/Input
@onready var _hint: Label = $Panel/Box/Hint


func _ready() -> void:
	_input.max_length = max_chars_from_data()
	_input.text_submitted.connect(_on_text_submitted)
	_input.gui_input.connect(_on_input_gui_input)
	_input.focus_exited.connect(_on_input_focus_exited)
	close()


## The longest line the server accepts, in characters (code points, like Godot's String).
static func max_chars_from_data() -> int:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(DATA_PATH))
	assert(parsed is Dictionary, "Missing %s: run tools/check.sh (it generates client data)" % DATA_PATH)
	var chat: Dictionary = (parsed as Dictionary)["chat"]
	var max_chars: float = chat["max_chars"]
	return roundi(max_chars)


## Adds a player's line.
func add_chat(speaker: String, text: String, role: Proto.Role, from_self: bool) -> void:
	_add(ChatLog.Line.new(speaker, text, role, from_self))


## Adds a line of game text (system_message).
func add_system(text: String) -> void:
	_add(ChatLog.Line.new("", text, Proto.Role.NORMAL, false))


## What the log shows, as plain text (for tests).
func shown_text() -> String:
	return _view.get_parsed_text()


func input_max_length() -> int:
	return _input.max_length


func open() -> void:
	is_open = true
	_hint.visible = false
	_input.visible = true
	_input.grab_focus()


func close() -> void:
	is_open = false
	_input.clear()
	_input.visible = false
	_hint.visible = true
	_input.release_focus()


func _unhandled_key_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if is_open or key == null or not key.pressed or key.echo:
		return
	if key.keycode == KEY_ENTER or key.keycode == KEY_KP_ENTER:
		open()
		get_viewport().set_input_as_handled()


func _on_text_submitted(text: String) -> void:
	var line := text.strip_edges()
	close()
	if line != "":
		submitted.emit(line)


func _on_input_gui_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key != null and key.pressed and key.keycode == KEY_ESCAPE:
		close()
		_input.accept_event()


## A click on the game takes the keyboard focus away; while the input is open, take it back, so
## typing carries on going to the input (and the arrow keys don't turn the camera).
func _on_input_focus_exited() -> void:
	if is_open:
		_input.grab_focus.call_deferred()


func _add(line: ChatLog.Line) -> void:
	if chat_log.add(line):
		_redraw()
	else:
		_draw_line(line, chat_log.size() == 1)


func _redraw() -> void:
	_view.clear()
	for i in chat_log.size():
		_draw_line(chat_log.lines[i], i == 0)


func _draw_line(line: ChatLog.Line, first: bool) -> void:
	if not first:
		_view.newline()
	if line.is_system():
		_view.push_color(SYSTEM_COLOR)
		_view.add_text(line.text)
		_view.pop()
		return
	var badge := ChatLog.badge(line.role)
	if badge != "":
		_view.push_color(BADGE_COLOR)
		_view.add_text("[%s] " % badge)
		_view.pop()
	_view.push_color(SELF_NAME_COLOR if line.is_self else NAME_COLOR)
	_view.add_text(line.name + ": ")
	_view.pop()
	_view.add_text(line.text)
