extends GutTest
## Orbit camera input: middle-drag orbits (right-drag doesn't), and the arrow keys orbit smoothly.

const FRAME := 1.0 / 60.0


func _make_camera() -> OrbitCamera:
	var rig := OrbitCamera.new()
	var cam := Camera3D.new()
	cam.name = "Camera3D"
	rig.add_child(cam)
	add_child_autofree(rig)
	return rig


func _press(button: MouseButton, pressed: bool) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = button
	e.pressed = pressed
	return e


func _drag(dx: float, dy: float) -> InputEventMouseMotion:
	var e := InputEventMouseMotion.new()
	e.relative = Vector2(dx, dy)
	return e


func test_middle_drag_orbits() -> void:
	var rig := _make_camera()
	var yaw := rig.yaw
	rig._unhandled_input(_press(MOUSE_BUTTON_MIDDLE, true))
	rig._unhandled_input(_drag(-50.0, 0.0))
	assert_gt(rig.yaw, yaw, "dragging left turns the camera")
	rig._unhandled_input(_press(MOUSE_BUTTON_MIDDLE, false))
	var after := rig.yaw
	rig._unhandled_input(_drag(-50.0, 0.0))
	assert_eq(rig.yaw, after, "releasing the button stops orbiting")


func test_right_drag_does_not_orbit() -> void:
	var rig := _make_camera()
	var yaw := rig.yaw
	var pitch := rig.pitch
	rig._unhandled_input(_press(MOUSE_BUTTON_RIGHT, true))
	rig._unhandled_input(_drag(80.0, 40.0))
	rig._unhandled_input(_press(MOUSE_BUTTON_RIGHT, false))
	assert_eq(rig.yaw, yaw, "right click is kept for the context menu")
	assert_eq(rig.pitch, pitch)


func test_left_arrow_turns_the_same_way_as_dragging_left() -> void:
	var keys := _make_camera()
	var mouse := _make_camera()
	var start := keys.yaw
	for i in 30:
		keys.key_orbit(Vector2(-1, 0), FRAME)
	mouse.orbit(Vector2(-50, 0))
	assert_gt(keys.yaw, start)
	assert_gt(mouse.yaw, start)


func test_up_arrow_raises_the_camera_and_down_lowers_it() -> void:
	var rig := _make_camera()
	var start := rig.pitch
	for i in 10:
		rig.key_orbit(Vector2(0, -1), FRAME)
	assert_gt(rig.pitch, start, "up looks down more")
	var raised := rig.pitch
	for i in 40:
		rig.key_orbit(Vector2(0, 1), FRAME)
	assert_lt(rig.pitch, raised, "down lowers it")


func test_arrow_orbit_eases_in() -> void:
	var rig := _make_camera()
	var steps: Array[float] = []
	var last := rig.yaw
	for i in 30:
		rig.key_orbit(Vector2(1, 0), FRAME)
		steps.append(absf(rig.yaw - last))
		last = rig.yaw
	assert_lt(steps[0], steps[5], "starts slowly")
	assert_lt(steps[5], steps[29] + 1e-9, "keeps speeding up until full speed")
	var full := deg_to_rad(OrbitCamera.KEY_YAW_SPEED_DEG) * FRAME
	assert_almost_eq(steps[29], full, full * 0.02, "reaches full speed within half a second")


func test_arrow_orbit_eases_out_and_stops() -> void:
	var rig := _make_camera()
	for i in 30:
		rig.key_orbit(Vector2(1, 0), FRAME)
	var held := rig.yaw
	rig.key_orbit(Vector2.ZERO, FRAME)
	assert_lt(rig.yaw, held, "glides on briefly after release")
	for i in 120:
		rig.key_orbit(Vector2.ZERO, FRAME)
	var settled := rig.yaw
	rig.key_orbit(Vector2.ZERO, FRAME)
	assert_eq(rig.yaw, settled, "then stops completely")


func test_arrow_pitch_is_clamped() -> void:
	var rig := _make_camera()
	for i in 600:
		rig.key_orbit(Vector2(0, -1), FRAME)
	assert_almost_eq(rig.pitch, deg_to_rad(OrbitCamera.MAX_PITCH_DEG), 1e-6)
	for i in 600:
		rig.key_orbit(Vector2(0, 1), FRAME)
	assert_almost_eq(rig.pitch, deg_to_rad(OrbitCamera.MIN_PITCH_DEG), 1e-6)


func test_diagonal_keys_are_not_faster() -> void:
	var rig := _make_camera()
	for i in 60:
		rig.key_orbit(Vector2(1, 1), FRAME)
	var before := rig.yaw
	rig.key_orbit(Vector2(1, 1), FRAME)
	var step := absf(rig.yaw - before)
	assert_lt(step, deg_to_rad(OrbitCamera.KEY_YAW_SPEED_DEG) * FRAME, "held diagonally, each axis is a bit slower")
