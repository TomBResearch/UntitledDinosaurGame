class_name MotionTrack
extends RefCounted
## An entity's movement as a short timeline of paths, each taking over at its start tick.
##
## Other entities are drawn about 100 ms in the past, so a path_started often arrives before the
## drawn time reaches its start_tick. Keeping the old path until then makes the switch seamless:
## the server starts a repath exactly where the old path had the entity on the new start tick.
## Your own character is drawn at the current time, so its new paths take over at once.

var _paths: Array[PathPlayback] = []


## Adds a path that takes over at its start_tick. Anything queued to start at or after that tick
## is replaced: the server's later message wins.
func add(path: PathPlayback) -> void:
	while not _paths.is_empty() and _paths[_paths.size() - 1].start_tick >= path.start_tick:
		_paths.pop_back()
	_paths.append(path)


func is_empty() -> bool:
	return _paths.is_empty()


## The path in charge at tick t: the latest one that has started, or the first if none has.
func path_at(t: float) -> PathPlayback:
	assert(not _paths.is_empty(), "empty motion track")
	var i := _paths.size() - 1
	while i > 0 and float(_paths[i].start_tick) > t:
		i -= 1
	return _paths[i]


## Position in metres at tick t.
func position_at(t: float) -> Vector3:
	return path_at(t).position_at(t)


func heading_at(t: float) -> Vector3:
	return path_at(t).heading_at(t)


## Drops paths that t has moved past for good. Time only moves forward on the client (the clock
## estimate slews rather than stepping back), so older paths are never needed again.
func prune(t: float) -> void:
	var keep := _paths.find(path_at(t))
	if keep > 0:
		_paths = _paths.slice(keep)


## How many paths are queued (for tests).
func size() -> int:
	return _paths.size()
