class_name WebPlatformTransport
extends PlatformTransport
## Talks to the account platform from the web build with the browser's fetch, with
## credentials: "include", so the platform's HttpOnly refresh cookie is sent and rotated. Godot's
## HTTPRequest can't send credentialed cross-origin requests (the platform's docs/integration.md).
##
## Refresh and log out run under a Web Lock that the landing page (web/js/auth.js) takes too.
## Two refreshes at once with the same cookie count as reuse and log the player out everywhere,
## so this keeps the game and a landing page open in another tab from ever overlapping.

## The lock name. web/js/auth.js uses the same one.
const LOCK_NAME := "udg-platform-session"

const HELPER := """
window.udgPlatform = window.udgPlatform || {
  send: function (url, method, body, bearer, lock, done) {
    var run = function () {
      var headers = {};
      if (body) headers["Content-Type"] = "application/json";
      if (bearer) headers.Authorization = "Bearer " + bearer;
      return fetch(url, { method: method, headers: headers, body: body || undefined, credentials: "include" })
        .then(function (res) {
          return (res.status === 204 ? Promise.resolve("") : res.text())
            .then(function (text) { done(res.status, text); });
        })
        .catch(function () { done(0, ""); });
    };
    if (lock && navigator.locks) navigator.locks.request(lock, run); else run();
  }
};
"""

var _base_url: String = ""
var _helper: JavaScriptObject = null
## JavaScript callbacks stay referenced here until they're called, or Godot frees them early.
var _callbacks: Dictionary[int, JavaScriptObject] = {}
var _next_id: int = 0


func _init(base_url: String) -> void:
	_base_url = base_url
	JavaScriptBridge.eval(HELPER, true)
	_helper = JavaScriptBridge.get_interface("udgPlatform")


func send(method: String, path: String, body: Dictionary, bearer: String, exclusive: bool) -> PlatformReply:
	var reply := PlatformReply.new()
	if _helper == null:
		reply.finish(0, "")
		return reply
	_next_id += 1
	var id := _next_id
	var callback := JavaScriptBridge.create_callback(func(args: Array) -> void:
		_callbacks.erase(id)
		var http_status: float = args[0]
		var text: String = str(args[1])
		reply.finish(int(http_status), text))
	_callbacks[id] = callback
	_helper.call("send", _base_url + path, method, JSON.stringify(body) if not body.is_empty() else "",
			bearer, LOCK_NAME if exclusive else "", callback)
	return reply
