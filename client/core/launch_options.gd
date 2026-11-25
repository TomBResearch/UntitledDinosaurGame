class_name LaunchOptions
extends RefCounted
## How the client was started. On the web these come from the page's query string
## (index.html?name=Grug&server=ws://127.0.0.1:8090/w/dev); on desktop from the user arguments
## after "--" (godot --path client -- --name=Grug). A name means a dev run: the name is the dev
## ticket's name (docs/architecture/networking.md, "Dev tickets") and the platform isn't used.
##
## Without a name, a page on a real host (the deployed /play/) uses the account platform: the
## Session autoload refreshes the player's session and sends them back to the landing page without
## one (ADR 0015). A local page does that only when given accounts=<local platform URL>, for testing.
##
## Dev-only aids for testing several clients at once:
##   demo     walk to a random nearby point every few seconds, as if clicking
##   shot     save a screenshot of the window to this path every couple of seconds (desktop)
##   quit     quit after this many seconds
##   lag      add this many ms of round-trip latency, to try the client on a slow connection

const DEFAULT_SERVER_URL := "ws://127.0.0.1:8090/w/dev"
## On a deployed site the world is on the page's own host. Until the world list (M1) there's one.
const SITE_WORLD_PATH := "/w/1"
## The shared account platform (docs/architecture/accounts.md).
const DEFAULT_ACCOUNTS_URL := "https://accounts.untitledgames.co.uk"
## Where a player with no session goes: the landing page, which logs them in.
const HOME_PATH := "/"

var name: String = ""
var server_url: String = DEFAULT_SERVER_URL
## Whether server came from the options rather than the default.
var server_given: bool = false
var demo_walk: bool = false
var screenshot_path: String = ""
var quit_after_s: float = 0.0
var lag_ms: float = 0.0
## The account platform's base URL. accounts= overrides it, but only on a local page.
var accounts_url: String = DEFAULT_ACCOUNTS_URL
var accounts_given: bool = false
## Whether this run gets its session from the platform (set by apply_page, web only).
var use_platform: bool = false
## The landing page, for a player with no session or who logs out.
var home_url: String = HOME_PATH


## Reads the options for this run: the URL query on the web, user arguments elsewhere.
static func from_environment() -> LaunchOptions:
	if OS.has_feature("web"):
		var query: Variant = JavaScriptBridge.eval("window.location.search", true)
		var protocol: Variant = JavaScriptBridge.eval("window.location.protocol", true)
		var host: Variant = JavaScriptBridge.eval("window.location.host", true)
		var o := parse_query(str(query) if query != null else "")
		o.apply_page(str(protocol) if protocol != null else "", str(host) if host != null else "")
		return o
	return parse_args(OS.get_cmdline_user_args())


## Parses "?name=Grug&server=ws%3A%2F%2F...".
static func parse_query(query: String) -> LaunchOptions:
	var pairs: Dictionary[String, String] = {}
	for part in query.trim_prefix("?").split("&", false):
		var eq := part.find("=")
		var key := part if eq < 0 else part.substr(0, eq)
		var value := "" if eq < 0 else part.substr(eq + 1)
		pairs[key.uri_decode()] = value.replace("+", " ").uri_decode()
	return _from_pairs(pairs)


## Parses ["--name=Grug", "--server=ws://...", "--demo"].
static func parse_args(args: PackedStringArray) -> LaunchOptions:
	var pairs: Dictionary[String, String] = {}
	for arg in args:
		if not arg.begins_with("--"):
			continue
		var body := arg.substr(2)
		var eq := body.find("=")
		pairs[body if eq < 0 else body.substr(0, eq)] = "" if eq < 0 else body.substr(eq + 1)
	return _from_pairs(pairs)


static func _from_pairs(pairs: Dictionary[String, String]) -> LaunchOptions:
	var o := LaunchOptions.new()
	var player_name: String = pairs.get("name", "")
	o.name = player_name.strip_edges()
	var server: String = pairs.get("server", "")
	if server != "":
		o.server_url = server
		o.server_given = true
	var demo: String = pairs.get("demo", "0")
	o.demo_walk = pairs.has("demo") and demo not in ["0", "false", "no"]
	o.screenshot_path = pairs.get("shot", "")
	var quit: String = pairs.get("quit", "0")
	o.quit_after_s = maxf(quit.to_float(), 0.0)
	var lag: String = pairs.get("lag", "0")
	o.lag_ms = maxf(lag.to_float(), 0.0)
	var accounts: String = pairs.get("accounts", "")
	if accounts != "":
		o.accounts_url = accounts.trim_suffix("/")
		o.accounts_given = true
	return o


## Fills in what depends on the page this web build was served from: the default world, and
## whether to use the platform. A deployed page always talks to the real platform, so a link with
## accounts= can't point a player's session at another server.
func apply_page(protocol: String, host: String) -> void:
	var local := is_local_page(protocol, host)
	if not server_given:
		server_url = default_server_for_page(protocol, host)
	if not local:
		accounts_url = DEFAULT_ACCOUNTS_URL
		accounts_given = false
	use_platform = name == "" and (not local or accounts_given)
	home_url = HOME_PATH
	if local and accounts_given:
		home_url += "?accounts=" + accounts_url.uri_encode()


## Whether the page was served from this machine (localhost, 127.0.0.1, [::1] or a file).
static func is_local_page(protocol: String, host: String) -> bool:
	var hostname := host.substr(0, host.find("]") + 1) if host.begins_with("[") else host.get_slice(":", 0)
	return host == "" or protocol == "file:" or hostname in ["localhost", "127.0.0.1", "[::1]"]


## The world URL for a web page with no server option. A page served from this machine
## (localhost, 127.0.0.1, or a file) uses the local dev server; a deployed page uses its own host,
## over wss when the page is https.
static func default_server_for_page(protocol: String, host: String) -> String:
	if is_local_page(protocol, host):
		return DEFAULT_SERVER_URL
	var scheme := "wss://" if protocol == "https:" else "ws://"
	return scheme + host + SITE_WORLD_PATH


## The dev ticket for a name. The server checks the name; the client doesn't second-guess it.
static func dev_ticket(player_name: String) -> String:
	return "dev:" + player_name
