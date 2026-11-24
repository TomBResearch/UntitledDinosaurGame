class_name LaunchOptions
extends RefCounted
## How the client was started. On the web these come from the page's query string
## (index.html?name=Grug&server=ws://127.0.0.1:8090/w/dev); on desktop from the user arguments
## after "--" (godot --path client -- --name=Grug). Until platform login arrives in M1 the name is
## the dev ticket's name (docs/architecture/networking.md, "Dev tickets").
##
## Dev-only aids for testing several clients at once:
##   demo     walk to a random nearby point every few seconds, as if clicking
##   shot     save a screenshot of the window to this path every couple of seconds (desktop)
##   quit     quit after this many seconds
##   lag      add this many ms of round-trip latency, to try the client on a slow connection

const DEFAULT_SERVER_URL := "ws://127.0.0.1:8090/w/dev"

var name: String = ""
var server_url: String = DEFAULT_SERVER_URL
var demo_walk: bool = false
var screenshot_path: String = ""
var quit_after_s: float = 0.0
var lag_ms: float = 0.0


## Reads the options for this run: the URL query on the web, user arguments elsewhere.
static func from_environment() -> LaunchOptions:
	if OS.has_feature("web"):
		var query: Variant = JavaScriptBridge.eval("window.location.search", true)
		return parse_query(str(query) if query != null else "")
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
	var demo: String = pairs.get("demo", "0")
	o.demo_walk = pairs.has("demo") and demo not in ["0", "false", "no"]
	o.screenshot_path = pairs.get("shot", "")
	var quit: String = pairs.get("quit", "0")
	o.quit_after_s = maxf(quit.to_float(), 0.0)
	var lag: String = pairs.get("lag", "0")
	o.lag_ms = maxf(lag.to_float(), 0.0)
	return o


## The dev ticket for a name. The server checks the name; the client doesn't second-guess it.
static func dev_ticket(player_name: String) -> String:
	return "dev:" + player_name
