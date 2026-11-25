class_name GameApi
extends RefCounted
## The game's backend API (/api on the game's own site; docs/architecture/backend.md): worlds,
## characters and join tickets. Player routes send the platform access token as a bearer token.
##
## A 401 on a player route means the token was refused. Usually that's because the game was in a
## background tab and the refresh timer didn't run, so the token expired: the API refreshes the
## session once and tries again. A second 401 is returned as it is (no session: the caller goes back
## to the landing page).
##
## The client checks nothing itself: names, slots, appearance and who may join where are all the
## API's decisions (CLAUDE.md rule 1). Screens show its answers in plain words (ApiText).

var _transport: PlatformTransport = null
## Returns the current access token.
var _token: Callable = Callable()
## Refreshes the session; returns true if there's a new token. A coroutine.
var _refresh: Callable = Callable()


## transport reaches /api (the web build: a fetch on the page's own origin). token returns the
## current access token; refresh (a coroutine returning bool) gets a new one.
func _init(transport: PlatformTransport, token: Callable, refresh: Callable) -> void:
	_transport = transport
	_token = token
	_refresh = refresh


## GET /api/worlds: [{id, name, premiumOnly, population, online}]. No login needed.
func worlds() -> PlatformReply:
	return await _transport.send("GET", "/api/worlds", {}, "", false).wait()


## GET /api/characters: your characters, by slot.
func characters() -> PlatformReply:
	return await _player("GET", "/api/characters", {})


## POST /api/characters: {name, slot, appearance}. 201 with the new character.
func create_character(char_name: String, slot: int, appearance: Dictionary) -> PlatformReply:
	return await _player("POST", "/api/characters", {"name": char_name, "slot": slot, "appearance": appearance})


## PATCH /api/characters/:id: rename.
func rename_character(id: String, new_name: String) -> PlatformReply:
	return await _player("PATCH", "/api/characters/" + id.uri_encode(), {"name": new_name})


## DELETE /api/characters/:id, with the name typed to confirm. 204 when done.
func delete_character(id: String, confirm_name: String) -> PlatformReply:
	return await _player("DELETE", "/api/characters/" + id.uri_encode(), {"confirmName": confirm_name})


## POST /api/join: {ticket, wsUrl} for this character on this world.
func join(character_id: String, world_id: int) -> PlatformReply:
	return await _player("POST", "/api/join", {"characterId": character_id, "worldId": world_id})


func _player(method: String, path: String, body: Dictionary) -> PlatformReply:
	var token: String = _token.call()
	var reply := await _transport.send(method, path, body, token, false).wait()
	if reply.status != 401 or not _refresh.is_valid():
		return reply
	var refreshed: bool = await _refresh.call()
	if not refreshed:
		return reply
	var again: String = _token.call()
	return await _transport.send(method, path, body, again, false).wait()
