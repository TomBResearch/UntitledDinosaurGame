extends GutTest
## Error blend: a jump in the target eases out over 150 ms instead of popping.


func test_an_error_over_half_a_metre_blends_over_150_ms() -> void:
	var b := ErrorBlend.new()
	b.start(Vector3(0.8, 0, 0))
	assert_true(b.is_active())
	assert_eq(b.offset(), Vector3(0.8, 0, 0), "drawn where it was at first")
	b.advance(75.0)
	assert_almost_eq(b.offset().x, 0.4, 0.0001, "halfway (smoothstep is symmetric)")
	b.advance(74.0)
	assert_gt(b.offset().x, 0.0, "still blending just before 150 ms")
	b.advance(1.0)
	assert_eq(b.offset(), Vector3.ZERO, "on target at 150 ms")
	assert_false(b.is_active())


func test_offset_shrinks_steadily() -> void:
	var b := ErrorBlend.new()
	b.start(Vector3(0, 0, -2.0))
	var last := 2.0
	for i in 15:
		b.advance(10.0)
		var size := b.offset().length()
		assert_true(size < last, "shrinks every step")
		last = size
	assert_eq(last, 0.0)


func test_small_errors_blend_too_rather_than_popping() -> void:
	var b := ErrorBlend.new()
	b.start(Vector3(0.3, 0, 0))
	assert_true(b.is_active())
	b.advance(ErrorBlend.BLEND_MS)
	assert_eq(b.offset(), Vector3.ZERO)


func test_rounding_sized_errors_are_ignored() -> void:
	var b := ErrorBlend.new()
	b.start(Vector3(0.004, 0, 0))
	assert_false(b.is_active())
	assert_eq(b.offset(), Vector3.ZERO)


func test_teleport_sized_errors_snap() -> void:
	var b := ErrorBlend.new()
	b.start(Vector3(50, 0, 0))
	assert_false(b.is_active())
	assert_eq(b.offset(), Vector3.ZERO)


func test_a_new_error_replaces_one_in_progress() -> void:
	var b := ErrorBlend.new()
	b.start(Vector3(1, 0, 0))
	b.advance(100.0)
	b.start(Vector3(0, 0, 0.6))
	assert_eq(b.offset(), Vector3(0, 0, 0.6))
	b.advance(150.0)
	assert_eq(b.offset(), Vector3.ZERO)


func test_player_view_blends_a_repath_of_your_own_character() -> void:
	# Your character is drawn at the current tick, ahead of the server's start tick for the new
	# path, so the new path puts it somewhere else. The view blends the difference out.
	var view: PlayerView = autofree(preload("res://entities/player/player_view.tscn").instantiate())
	add_child(view)
	var enter := Proto.EntityEnter.new()
	enter.entity = 1
	enter.name = "Ugg"
	enter.position = Vector3i(0, 0, 0)
	var path := Proto.Path.new()
	path.start_tick = 0
	path.speed = 400
	path.waypoints = [Vector3i(0, 0, 0), Vector3i(2000, 0, 0)]
	enter.path = path
	view.setup(enter, 20, true)
	view.update_view(20.0, 16.0)
	assert_almost_eq(view.position.x, 4.0, 0.0001, "1 s at 4 m/s")
	# A repath that started at tick 18 (where the first path had it at 3.6 m), heading +z.
	var wps: Array[Vector3i] = [Vector3i(360, 0, 0), Vector3i(360, 0, 2000)]
	view.apply_path(PathPlayback.create(18, 400, wps, 20), 20.0)
	view.update_view(20.0, 0.0)
	assert_almost_eq(view.position.x, 4.0, 0.0001, "no pop: still drawn where it was")
	view.update_view(23.0, 150.0)
	assert_almost_eq(view.position.x, 3.6, 0.0001, "on the server's path after 150 ms")
	assert_almost_eq(view.position.z, 1.0, 0.0001, "5 ticks along the new path")
