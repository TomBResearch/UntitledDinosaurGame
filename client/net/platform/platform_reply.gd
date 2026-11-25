class_name PlatformReply
extends RefCounted
## One answer from the account platform. Transports hand one back straight away and finish it
## when the answer arrives; callers `await reply.wait()`.
##
## The platform's errors are {"error": "<code>", "message": "<text for players>"}
## (UntitledAccountSystem docs/spec.md). Status 0 with error "network" means no answer at all,
## which also covers a browser refusing the request (CORS).

signal completed

var done: bool = false
## The HTTP status, or 0 for no answer.
var status: int = 0
var data: Dictionary = {}
## The platform's error code, "network" or "unknown". Empty when the request worked.
var error: String = ""


## Records the answer and wakes everyone waiting. A second call is ignored.
func finish(http_status: int, body: String) -> void:
	if done:
		return
	status = http_status
	# JSON.new().parse, not JSON.parse_string: a proxy's HTML error page isn't worth an engine error.
	var json := JSON.new()
	if body != "" and json.parse(body) == OK and json.data is Dictionary:
		data = json.data
	if not is_ok():
		var code: Variant = data.get("error")
		error = str(code) if code is String else ("network" if http_status == 0 else "unknown")
	done = true
	completed.emit()


func is_ok() -> bool:
	return status >= 200 and status < 300


## Returns this reply once it has finished.
func wait() -> PlatformReply:
	if not done:
		await completed
	return self
