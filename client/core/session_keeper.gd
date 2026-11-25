class_name SessionKeeper
extends Node
## Keeps the game's account platform session alive, as the Session autoload
## (res://autoload/session.gd). Tests create their own with a fake transport.
##
## - begin() refreshes once at start. No session sends the player to the landing page.
## - It refreshes again REFRESH_LEAD_S before the access token expires, and retries every
##   RETRY_S if the platform can't be reached. A refresh that finds the session gone (logged out in
##   another tab, banned) sends the player to the landing page.
## - log_out() ends the session and goes to the landing page.
## - Dev runs (a name in the launch options, desktop, local pages) never call begin().
##
## Joining a world still uses a dev ticket named after the account (main.gd). The seam for real
## join tickets (cmd/api, M1): main.gd's _on_signed_in() asks /api for one with
## platform.access_token instead.

## Retry a refresh that got no usable answer after this long.
const RETRY_S := 15.0

var platform: PlatformSession = null

var _timer: Timer = null
var _home_url: String = LaunchOptions.HOME_PATH
var _navigate: Callable = _go_to_page


func _ready() -> void:
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.timeout.connect(_on_refresh_due)
	add_child(_timer)


## Starts the session for these options. transport is for tests; the web build talks to the real
## platform. navigate is for tests too: it gets the URL instead of the page going there.
func begin(options: LaunchOptions, transport: PlatformTransport = null, navigate: Callable = Callable()) -> PlatformSession.Outcome:
	if transport == null:
		transport = WebPlatformTransport.new(options.accounts_url) if OS.has_feature("web") else PlatformTransport.new()
	if navigate.is_valid():
		_navigate = navigate
	_home_url = options.home_url
	platform = PlatformSession.new(transport)
	return await _refresh_now()


## Whether a refresh is waiting on the timer, and how long until it runs.
func refresh_scheduled_in_s() -> float:
	return _timer.time_left if _timer != null and not _timer.is_stopped() else -1.0


## Ends the session on the platform and goes to the landing page.
func log_out() -> void:
	_timer.stop()
	if platform != null:
		await platform.log_out()
	go_home()


## Leaves the game for the landing page.
func go_home() -> void:
	_timer.stop()
	_navigate.call(_home_url)


func _on_refresh_due() -> void:
	await _refresh_now()


func _refresh_now() -> PlatformSession.Outcome:
	var reply := await platform.refresh()
	var outcome := PlatformSession.outcome(reply)
	match outcome:
		PlatformSession.Outcome.SIGNED_IN:
			_timer.start(PlatformSession.refresh_delay_s(platform.expires_in_s))
		PlatformSession.Outcome.NO_SESSION:
			go_home()
		PlatformSession.Outcome.UNREACHABLE:
			# At start the player gets a Retry button instead (main.gd). In play, keep trying: the
			# world connection doesn't need the token, only /api calls will.
			if platform.access_token != "":
				_timer.start(RETRY_S)
	return outcome


func _go_to_page(url: String) -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.location.replace(%s)" % JSON.stringify(url), true)
	else:
		get_tree().quit()
