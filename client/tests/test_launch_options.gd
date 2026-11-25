extends GutTest
## Launch options from the web query string and desktop arguments.


func test_query() -> void:
	var o := LaunchOptions.parse_query("?name=Grug&server=ws%3A%2F%2Fexample.test%3A8090%2Fw%2Fdev")
	assert_eq(o.name, "Grug")
	assert_eq(o.server_url, "ws://example.test:8090/w/dev")
	assert_false(o.demo_walk)


func test_query_decodes_spaces() -> void:
	assert_eq(LaunchOptions.parse_query("?name=Big+Ugg").name, "Big Ugg")
	assert_eq(LaunchOptions.parse_query("?name=Big%20Ugg").name, "Big Ugg")


func test_defaults() -> void:
	var o := LaunchOptions.parse_query("")
	assert_eq(o.name, "")
	assert_eq(o.server_url, LaunchOptions.DEFAULT_SERVER_URL)
	assert_eq(o.quit_after_s, 0.0)


func test_args() -> void:
	var o := LaunchOptions.parse_args(PackedStringArray(["--name=Ugg", "--demo", "--shot=/tmp/a.png", "--quit=12", "--lag=150", "stray"]))
	assert_eq(o.name, "Ugg")
	assert_true(o.demo_walk)
	assert_eq(o.screenshot_path, "/tmp/a.png")
	assert_eq(o.quit_after_s, 12.0)
	assert_eq(o.lag_ms, 150.0)
	assert_eq(o.server_url, LaunchOptions.DEFAULT_SERVER_URL)


func test_demo_can_be_turned_off() -> void:
	assert_false(LaunchOptions.parse_query("?demo=0").demo_walk)
	assert_true(LaunchOptions.parse_query("?demo=1").demo_walk)


func test_dev_ticket() -> void:
	assert_eq(LaunchOptions.dev_ticket("Grug"), "dev:Grug")


func test_server_given_is_marked() -> void:
	assert_false(LaunchOptions.parse_query("?name=Grug").server_given)
	assert_true(LaunchOptions.parse_query("?server=ws%3A%2F%2Fexample.com%2Fw%2F1").server_given)


func test_local_pages_use_the_local_dev_server() -> void:
	for host: String in ["localhost:8060", "127.0.0.1:8060", "[::1]:8060", "localhost", ""]:
		assert_eq(LaunchOptions.default_server_for_page("http:", host), LaunchOptions.DEFAULT_SERVER_URL, host)
	assert_eq(LaunchOptions.default_server_for_page("file:", ""), LaunchOptions.DEFAULT_SERVER_URL)


func test_deployed_pages_use_their_own_host() -> void:
	assert_eq(LaunchOptions.default_server_for_page("https:", "dinosaur.untitledgames.co.uk"),
			"wss://dinosaur.untitledgames.co.uk/w/1")
	assert_eq(LaunchOptions.default_server_for_page("http:", "192.168.1.20:8080"), "ws://192.168.1.20:8080/w/1")
