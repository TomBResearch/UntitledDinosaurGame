extends PlatformTransport
## A stand-in for the game API in tests (preload it; no class_name, so it never ships). It records
## every request and answers from canned replies, straight away, so screens finish their work
## without waiting. Unanswered requests get 404 not_found. hold keeps replies open until answer().

## Each request: {method, path, body, bearer}.
var requests: Array[Dictionary] = []
## "METHOD /path" -> queued [status, body text], used in turn. Once they're used up, the last one
## used repeats.
var _answers: Dictionary[String, Array] = {}
var _last: Dictionary[String, Array] = {}
var hold: bool = false
var held: Array[PlatformReply] = []


## Answers "METHOD /path" with this status and JSON body (a Dictionary, an Array or null).
func on(method_path: String, status: int, body: Variant = null) -> void:
	if not _answers.has(method_path):
		_answers[method_path] = []
	_answers[method_path].append([status, JSON.stringify(body) if body != null else ""])


func send(method: String, path: String, body: Dictionary, bearer: String, _exclusive: bool) -> PlatformReply:
	requests.append({"method": method, "path": path, "body": body, "bearer": bearer})
	var reply := PlatformReply.new()
	if hold:
		held.append(reply)
		return reply
	var key := method + " " + path
	var queue: Array = _answers.get(key, [])
	if not queue.is_empty():
		_last[key] = queue.pop_front()
	if not _last.has(key):
		reply.finish(404, JSON.stringify({"error": "not_found"}))
		return reply
	var answer: Array = _last[key]
	var status: int = answer[0]
	var text: String = answer[1]
	reply.finish(status, text)
	return reply


func last() -> Dictionary:
	return requests[-1] if not requests.is_empty() else {}


## The last request's JSON body.
func last_body() -> Dictionary:
	return JsonRead.object(last(), "body")


## The bearer token request i was sent with.
func bearer(i: int) -> String:
	return JsonRead.text(requests[i], "bearer")


## The requests to one "METHOD /path".
func count(method_path: String) -> int:
	var n := 0
	for r in requests:
		if "%s %s" % [r["method"], r["path"]] == method_path:
			n += 1
	return n
