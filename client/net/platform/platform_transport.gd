class_name PlatformTransport
extends RefCounted
## How PlatformSession reaches the account platform. The web build uses WebPlatformTransport
## (a JavaScriptBridge fetch, so the browser sends the refresh cookie). Tests use a fake.
## This base class has no way to reach the platform: every request finishes as "network".


## Sends a request and returns its reply at once, finished later. body is sent as JSON when it
## isn't empty; bearer adds "Authorization: Bearer <token>". exclusive requests (refresh and
## log out) never run at the same time as another exclusive one, in any tab of this site.
func send(_method: String, _path: String, _body: Dictionary, _bearer: String, _exclusive: bool) -> PlatformReply:
	var reply := PlatformReply.new()
	reply.finish(0, "")
	return reply
