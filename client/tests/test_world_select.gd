extends GutTest
## The world list (WorldSelectScreen) against a fake game API: busy bands, premium worlds, and
## where each answer to POST /api/join sends the player.

const FakeApi := preload("res://tests/helpers/fake_api_transport.gd")
const WORLDS := preload("res://screens/worlds/world_select.tscn")

const WORLD_1 := {"id": 1, "name": "World 1", "premiumOnly": false, "population": "low", "online": true}
const WORLD_2 := {"id": 2, "name": "World 2", "premiumOnly": true, "population": "medium", "online": true}
const GRUG := {"id": "c-1", "name": "Grug", "slot": 1, "appearance": {}}


func _screen(t: PlatformTransport, premium: bool) -> WorldSelectScreen:
	var s: WorldSelectScreen = WORLDS.instantiate()
	add_child_autofree(s)
	var api := GameApi.new(t, func() -> String: return "tok", func() -> bool: return false)
	s.start(api, GRUG, premium)
	return s


func _two_worlds() -> FakeApi:
	var t := FakeApi.new()
	t.on("GET /api/worlds", 200, [WORLD_1, WORLD_2])
	return t


func test_row_states() -> void:
	var free := WorldSelectScreen.row_state(WORLD_1, false)
	assert_eq(free.band, "Low")
	assert_true(free.can_join)
	assert_eq(free.note, "")
	var premium_no := WorldSelectScreen.row_state(WORLD_2, false)
	assert_eq(premium_no.band, "Medium")
	assert_false(premium_no.can_join)
	assert_eq(premium_no.note, WorldSelectScreen.PREMIUM_NOTE, "says why")
	var premium_yes := WorldSelectScreen.row_state(WORLD_2, true)
	assert_true(premium_yes.can_join)
	assert_eq(premium_yes.note, "")
	var offline := WorldSelectScreen.row_state({"id": 1, "online": false, "population": null}, true)
	assert_eq(offline.band, "Offline")
	assert_false(offline.can_join)
	var full := WorldSelectScreen.row_state({"id": 1, "online": true, "population": "full"}, true)
	assert_eq(full.band, "Full")
	assert_false(full.can_join)
	assert_eq(WorldSelectScreen.row_state({"online": true, "population": "high"}, false).band, "High")


func test_without_premium_the_premium_world_is_marked_and_off() -> void:
	var s := _screen(_two_worlds(), false)
	assert_eq(s.worlds.size(), 2)
	assert_false(s.join_button(1).disabled)
	assert_true(s.join_button(2).disabled)
	var rows: VBoxContainer = s.get_node("Center/Panel/Box/Rows")
	var texts := _texts(rows.get_child(1))
	assert_has(texts, "Premium", "the badge")
	assert_has(texts, WorldSelectScreen.PREMIUM_NOTE, "the reason")
	assert_has(texts, "Medium", "the busy band")
	assert_false(_texts(rows.get_child(0)).has("Premium"))


func test_with_premium_both_can_be_joined() -> void:
	var s := _screen(_two_worlds(), true)
	assert_false(s.join_button(1).disabled)
	assert_false(s.join_button(2).disabled)


func test_join_gets_a_ticket() -> void:
	var t := _two_worlds()
	t.on("POST /api/join", 200, {"ticket": "tk", "wsUrl": "wss://dinosaur.example/w/2"})
	var s := _screen(t, true)
	watch_signals(s)
	await s.join(2)
	assert_eq(t.last_body(), {"characterId": "c-1", "worldId": 2})
	assert_signal_emitted(s, "joined")
	var params: Array = get_signal_parameters(s, "joined")
	var tk: String = params[0]
	var url: String = params[1]
	assert_eq(tk, "tk")
	assert_eq(url, "wss://dinosaur.example/w/2")


func test_premium_refused_by_the_api_is_explained() -> void:
	# The profile can be out of date: the API's answer is what counts.
	var t := _two_worlds()
	t.on("POST /api/join", 403, {"error": "premium_required"})
	var s := _screen(t, true)
	watch_signals(s)
	await s.join(2)
	assert_signal_not_emitted(s, "joined")
	assert_string_contains(s.message(), "Premium members only")
	assert_false(s.join_button(1).disabled, "the player can pick another world")


func test_join_refusals_stay_on_the_list_with_a_reason() -> void:
	var cases := {
		"already_online": "still logged in",
		"world_offline": "offline",
		"world_full": "full",
		"banned": "banned",
		"unknown_world": "doesn't exist",
		"accounts_unavailable": "couldn't check your account",
	}
	for code: String in cases:
		var t := _two_worlds()
		t.on("POST /api/join", 409, {"error": code})
		var s := _screen(t, true)
		watch_signals(s)
		await s.join(1)
		var want: String = cases[code]
		assert_string_contains(s.message(), want)
		assert_signal_not_emitted(s, "joined")
		assert_signal_not_emitted(s, "back_pressed")


func test_a_missing_character_goes_back_to_the_list() -> void:
	var t := _two_worlds()
	t.on("POST /api/join", 404, {"error": "not_found"})
	var s := _screen(t, true)
	watch_signals(s)
	await s.join(1)
	assert_signal_emitted(s, "back_pressed")


func test_no_session_goes_home() -> void:
	var t := _two_worlds()
	t.on("POST /api/join", 401, {"error": "unauthorized"})
	var s := _screen(t, true)
	watch_signals(s)
	await s.join(1)
	assert_signal_emitted(s, "session_lost")


func test_where_join_answers_lead() -> void:
	var cases := [[200, "", WorldSelectScreen.Next.ENTER], [401, "unauthorized", WorldSelectScreen.Next.HOME],
		[404, "not_found", WorldSelectScreen.Next.CHARACTERS], [403, "premium_required", WorldSelectScreen.Next.WORLDS],
		[503, "world_offline", WorldSelectScreen.Next.WORLDS], [0, "", WorldSelectScreen.Next.WORLDS]]
	for c: Array in cases:
		var r := PlatformReply.new()
		var status: int = c[0]
		var code: String = c[1]
		r.finish(status, JSON.stringify({"error": code}) if code != "" else "{}")
		var want: WorldSelectScreen.Next = c[2]
		assert_eq(WorldSelectScreen.next_for(r), want, "%d %s" % [status, code])


func test_a_failed_list_says_why() -> void:
	var t := FakeApi.new()
	t.on("GET /api/worlds", 503, {"error": "unavailable"})
	var s := _screen(t, false)
	assert_string_contains(s.message(), "having trouble")


func _texts(node: Node) -> PackedStringArray:
	var out := PackedStringArray()
	for label in node.find_children("*", "Label", true, false):
		out.append((label as Label).text)
	return out
