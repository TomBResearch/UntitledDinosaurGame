extends GutTest
## Where the game screen sends the player when the world refuses them or the connection drops:
## with a platform session, back to the world list or a fresh ticket; in a dev run, the name box
## or a plain reconnect.

const GAME := preload("res://screens/game/game.tscn")


func _game(platform: bool) -> GameScreen:
	var g: GameScreen = GAME.instantiate()
	add_child_autofree(g)
	g.options = LaunchOptions.new()
	g.options.use_platform = platform
	watch_signals(g)
	return g


func test_a_refused_join_ticket_goes_back_to_the_world_list() -> void:
	var g := _game(true)
	g._on_kicked(Proto.KickReason.BAD_TICKET)
	assert_signal_emitted(g, "ticket_refused")
	assert_signal_not_emitted(g, "name_refused")


func test_a_refused_dev_name_goes_back_to_the_name_box() -> void:
	var g := _game(false)
	g._on_kicked(Proto.KickReason.BAD_TICKET)
	assert_signal_emitted(g, "name_refused")
	assert_signal_not_emitted(g, "ticket_refused")


func test_reconnecting_with_a_platform_session_asks_for_a_new_ticket() -> void:
	var g := _game(true)
	g._reconnect()
	assert_signal_emitted(g, "rejoin_requested", "a join ticket works once, so main fetches another")


func test_a_failed_rejoin_offers_the_world_list() -> void:
	var g := _game(true)
	g.show_rejoin_failed("That world is full.")
	var button: Button = g.get_node("Hud/Overlay/Panel/Box/Button")
	assert_eq(button.text, "Choose a world")
	button.pressed.emit()
	assert_signal_emitted_with_parameters(g, "ticket_refused", ["That world is full."])
