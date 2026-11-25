extends GutTest
## The game's platform session (PlatformSession) and the Session autoload's logic (SessionKeeper),
## with a fake transport: one refresh at a time, the expiry timer, and when to go back to the
## landing page. No real time passes: tests call the timer's handler themselves.

const SESSION_BODY := {"accessToken": "tok-1", "tokenType": "Bearer", "expiresIn": 900,
		"account": {"id": "a1", "username": "Raptor_Ranger99", "role": "normal", "premium": false}}


## Records every request and leaves its reply open until the test finishes it.
class FakeTransport:
	extends PlatformTransport
	var requests: Array[Dictionary] = []
	var replies: Array[PlatformReply] = []

	func send(method: String, path: String, body: Dictionary, bearer: String, exclusive: bool) -> PlatformReply:
		requests.append({"method": method, "path": path, "body": body, "bearer": bearer, "exclusive": exclusive})
		var reply := PlatformReply.new()
		replies.append(reply)
		return reply

	func answer(index: int, status: int, body: Dictionary = {}) -> void:
		replies[index].finish(status, JSON.stringify(body) if not body.is_empty() else "")


func _error(code: String) -> Dictionary:
	return {"error": code, "message": "text"}


# ---------- PlatformSession ----------

func test_refresh_is_single_flight() -> void:
	var t := FakeTransport.new()
	var s := PlatformSession.new(t)
	var got: Array[PlatformReply] = []
	var ask := func() -> void: got.append(await s.refresh())
	ask.call()
	ask.call()
	assert_eq(t.requests.size(), 1, "a second refresh waits for the first instead of sending")
	assert_true(s.is_refreshing())
	t.answer(0, 200, SESSION_BODY)
	assert_eq(got.size(), 2, "both callers get the answer")
	assert_same(got[0], got[1])
	assert_false(s.is_refreshing())
	assert_eq(s.access_token, "tok-1")
	assert_eq(s.username(), "Raptor_Ranger99")
	assert_eq(s.expires_in_s, 900.0)
	ask.call()
	assert_eq(t.requests.size(), 2, "once it's done, the next refresh sends again")


func test_refresh_and_log_out_are_exclusive_and_cookie_only() -> void:
	var t := FakeTransport.new()
	var s := PlatformSession.new(t)
	s.refresh()
	t.answer(0, 200, SESSION_BODY)
	s.log_out()
	assert_eq(t.requests[0], {"method": "POST", "path": "/auth/refresh", "body": {}, "bearer": "", "exclusive": true})
	assert_eq(t.requests[1], {"method": "POST", "path": "/auth/logout", "body": {}, "bearer": "", "exclusive": true})
	assert_eq(s.access_token, "", "logging out forgets the token at once")


func test_log_out_waits_for_a_running_refresh() -> void:
	var t := FakeTransport.new()
	var s := PlatformSession.new(t)
	s.refresh()
	s.log_out()
	assert_eq(t.requests.size(), 1, "log out isn't sent while a refresh is running")
	t.answer(0, 200, SESSION_BODY)
	assert_eq(t.requests.size(), 2)
	var second: Dictionary = t.requests[1]
	var path: String = second["path"]
	assert_eq(path, "/auth/logout")
	assert_eq(s.access_token, "", "the refresh that finished first doesn't bring the token back")


func test_a_lost_session_is_forgotten_but_a_network_error_keeps_the_token() -> void:
	var t := FakeTransport.new()
	var s := PlatformSession.new(t)
	s.refresh()
	t.answer(0, 200, SESSION_BODY)
	s.refresh()
	t.answer(1, 0)
	assert_eq(s.access_token, "tok-1", "no answer: the token may still be good")
	s.refresh()
	t.answer(2, 401, _error("token_reused"))
	assert_eq(s.access_token, "")
	assert_eq(s.account, {})


func test_outcomes() -> void:
	var cases: Array[Array] = [
		[200, SESSION_BODY, PlatformSession.Outcome.SIGNED_IN],
		[401, _error("no_session"), PlatformSession.Outcome.NO_SESSION],
		[401, _error("session_expired"), PlatformSession.Outcome.NO_SESSION],
		[401, _error("token_reused"), PlatformSession.Outcome.NO_SESSION],
		[403, _error("banned"), PlatformSession.Outcome.NO_SESSION],
		[403, _error("bad_origin"), PlatformSession.Outcome.NO_SESSION],
		[0, {}, PlatformSession.Outcome.UNREACHABLE],
		[429, _error("rate_limited"), PlatformSession.Outcome.UNREACHABLE],
		[500, _error("internal"), PlatformSession.Outcome.UNREACHABLE],
		[502, {}, PlatformSession.Outcome.UNREACHABLE],
	]
	for c: Array in cases:
		var reply := PlatformReply.new()
		var status: int = c[0]
		var body: Dictionary = c[1]
		var want: PlatformSession.Outcome = c[2]
		reply.finish(status, JSON.stringify(body) if not body.is_empty() else "")
		assert_eq(PlatformSession.outcome(reply), want, str(c))


func test_reply_error_codes() -> void:
	var r := PlatformReply.new()
	r.finish(0, "")
	assert_eq(r.error, "network")
	r = PlatformReply.new()
	r.finish(502, "<html>Bad gateway</html>")
	assert_eq(r.error, "unknown")
	r = PlatformReply.new()
	r.finish(403, JSON.stringify(_error("banned")))
	assert_eq(r.error, "banned")
	r = PlatformReply.new()
	r.finish(204, "")
	assert_true(r.is_ok())
	assert_eq(r.error, "")


func test_refresh_delay() -> void:
	assert_eq(PlatformSession.refresh_delay_s(900.0), 840.0, "a minute before a 15-minute token expires")
	assert_eq(PlatformSession.refresh_delay_s(30.0), PlatformSession.MIN_REFRESH_DELAY_S)
	assert_eq(PlatformSession.refresh_delay_s(0.0), PlatformSession.MIN_REFRESH_DELAY_S)


func test_has_premium_from_the_profile() -> void:
	var s := PlatformSession.new(FakeTransport.new())
	assert_false(s.has_premium(), "signed out")
	s.account = {"role": "normal", "premium": false}
	assert_false(s.has_premium())
	s.account = {"role": "normal", "premium": true}
	assert_true(s.has_premium())
	for staff: String in ["premium", "moderator", "admin", "owner"]:
		s.account = {"role": staff, "premium": false}
		assert_true(s.has_premium(), "%s counts as Premium" % staff)


# ---------- SessionKeeper (the Session autoload) ----------

var _went_to: Array[String] = []


func _keeper() -> SessionKeeper:
	_went_to.clear()
	var k := SessionKeeper.new()
	add_child_autofree(k)
	return k


func _deployed() -> LaunchOptions:
	var o := LaunchOptions.parse_query("")
	o.apply_page("https:", "dinosaur.untitledgames.co.uk")
	return o


func _start(k: SessionKeeper, t: FakeTransport, o: LaunchOptions = null) -> void:
	k.begin(o if o != null else _deployed(), t, func(url: String) -> void: _went_to.append(url))


func test_signed_in_schedules_a_refresh_before_expiry() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	assert_eq(k.refresh_scheduled_in_s(), -1.0, "nothing scheduled while the first refresh runs")
	t.answer(0, 200, SESSION_BODY)
	assert_almost_eq(k.refresh_scheduled_in_s(), 840.0, 0.01)
	assert_eq(_went_to, [] as Array[String])


func test_no_session_at_start_goes_to_the_landing_page() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	t.answer(0, 401, _error("no_session"))
	assert_eq(_went_to, ["/"] as Array[String])
	assert_eq(k.refresh_scheduled_in_s(), -1.0)


func test_unreachable_at_start_stays_for_try_again() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	t.answer(0, 0)
	assert_eq(_went_to, [] as Array[String], "main shows Try again instead")
	assert_eq(k.refresh_scheduled_in_s(), -1.0)


func test_timer_refresh_keeps_the_session_going() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	t.answer(0, 200, SESSION_BODY)
	k._on_refresh_due()
	assert_eq(t.requests.size(), 2)
	t.answer(1, 200, {"accessToken": "tok-2", "expiresIn": 600, "account": SESSION_BODY["account"]})
	assert_eq(k.platform.access_token, "tok-2")
	assert_almost_eq(k.refresh_scheduled_in_s(), 540.0, 0.01)


func test_timer_refresh_retries_when_unreachable() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	t.answer(0, 200, SESSION_BODY)
	k._on_refresh_due()
	t.answer(1, 503)
	assert_almost_eq(k.refresh_scheduled_in_s(), SessionKeeper.RETRY_S, 0.01)
	assert_eq(_went_to, [] as Array[String])


func test_session_lost_during_play_goes_to_the_landing_page() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	t.answer(0, 200, SESSION_BODY)
	k._on_refresh_due()
	t.answer(1, 401, _error("session_expired"))
	assert_eq(_went_to, ["/"] as Array[String])
	assert_eq(k.refresh_scheduled_in_s(), -1.0)


func test_log_out_ends_the_session_then_goes_home() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	_start(k, t)
	t.answer(0, 200, SESSION_BODY)
	k.log_out()
	var second: Dictionary = t.requests[1]
	var path: String = second["path"]
	assert_eq(path, "/auth/logout")
	assert_eq(k.refresh_scheduled_in_s(), -1.0, "no refresh after logging out")
	assert_eq(_went_to, [] as Array[String], "waits for the platform first")
	t.answer(1, 204)
	assert_eq(_went_to, ["/"] as Array[String])


func test_local_testing_goes_home_with_the_same_platform() -> void:
	var k := _keeper()
	var t := FakeTransport.new()
	var o := LaunchOptions.parse_query("?accounts=http%3A%2F%2Flocalhost%3A3110")
	o.apply_page("http:", "localhost:8075")
	_start(k, t, o)
	t.answer(0, 401, _error("no_session"))
	assert_eq(_went_to, ["/?accounts=http%3A%2F%2Flocalhost%3A3110"] as Array[String])
