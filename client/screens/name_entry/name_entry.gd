class_name NameEntryScreen
extends Control
## Asks for a dev name (until platform login in M1). Shown on desktop, and on the web when the
## page has no ?name= parameter or the server refused the name.

signal submitted(player_name: String)

@onready var _name: LineEdit = $Center/Panel/Box/Name
@onready var _error: Label = $Center/Panel/Box/Error
@onready var _enter: Button = $Center/Panel/Box/Enter


func _ready() -> void:
	_name.text_submitted.connect(func(_t: String) -> void: _submit())
	_enter.pressed.connect(_submit)
	_name.grab_focus()


## Pre-fills the box and shows a message (for example why the last name was refused).
func prepare(player_name: String, message: String) -> void:
	_name.text = player_name
	_error.text = message
	_error.visible = message != ""


func _submit() -> void:
	var n := _name.text.strip_edges()
	if n == "":
		prepare("", "Type a name first.")
		return
	submitted.emit(n)
