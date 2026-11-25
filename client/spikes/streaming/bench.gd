extends Node3D
## Streaming spike bench: walks a third-person camera across the generated chunked region
## (build_spike_region.gd) while SpikeChunkStreamer loads and frees chunks, and records frame times,
## the hitch at each chunk load, load times and memory. Frame times are capped by vsync (16.7 ms at
## 60 Hz), so it also records each frame's busy time: from the start of the bench's _process (it runs
## first) to RenderingServer.frame_post_draw, which covers the streamer's work and submitting the draw
## calls, but not the GPU's own time. Prints a summary at the end; on the web it
## also POSTs the JSON to /results on the page's server (serve.py saves it, and with --plan sends
## the page on to the next run).
##
## Options (web: query string, ?mode=threaded&chunk=64; desktop: -- --mode=threaded --chunk=64):
##   mode=threaded|sync  load_threaded_request (default) or plain ResourceLoader.load
##   sub=1               use_sub_threads in load_threaded_request
##   chunk=64|32         chunk size (generated/chunks<size>/)
##   load=160 unload=220 load and free distances, metres
##   inflight=2          loads in flight at once
##   split=0             add a chunk's props this many nodes a frame (0: all at once)
##   frees=1             chunks freed a frame at most
##   speed=12 walk=45    walking speed (m/s) and how long to walk (s). Real walking is 4 m/s; the
##                       default is three times that, so more chunks load per run.
##   label=name          a name for the results
##   norender=1          don't draw (the render loop is off), but still flush the rendering server's
##                       command queue every frame, so mesh uploads still happen. For measuring
##                       main-thread cost where the browser can't present frames (a hidden or locked
##                       screen throttles drawing to about 1 fps).
##   out=path            desktop: also write the JSON here
##   quit=1              desktop: quit when done

const SETTLE_S := 3.0
const CAMERA_BACK_M := 14.0
const CAMERA_UP_M := 10.0
const START := Vector3(40.0, 0.0, 40.0)
const WALK_DIR := Vector3(1.0, 0.0, 0.35)

enum Phase { INITIAL, SETTLE, WALK, DONE }

var _opts: Dictionary[String, String] = {}
var _streamer: SpikeChunkStreamer
var _camera: Camera3D
var _hud: Label
var _phase: Phase = Phase.INITIAL
var _phase_started_us: int = 0
var _last_frame_us: int = 0
var _frame_start_us: int = 0
var _settle_busy_ms: PackedFloat64Array = PackedFloat64Array()
var _busy_by_frame: Dictionary[int, float] = {}
var _focus: Vector3 = START
var _speed_m_s: float = 12.0
var _walk_s: float = 45.0
var _startup_ms: float = -1.0
var _initial: Dictionary = {}
var _settle_dt_ms: PackedFloat64Array = PackedFloat64Array()
## Walk frames: engine frame number and the time since the previous frame started.
var _walk_frames: PackedInt64Array = PackedInt64Array()
var _walk_dt_ms: PackedFloat64Array = PackedFloat64Array()
var _summary: String = ""


func _ready() -> void:
	if OS.has_feature("web"):
		_startup_ms = float(str(JavaScriptBridge.eval("performance.now()", true)))
	_opts = _read_options()
	_speed_m_s = _opt_float("speed", 12.0)
	_walk_s = _opt_float("walk", 45.0)

	if _opts.get("norender", "0") == "1":
		RenderingServer.render_loop_enabled = false
	process_priority = -1000
	RenderingServer.frame_post_draw.connect(_record_busy)

	_streamer = SpikeChunkStreamer.new()
	_streamer.name = "Chunks"
	_streamer.mode = SpikeChunkStreamer.Mode.SYNC if _opts.get("mode", "") == "sync" \
			else SpikeChunkStreamer.Mode.THREADED
	_streamer.use_sub_threads = _opts.get("sub", "0") == "1"
	_streamer.chunk_size_m = int(_opt_float("chunk", 64.0))
	_streamer.load_radius_m = _opt_float("load", 160.0)
	_streamer.unload_radius_m = _opt_float("unload", 220.0)
	_streamer.max_in_flight = int(_opt_float("inflight", 2.0))
	_streamer.split_nodes = int(_opt_float("split", 0.0))
	_streamer.max_frees_per_frame = int(_opt_float("frees", 1.0))
	add_child(_streamer)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50.0, 35.0, 0.0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 80.0
	add_child(sun)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.62, 0.78, 0.9)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.8, 0.85)
	env.ambient_light_energy = 0.5
	var world_env := WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)

	_camera = Camera3D.new()
	_camera.far = 250.0
	add_child(_camera)
	_place_camera()

	var layer := CanvasLayer.new()
	add_child(layer)
	_hud = Label.new()
	_hud.position = Vector2(12.0, 8.0)
	_hud.add_theme_color_override("font_outline_color", Color.BLACK)
	_hud.add_theme_constant_override("outline_size", 4)
	layer.add_child(_hud)

	_phase_started_us = Time.get_ticks_usec()
	_last_frame_us = _phase_started_us


func _process(_delta: float) -> void:
	if not RenderingServer.render_loop_enabled:
		RenderingServer.force_sync()
	var now := Time.get_ticks_usec()
	_frame_start_us = now
	var dt_ms := (now - _last_frame_us) / 1000.0
	_last_frame_us = now
	var phase_s := (now - _phase_started_us) / 1_000_000.0
	match _phase:
		Phase.INITIAL:
			_streamer.update(_focus)
			if _streamer.is_idle() and _streamer.loaded_count() > 0:
				_initial = {
					"chunks": _streamer.records.size(),
					"ms": (now - _phase_started_us) / 1000.0,
				}
				_streamer.records.clear()
				_streamer.free_us.clear()
				_streamer.frame_work_us.clear()
				_set_phase(Phase.SETTLE, now)
		Phase.SETTLE:
			_settle_dt_ms.append(dt_ms)
			if phase_s >= SETTLE_S:
				_set_phase(Phase.WALK, now)
		Phase.WALK:
			_walk_frames.append(Engine.get_process_frames())
			_walk_dt_ms.append(dt_ms)
			_focus += WALK_DIR.normalized() * _speed_m_s * dt_ms / 1000.0
			_streamer.update(_focus)
			if phase_s >= _walk_s:
				_finish()
		Phase.DONE:
			pass
	_place_camera()
	if Engine.get_process_frames() % 600 == 0:
		print("bench: %s, frame %d, %.0f fps, %d chunks" % [Phase.keys()[_phase],
			Engine.get_process_frames(), Engine.get_frames_per_second(), _streamer.loaded_count()])
	if _phase != Phase.DONE:
		_hud.text = "%s  %.0f fps  chunks %d  %.0f m" % [
			Phase.keys()[_phase], Engine.get_frames_per_second(), _streamer.loaded_count(),
			(_focus - START).length()]
	if not RenderingServer.render_loop_enabled:
		_record_busy()  # nothing is drawn, so frame_post_draw doesn't come


func _record_busy() -> void:
	var busy_ms := (Time.get_ticks_usec() - _frame_start_us) / 1000.0
	if _phase == Phase.SETTLE:
		_settle_busy_ms.append(busy_ms)
	elif _phase == Phase.WALK:
		_busy_by_frame[Engine.get_process_frames()] = busy_ms


func _set_phase(phase: Phase, now_us: int) -> void:
	print("bench: %s after %.1f s in %s (frame %d)" % [Phase.keys()[phase],
		(now_us - _phase_started_us) / 1_000_000.0, Phase.keys()[_phase], Engine.get_process_frames()])
	_phase = phase
	_phase_started_us = now_us


func _place_camera() -> void:
	var ground := Vector3(_focus.x, SpikeTerrain.height_at(_focus.x, _focus.z) + 1.5, _focus.z)
	_camera.position = ground - WALK_DIR.normalized() * CAMERA_BACK_M + Vector3.UP * CAMERA_UP_M
	_camera.look_at(ground)


func _finish() -> void:
	_phase = Phase.DONE
	var lines := PackedStringArray()
	var result := _results(lines)
	_summary = "\n".join(lines)
	_hud.text = _summary
	print(_summary)
	print("RESULT_JSON " + JSON.stringify(result))
	if OS.has_feature("web"):
		# serve.py --plan answers with the next run's URL, so one tab can run a whole suite.
		var js := ("fetch('/results?label=' + encodeURIComponent(%s), {method: 'POST', body: %s})"
			+ ".then(r => r.json()).then(j => { if (j.next) setTimeout(() => location.href = j.next, 1000); })"
			+ ".catch(() => {})") % [
				JSON.stringify(_opts.get("label", "web")), JSON.stringify(JSON.stringify(result))]
		JavaScriptBridge.eval(js, true)
		return
	var out: String = _opts.get("out", "")
	if out != "":
		var f := FileAccess.open(out, FileAccess.WRITE)
		if f != null:
			f.store_string(JSON.stringify(result, "  "))
			f.close()
	if _opts.has("quit"):
		get_tree().quit()


## The results as JSON-ready data, with a readable summary appended to lines.
func _results(lines: PackedStringArray) -> Dictionary:
	# A frame's dt (time since the previous frame started) covers the previous frame's work and
	# drawing, so the frame after the one that did the work shows its hitch.
	var dt_by_frame: Dictionary[int, float] = {}
	for i in _walk_frames.size():
		dt_by_frame[_walk_frames[i]] = _walk_dt_ms[i]
	var after_work := PackedFloat64Array()
	var quiet := PackedFloat64Array()
	var busy_all := PackedFloat64Array()
	var busy_work := PackedFloat64Array()
	var busy_quiet := PackedFloat64Array()
	for i in _walk_frames.size():
		var frame := _walk_frames[i]
		if _streamer.frame_work_us.has(frame - 1):
			after_work.append(_walk_dt_ms[i])
		else:
			quiet.append(_walk_dt_ms[i])
		if _busy_by_frame.has(frame):
			var busy: float = _busy_by_frame[frame]
			busy_all.append(busy)
			if _streamer.frame_work_us.has(frame):
				busy_work.append(busy)
			else:
				busy_quiet.append(busy)

	const COLUMNS: Array[String] = ["hitch_frame_ms", "request_call_ms", "poll_calls_ms", "wait_ms",
		"get_ms", "instantiate_ms", "add_ms", "total_ms"]
	var columns: Dictionary[String, PackedFloat64Array] = {}
	for k in COLUMNS:
		columns[k] = PackedFloat64Array()
	var chunks: Array[Dictionary] = []
	for rec in _streamer.records:
		var d := rec.to_dict()
		var hitch := 0.0
		for frame in rec.work_frames:
			var next_dt: float = dt_by_frame.get(frame + 1, 0.0)
			hitch = maxf(hitch, next_dt)
		d["hitch_frame_ms"] = hitch
		chunks.append(d)
		for k in COLUMNS:
			columns[k].append(float(str(d[k])))
	var per_chunk: Dictionary[String, Stats] = {}
	for k in COLUMNS:
		per_chunk[k] = Stats.of(columns[k])
	var frees := PackedFloat64Array()
	for us in _streamer.free_us:
		frees.append(us / 1000.0)
	var settle := Stats.of(_settle_dt_ms)
	var walk := Stats.of(_walk_dt_ms)
	var after := Stats.of(after_work)
	var without := Stats.of(quiet)
	var free := Stats.of(frees)
	var busy_settle := Stats.of(_settle_busy_ms)
	var busy_walk := Stats.of(busy_all)
	var busy_stream := Stats.of(busy_work)
	var busy_other := Stats.of(busy_quiet)
	var initial_chunks: int = _initial.get("chunks", 0)
	var initial_ms: float = _initial.get("ms", 0.0)
	var static_mb := Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0
	var video_mb := Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0
	var objects := int(Performance.get_monitor(Performance.OBJECT_COUNT))
	var draw_calls := int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	var primitives := int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME))
	var label: String = _opts.get("label", "")

	var web := {}
	lines.append("== streaming spike: %s  (%s, threads feature %s, %d cores)" % [
		label, OS.get_name(), str(OS.has_feature("threads")), OS.get_processor_count()])
	var gpu := "%s / %s" % [RenderingServer.get_video_adapter_vendor(), RenderingServer.get_video_adapter_name()]
	if OS.has_feature("web"):
		# Browsers mask GL_RENDERER; the debug extension gives the real adapter (or SwiftShader).
		gpu = str(JavaScriptBridge.eval("(() => { const gl = document.createElement('canvas')"
			+ ".getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info');"
			+ " return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()", true))
	lines.append("options: %s" % JSON.stringify(_opts))
	lines.append("gpu: %s" % gpu)
	if OS.has_feature("web"):
		var isolated := str(JavaScriptBridge.eval("String(self.crossOriginIsolated)", true))
		web = {
			"user_agent": str(JavaScriptBridge.eval("navigator.userAgent", true)),
			"cross_origin_isolated": isolated,
			"startup_ms": _startup_ms,
		}
		lines.append("start-up: %.0f ms from navigation to first frame; crossOriginIsolated=%s" % [
			_startup_ms, isolated])
	lines.append("initial ring: %d chunks in %.0f ms" % [initial_chunks, initial_ms])
	lines.append("idle frame ms: %s" % settle.text())
	lines.append("walk %.0f m, %d chunks loaded" % [_speed_m_s * _walk_s, chunks.size()])
	lines.append("walk frame ms: %s  >25:%d >33:%d >50:%d" % [
		walk.text(), walk.over_25, walk.over_33, walk.over_50])
	lines.append("  after stream work: %s" % after.text())
	lines.append("  without:           %s" % without.text())
	for k in COLUMNS:
		lines.append("  per chunk %-15s %s" % [k, per_chunk[k].text()])
	lines.append("  free chunk ms:  %s" % free.text())
	lines.append("busy ms (frame start to post-draw): idle %s" % busy_settle.text())
	lines.append("  walking %s" % busy_walk.text())
	lines.append("  frames with stream work %s" % busy_stream.text())
	lines.append("  other frames            %s" % busy_other.text())
	lines.append("memory: static %.0f MB, video %.0f MB, %d objects; %d draw calls, %d primitives" % [
		static_mb, video_mb, objects, draw_calls, primitives])

	var per_chunk_dicts := {}
	for k in COLUMNS:
		per_chunk_dicts[k] = per_chunk[k].to_dict()
	return {
		"label": label,
		"options": _opts,
		"platform": OS.get_name(),
		"threads_feature": OS.has_feature("threads"),
		"nothreads_feature": OS.has_feature("nothreads"),
		"processors": OS.get_processor_count(),
		"gpu": gpu,
		"web": web,
		"initial_load": _initial,
		"settle_frame_ms": settle.to_dict(),
		"walk": {
			"distance_m": _speed_m_s * _walk_s,
			"frame_ms": walk.to_dict(),
			"frames_after_stream_work_ms": after.to_dict(),
			"frames_without_stream_work_ms": without.to_dict(),
			"chunks_loaded": chunks.size(),
			"per_chunk": per_chunk_dicts,
			"free_ms": free.to_dict(),
		},
		"busy_ms": {
			"settle": busy_settle.to_dict(),
			"walk": busy_walk.to_dict(),
			"stream_work_frames": busy_stream.to_dict(),
			"other_frames": busy_other.to_dict(),
		},
		"memory": {
			"static_mb": static_mb,
			"video_mb": video_mb,
			"objects": objects,
			"draw_calls": draw_calls,
			"primitives": primitives,
		},
		"chunks": chunks,
	}


## Percentiles and counts of slow frames for a list of milliseconds.
class Stats:
	var n: int = 0
	var p50: float = 0.0
	var p95: float = 0.0
	var p99: float = 0.0
	var max: float = 0.0
	var over_25: int = 0
	var over_33: int = 0
	var over_50: int = 0

	static func of(values: PackedFloat64Array) -> Stats:
		var s := Stats.new()
		s.n = values.size()
		if s.n == 0:
			return s
		var sorted := values.duplicate()
		sorted.sort()
		s.p50 = _pct(sorted, 0.5)
		s.p95 = _pct(sorted, 0.95)
		s.p99 = _pct(sorted, 0.99)
		s.max = sorted[s.n - 1]
		for v in sorted:
			s.over_25 += 1 if v > 25.0 else 0
			s.over_33 += 1 if v > 33.4 else 0
			s.over_50 += 1 if v > 50.0 else 0
		return s

	static func _pct(sorted: PackedFloat64Array, q: float) -> float:
		return sorted[clampi(roundi(q * (sorted.size() - 1)), 0, sorted.size() - 1)]

	func text() -> String:
		if n == 0:
			return "(none)"
		return "p50 %.1f  p95 %.1f  p99 %.1f  max %.1f  (n=%d)" % [p50, p95, p99, max, n]

	func to_dict() -> Dictionary:
		return {"n": n, "p50": p50, "p95": p95, "p99": p99, "max": max,
			"over_25": over_25, "over_33": over_33, "over_50": over_50}


func _opt_float(key: String, fallback: float) -> float:
	var v: String = _opts.get(key, "")
	return fallback if v == "" else v.to_float()


static func _read_options() -> Dictionary[String, String]:
	var pairs: Dictionary[String, String] = {}
	if OS.has_feature("web"):
		var query := str(JavaScriptBridge.eval("window.location.search", true))
		for part in query.trim_prefix("?").split("&", false):
			var eq := part.find("=")
			pairs[(part if eq < 0 else part.substr(0, eq)).uri_decode()] = \
					"" if eq < 0 else part.substr(eq + 1).uri_decode()
		return pairs
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--"):
			var body := arg.substr(2)
			var eq := body.find("=")
			pairs[body if eq < 0 else body.substr(0, eq)] = "" if eq < 0 else body.substr(eq + 1)
	return pairs
