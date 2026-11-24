extends Node
## Placeholder boot scene. Replaced by the Boot screen (version check, then login) in M0.


func _ready() -> void:
	print("Untitled Dinosaur Game client %s" % ProjectSettings.get_setting("application/config/version"))
