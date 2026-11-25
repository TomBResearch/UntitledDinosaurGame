class_name ChatLog
extends RefCounted
## The chat box's lines, newest last, trimmed to the last MAX_LINES. Pure data, so it's tested
## without a scene. The text is kept exactly as the server sent it: the chat box shows it as plain
## text, never as BBCode.

## How many lines the chat box keeps.
const MAX_LINES := 50


## One line in the chat box.
class Line:
	extends RefCounted
	## The speaker's name, or "" for a game message (system_message).
	var name: String = ""
	var text: String = ""
	var role: Proto.Role = Proto.Role.NORMAL
	## The line is from you.
	var is_self: bool = false

	func _init(line_name: String, line_text: String, line_role: Proto.Role, self_line: bool) -> void:
		name = line_name
		text = line_text
		role = line_role
		is_self = self_line

	func is_system() -> bool:
		return name == ""


var max_lines: int = MAX_LINES
var lines: Array[Line] = []


## Adds a line. Returns true if the oldest line was dropped to make room.
func add(line: Line) -> bool:
	lines.append(line)
	if lines.size() <= max_lines:
		return false
	lines = lines.slice(lines.size() - max_lines)
	return true


func size() -> int:
	return lines.size()


func clear() -> void:
	lines.clear()


## The badge shown before a name for the account role ("" for normal players).
static func badge(role: Proto.Role) -> String:
	match role:
		Proto.Role.PREMIUM:
			return "Premium"
		Proto.Role.MODERATOR:
			return "Mod"
		Proto.Role.ADMIN:
			return "Admin"
		Proto.Role.OWNER:
			return "Owner"
	return ""


## The English text for a system_message key. seconds is the message's countdown, for the keys
## that have one.
static func system_text(key: Proto.SystemKey, seconds: int = 0) -> String:
	match key:
		Proto.SystemKey.CHAT_MUTED:
			return "You're muted, so nobody heard that."
		Proto.SystemKey.IDLE_WARNING:
			return "You've been idle for a while. You'll be logged out in %s unless you do something." % duration_text(seconds)
		Proto.SystemKey.SHUTDOWN_WARNING:
			return "The world is restarting in %s. Your progress will be saved." % duration_text(seconds)
	return "(unknown game message %d)" % key


## A countdown in words: "1 minute", "2 minutes", "90 seconds", "1 second".
static func duration_text(seconds: int) -> String:
	if seconds >= 60 and seconds % 60 == 0:
		var minutes := seconds / 60
		return "1 minute" if minutes == 1 else "%d minutes" % minutes
	return "1 second" if seconds == 1 else "%d seconds" % seconds
