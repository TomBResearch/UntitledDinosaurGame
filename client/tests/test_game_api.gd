extends GutTest
## The game API client (GameApi) and its plain-words errors (ApiText), with a fake transport.

const FakeApi := preload("res://tests/helpers/fake_api_transport.gd")

var _token: String = "tok-1"
var _refreshes: int = 0
var _refresh_works: bool = true


func before_each() -> void:
	_token = "tok-1"
	_refreshes = 0
	_refresh_works = true


func _api(t: PlatformTransport) -> GameApi:
	return GameApi.new(t, func() -> String: return _token, _refresh)


func _refresh() -> bool:
	_refreshes += 1
	if _refresh_works:
		_token = "tok-2"
	return _refresh_works


func test_routes_bodies_and_token() -> void:
	var t := FakeApi.new()
	var api := _api(t)
	api.worlds()
	api.characters()
	api.create_character("Grug", 2, {"bodyType": "lean"})
	api.rename_character("c-1", "Ugg")
	api.delete_character("c-1", "ugg")
	api.join("c-1", 2)
	assert_eq(t.requests, [
		{"method": "GET", "path": "/api/worlds", "body": {}, "bearer": ""},
		{"method": "GET", "path": "/api/characters", "body": {}, "bearer": "tok-1"},
		{"method": "POST", "path": "/api/characters", "body": {"name": "Grug", "slot": 2, "appearance": {"bodyType": "lean"}}, "bearer": "tok-1"},
		{"method": "PATCH", "path": "/api/characters/c-1", "body": {"name": "Ugg"}, "bearer": "tok-1"},
		{"method": "DELETE", "path": "/api/characters/c-1", "body": {"confirmName": "ugg"}, "bearer": "tok-1"},
		{"method": "POST", "path": "/api/join", "body": {"characterId": "c-1", "worldId": 2}, "bearer": "tok-1"},
	] as Array[Dictionary], "the world list needs no login; everything else sends the access token")


func test_lists_are_parsed() -> void:
	var t := FakeApi.new()
	t.on("GET /api/worlds", 200, [{"id": 1, "name": "World 1"}])
	var reply: PlatformReply = await _api(t).worlds()
	assert_true(reply.is_ok())
	assert_eq(reply.list.size(), 1)
	var first: Dictionary = reply.list[0]
	assert_eq(JsonRead.text(first, "name"), "World 1")


func test_a_401_refreshes_once_and_retries_with_the_new_token() -> void:
	var t := FakeApi.new()
	t.on("GET /api/characters", 401, {"error": "unauthorized"})
	t.on("GET /api/characters", 200, [])
	var reply: PlatformReply = await _api(t).characters()
	assert_true(reply.is_ok())
	assert_eq(_refreshes, 1)
	assert_eq(t.requests.size(), 2)
	assert_eq(t.bearer(1), "tok-2")


func test_a_second_401_is_returned() -> void:
	var t := FakeApi.new()
	t.on("POST /api/join", 401, {"error": "unauthorized"})
	var reply: PlatformReply = await _api(t).join("c", 1)
	assert_eq(reply.status, 401)
	assert_eq(_refreshes, 1, "only one refresh")
	assert_eq(t.requests.size(), 2)


func test_no_session_after_refresh_is_not_retried() -> void:
	_refresh_works = false
	var t := FakeApi.new()
	t.on("GET /api/characters", 401, {"error": "unauthorized"})
	var reply: PlatformReply = await _api(t).characters()
	assert_eq(reply.status, 401)
	assert_eq(t.requests.size(), 1)


func test_other_errors_are_not_retried() -> void:
	var t := FakeApi.new()
	t.on("POST /api/join", 403, {"error": "premium_required"})
	var reply: PlatformReply = await _api(t).join("c", 2)
	assert_eq(reply.error, "premium_required")
	assert_eq(_refreshes, 0)


# ---------- ApiText ----------

## Every error code in docs/architecture/backend.md's routes, plus the transport's own.
const API_CODES: PackedStringArray = ["unauthorized", "unavailable", "accounts_unavailable", "rate_limited",
	"bad_request", "not_found", "invalid_slot", "invalid_name", "invalid_appearance", "slot_used", "name_taken",
	"character_online", "rename_too_soon", "confirm_name", "unknown_world", "banned", "premium_required",
	"already_online", "world_offline", "world_full", "internal", "network"]


func _reply(status: int, body: Dictionary) -> PlatformReply:
	var r := PlatformReply.new()
	r.finish(status, JSON.stringify(body))
	return r


func test_every_api_error_has_its_own_words() -> void:
	var known := ApiText.known_codes()
	for code in API_CODES:
		assert_has(known, code, "%s has text" % code)
		var text := ApiText.explain(_reply(400, {"error": code}))
		assert_false(text.contains("Something went wrong ("), "%s isn't the general message" % code)


func test_name_reasons() -> void:
	assert_string_contains(ApiText.explain(_reply(400, {"error": "invalid_name", "reason": "shape"})), "3–12 letters")
	assert_string_contains(ApiText.explain(_reply(400, {"error": "invalid_name", "reason": "not_allowed"})), "isn't allowed")
	assert_string_contains(ApiText.explain(_reply(400, {"error": "invalid_name", "reason": "reserved"})), "reserved")
	assert_string_contains(ApiText.explain(_reply(400, {"error": "invalid_name"})), "3–12 letters")


func test_rename_too_soon_gives_the_date() -> void:
	var text := ApiText.explain(_reply(429, {"error": "rename_too_soon", "retryAt": "2027-01-31T12:00:00Z"}))
	assert_string_contains(text, "31 January 2027")


func test_unknown_codes_and_no_answer() -> void:
	assert_string_contains(ApiText.explain(_reply(418, {"error": "teapot"})), "teapot")
	var offline := PlatformReply.new()
	offline.finish(0, "")
	assert_string_contains(ApiText.explain(offline), "couldn't reach")


func test_date_text() -> void:
	assert_eq(ApiText.date_text("2026-11-25T09:30:00.123Z"), "25 November 2026")
	assert_eq(ApiText.date_text(""), "")
	assert_eq(ApiText.date_text("soon"), "")
