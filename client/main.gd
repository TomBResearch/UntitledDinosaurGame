extends Node
## The game's entry scene. Reads the launch options (web query or desktop arguments), then:
## - on the deployed web page, checks the player's account session with the platform (the Session
##   autoload; no session goes back to the landing page) and joins as the account's name;
## - in a dev run (a name given, desktop or a local page), asks for a dev name if there isn't one.
## Then it opens the game screen. Character select, world select and the Boot version check come
## later in M1.

const GAME_SCENE := preload("res://screens/game/game.tscn")
const NAME_SCENE := preload("res://screens/name_entry/name_entry.tscn")
const ACCOUNT_SCENE := preload("res://screens/account_check/account_check.tscn")

var _options: LaunchOptions = null
var _screen: Node = null


func _ready() -> void:
	print("Untitled Dinosaur Game client %s" % ProjectSettings.get_setting("application/config/version"))
	_options = LaunchOptions.from_environment()
	if _options.use_platform:
		_check_account()
	elif _options.name != "":
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


func _check_account() -> void:
	var screen: AccountCheckScreen = ACCOUNT_SCENE.instantiate()
	_swap(screen)
	screen.home_pressed.connect(Session.go_home)
	screen.retry_pressed.connect(func() -> void:
		screen.show_checking()
		_refresh_account(screen))
	_refresh_account(screen)


func _refresh_account(screen: AccountCheckScreen) -> void:
	var outcome: PlatformSession.Outcome = await Session.begin(_options)
	match outcome:
		PlatformSession.Outcome.SIGNED_IN:
			_on_signed_in()
		PlatformSession.Outcome.UNREACHABLE:
			screen.show_unreachable()
		PlatformSession.Outcome.NO_SESSION:
			pass  # Session is already taking the player to the landing page.


## Signed in on the platform. Until characters and join tickets (cmd/api) exist, the player joins
## with a dev ticket named after their account; if the world refuses that name, the name box opens.
## The join-ticket seam: ask /api for a ticket with Session.platform.access_token here.
func _on_signed_in() -> void:
	_options.name = PlatformSession.dev_name_for(Session.platform.username())
	_open_game()


func _open_game() -> void:
	var game: GameScreen = GAME_SCENE.instantiate()
	_swap(game)
	game.name_refused.connect(_ask_name)
	game.log_out_requested.connect(func() -> void:
		Net.close()
		Session.log_out())
	game.start(_options, Net)


func _swap(screen: Node) -> void:
	if _screen != null:
		_screen.queue_free()
	_screen = screen
	add_child(screen)
