class_name AccountCheckScreen
extends Control
## Shown on the web while the game checks the player's account session with the platform, and if
## the platform can't be reached (with Try again). With no session the player is sent to the landing
## page instead, so this never asks for a login itself (ADR 0015).

signal retry_pressed
signal home_pressed

@onready var _message: Label = $Center/Panel/Box/Message
@onready var _retry: Button = $Center/Panel/Box/Buttons/Retry
@onready var _home: Button = $Center/Panel/Box/Buttons/Home


func _ready() -> void:
	_retry.pressed.connect(func() -> void: retry_pressed.emit())
	_home.pressed.connect(func() -> void: home_pressed.emit())
	show_checking()


func show_checking() -> void:
	_message.text = "Checking your account…"
	_retry.visible = false
	_home.visible = false


func show_unreachable() -> void:
	_message.text = "We couldn't reach the accounts server. Check your connection and try again."
	_retry.visible = true
	_home.visible = true
	_retry.grab_focus()
