extends Node
## The game's entry scene. Reads the launch options (web query or desktop arguments), asks for a
## dev name if there isn't one, then opens the game screen. Platform login, world select and the
## Boot version check replace the name box in M1.

const GAME_SCENE := preload("res://screens/game/game.tscn")
const NAME_SCENE := preload("res://screens/name_entry/name_entry.tscn")

var _options: LaunchOptions = null
var _screen: Node = null


func _ready() -> void:
	print("Untitled Dinosaur Game client %s" % ProjectSettings.get_setting("application/config/version"))
	_options = LaunchOptions.from_environment()
	if _options.name != "":
		_open_game()
	else:
		_ask_name("")


func _ask_name(message: String) -> void:
	var screen: NameEntryScreen = NAME_SCENE.instantiate()
	_swap(screen)
	screen.prepare(_options.name, message)
	screen.submitted.connect(func(n: String) -> void:
		_options.name = n
		_open_game())


func _open_game() -> void:
	var game: GameScreen = GAME_SCENE.instantiate()
	_swap(game)
	game.name_refused.connect(_ask_name)
	game.start(_options, Net)


func _swap(screen: Node) -> void:
	if _screen != null:
		_screen.queue_free()
	_screen = screen
	add_child(screen)
