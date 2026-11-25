class_name SpikeChunkStreamer
extends Node3D
## The streaming spike's chunk streamer: keeps the chunks near a focus point loaded and frees the
## far ones, timing every main-thread step. The real streamer (client/world/, later) starts from this.
##
## Each frame, update(focus):
## 1. frees the farthest loaded chunk beyond unload_radius_m (nearest point of the chunk to the
##    focus), one a frame;
## 2. queues missing chunks within load_radius_m, nearest first, and starts up to max_in_flight
##    loads: ResourceLoader.load_threaded_request (Mode.THREADED) or a plain ResourceLoader.load
##    (Mode.SYNC, the baseline);
## 3. polls the loads in flight and finishes at most one a frame: load_threaded_get, instantiate,
##    add_child. With split_nodes > 0 the chunk's Props and Landmarks children are taken off before
##    it enters the tree and added split_nodes at a time over the next frames.
## Every step is timed with Time.get_ticks_usec() and kept in `records` and `frame_work_us`.

enum Mode { THREADED, SYNC }

## One chunk load, from request to the last node in the tree. Times in microseconds.
class LoadRecord:
	var key: Vector2i
	var path: String
	var requested_at_us: int
	var request_call_us: int = 0
	var poll_calls_us: int = 0
	var loaded_at_us: int = 0
	var get_us: int = 0
	var instantiate_us: int = 0
	var add_us: int = 0
	var finished_at_us: int = 0
	## Split mode: nodes of this chunk still waiting to be added.
	var nodes_left: int = 0
	## Engine frame in which each piece of main-thread work happened (for matching frame times).
	var work_frames: PackedInt32Array = PackedInt32Array()

	func to_dict() -> Dictionary:
		return {
			"key": [key.x, key.y],
			"request_call_ms": request_call_us / 1000.0,
			"poll_calls_ms": poll_calls_us / 1000.0,
			"wait_ms": (loaded_at_us - requested_at_us) / 1000.0,
			"get_ms": get_us / 1000.0,
			"instantiate_ms": instantiate_us / 1000.0,
			"add_ms": add_us / 1000.0,
			"total_ms": (finished_at_us - requested_at_us) / 1000.0,
		}

var chunk_size_m: int = 64
var load_radius_m: float = 160.0
var unload_radius_m: float = 220.0
var mode: Mode = Mode.THREADED
var use_sub_threads: bool = false
var max_in_flight: int = 2
var split_nodes: int = 0
var max_frees_per_frame: int = 1

## Finished loads, in order.
var records: Array[LoadRecord] = []
## Microseconds spent freeing each unloaded chunk.
var free_us: PackedInt64Array = PackedInt64Array()
## Main-thread microseconds this streamer spent in each engine frame (keyed by frame number).
var frame_work_us: Dictionary[int, int] = {}

var _loaded: Dictionary[Vector2i, Node3D] = {}
var _in_flight: Dictionary[Vector2i, LoadRecord] = {}
var _queued: Array[Vector2i] = []
## Split mode: nodes still to add, as [parent: Node, node: Node, record: LoadRecord], oldest first.
var _to_add: Array[Array] = []


## Chunks loaded and in the tree.
func loaded_count() -> int:
	return _loaded.size()


## True when nothing is loading and every wanted chunk is in.
func is_idle() -> bool:
	return _in_flight.is_empty() and _queued.is_empty() and _to_add.is_empty()


func update(focus: Vector3) -> void:
	var frame := Engine.get_process_frames()
	_unload_far(focus, frame)
	_queue_near(focus)
	_start_loads(frame)
	if not _add_split_nodes(frame):
		_finish_one(frame)


## Frees the farthest chunk beyond unload_radius_m, at most max_frees_per_frame a frame: freeing a
## chunk costs up to about 10 ms on the web (measured), and a border crossing frees a whole row.
func _unload_far(focus: Vector3, frame: int) -> void:
	var far: Array[Vector2i] = []
	for key: Vector2i in _loaded.keys():
		if _distance(key, focus) > unload_radius_m:
			far.append(key)
	far.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return _distance(a, focus) > _distance(b, focus))
	for key: Vector2i in far.slice(0, max_frees_per_frame):
		var chunk: Node3D = _loaded[key]
		_loaded.erase(key)
		var t0 := Time.get_ticks_usec()
		remove_child(chunk)
		chunk.free()
		var spent := Time.get_ticks_usec() - t0
		free_us.append(spent)
		_add_work(frame, spent)


func _queue_near(focus: Vector3) -> void:
	var reach := ceili(load_radius_m / chunk_size_m) + 1
	var centre := Vector2i(floori(focus.x / chunk_size_m), floori(focus.z / chunk_size_m))
	var wanted: Array[Vector2i] = []
	for dz in range(-reach, reach + 1):
		for dx in range(-reach, reach + 1):
			var key := centre + Vector2i(dx, dz)
			if _distance(key, focus) <= load_radius_m and not _loaded.has(key) \
					and not _in_flight.has(key):
				wanted.append(key)
	wanted.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return _distance(a, focus) < _distance(b, focus))
	_queued = wanted


func _start_loads(frame: int) -> void:
	while not _queued.is_empty() and _in_flight.size() < max_in_flight:
		var key: Vector2i = _queued.pop_front()
		var rec := LoadRecord.new()
		rec.key = key
		rec.path = SpikeTerrain.chunk_path(chunk_size_m, key.x, key.y)
		rec.requested_at_us = Time.get_ticks_usec()
		if mode == Mode.THREADED:
			# CACHE_MODE_IGNORE: every load reads the file, even if an identical chunk (the region
			# tiles) is still alive. Shared props are dependencies and still come from the cache.
			var err := ResourceLoader.load_threaded_request(
				rec.path, "PackedScene", use_sub_threads, ResourceLoader.CACHE_MODE_IGNORE)
			if err != OK:
				push_error("load_threaded_request %s: %s" % [rec.path, error_string(err)])
				continue
		rec.request_call_us = Time.get_ticks_usec() - rec.requested_at_us
		rec.work_frames.append(frame)
		_add_work(frame, rec.request_call_us)
		_in_flight[key] = rec


## Finishes the first load that's ready. One a frame, so two finishes never share a frame.
func _finish_one(frame: int) -> void:
	for key: Vector2i in _in_flight.keys():
		var rec: LoadRecord = _in_flight[key]
		var packed: PackedScene = null
		if mode == Mode.THREADED:
			var t0 := Time.get_ticks_usec()
			var status := ResourceLoader.load_threaded_get_status(rec.path)
			var spent := Time.get_ticks_usec() - t0
			rec.poll_calls_us += spent
			_add_work(frame, spent)
			if status == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
				continue
			rec.loaded_at_us = Time.get_ticks_usec()
			if status != ResourceLoader.THREAD_LOAD_LOADED:
				push_error("load %s failed (status %d)" % [rec.path, status])
				_in_flight.erase(key)
				return
			t0 = Time.get_ticks_usec()
			packed = ResourceLoader.load_threaded_get(rec.path) as PackedScene
			rec.get_us = Time.get_ticks_usec() - t0
		else:
			var t0 := Time.get_ticks_usec()
			packed = ResourceLoader.load(rec.path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) \
					as PackedScene
			rec.get_us = Time.get_ticks_usec() - t0
			rec.loaded_at_us = Time.get_ticks_usec()
		_in_flight.erase(key)
		_place(rec, packed, frame)
		return


func _place(rec: LoadRecord, packed: PackedScene, frame: int) -> void:
	var t0 := Time.get_ticks_usec()
	var chunk := packed.instantiate() as Node3D
	rec.instantiate_us = Time.get_ticks_usec() - t0
	chunk.position = Vector3(rec.key.x * chunk_size_m, 0.0, rec.key.y * chunk_size_m)
	chunk.name = "Chunk_%d_%d" % [rec.key.x, rec.key.y]
	if split_nodes > 0:
		for group_name: String in ["Props", "Landmarks"]:
			var group := chunk.get_node_or_null(group_name)
			if group == null:
				continue
			for child in group.get_children():
				group.remove_child(child)
				_to_add.append([group, child, rec])
				rec.nodes_left += 1
	t0 = Time.get_ticks_usec()
	add_child(chunk)
	rec.add_us = Time.get_ticks_usec() - t0
	rec.work_frames.append(frame)
	_add_work(frame, rec.get_us + rec.instantiate_us + rec.add_us)
	_loaded[rec.key] = chunk
	if rec.nodes_left == 0:
		rec.finished_at_us = Time.get_ticks_usec()
		records.append(rec)


## Adds up to split_nodes held-back nodes. Returns true if it did any work this frame.
func _add_split_nodes(frame: int) -> bool:
	if _to_add.is_empty():
		return false
	var n := 0
	while not _to_add.is_empty() and n < split_nodes:
		var t0 := Time.get_ticks_usec()
		var entry: Array = _to_add.pop_front()
		var parent := entry[0] as Node
		var node := entry[1] as Node
		var rec := entry[2] as LoadRecord
		if is_instance_valid(parent) and parent.is_inside_tree():
			parent.add_child(node)
		else:
			node.free() # its chunk was unloaded before it was finished
		var spent := Time.get_ticks_usec() - t0
		_add_work(frame, spent)
		rec.add_us += spent
		rec.nodes_left -= 1
		if rec.work_frames[rec.work_frames.size() - 1] != frame:
			rec.work_frames.append(frame)
		if rec.nodes_left == 0:
			rec.finished_at_us = Time.get_ticks_usec()
			records.append(rec)
		n += 1
	return true


func _add_work(frame: int, us: int) -> void:
	frame_work_us[frame] = frame_work_us.get(frame, 0) + us


## Distance on the ground from the focus to the nearest point of a chunk.
func _distance(key: Vector2i, focus: Vector3) -> float:
	var x0 := float(key.x * chunk_size_m)
	var z0 := float(key.y * chunk_size_m)
	var dx := maxf(maxf(x0 - focus.x, focus.x - (x0 + chunk_size_m)), 0.0)
	var dz := maxf(maxf(z0 - focus.z, focus.z - (z0 + chunk_size_m)), 0.0)
	return sqrt(dx * dx + dz * dz)
