class_name CharacterSelectScreen
extends Control
## Your characters, after the platform session check: three slots, each a character or empty.
## Pick one to see them turn in the preview; Play goes on to the world list. An empty slot opens
## the creation screen. Rename and Delete open a small dialog each.
##
## Everything comes from the game API (GameApi) and every refusal is shown in plain words
## (ApiText). The API decides; this screen asks and shows the answer.

## Play with this character: main shows the world list.
signal play_pressed(character: Dictionary)
## Create a character in this empty slot.
signal create_pressed(slot: int)
## The API refused the login even after a refresh: main goes back to the landing page.
signal session_lost
signal home_pressed
signal log_out_pressed

## How many character slots an account has (the API's Slots; it refuses any other).
const SLOTS := 3

enum DialogMode { NONE, RENAME, DELETE }

var api: GameApi = null
## Slot -> character (the API's JSON), for the slots that have one.
var characters: Dictionary[int, Dictionary] = {}
var selected_slot: int = 1
var dialog_mode: DialogMode = DialogMode.NONE

var _busy: bool = false
var _slot_buttons: Array[Button] = []

@onready var _preview: CavemanPreview = $Center/Columns/Preview
@onready var _account: Label = $Center/Columns/Panel/Box/Account
@onready var _slots: VBoxContainer = $Center/Columns/Panel/Box/Slots
@onready var _details: Label = $Center/Columns/Panel/Box/Details
@onready var _play: Button = $Center/Columns/Panel/Box/Actions/Play
@onready var _rename: Button = $Center/Columns/Panel/Box/Actions/Rename
@onready var _delete: Button = $Center/Columns/Panel/Box/Actions/Delete
@onready var _message: Label = $Center/Columns/Panel/Box/Message
@onready var _reload: Button = $Center/Columns/Panel/Box/Footer/Reload
@onready var _home: Button = $Center/Columns/Panel/Box/Footer/Home
@onready var _log_out: Button = $Center/Columns/Panel/Box/Footer/LogOut
@onready var _dialog: Control = $Dialog
@onready var _dialog_title: Label = $Dialog/Center/Panel/Box/Title
@onready var _dialog_text: Label = $Dialog/Center/Panel/Box/Text
@onready var _dialog_field: LineEdit = $Dialog/Center/Panel/Box/Field
@onready var _dialog_hint: Label = $Dialog/Center/Panel/Box/Hint
@onready var _dialog_message: Label = $Dialog/Center/Panel/Box/Message
@onready var _dialog_cancel: Button = $Dialog/Center/Panel/Box/Buttons/Cancel
@onready var _dialog_confirm: Button = $Dialog/Center/Panel/Box/Buttons/Confirm


func _ready() -> void:
	var group := ButtonGroup.new()
	for slot in range(1, SLOTS + 1):
		var b := Button.new()
		b.theme_type_variation = &"SlotButton"
		b.toggle_mode = true
		b.button_group = group
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.custom_minimum_size = Vector2(0, 56)
		b.pressed.connect(_on_slot_pressed.bind(slot))
		_slots.add_child(b)
		_slot_buttons.append(b)
	_play.pressed.connect(_on_play)
	_rename.pressed.connect(open_rename)
	_delete.pressed.connect(open_delete)
	_reload.pressed.connect(func() -> void: load_characters())
	_home.pressed.connect(func() -> void: home_pressed.emit())
	_log_out.pressed.connect(func() -> void: log_out_pressed.emit())
	_dialog_cancel.pressed.connect(close_dialog)
	_dialog_confirm.pressed.connect(func() -> void: confirm_dialog())
	_dialog_field.text_changed.connect(func(_t: String) -> void: _update_dialog())
	_dialog_field.text_submitted.connect(func(_t: String) -> void:
		if not _dialog_confirm.disabled:
			confirm_dialog())
	_refresh_view()


## Shows the account's characters. message (if any) is shown once they've loaded, for example why
## the player was sent back here. select_id picks that character.
func start(game_api: GameApi, username: String, message: String = "", select_id: String = "") -> void:
	api = game_api
	_account.text = "Logged in as %s" % username if username != "" else ""
	await load_characters(select_id)
	if message != "":
		show_message(message)


## Asks the API for the characters again.
func load_characters(select_id: String = "") -> void:
	_set_busy(true)
	_details.text = "Loading your characters…"
	_message.visible = false
	_reload.visible = false
	var reply := await api.characters()
	_set_busy(false)
	if reply.status == 401:
		session_lost.emit()
		return
	if not reply.is_ok():
		characters.clear()
		_refresh_view()
		_details.text = ""
		show_message(ApiText.explain(reply))
		_reload.visible = true
		return
	characters = by_slot(reply.list)
	selected_slot = _slot_of(select_id) if select_id != "" and _slot_of(select_id) > 0 else first_slot(characters)
	_refresh_view()


func show_message(text: String) -> void:
	_message.text = text
	_message.visible = text != ""


## The character in the selected slot, or {} for an empty one.
func selected() -> Dictionary:
	return _in_slot(selected_slot)


func _in_slot(slot: int) -> Dictionary:
	if characters.has(slot):
		return characters[slot]
	return {}


func select_slot(slot: int) -> void:
	selected_slot = clampi(slot, 1, SLOTS)
	_refresh_view()


func _on_slot_pressed(slot: int) -> void:
	if not characters.has(slot):
		create_pressed.emit(slot)
		_refresh_view()  # keep the highlight on the selected character
		return
	_message.visible = false
	select_slot(slot)


func _on_play() -> void:
	if not selected().is_empty():
		play_pressed.emit(selected())


# ---------- Rename and delete ----------

## Opens the rename dialog for the selected character.
func open_rename() -> void:
	var c := selected()
	if c.is_empty():
		return
	dialog_mode = DialogMode.RENAME
	_dialog_title.text = "Rename %s" % _name_of(c)
	_dialog_text.text = "Pick a new name. You can rename a character once every 30 days, and nobody else can take the old name for 30 days."
	_dialog_hint.text = "Names are " + ApiText.NAME_RULES
	_dialog_field.text = _name_of(c)
	_dialog_field.placeholder_text = "New name"
	_dialog_confirm.text = "Rename"
	var wait := rename_wait_text(c)
	_open_dialog(wait)
	_dialog_field.editable = wait == ""


## Opens the delete dialog for the selected character.
func open_delete() -> void:
	var c := selected()
	if c.is_empty():
		return
	dialog_mode = DialogMode.DELETE
	_dialog_title.text = "Delete %s?" % _name_of(c)
	_dialog_text.text = "This deletes %s and everything they have, for good. You can't undo it." % _name_of(c)
	_dialog_hint.text = "Type the character's name to confirm."
	_dialog_field.text = ""
	_dialog_field.placeholder_text = _name_of(c)
	_dialog_confirm.text = "Delete"
	_dialog_field.editable = true
	_open_dialog("")


func close_dialog() -> void:
	dialog_mode = DialogMode.NONE
	_dialog.visible = false


## Sends the dialog's rename or delete. The API checks it; its refusal is shown in the dialog.
func confirm_dialog() -> void:
	var c := selected()
	if c.is_empty() or _busy:
		return
	var id := _id_of(c)
	var text := _dialog_field.text.strip_edges()
	_set_busy(true)
	var reply: PlatformReply
	var mode := dialog_mode
	if mode == DialogMode.RENAME:
		reply = await api.rename_character(id, text)
	else:
		reply = await api.delete_character(id, text)
	_set_busy(false)
	if reply.status == 401:
		session_lost.emit()
		return
	if not reply.is_ok():
		_dialog_message.text = ApiText.explain(reply)
		_dialog_message.visible = true
		_update_dialog()
		return
	close_dialog()
	if mode == DialogMode.RENAME:
		characters[selected_slot] = reply.data
		_refresh_view()
		show_message("")
	else:
		await load_characters()


## The dialog field's text (tests).
func dialog_field() -> LineEdit:
	return _dialog_field


func dialog_confirm_button() -> Button:
	return _dialog_confirm


func _open_dialog(message: String) -> void:
	_dialog_message.text = message
	_dialog_message.visible = message != ""
	_dialog.visible = true
	_update_dialog()
	_dialog_field.grab_focus.call_deferred()


func _update_dialog() -> void:
	var c := selected()
	var text := _dialog_field.text.strip_edges()
	var ok := false
	match dialog_mode:
		DialogMode.RENAME:
			ok = text != "" and text != _name_of(c) and _dialog_field.editable
		DialogMode.DELETE:
			ok = delete_confirmed(text, _name_of(c))
	_dialog_confirm.disabled = not ok or _busy


# ---------- Drawing ----------

func _refresh_view() -> void:
	for slot in range(1, SLOTS + 1):
		var b := _slot_buttons[slot - 1]
		b.text = slot_label(slot, _in_slot(slot))
		b.set_pressed_no_signal(slot == selected_slot and characters.has(slot))
		b.disabled = _busy
	var c := selected()
	var has := not c.is_empty()
	_preview.show_look(_look_of(c) if has else {})
	_details.text = details_text(c) if has else ("You have no characters yet. Pick an empty slot to make one." if characters.is_empty() else "")
	_play.disabled = not has or _busy
	_rename.disabled = not has or _busy
	_delete.disabled = not has or _busy
	_home.disabled = _busy
	_log_out.disabled = _busy


func _set_busy(on: bool) -> void:
	_busy = on
	_refresh_view()
	if dialog_mode != DialogMode.NONE:
		_update_dialog()


func _slot_of(id: String) -> int:
	for slot: int in characters:
		if _id_of(characters[slot]) == id:
			return slot
	return 0


# ---------- Logic (static, tested on its own) ----------

## The API's character list by slot. Anything without a slot from 1 to SLOTS is ignored.
static func by_slot(list: Array) -> Dictionary[int, Dictionary]:
	var out: Dictionary[int, Dictionary] = {}
	for item: Variant in list:
		if not item is Dictionary:
			continue
		var c: Dictionary = item
		var slot := JsonRead.whole(c, "slot")
		if slot >= 1 and slot <= SLOTS:
			out[slot] = c
	return out


## The slot to select first: the first with a character, or 1.
static func first_slot(chars: Dictionary[int, Dictionary]) -> int:
	for slot in range(1, SLOTS + 1):
		if chars.has(slot):
			return slot
	return 1


## A slot button's text.
static func slot_label(slot: int, c: Dictionary) -> String:
	if c.is_empty():
		return "Slot %d · Empty: make a new character" % slot
	var text := "%s\nTotal level %d" % [_name_of(c), JsonRead.whole(c, "totalLevel")]
	if c.get("online") == true:
		text += " · in a world now"
	return text


## The line under the slots for a character.
static func details_text(c: Dictionary) -> String:
	var when := ApiText.date_text(JsonRead.text(c, "lastPlayedAt"))
	var parts: PackedStringArray = []
	parts.append("Last played %s." % when if when != "" else "Not played yet.")
	parts.append("Wears a pelt loincloth.")
	return " ".join(parts)


## Why the character can't be renamed yet ("" if he can), from the API's nextRenameAt.
static func rename_wait_text(c: Dictionary) -> String:
	var when := ApiText.date_text(JsonRead.text(c, "nextRenameAt"))
	return "%s was renamed recently. You can rename them again on %s." % [_name_of(c), when] if when != "" else ""


## Whether the typed name matches, so the Delete button can be pressed. Any case, like the API.
static func delete_confirmed(typed: String, char_name: String) -> bool:
	return char_name != "" and typed.strip_edges().to_lower() == char_name.to_lower()


static func _name_of(c: Dictionary) -> String:
	return JsonRead.text(c, "name")


static func _id_of(c: Dictionary) -> String:
	return JsonRead.text(c, "id")


static func _look_of(c: Dictionary) -> Dictionary:
	return JsonRead.object(c, "appearance")
