class_name WorldSelectScreen
extends Control
## The world list (GET /api/worlds), RuneScape-style: each world's name, how busy it is, and
## whether it's premium only (docs/design/worlds-and-premium.md). Join asks the API for a join
## ticket (POST /api/join) for the chosen character on that world.
##
## Premium-only worlds show why a player without Premium can't join, and their Join button is off.
## That's only a hint from the account's profile: the API decides with the account's fresh state,
## and the world checks the ticket again.

## The API gave a ticket: main opens the game on ws_url with it.
signal joined(ticket: String, ws_url: String, world: Dictionary)
## Go back to the character list, with a message if there's one to show there.
signal back_pressed(message: String)
## The API refused the login even after a refresh: main goes back to the landing page.
signal session_lost

## Players see the busy band, never the count (backend.md, "World status").
const BANDS := {"low": "Low", "medium": "Medium", "high": "High", "full": "Full"}
const PREMIUM_NOTE := "Premium members only. Premium comes with your Untitled Games account; this account doesn't have it."

## How a world's row looks.
class RowState:
	## The busy band ("Low" … "Full"), or "Offline".
	var band: String = ""
	var can_join: bool = true
	## Why it can't be joined, or "".
	var note: String = ""


## Where a join's answer sends the player.
enum Next {
	## In: open the game.
	ENTER,
	## Stay on the world list and say why.
	WORLDS,
	## The character is gone: back to the character list.
	CHARACTERS,
	## No session: back to the landing page.
	HOME,
}

var api: GameApi = null
var character: Dictionary = {}
var has_premium: bool = false
var worlds: Array[Dictionary] = []

var _busy: bool = false
var _join_buttons: Dictionary[int, Button] = {}

@onready var _title: Label = $Center/Panel/Box/Title
@onready var _rows: VBoxContainer = $Center/Panel/Box/Rows
@onready var _status: Label = $Center/Panel/Box/Status
@onready var _message: Label = $Center/Panel/Box/Message
@onready var _back: Button = $Center/Panel/Box/Buttons/Back
@onready var _refresh: Button = $Center/Panel/Box/Buttons/Refresh


func _ready() -> void:
	_back.pressed.connect(func() -> void: back_pressed.emit(""))
	_refresh.pressed.connect(func() -> void: load_worlds())


## Shows the worlds for this character. premium is the account's profile (Premium or staff), for
## the hint only. message (if any) explains why the player is back here.
func start(game_api: GameApi, chosen: Dictionary, premium: bool, message: String = "") -> void:
	api = game_api
	character = chosen
	has_premium = premium
	var n := JsonRead.text(chosen, "name")
	_title.text = "Choose a world for %s" % n if n != "" else "Choose a world"
	await load_worlds()
	if message != "":
		show_message(message)


func load_worlds() -> void:
	_set_busy(true)
	_status.text = "Loading the worlds…"
	_message.visible = false
	var reply := await api.worlds()
	_set_busy(false)
	if not reply.is_ok():
		_status.text = ""
		show_message(ApiText.explain(reply))
		return
	worlds.clear()
	for w: Variant in reply.list:
		if w is Dictionary:
			worlds.append(w as Dictionary)
	_status.text = ""
	_build_rows()


func show_message(text: String) -> void:
	_message.text = text
	_message.visible = text != ""


## Asks the API for a ticket to this world, and acts on the answer.
func join(world_id: int) -> void:
	if _busy:
		return
	var world := _world(world_id)
	_set_busy(true)
	_message.visible = false
	_status.text = "Joining %s…" % _world_name(world)
	var reply := await api.join(JsonRead.text(character, "id"), world_id)
	_set_busy(false)
	_status.text = ""
	match next_for(reply):
		Next.ENTER:
			joined.emit(JsonRead.text(reply.data, "ticket"), JsonRead.text(reply.data, "wsUrl"), world)
		Next.HOME:
			session_lost.emit()
		Next.CHARACTERS:
			back_pressed.emit(ApiText.explain(reply))
		Next.WORLDS:
			if reply.error in ["world_offline", "world_full", "unknown_world"]:
				await load_worlds()  # the list is out of date
			show_message(ApiText.explain(reply))


## The Join button for a world (tests).
func join_button(world_id: int) -> Button:
	return _join_buttons.get(world_id, null)


func message() -> String:
	return _message.text if _message.visible else ""


func _build_rows() -> void:
	for child in _rows.get_children():
		child.queue_free()
	_join_buttons.clear()
	for w in worlds:
		var state := row_state(w, has_premium)
		var card := PanelContainer.new()
		card.theme_type_variation = &"Card"
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		card.add_child(row)
		var text := VBoxContainer.new()
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(text)
		var title := HBoxContainer.new()
		title.add_theme_constant_override("separation", 8)
		text.add_child(title)
		var name_label := Label.new()
		name_label.text = _world_name(w)
		title.add_child(name_label)
		if w.get("premiumOnly") == true:
			var badge := Label.new()
			badge.theme_type_variation = &"BadgeLabel"
			badge.text = "Premium"
			title.add_child(badge)
		var note := state.note
		if note != "":
			var note_label := Label.new()
			note_label.theme_type_variation = &"HintLabel"
			note_label.text = note
			note_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			note_label.custom_minimum_size = Vector2(300, 0)
			text.add_child(note_label)
		var band := Label.new()
		band.text = state.band
		band.custom_minimum_size = Vector2(80, 0)
		band.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		band.tooltip_text = "How busy the world is"
		row.add_child(band)
		var button := Button.new()
		button.text = "Join"
		button.custom_minimum_size = Vector2(90, 36)
		button.disabled = not state.can_join
		var id := _world_id(w)
		button.pressed.connect(join.bind(id))
		row.add_child(button)
		_join_buttons[id] = button
		_rows.add_child(card)


func _set_busy(on: bool) -> void:
	_busy = on
	_back.disabled = on
	_refresh.disabled = on
	for id: int in _join_buttons:
		var b := _join_buttons[id]
		var state := row_state(_world(id), has_premium)
		b.disabled = on or not state.can_join


func _world(id: int) -> Dictionary:
	for w in worlds:
		if _world_id(w) == id:
			return w
	return {}


# ---------- Logic (static, tested on its own) ----------

## How a world's row looks. Offline and full worlds can't be joined; nor can premium-only worlds
## without Premium (the note says why).
static func row_state(world: Dictionary, premium: bool) -> RowState:
	var r := RowState.new()
	var online: bool = world.get("online") == true
	var population := JsonRead.text(world, "population")
	r.band = BANDS.get(population, "Unknown") if online else "Offline"
	if not online:
		r.can_join = false
		r.note = "Offline just now. Try again soon."
	elif population == "full":
		r.can_join = false
		r.note = "Full just now. Try again soon."
	if world.get("premiumOnly") == true and not premium:
		r.can_join = false
		r.note = PREMIUM_NOTE
	return r


## Where a join's answer sends the player.
static func next_for(reply: PlatformReply) -> Next:
	if reply.is_ok():
		return Next.ENTER
	if reply.status == 401:
		return Next.HOME
	if reply.error == "not_found":
		return Next.CHARACTERS
	return Next.WORLDS


static func _world_id(w: Dictionary) -> int:
	return JsonRead.whole(w, "id")


static func _world_name(w: Dictionary) -> String:
	return JsonRead.text(w, "name", "the world")
