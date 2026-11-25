extends GutTest
## The character list (CharacterSelectScreen) and creation (CharacterCreateScreen) against a fake
## game API: what they ask for, and what they show for each answer.

const FakeApi := preload("res://tests/helpers/fake_api_transport.gd")
const SELECT := preload("res://screens/characters/character_select.tscn")
const CREATE := preload("res://screens/characters/character_create.tscn")

const LOOK := {"bodyType": "lean", "skinTone": "tone_2", "hairStyle": "long", "hairColour": "auburn", "beard": "none"}
const GRUG := {"id": "c-1", "name": "Grug", "slot": 1, "appearance": LOOK, "totalLevel": 14, "lastRegion": null,
		"lastPlayedAt": null, "online": false, "nextRenameAt": null}
const UGG := {"id": "c-3", "name": "Ugg", "slot": 3, "appearance": LOOK, "totalLevel": 20, "lastRegion": null,
		"lastPlayedAt": "2026-11-20T10:00:00Z", "online": false, "nextRenameAt": "2026-12-20T10:00:00Z"}

var _lost: int = 0


func before_each() -> void:
	_lost = 0


func _api(t: PlatformTransport) -> GameApi:
	return GameApi.new(t, func() -> String: return "tok", func() -> bool: return false)


func _select(t: PlatformTransport) -> CharacterSelectScreen:
	var s: CharacterSelectScreen = SELECT.instantiate()
	add_child_autofree(s)
	s.session_lost.connect(func() -> void: _lost += 1)
	s.start(_api(t), "raptor_fan")
	return s


## The name in the character a signal carried (JSON numbers come back as floats, so compare names).
func _emitted_name(obj: Object, sig: String) -> String:
	var params: Array = get_signal_parameters(obj, sig)
	if params.is_empty() or not params[0] is Dictionary:
		return ""
	var c: Dictionary = params[0]
	return JsonRead.text(c, "name")


# ---------- Character list ----------

func test_lists_characters_by_slot() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 200, [UGG, GRUG])
	var s := _select(t)
	assert_eq(s.characters.keys(), [3, 1])
	assert_eq(s.selected_slot, 1, "the first slot with a character")
	assert_eq(JsonRead.text(s.selected(), "name"), "Grug")
	var preview: CavemanPreview = s.get_node("Center/Columns/Preview")
	assert_true(preview.caveman().visible)
	assert_eq(preview.caveman().look, LOOK)


func test_slot_labels_and_details() -> void:
	assert_eq(CharacterSelectScreen.slot_label(2, {}), "Slot 2 · Empty: make a new character")
	assert_eq(CharacterSelectScreen.slot_label(1, GRUG), "Grug\nTotal level 14")
	var online := GRUG.duplicate()
	online["online"] = true
	assert_string_contains(CharacterSelectScreen.slot_label(1, online), "in a world now")
	assert_string_contains(CharacterSelectScreen.details_text(GRUG), "Not played yet")
	assert_string_contains(CharacterSelectScreen.details_text(UGG), "20 November 2026")
	assert_string_contains(CharacterSelectScreen.details_text(GRUG), "pelt loincloth")


func test_by_slot_ignores_junk() -> void:
	var got := CharacterSelectScreen.by_slot([GRUG, {"slot": 9}, "x", {"name": "no slot"}])
	assert_eq(got.keys(), [1])


func test_no_characters() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 200, [])
	var s := _select(t)
	assert_true(s.selected().is_empty())
	assert_true((s.get_node("Center/Columns/Panel/Box/Actions/Play") as Button).disabled)
	var preview: CavemanPreview = s.get_node("Center/Columns/Preview")
	assert_false(preview.caveman().visible)


func test_play_and_create() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 200, [GRUG])
	var s := _select(t)
	watch_signals(s)
	(s.get_node("Center/Columns/Panel/Box/Actions/Play") as Button).pressed.emit()
	assert_eq(_emitted_name(s, "play_pressed"), "Grug")
	var slot2: Button = s.get_node("Center/Columns/Panel/Box/Slots").get_child(1)
	slot2.pressed.emit()
	assert_signal_emitted_with_parameters(s, "create_pressed", [2])


func test_a_failed_list_shows_why_with_try_again() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 503, {"error": "unavailable"})
	var s := _select(t)
	var msg: Label = s.get_node("Center/Columns/Panel/Box/Message")
	assert_true(msg.visible)
	assert_string_contains(msg.text, "having trouble")
	assert_true((s.get_node("Center/Columns/Panel/Box/Footer/Reload") as Button).visible)


func test_no_session_goes_home() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 401, {"error": "unauthorized"})
	_select(t)
	assert_eq(_lost, 1)


func test_rename() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 200, [GRUG])
	var renamed := GRUG.duplicate()
	renamed["name"] = "Grugg"
	t.on("PATCH /api/characters/c-1", 409, {"error": "name_taken"})
	t.on("PATCH /api/characters/c-1", 200, renamed)
	var s := _select(t)
	s.open_rename()
	var field := s.dialog_field()
	assert_eq(field.text, "Grug")
	assert_true(s.dialog_confirm_button().disabled, "the same name can't be sent")
	field.text = "Grugg"
	field.text_changed.emit("Grugg")
	assert_false(s.dialog_confirm_button().disabled)
	await s.confirm_dialog()
	assert_eq(t.last_body(), {"name": "Grugg"})
	var dialog_msg: Label = s.get_node("Dialog/Center/Panel/Box/Message")
	assert_string_contains(dialog_msg.text, "taken", "the API's refusal shows in the dialog")
	assert_eq(s.dialog_mode, CharacterSelectScreen.DialogMode.RENAME)
	await s.confirm_dialog()
	assert_eq(s.dialog_mode, CharacterSelectScreen.DialogMode.NONE)
	assert_eq(JsonRead.text(s.selected(), "name"), "Grugg")


func test_rename_too_soon_is_explained_before_trying() -> void:
	assert_eq(CharacterSelectScreen.rename_wait_text(GRUG), "")
	assert_string_contains(CharacterSelectScreen.rename_wait_text(UGG), "20 December 2026")
	var t := FakeApi.new()
	t.on("GET /api/characters", 200, [UGG])
	var s := _select(t)
	s.open_rename()
	assert_false(s.dialog_field().editable)
	assert_true(s.dialog_confirm_button().disabled)


func test_delete_needs_the_name_typed() -> void:
	assert_true(CharacterSelectScreen.delete_confirmed(" grug ", "Grug"), "any case, like the API")
	assert_false(CharacterSelectScreen.delete_confirmed("Gru", "Grug"))
	assert_false(CharacterSelectScreen.delete_confirmed("", ""))
	var t := FakeApi.new()
	t.on("GET /api/characters", 200, [GRUG])
	t.on("DELETE /api/characters/c-1", 409, {"error": "character_online"})
	t.on("DELETE /api/characters/c-1", 204)
	var s := _select(t)
	s.open_delete()
	var field := s.dialog_field()
	assert_eq(field.text, "")
	assert_true(s.dialog_confirm_button().disabled)
	field.text = "GRUG"
	field.text_changed.emit("GRUG")
	assert_false(s.dialog_confirm_button().disabled)
	await s.confirm_dialog()
	assert_eq(t.last_body(), {"confirmName": "GRUG"})
	var dialog_msg: Label = s.get_node("Dialog/Center/Panel/Box/Message")
	assert_string_contains(dialog_msg.text, "still logged in")
	t.on("GET /api/characters", 200, [])  # queued after [GRUG]: the reload after deleting
	await s.confirm_dialog()
	assert_eq(s.dialog_mode, CharacterSelectScreen.DialogMode.NONE)
	assert_eq(t.count("GET /api/characters"), 2, "the list is loaded again")
	assert_true(s.characters.is_empty())


# ---------- Creation ----------

func _create(t: PlatformTransport) -> CharacterCreateScreen:
	var s: CharacterCreateScreen = CREATE.instantiate()
	add_child_autofree(s)
	s.session_lost.connect(func() -> void: _lost += 1)
	s.start(_api(t), 2, null, 42)
	return s


func test_create_sends_name_slot_and_look() -> void:
	var t := FakeApi.new()
	t.on("POST /api/characters", 201, GRUG)
	var s := _create(t)
	watch_signals(s)
	assert_true(s.create_button().disabled, "no name yet")
	assert_eq(AppearanceCatalog.shared().resolve(s.look), s.look, "starts with a listed look")
	s.set_look(LOOK)
	s.step_part("beard", 1)
	var want := LOOK.duplicate()
	want["beard"] = "stubble"
	assert_eq(s.look, want)
	assert_eq(s.preview().caveman().look, want, "the preview follows")
	s.set_char_name("  Grug ")
	assert_false(s.create_button().disabled)
	await s.submit()
	assert_eq(t.last_body(), {"name": "Grug", "slot": 2, "appearance": want})
	assert_eq(_emitted_name(s, "created"), "Grug")


func test_create_refusals_are_shown() -> void:
	var cases := [
		[{"error": "invalid_name", "reason": "shape"}, 400, "3–12 letters"],
		[{"error": "invalid_name", "reason": "not_allowed"}, 400, "isn't allowed"],
		[{"error": "invalid_name", "reason": "reserved"}, 400, "reserved"],
		[{"error": "name_taken"}, 409, "taken"],
		[{"error": "slot_used"}, 409, "already has a character"],
		[{"error": "invalid_appearance"}, 400, "isn't available"],
		[{"error": "rate_limited"}, 429, "a lot of requests"],
	]
	for c: Array in cases:
		var t := FakeApi.new()
		var body: Dictionary = c[0]
		var status: int = c[1]
		var want: String = c[2]
		t.on("POST /api/characters", status, body)
		var s := _create(t)
		watch_signals(s)
		s.set_char_name("Grug")
		await s.submit()
		assert_string_contains(s.message(), want)
		assert_signal_not_emitted(s, "created")
		assert_false(s.create_button().disabled, "the player can try again")


func test_create_with_no_session_goes_home() -> void:
	var t := FakeApi.new()
	t.on("POST /api/characters", 401, {"error": "unauthorized"})
	var s := _create(t)
	s.set_char_name("Grug")
	await s.submit()
	assert_eq(_lost, 1)


func test_randomise_gives_listed_looks() -> void:
	var t := FakeApi.new()
	var s := _create(t)
	var randomise: Button = s.get_node("Center/Columns/Panel/Box/Randomise")
	for i in 5:
		randomise.pressed.emit()
		assert_eq(AppearanceCatalog.shared().resolve(s.look), s.look)
