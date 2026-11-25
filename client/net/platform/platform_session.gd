class_name PlatformSession
extends RefCounted
## The player's account platform session in the game (ADR 0015): the access token, kept in
## memory only, and the profile that came with it. The refresh token is the platform's HttpOnly
## cookie, which the game never sees.
##
## Only one refresh runs at a time: a second caller waits for the one already running and gets
## the same reply. Two refreshes at once with the same cookie count as reuse, and the platform then
## logs the player out everywhere.

## What a refresh means for the game.
enum Outcome {
	## Signed in, with a fresh access token.
	SIGNED_IN,
	## No session (never logged in, logged out, expired, reused, banned or this site not allowed):
	## back to the landing page.
	NO_SESSION,
	## No usable answer (offline, rate limited, platform down): try again later.
	UNREACHABLE,
}

## Refresh this long before the access token expires (the platform's docs/integration.md).
const REFRESH_LEAD_S := 60.0
## Never schedule a refresh sooner than this, even for a very short-lived token.
const MIN_REFRESH_DELAY_S := 5.0

var access_token: String = ""
## The platform's profile: id, username, email, role, premium, createdAt and so on.
var account: Dictionary = {}
## The access token's lifetime from the last refresh, in seconds.
var expires_in_s: float = 0.0

var _transport: PlatformTransport = null
var _in_flight: PlatformReply = null


func _init(transport: PlatformTransport) -> void:
	_transport = transport


## Gets a new access token with the refresh cookie. Returns the reply once it has arrived.
func refresh() -> PlatformReply:
	if _in_flight == null:
		var reply := _transport.send("POST", "/auth/refresh", {}, "", true)
		_in_flight = reply
		if reply.done:
			_apply(reply)
		else:
			reply.completed.connect(_apply.bind(reply), CONNECT_ONE_SHOT)
		return await reply.wait()
	return await _in_flight.wait()


## Whether a refresh is running now.
func is_refreshing() -> bool:
	return _in_flight != null


## Ends the session on the platform (every tab and game using this login) and forgets it here.
func log_out() -> PlatformReply:
	if _in_flight != null:
		await _in_flight.wait()
	var reply := _transport.send("POST", "/auth/logout", {}, "", true)
	_forget()
	return await reply.wait()


## The account's username, or "" when signed out.
func username() -> String:
	var name: Variant = account.get("username")
	return name if name is String else ""


func _apply(reply: PlatformReply) -> void:
	_in_flight = null
	if reply.is_ok():
		var token: Variant = reply.data.get("accessToken")
		var profile: Variant = reply.data.get("account")
		var lifetime: Variant = reply.data.get("expiresIn")
		access_token = token if token is String else ""
		account = profile if profile is Dictionary else {}
		# JSON numbers parse as floats.
		expires_in_s = lifetime if lifetime is float else 0.0
	elif outcome(reply) == Outcome.NO_SESSION:
		_forget()


func _forget() -> void:
	access_token = ""
	account = {}
	expires_in_s = 0.0


## What a refresh reply means. 401 (no_session, session_expired, token_reused) and 403 (banned,
## bad_origin) mean there's no session to keep. Anything else that failed is worth retrying.
static func outcome(reply: PlatformReply) -> Outcome:
	if reply.is_ok():
		return Outcome.SIGNED_IN
	if reply.status == 401 or reply.status == 403:
		return Outcome.NO_SESSION
	return Outcome.UNREACHABLE


## Seconds until the next refresh for a token that lasts expires_in seconds.
static func refresh_delay_s(expires_in: float) -> float:
	return maxf(expires_in - REFRESH_LEAD_S, MIN_REFRESH_DELAY_S)


## Whether the account has Premium, as the profile from the last refresh says. Staff count as
## Premium (a platform rule). Only for hints on screen (the world list): the API checks the
## account's fresh state when it issues a join ticket.
func has_premium() -> bool:
	if account.get("premium") == true:
		return true
	return account.get("role") in ["premium", "moderator", "admin", "owner"]
