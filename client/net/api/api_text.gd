class_name ApiText
extends RefCounted
## Plain words for every answer the game API can give (docs/architecture/backend.md, "Routes").
## The API decides; this only explains. Every error code the API sends has text here, and a code
## this client doesn't know yet gets a general message rather than nothing.

## The character name rules as players read them (internal/names on the server checks them).
const NAME_RULES := "3–12 letters and numbers (A–Z, 0–9), with single spaces between words."

const MONTHS: PackedStringArray = ["January", "February", "March", "April", "May", "June", "July",
		"August", "September", "October", "November", "December"]

const _GENERAL := {
	"network": "We couldn't reach the game server. Check your connection and try again.",
	"unavailable": "The game server is having trouble. Please try again in a minute.",
	"accounts_unavailable": "We couldn't check your account just now. Please try again in a minute.",
	"rate_limited": "That's a lot of requests in a short time. Wait a moment and try again.",
	"unauthorized": "Your login has ended. Please log in again.",
	"bad_request": "Something went wrong sending that. Please try again.",
	"internal": "Something went wrong on our side. Please try again.",
	"not_found": "That character doesn't exist any more.",
	"character_online": "That character is still logged in to a world. Wait a moment and try again.",
	"invalid_slot": "That character slot doesn't exist.",
	"slot_used": "That slot already has a character in it.",
	"name_taken": "That name is taken. Try another.",
	"invalid_appearance": "One of those looks isn't available. Pick again and try once more.",
	"confirm_name": "The name you typed doesn't match. Type the character's name exactly to delete it.",
	"unknown_world": "That world doesn't exist any more. Pick another.",
	"banned": "This account is banned, so it can't join a world.",
	"premium_required": "This world is for Premium members only. Pick a free world.",
	"already_online": "One of your characters is still logged in to a world. Wait a moment and try again.",
	"world_offline": "That world is offline just now. Pick another, or try again soon.",
	"world_full": "That world is full. Pick another, or try again soon.",
}

const _NAME_REASONS := {
	"shape": "Names are " + NAME_RULES,
	"not_allowed": "That name isn't allowed. Try another.",
	"reserved": "That name is reserved. Try another.",
}


## What a failed reply means for the player.
static func explain(reply: PlatformReply) -> String:
	var code := reply.error
	if code == "invalid_name":
		var why: String = _NAME_REASONS.get(JsonRead.text(reply.data, "reason", "shape"), _NAME_REASONS["shape"])
		return why
	if code == "rename_too_soon":
		var when := date_text(JsonRead.text(reply.data, "retryAt"))
		return "You can only rename a character once every 30 days." + (" Next rename: %s." % when if when != "" else "")
	if _GENERAL.has(code):
		var text: String = _GENERAL[code]
		return text
	if reply.status == 0:
		var offline: String = _GENERAL["network"]
		return offline
	return "Something went wrong (%s). Please try again." % (code if code != "" else str(reply.status))


## Every error code with text (tests check this matches backend.md's routes).
static func known_codes() -> PackedStringArray:
	var codes := PackedStringArray(_GENERAL.keys())
	codes.append_array(["invalid_name", "rename_too_soon"])
	return codes


## "31 January 2027" from an RFC 3339 time such as "2027-01-31T12:00:00Z", or "" if it isn't one.
static func date_text(rfc3339: String) -> String:
	if rfc3339.length() < 10:
		return ""
	var d := Time.get_datetime_dict_from_datetime_string(rfc3339, false)
	var month := JsonRead.whole(d, "month")
	var day := JsonRead.whole(d, "day")
	var year := JsonRead.whole(d, "year")
	if month < 1 or month > 12 or day < 1:
		return ""
	return "%d %s %d" % [day, MONTHS[month - 1], year]
