extends GutTest
## Path playback must match the server's positionAt (server/internal/region/movement.go) exactly:
## distance_cm = speed × (t − start_tick) / tick_hz along the 3D segments, clamped to the end.

const HZ := 20
const EPS := 0.0001


func _path(start: int, speed: int, wps: Array[Vector3i]) -> PathPlayback:
	return PathPlayback.create(start, speed, wps, HZ)


func _straight() -> PathPlayback:
	# 10 m along +x at 4 m/s: 2.5 s = 50 ticks.
	var wps: Array[Vector3i] = [Vector3i(0, 0, 0), Vector3i(1000, 0, 0)]
	return _path(100, 400, wps)


func test_at_the_start_tick_it_is_on_the_first_waypoint() -> void:
	var p := _straight()
	assert_eq(p.position_cm_at(100.0), Vector3(0, 0, 0))
	assert_false(p.is_finished(100.0))


func test_before_the_start_tick_it_waits_on_the_first_waypoint() -> void:
	var p := _straight()
	assert_eq(p.position_cm_at(90.0), Vector3(0, 0, 0))
	assert_eq(p.distance_at(90.0), 0.0)


func test_mid_segment() -> void:
	var p := _straight()
	# 10 ticks at 400 cm/s and 20 Hz = 200 cm.
	assert_almost_eq(p.position_cm_at(110.0).x, 200.0, EPS)
	# Fractional ticks: 12.5 ticks = 250 cm.
	assert_almost_eq(p.position_cm_at(112.5).x, 250.0, EPS)
	assert_eq(p.heading_at(112.5), Vector3(1, 0, 0))


func test_exactly_at_the_end() -> void:
	var p := _straight()
	assert_almost_eq(p.end_tick(), 150.0, EPS)
	assert_eq(p.position_cm_at(150.0), Vector3(1000, 0, 0))
	assert_true(p.is_finished(150.0))
	assert_eq(p.heading_at(150.0), Vector3.ZERO)


func test_past_the_end_stays_on_the_last_waypoint() -> void:
	var p := _straight()
	assert_eq(p.position_cm_at(1000.0), Vector3(1000, 0, 0))
	assert_eq(p.position_at(1000.0), Vector3(10, 0, 0), "metres are centimetres / 100")


func test_distance_is_measured_along_3d_segments_on_a_slope() -> void:
	# A 3-4-5 slope: 300 cm across, 400 cm up, so the segment is 500 cm long in 3D.
	var wps: Array[Vector3i] = [Vector3i(0, 0, 0), Vector3i(300, 400, 0)]
	var p := _path(0, 500, wps)
	assert_almost_eq(p.length_cm(), 500.0, EPS)
	# 1 s at 5 m/s = 20 ticks reaches the top, not 0.6 s as a flat distance would.
	assert_almost_eq(p.end_tick(), 20.0, EPS)
	var mid := p.position_cm_at(10.0)
	assert_almost_eq(mid.x, 150.0, EPS)
	assert_almost_eq(mid.y, 200.0, EPS, "height comes from the waypoints")
	assert_eq(p.heading_at(10.0), Vector3(1, 0, 0), "heading is horizontal")


func test_several_segments_with_corners() -> void:
	var wps: Array[Vector3i] = [
		Vector3i(0, 100, 0), Vector3i(400, 100, 0), Vector3i(400, 100, 300), Vector3i(400, 220, 460),
	]
	var p := _path(0, 400, wps)
	# Lengths 400, 300, 200 (120 up and 160 across).
	assert_almost_eq(p.length_cm(), 900.0, EPS)
	assert_almost_eq(p.position_cm_at(20.0).x, 400.0, EPS, "1 s = 400 cm: the first corner")
	var second := p.position_cm_at(25.0)  # 500 cm: 100 cm into the second segment
	assert_almost_eq(second.x, 400.0, EPS)
	assert_almost_eq(second.z, 100.0, EPS)
	var third := p.position_cm_at(40.0)  # 800 cm: halfway up the last segment
	assert_almost_eq(third.y, 160.0, EPS)
	assert_almost_eq(third.z, 380.0, EPS)
	assert_eq(p.position_cm_at(45.0), Vector3(400, 220, 460))


func test_a_path_recorded_from_the_world_server() -> void:
	# Ugg's path_started from a live run (tests/test_net_dispatch.gd): tick 1414, 400 cm/s.
	var wps: Array[Vector3i] = [Vector3i(-600, 146, 1400), Vector3i(-1179, 103, 421), Vector3i(-1307, 102, 204)]
	var p := _path(1414, 400, wps)
	# 17 ticks later it is 340 cm along the first segment (579 across, 43 down, 979 along z).
	var seg1 := sqrt(579.0 * 579.0 + 43.0 * 43.0 + 979.0 * 979.0)
	var f := 340.0 / seg1
	var got := p.position_cm_at(1431.0)
	assert_almost_eq(got.x, -600.0 - 579.0 * f, 0.001)
	assert_almost_eq(got.y, 146.0 - 43.0 * f, 0.001)
	assert_almost_eq(got.z, 1400.0 - 979.0 * f, 0.001)
	var seg2 := sqrt(128.0 * 128.0 + 1.0 + 217.0 * 217.0)
	assert_almost_eq(p.end_tick(), 1414.0 + (seg1 + seg2) * 20.0 / 400.0, 0.0001)


func test_stationary() -> void:
	var p := PathPlayback.stationary(Vector3i(50, 60, 70), 10, HZ)
	assert_eq(p.position_cm_at(0.0), Vector3(50, 60, 70))
	assert_eq(p.position_cm_at(1e6), Vector3(50, 60, 70))
	assert_true(p.is_finished(10.0))
	assert_eq(p.heading_at(20.0), Vector3.ZERO)


func test_from_proto() -> void:
	var path := Proto.Path.new()
	path.start_tick = 7
	path.speed = 400
	path.waypoints = [Vector3i(0, 0, 0), Vector3i(0, 0, -800)]
	var p := PathPlayback.from_proto(path, HZ)
	assert_almost_eq(p.position_cm_at(17.0).z, -200.0, EPS)


# --- MotionTrack: paths taking over at their start tick ---------------------------------------

func test_track_keeps_the_old_path_until_the_new_one_starts() -> void:
	var track := MotionTrack.new()
	var first: Array[Vector3i] = [Vector3i(0, 0, 0), Vector3i(1000, 0, 0)]
	track.add(_path(0, 400, first))
	# A repath at tick 10, from where the first path has it then (200 cm).
	var second: Array[Vector3i] = [Vector3i(200, 0, 0), Vector3i(200, 0, 1000)]
	track.add(_path(10, 400, second))
	assert_almost_eq(track.position_at(8.0).x * 100.0, 160.0, 0.001, "still on the first path")
	assert_almost_eq(track.position_at(10.0).x * 100.0, 200.0, 0.001, "seamless switch")
	assert_almost_eq(track.position_at(15.0).z * 100.0, 100.0, 0.001, "on the second path")
	track.prune(15.0)
	assert_eq(track.size(), 1, "the finished path is dropped")


func test_track_later_message_replaces_queued_paths() -> void:
	var track := MotionTrack.new()
	var a: Array[Vector3i] = [Vector3i(0, 0, 0), Vector3i(1000, 0, 0)]
	track.add(_path(0, 400, a))
	track.add(_path(20, 400, a))
	track.add(PathPlayback.stationary(Vector3i(300, 0, 0), 15, HZ))
	assert_eq(track.size(), 2, "the stop at 15 replaces the path queued for 20")
	assert_eq(track.position_at(30.0), Vector3(3, 0, 0))
