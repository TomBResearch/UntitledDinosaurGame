class_name CharacterCreateScreen
extends Control
## Making a character in an empty slot: a name and a look (body type, skin tone, hair style, hair
## colour and beard, from data/appearance.json), with a turning preview. Every character starts in
## the pelt loincloth. The API checks the name and the look (POST /api/characters); a refusal is
## shown in plain words and the player can fix it and try again.

## The API made the character (its JSON).
signal created(character: Dictionary)
signal cancelled
## The API refused the login even after a refresh: main goes back to the landing page.
signal session_lost

var api: GameApi = null
var slot: int = 1
var look: Dictionary = {}
var catalog: AppearanceCatalog = null

var _busy: bool = false
var _rng := RandomNumberGenerator.new()
## Part -> the label showing its current choice.
var _values: Dictionary[String, Label] = {}

@onready var _preview: CavemanPreview = $Center/Columns/Preview
@onready var _title: Label = $Center/Columns/Panel/Box/Title
@onready var _name: LineEdit = $Center/Columns/Panel/Box/Name
@onready var _name_hint: Label = $Center/Columns/Panel/Box/NameHint
@onready var _parts: GridContainer = $Center/Columns/Panel/Box/Parts
@onready var _randomise: Button = $Center/Columns/Panel/Box/Randomise
@onready var _message: Label = $Center/Columns/Panel/Box/Message
@onready var _create: Button = $Center/Columns/Panel/Box/Buttons/Create
@onready var _back: Button = $Center/Columns/Panel/Box/Buttons/Back


func _ready() -> void:
	_name_hint.text = "Names are " + ApiText.NAME_RULES
	_name.text_changed.connect(func(_t: String) -> void: _update_buttons())
	_name.text_submitted.connect(func(_t: String) -> void:
		if not _create.disabled:
			submit())
	_randomise.pressed.connect(func() -> void: set_look(catalog.random_look(_rng)))
	_create.pressed.connect(func() -> void: submit())
	_back.pressed.connect(func() -> void: cancelled.emit())


## Opens the screen for an empty slot, with a random look. rng_seed is for tests.
func start(game_api: GameApi, empty_slot: int, appearance: AppearanceCatalog = null, rng_seed: int = -1) -> void:
	api = game_api
	slot = empty_slot
	catalog = appearance if appearance != null else AppearanceCatalog.shared()
	if rng_seed >= 0:
		_rng.seed = rng_seed
	else:
		_rng.randomize()
	_title.text = "New character · slot %d" % slot
	_build_parts()
	set_look(catalog.random_look(_rng))
	_update_buttons()
	_name.grab_focus.call_deferred()


func set_look(new_look: Dictionary) -> void:
	look = catalog.resolve(new_look)
	for part in AppearanceCatalog.PARTS:
		if _values.has(part):
			var id: String = look[part]
			_values[part].text = catalog.name_of(part, id)
	_preview.show_look(look)


## Moves one part of the look along (the < and > buttons).
func step_part(part: String, by: int) -> void:
	set_look(catalog.step(look, part, by))


func set_char_name(text: String) -> void:
	_name.text = text
	_update_buttons()


## Sends the character to the API.
func submit() -> void:
	if _busy:
		return
	_busy = true
	_message.visible = false
	_update_buttons()
	var reply := await api.create_character(_name.text.strip_edges(), slot, look)
	_busy = false
	_update_buttons()
	if reply.status == 401:
		session_lost.emit()
		return
	if reply.is_ok():
		created.emit(reply.data)
		return
	_message.text = ApiText.explain(reply)
	_message.visible = true
	if reply.error in ["invalid_name", "name_taken"]:
		_name.grab_focus()
		_name.select_all()


## The message shown (tests).
func message() -> String:
	return _message.text if _message.visible else ""


func create_button() -> Button:
	return _create


func preview() -> CavemanPreview:
	return _preview


func _build_parts() -> void:
	for child in _parts.get_children():
		child.queue_free()
	_values.clear()
	for part in AppearanceCatalog.PARTS:
		var label := Label.new()
		label.text = AppearanceCatalog.LABELS[part]
		label.custom_minimum_size = Vector2(110, 0)
		_parts.add_child(label)
		var prev := Button.new()
		prev.text = "<"
		prev.tooltip_text = "Previous %s" % label.text.to_lower()
		prev.pressed.connect(step_part.bind(part, -1))
		_parts.add_child(prev)
		var value := Label.new()
		value.custom_minimum_size = Vector2(130, 0)
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_parts.add_child(value)
		_values[part] = value
		var next := Button.new()
		next.text = ">"
		next.tooltip_text = "Next %s" % label.text.to_lower()
		next.pressed.connect(step_part.bind(part, 1))
		_parts.add_child(next)


func _update_buttons() -> void:
	_create.disabled = _busy or _name.text.strip_edges() == ""
	_randomise.disabled = _busy
	_back.disabled = _busy
