extends GutTest
## Appearance choices from data/appearance.json (AppearanceCatalog) and the caveman drawn from them
## (CavemanModel).

const CAVEMAN := preload("res://entities/player/caveman.tscn")
const PLAYER := preload("res://entities/player/player_view.tscn")


func _catalog() -> AppearanceCatalog:
	return AppearanceCatalog.shared()


func test_every_part_has_choices_and_the_default_is_one_of_them() -> void:
	var c := _catalog()
	for part in AppearanceCatalog.PARTS:
		assert_gt(c.choices(part).size(), 0, "%s has choices" % part)
		assert_ne(c.name_of(part, JsonRead.text(c.default_look, part)), "", "the default %s is listed" % part)


func test_resolve_fills_in_unknown_and_missing_parts() -> void:
	var c := _catalog()
	var look := c.resolve({"bodyType": "broad", "skinTone": "plaid"})
	assert_eq(JsonRead.text(look, "bodyType"), "broad")
	assert_eq(JsonRead.text(look, "skinTone"), JsonRead.text(c.default_look, "skinTone"))
	assert_eq(JsonRead.text(look, "beard"), JsonRead.text(c.default_look, "beard"))
	assert_eq(look.size(), 5)


func test_step_goes_round() -> void:
	var c := _catalog()
	var tones := c.ids("skinTone")
	var look := c.resolve({"skinTone": tones[0]})
	var back := c.step(look, "skinTone", -1)
	assert_eq(JsonRead.text(back, "skinTone"), tones[-1], "back from the first wraps to the last")
	var round := look
	for i in tones.size():
		round = c.step(round, "skinTone", 1)
	assert_eq(round, look, "all the way round, and other parts stay")


func test_random_looks_are_made_of_listed_choices() -> void:
	var c := _catalog()
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 20:
		var look := c.random_look(rng)
		assert_eq(c.resolve(look), look)


func test_colours_and_sizes_come_from_data() -> void:
	var c := _catalog()
	assert_eq(c.colour_of("hairColour", "black"), Color.html("#1c1714"))
	assert_eq(c.colour_of("hairColour", "nope"), Color.WHITE)
	assert_eq(c.body_scale("broad"), Vector2(1.2, 0.97))
	assert_eq(c.body_scale("nope"), Vector2.ONE)


func test_the_caveman_shows_a_look() -> void:
	var c := _catalog()
	var model: CavemanModel = CAVEMAN.instantiate()
	add_child_autofree(model)
	model.apply({"bodyType": "broad", "skinTone": "tone_6", "hairStyle": "topknot", "hairColour": "grey", "beard": "long"})
	assert_eq(model.showing("hair"), "topknot")
	assert_eq(model.showing("beard"), "long")
	assert_eq(model.skin_colour(), c.colour_of("skinTone", "tone_6"))
	assert_eq(model.hair_colour(), c.colour_of("hairColour", "grey"))
	assert_almost_eq(model.scale.y, 0.97, 0.001)
	var body: Node3D = model.get_node("Body")
	assert_almost_eq(body.scale.x, 1.2, 0.001)
	assert_true((model.get_node("Loincloth") as Node3D).visible, "the starting pelt loincloth")
	model.apply({"hairStyle": "bald", "beard": "none"})
	assert_eq(model.showing("hair"), "bald")
	assert_eq(model.showing("beard"), "none")


func test_every_hair_style_and_beard_has_a_piece() -> void:
	var c := _catalog()
	var model: CavemanModel = CAVEMAN.instantiate()
	add_child_autofree(model)
	for id in c.ids("hairStyle"):
		assert_not_null(model.get_node_or_null("Hair/" + id), "hair style %s has a node" % id)
	for id in c.ids("beard"):
		assert_not_null(model.get_node_or_null("Beard/" + id), "beard %s has a node" % id)


func test_a_look_applied_before_the_model_is_ready_still_shows() -> void:
	var model: CavemanModel = CAVEMAN.instantiate()
	model.apply({"hairStyle": "long", "beard": "stubble"})
	add_child_autofree(model)
	assert_eq(model.showing("hair"), "long")
	assert_eq(model.showing("beard"), "stubble")


func _enter(look: Proto.Look) -> Proto.EntityEnter:
	var e := Proto.EntityEnter.new()
	e.entity = 7
	e.kind = Proto.EntityKind.PLAYER
	e.name = "Grug"
	e.look = look
	return e


func test_other_players_are_drawn_with_their_own_look() -> void:
	var l := Proto.Look.new()
	l.body_type = "lean"
	l.skin_tone = "tone_5"
	l.hair_style = "long"
	l.hair_colour = "auburn"
	l.beard = "stubble"
	var view: PlayerView = PLAYER.instantiate()
	view.setup(_enter(l), 20, false)
	add_child_autofree(view)
	var model := view.model()
	assert_eq(model.showing("hair"), "long")
	assert_eq(model.showing("beard"), "stubble")
	assert_eq(model.skin_colour(), _catalog().colour_of("skinTone", "tone_5"))
	assert_eq(model.look, PlayerView.look_of(l))


func test_a_player_without_a_look_is_drawn_with_the_default() -> void:
	var view: PlayerView = PLAYER.instantiate()
	add_child_autofree(view)
	view.setup(_enter(null), 20, false)
	assert_eq(view.model().look, _catalog().default_look, "dev players")
	assert_eq(PlayerView.look_of(null), {})
