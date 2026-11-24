extends SceneTree
## Generates region.tscn, the M0 greybox test region: about 200 m x 200 m with rolling hills, a
## plateau with a cliff and a cave mouth, a river with one ford, and scattered rocks.
##
##   /Applications/Godot.app/Contents/MacOS/Godot --headless --path client \
##       -s res://regions/test_greybox/build_greybox.gd
##   tools/export-regions.sh --bake test_greybox
##
## Running it OVERWRITES region.tscn, including any hand edits made in the editor. Once the region
## is being edited by hand, stop using this and treat the scene as the only source. The heights,
## layout and rock seed below are greybox choices, not game rules.

const OUT_PATH := "res://regions/test_greybox/region.tscn"
const SPAWN_SCRIPT := "res://regions/markers/spawn_point.gd"
const RESPAWN_SCRIPT := "res://regions/markers/respawn_point.gd"
const TERRAIN_SCRIPT := "res://regions/test_greybox/heightmap_terrain.gd"

const SAMPLES := 101 # per side, so 100 cells
const SPACING_M := 2.0 # 100 cells x 2 m = 200 m, centred on the origin
const HEIGHT_STEP_M := 1.0 / 16.0 # heights are quantised so the scene text stays short

const WATER_Y := -0.6
const RIVER_BED_Y := -1.5
const RIVER_BED_HALF_WIDTH_M := 4.0
const RIVER_BANK_SLOPE := 0.5 # rise per metre, about 27 degrees: walkable down to the water
const FORD_Z := 9.0
const FORD_HALF_LENGTH_M := 4.0
const FORD_FADE_M := 3.0
const FORD_BED_Y := -0.2
const MIN_WATER_HALF_WIDTH_M := 0.5

const PLATEAU_Y := 12.0
const CLIFF_FOOT_Z := -40.0 # the plateau's south cliff runs from here...
const CLIFF_TOP_Z := -46.0 # ...up to here (12 m over 6 m: far too steep to walk)
const RAMP_TOP_X := -40.0 # the plateau's east side is a walkable ramp...
const RAMP_FOOT_X := -15.0 # ...down to here (12 m over 25 m, about 26 degrees)

const CAVE_X := -55.0
const CAVE_FRONT_Z := -30.0
const CAVE_BACK_Z := -48.0
const CAVE_HALF_WIDTH_M := 2.5
const CAVE_HEADROOM_M := 3.5
const CAVE_WALL_M := 6.5

const PLAYER_SPAWN := Vector2(-6.0, 14.0)
const RESPAWN := Vector2(-2.0, 24.0)

const ROCK_SEED := 20261124
const ROCK_COUNT := 32
const ROCK_FILL_SIDES := 8

## [x, z, height, sigma] gaussian hills
const HILLS: Array[Vector4] = [
	Vector4(58.0, -52.0, 14.0, 20.0),
	Vector4(-48.0, 52.0, 9.0, 15.0),
	Vector4(62.0, 58.0, 6.0, 12.0),
	Vector4(-5.0, 78.0, 4.0, 10.0),
]

var _scene_root: Node3D


func _initialize() -> void:
	_scene_root = Node3D.new()
	_scene_root.name = "TestGreybox"
	_build()
	_own(_scene_root)
	var packed := PackedScene.new()
	var err := packed.pack(_scene_root)
	if err == OK:
		err = ResourceSaver.save(packed, OUT_PATH)
	_scene_root.free()
	if err != OK:
		printerr("build_greybox: can't save %s (%s)" % [OUT_PATH, error_string(err)])
		quit(1)
		return
	print("build_greybox: wrote %s; now run tools/export-regions.sh --bake test_greybox" % OUT_PATH)
	quit(0)


func _build() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-50.0, 35.0, 0.0)
	sun.shadow_enabled = true
	_scene_root.add_child(sun)

	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.62, 0.78, 0.9)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.8, 0.85)
	env.ambient_light_energy = 0.5
	var world_env := WorldEnvironment.new()
	world_env.name = "Environment"
	world_env.environment = env
	_scene_root.add_child(world_env)

	var nav := NavigationRegion3D.new()
	nav.name = "NavigationRegion3D"
	nav.navigation_mesh = _navmesh_settings()
	_scene_root.add_child(nav)
	nav.add_child(_terrain())
	nav.add_child(_cave())
	nav.add_child(_rocks())
	nav.add_child(_river_obstacles())

	var water := MeshInstance3D.new()
	water.name = "Water"
	var plane := PlaneMesh.new()
	plane.size = Vector2(SAMPLES - 1, SAMPLES - 1) * SPACING_M
	plane.material = _material(Color(0.25, 0.45, 0.7))
	water.mesh = plane
	water.position.y = WATER_Y
	_scene_root.add_child(water)

	var markers := Node3D.new()
	markers.name = "Markers"
	_scene_root.add_child(markers)
	markers.add_child(_marker("PlayerSpawn", SPAWN_SCRIPT, PLAYER_SPAWN))
	markers.add_child(_marker("Respawn", RESPAWN_SCRIPT, RESPAWN))


func _navmesh_settings() -> NavigationMesh:
	var nm := NavigationMesh.new()
	nm.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nm.cell_size = 0.2
	nm.cell_height = 0.2
	nm.agent_radius = RegionExport.AGENT_RADIUS_M
	nm.agent_height = RegionExport.AGENT_HEIGHT_M
	nm.agent_max_climb = RegionExport.AGENT_MAX_CLIMB_M
	nm.agent_max_slope = RegionExport.AGENT_MAX_SLOPE_DEG
	nm.region_min_size = 8.0 # drops walkable scraps under about 2.5 m², e.g. on rock tips
	nm.detail_sample_distance = 10.0 # 2 m, the heightmap spacing
	nm.detail_sample_max_error = 1.0
	return nm


func _terrain() -> StaticBody3D:
	var heights := PackedFloat32Array()
	heights.resize(SAMPLES * SAMPLES)
	for iz in SAMPLES:
		for ix in SAMPLES:
			var p := _sample_xz(ix, iz)
			heights[iz * SAMPLES + ix] = snappedf(height_at(p.x, p.y), HEIGHT_STEP_M)
	var shape := HeightMapShape3D.new()
	shape.map_width = SAMPLES
	shape.map_depth = SAMPLES
	shape.map_data = heights

	var body := StaticBody3D.new()
	body.name = "Terrain"
	var col := CollisionShape3D.new()
	col.name = "Collision"
	col.shape = shape
	col.scale = Vector3(SPACING_M, 1.0, SPACING_M)
	body.add_child(col)

	var view := Node3D.new()
	view.name = "Visual"
	view.set_script(load(TERRAIN_SCRIPT))
	var mat := _material(Color.WHITE)
	mat.vertex_color_use_as_albedo = true
	view.set("material", mat)
	view.set("spacing_m", SPACING_M)
	view.set("heightmap", shape)
	body.add_child(view)
	return body


func _sample_xz(ix: int, iz: int) -> Vector2:
	var half := (SAMPLES - 1) * 0.5 * SPACING_M
	return Vector2(ix * SPACING_M - half, iz * SPACING_M - half)


## Ground height before quantising: gentle noise, hills, the plateau, then the river carved in.
func height_at(x: float, z: float) -> float:
	var h := 0.8 + 0.35 * sin(x * 0.07 + 1.3) * cos(z * 0.05 - 0.4) + 0.2 * sin((x + z) * 0.11)
	for hill in HILLS:
		var d2 := (x - hill.x) ** 2 + (z - hill.y) ** 2
		h += hill.z * exp(-d2 / (2.0 * hill.w * hill.w))
	var cliff := clampf((CLIFF_FOOT_Z - z) / (CLIFF_FOOT_Z - CLIFF_TOP_Z), 0.0, 1.0)
	var ramp := clampf((RAMP_FOOT_X - x) / (RAMP_FOOT_X - RAMP_TOP_X), 0.0, 1.0)
	h = maxf(h, PLATEAU_Y * cliff * ramp)
	var bank := river_bed_y(z) + maxf(0.0, river_distance(x, z) - RIVER_BED_HALF_WIDTH_M) * RIVER_BANK_SLOPE
	return minf(h, bank)


func river_centre_x(z: float) -> float:
	return 22.0 + 9.0 * sin(z / 23.0 + 0.5)


## Distance from the river's centre line, measured square to it.
func river_distance(x: float, z: float) -> float:
	var slope := 9.0 / 23.0 * cos(z / 23.0 + 0.5)
	return absf(x - river_centre_x(z)) / sqrt(1.0 + slope * slope)


func river_bed_y(z: float) -> float:
	var ford := clampf(1.0 - (absf(z - FORD_Z) - FORD_HALF_LENGTH_M) / FORD_FADE_M, 0.0, 1.0)
	return lerpf(RIVER_BED_Y, FORD_BED_Y, ford)


## Half-width of the water surface at z, or 0 where the bed is above the water (the ford).
func water_half_width(z: float) -> float:
	var depth := WATER_Y - river_bed_y(z)
	return RIVER_BED_HALF_WIDTH_M + depth / RIVER_BANK_SLOPE if depth > 0.0 else 0.0


## The water is cut out of the navmesh with carving obstacles: one quad per 2 m of river, skipping
## the ford, which stays walkable.
func _river_obstacles() -> Node3D:
	var river := Node3D.new()
	river.name = "River"
	var half := (SAMPLES - 1) * 0.5 * SPACING_M
	var z := -half - 2.0
	var n := 0
	while z < half + 2.0:
		var z1 := z + 2.5 # overlap the next quad by 0.5 m
		var w0 := water_half_width(z)
		var w1 := water_half_width(z1)
		if w0 > 0.0 or w1 > 0.0:
			# Where the water starts or ends inside this quad, taper it to a thin point rather than
			# leave the water's tip uncarved.
			w0 = maxf(w0, MIN_WATER_HALF_WIDTH_M)
			w1 = maxf(w1, MIN_WATER_HALF_WIDTH_M)
			n += 1
			var ob := NavigationObstacle3D.new()
			ob.name = "Water%03d" % n
			ob.position.y = RIVER_BED_Y - 1.0
			ob.height = WATER_Y - ob.position.y
			var c0 := river_centre_x(z)
			var c1 := river_centre_x(z1)
			ob.vertices = PackedVector3Array([
				Vector3(c0 - w0, 0.0, z), Vector3(c0 + w0, 0.0, z),
				Vector3(c1 + w1, 0.0, z1), Vector3(c1 - w1, 0.0, z1),
			])
			ob.affect_navigation_mesh = true
			ob.carve_navigation_mesh = true
			ob.avoidance_enabled = false
			river.add_child(ob)
		z += 2.0
	return river


## A rock outcrop against the plateau cliff with a 5 m wide, 10 m deep cave mouth in it. The
## outcrop's top is level with the plateau, so it walks as part of the plateau.
func _cave() -> Node3D:
	var cave := Node3D.new()
	cave.name = "Cave"
	var floor_y := height_at(CAVE_X, CAVE_FRONT_Z)
	var depth := CAVE_FRONT_Z - CAVE_BACK_Z
	var mid_z := (CAVE_FRONT_Z + CAVE_BACK_Z) * 0.5
	var base_y := floor_y - 1.5
	var rock := _material(Color(0.47, 0.44, 0.42))
	var wall_x := CAVE_HALF_WIDTH_M + CAVE_WALL_M * 0.5
	for side: float in [-1.0, 1.0]:
		var wall_name := "WallWest" if side < 0.0 else "WallEast"
		var at := Vector3(CAVE_X + side * wall_x, 0.0, mid_z)
		cave.add_child(_box(wall_name, at, base_y, PLATEAU_Y, Vector2(CAVE_WALL_M, depth), rock))
		var hx := CAVE_WALL_M * 0.5
		var hz := depth * 0.5
		cave.add_child(_fill(wall_name + "Inside", at, base_y - 1.0, floor_y + CAVE_HEADROOM_M,
			PackedVector3Array([
				Vector3(-hx, 0.0, -hz), Vector3(hx, 0.0, -hz), Vector3(hx, 0.0, hz), Vector3(-hx, 0.0, hz),
			])))
	cave.add_child(_box("Roof", Vector3(CAVE_X, 0.0, mid_z), floor_y + CAVE_HEADROOM_M, PLATEAU_Y,
		Vector2(CAVE_HALF_WIDTH_M * 2.0, depth), rock))
	# A dark block where the cliff closes the cave, so it reads as going deeper. Visual only.
	var dark := MeshInstance3D.new()
	dark.name = "Darkness"
	var box := BoxMesh.new()
	box.size = Vector3(CAVE_HALF_WIDTH_M * 2.0, CAVE_HEADROOM_M + 0.5, 2.5)
	box.material = _material(Color(0.06, 0.05, 0.05))
	dark.mesh = box
	dark.position = Vector3(CAVE_X, floor_y + (CAVE_HEADROOM_M - 0.5) * 0.5, CLIFF_FOOT_Z - 0.75)
	cave.add_child(dark)
	return cave


## Recast doesn't fill closed shapes, so ground enclosed by a wall or a rock bakes as a walkable
## island inside it. This obstacle drops the source geometry inside `outline` (around `at`) between
## `bottom_y` and `top_y`; set top_y above the ground but below any top that should stay walkable.
func _fill(node_name: String, at: Vector3, bottom_y: float, top_y: float,
		outline: PackedVector3Array) -> NavigationObstacle3D:
	var ob := NavigationObstacle3D.new()
	ob.name = node_name
	ob.position = Vector3(at.x, bottom_y, at.z)
	ob.height = top_y - bottom_y
	ob.vertices = outline
	ob.affect_navigation_mesh = true
	ob.avoidance_enabled = false
	return ob


func _box(node_name: String, at: Vector3, bottom_y: float, top_y: float, size_xz: Vector2,
		mat: Material) -> StaticBody3D:
	var size := Vector3(size_xz.x, top_y - bottom_y, size_xz.y)
	var body := StaticBody3D.new()
	body.name = node_name
	body.position = Vector3(at.x, (bottom_y + top_y) * 0.5, at.z)
	var col := CollisionShape3D.new()
	col.name = "Collision"
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	body.add_child(col)
	var mesh := MeshInstance3D.new()
	mesh.name = "Mesh"
	var box := BoxMesh.new()
	box.size = size
	box.material = mat
	mesh.mesh = box
	body.add_child(mesh)
	return body


## Pointed boulders (steep sides, small tips) so no walkable scraps end up on top of them.
func _rocks() -> Node3D:
	var rocks := Node3D.new()
	rocks.name = "Rocks"
	var rng := RandomNumberGenerator.new()
	rng.seed = ROCK_SEED
	var mat := _material(Color(0.55, 0.53, 0.5))
	var placed := 0
	var tries := 0
	while placed < ROCK_COUNT and tries < 2000:
		tries += 1
		var x := rng.randf_range(-90.0, 90.0)
		var z := rng.randf_range(-90.0, 90.0)
		var radius := rng.randf_range(1.0, 3.0)
		if not _rock_fits(x, z, radius):
			continue
		placed += 1
		var height := radius * rng.randf_range(1.3, 1.9)
		var cyl := CylinderMesh.new()
		cyl.bottom_radius = radius
		cyl.top_radius = radius * 0.3
		cyl.height = height
		cyl.radial_segments = rng.randi_range(5, 8)
		cyl.rings = 0
		cyl.material = mat
		# Sit on the lowest ground under the rock, sunk a little, so it never floats.
		var ground := height_at(x, z)
		var ground_top := ground
		var inside := PackedVector3Array()
		for a in ROCK_FILL_SIDES:
			var ang := a * TAU / ROCK_FILL_SIDES
			var dir := Vector3(cos(ang), 0.0, sin(ang))
			var h := height_at(x + dir.x * radius, z + dir.z * radius)
			ground = minf(ground, h)
			ground_top = maxf(ground_top, h)
			inside.append(dir * radius * 0.9)
		var body := StaticBody3D.new()
		body.name = "Rock%02d" % placed
		body.position = Vector3(x, ground - 0.25, z)
		body.rotation = Vector3(rng.randf_range(-0.12, 0.12), rng.randf_range(0.0, TAU), rng.randf_range(-0.12, 0.12))
		var col := CollisionShape3D.new()
		col.name = "Collision"
		col.shape = cyl.create_convex_shape()
		col.position.y = height * 0.5
		body.add_child(col)
		var mesh := MeshInstance3D.new()
		mesh.name = "Mesh"
		mesh.mesh = cyl
		mesh.position.y = height * 0.5
		body.add_child(mesh)
		rocks.add_child(body)
		rocks.add_child(_fill(body.name + "Inside", body.position, ground - 1.0, ground_top + 1.0, inside))
	return rocks


func _rock_fits(x: float, z: float, radius: float) -> bool:
	var clear := radius + 3.0
	if river_distance(x, z) < water_half_width(z) + clear + 2.0:
		return false
	if absf(z - FORD_Z) < 10.0 and river_distance(x, z) < 14.0: # keep the ford's approaches open
		return false
	if x < RAMP_FOOT_X + clear and z < CLIFF_FOOT_Z + clear: # plateau, cliff and ramp
		return false
	if absf(x - CAVE_X) < CAVE_HALF_WIDTH_M + CAVE_WALL_M + clear and z < CAVE_FRONT_Z + 12.0:
		return false
	for keep in [PLAYER_SPAWN, RESPAWN] as Array[Vector2]:
		if Vector2(x, z).distance_to(keep) < 8.0 + clear:
			return false
	return true


func _marker(node_name: String, script_path: String, at: Vector2) -> Marker3D:
	var m := Marker3D.new()
	m.name = node_name
	m.set_script(load(script_path))
	m.position = Vector3(at.x, snappedf(height_at(at.x, at.y), HEIGHT_STEP_M), at.y)
	return m


func _material(colour: Color) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = colour
	mat.roughness = 1.0
	return mat


func _own(node: Node) -> void:
	for child in node.get_children():
		child.owner = _scene_root
		_own(child)
