class_name SpeechBubble
extends Label3D
## A player's latest chat line, drawn over their head for SHOW_S seconds. Label3D never parses
## BBCode, so the line shows exactly as typed. A new line replaces the old one and restarts the
## timer. It's a child of the player's view, so it follows them and goes when they leave view.

## How long a line stays up.
const SHOW_S := 5.0

var _remaining_s: float = 0.0


func _ready() -> void:
	visible = _remaining_s > 0.0


## Shows a line, replacing any other.
func say(line: String) -> void:
	text = line
	_remaining_s = SHOW_S
	visible = true


## Counts down delta seconds. Returns whether the bubble is still showing.
func advance(delta: float) -> bool:
	if _remaining_s <= 0.0:
		return false
	_remaining_s -= delta
	if _remaining_s <= 0.0:
		_remaining_s = 0.0
		visible = false
		text = ""
	return _remaining_s > 0.0


func is_showing() -> bool:
	return _remaining_s > 0.0


func _process(delta: float) -> void:
	advance(delta)
