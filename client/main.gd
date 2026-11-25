extends Node
## The game's entry scene. Reads the launch options (web query or desktop arguments), then:
## - on the deployed web page, checks the player's account session with the platform (the Session
##   autoload; no session goes back to the landing page), then shows the player's characters, the
##   world list, and joins the chosen world with a join ticket from the game API;
## - in a dev run (a name given, desktop or a local page), asks for a dev name if there isn't one
##   and joins with a dev ticket (the world must run with -dev-tickets).
## The Boot version check comes later.

const GAME_SCENE := preload("res://screens/game/game.tscn")
const NAME_SCENE := preload("res://screens/name_entry/name_entry.tscn")
const ACCOUNT_SCENE := preload("res://screens/account_check/account_check.tscn")
const CHARACTERS_SCENE := preload("res://screens/characters/character_select.tscn")
const CREATE_SCENE := preload("res://screens/characters/character_create.tscn")
const WORLDS_SCENE := preload("res://screens/worlds/world_select.tscn")

const TICKET_REFUSED := "The world didn't accept your join ticket. Please choose a world again."

var _options: LaunchOptions = null
var _screen: Node = null
## The character and world the player is joining or playing (platform session).
var _character: Dictionary = {}
var _world: Dictionary = {}


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


## Signed in on the platform: choose a character, then a world, then join it with a ticket from
## the game API (POST /api/join).
func _on_signed_in() -> void:
	_show_characters()


func _show_characters(message: String = "", select_id: String = "") -> void:
	var screen: CharacterSelectScreen = CHARACTERS_SCENE.instantiate()
	_swap(screen)
	screen.play_pressed.connect(_show_worlds.bind(""))
	screen.create_pressed.connect(_show_create)
	screen.session_lost.connect(Session.go_home)
	screen.home_pressed.connect(Session.go_home)
	screen.log_out_pressed.connect(Session.log_out)
	screen.start(Session.api, Session.platform.username(), message, select_id)


func _show_create(slot: int) -> void:
	var screen: CharacterCreateScreen = CREATE_SCENE.instantiate()
	_swap(screen)
	screen.created.connect(func(c: Dictionary) -> void: _show_characters("", JsonRead.text(c, "id")))
	screen.cancelled.connect(func() -> void: _show_characters())
	screen.session_lost.connect(Session.go_home)
	screen.start(Session.api, slot)


func _show_worlds(character: Dictionary, message: String) -> void:
	_character = character
	var screen: WorldSelectScreen = WORLDS_SCENE.instantiate()
	_swap(screen)
	screen.joined.connect(_enter_world)
	screen.back_pressed.connect(func(why: String) -> void: _show_characters(why, JsonRead.text(_character, "id")))
	screen.session_lost.connect(Session.go_home)
	screen.start(Session.api, character, Session.platform.has_premium(), message)


## The API gave a join ticket: open the game on that world with it.
func _enter_world(ticket: String, ws_url: String, world: Dictionary) -> void:
	_world = world
	_options.name = JsonRead.text(_character, "name")
	_options.server_url = ws_url
	_open_game(ticket, JsonRead.object(_character, "appearance"))


func _open_game(ticket: String = "", look: Dictionary = {}) -> void:
	var game: GameScreen = GAME_SCENE.instantiate()
	_swap(game)
	game.name_refused.connect(_ask_name)
	game.ticket_refused.connect(func(message: String) -> void:
		Net.close()
		_show_worlds(_character, message if message != "" else TICKET_REFUSED))
	game.rejoin_requested.connect(_rejoin.bind(game))
	game.leave_requested.connect(func() -> void:
		Net.close()
		_show_characters("", JsonRead.text(_character, "id")))
	game.log_out_requested.connect(func() -> void:
		Net.close()
		Session.log_out())
	game.start(_options, Net, ticket, look)


## Reconnecting after a drop or a world restart needs a new ticket: each one works only once.
func _rejoin(game: GameScreen) -> void:
	var reply := await Session.api.join(JsonRead.text(_character, "id"), JsonRead.whole(_world, "id"))
	if not is_instance_valid(game) or game != _screen:
		return  # The player has moved on.
	match WorldSelectScreen.next_for(reply):
		WorldSelectScreen.Next.ENTER:
			game.reconnect_with(JsonRead.text(reply.data, "wsUrl"), JsonRead.text(reply.data, "ticket"))
		WorldSelectScreen.Next.HOME:
			Session.go_home()
		_:
			game.show_rejoin_failed(ApiText.explain(reply))


func _swap(screen: Node) -> void:
	if _screen != null:
		_screen.queue_free()
	_screen = screen
	add_child(screen)
