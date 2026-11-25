extends SceneTree
## Generates the streaming spike's chunked region into generated/ (ignored by git):
##
##   /Applications/Godot.app/Contents/MacOS/Godot --path client \
##       -s res://spikes/streaming/build_spike_region.gd
##
## Not --headless: the headless renderer keeps no MultiMesh buffers, so the props would be saved
## without their transforms. It opens a window for a moment.
##
## The region is SpikeTerrain.TILE_M (512 m) square, written once per chunk size: 8 x 8 chunks of
## 64 m in generated/chunks64/ and 16 x 16 chunks of 32 m in generated/chunks32/. Heights repeat every
## 512 m, so the bench tiles the chunks over an endless plane.
##
## Each chunk is what a real one is likely to hold (docs/architecture/content-pipeline.md):
## - a terrain mesh at 1 m spacing (vertex coloured, as the art direction is low-poly) and its
##   HeightMapShape3D collision;
## - scattered props drawn as one MultiMeshInstance3D per prop mesh (trees, rocks, bushes, ferns,
##   pebbles), so a chunk costs about ten draw calls, within the 400 draw-call budget;
## - hand-placed "landmarks" (boulders and dead trees) as instanced sub-scenes with collision, like
##   props imported from Blender.
## Prop meshes, landmark scenes and materials are shared files, as they would be in the game.
## Counts are per 64 m chunk and scale with area for smaller chunks.

const OUT := SpikeTerrain.GENERATED_DIR
const SPACING_M := 1.0

const TREES := 45
const ROCKS := 40
const BUSHES := 30
const FERNS := 600
const PEBBLES := 300
const BOULDERS := 8
const DEAD_TREES := 4
const BASE_AREA_M2 := 64.0 * 64.0
## Small props are hidden beyond these distances (from the camera to the chunk's props).
const FERN_RANGE_M := 70.0
const BUSH_RANGE_M := 100.0
const ROCK_RANGE_M := 120.0

var _vertex_mat: StandardMaterial3D
var _foliage_mat: StandardMaterial3D
var _meshes: Dictionary[String, ArrayMesh] = {}
var _boulder: PackedScene
var _dead_tree: PackedScene


func _initialize() -> void:
	if DisplayServer.get_name() == "headless":
		printerr("build_spike_region: run it without --headless (MultiMesh buffers need a renderer)")
		quit(1)
		return
	var err := _generate()
	if err != OK:
		printerr("build_spike_region: failed (%s)" % error_string(err))
		quit(1)
		return
	print("build_spike_region: wrote %s" % OUT)
	quit(0)


func _generate() -> Error:
	for dir: String in ["materials", "props"]:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT.path_join(dir)))
	_vertex_mat = _material(false)
	_foliage_mat = _material(true)
	var err := _save(_vertex_mat, "materials/vertex.tres")
	if err == OK:
		err = _save(_foliage_mat, "materials/foliage.tres")
	if err != OK:
		return err
	err = _build_prop_meshes()
	if err != OK:
		return err
	_boulder = _landmark_scene("boulder", _meshes["boulder"], _meshes["boulder"].create_convex_shape())
	_dead_tree = _landmark_scene("dead_tree", _meshes["dead_tree"], _dead_tree_shape())
	if _boulder == null or _dead_tree == null:
		return FAILED
	for size_m in SpikeTerrain.CHUNK_SIZES:
		var dir := OUT.path_join("chunks%d" % size_m)
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(dir))
		var per_side := int(SpikeTerrain.TILE_M) / size_m
		for iz in per_side:
			for ix in per_side:
				var chunk := _chunk(size_m, ix, iz)
				var packed := PackedScene.new()
				err = packed.pack(chunk)
				chunk.free()
				if err == OK:
					err = ResourceSaver.save(packed, SpikeTerrain.chunk_path(size_m, ix, iz))
				if err != OK:
					return err
	return OK


## Saves a shared resource and gives it that path, so chunks refer to the file instead of embedding
## a copy.
func _save(res: Resource, rel_path: String) -> Error:
	var path := OUT.path_join(rel_path)
	var err := ResourceSaver.save(res, path)
	if err == OK:
		res.take_over_path(path)
	return err


func _material(double_sided: bool) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 1.0
	if double_sided:
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	return mat


# --- Prop meshes -------------------------------------------------------------------------------

func _build_prop_meshes() -> Error:
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.22
	trunk.bottom_radius = 0.35
	trunk.height = 4.5
	trunk.radial_segments = 7
	trunk.rings = 1
	var round_canopy := SphereMesh.new()
	round_canopy.radius = 2.2
	round_canopy.height = 3.4
	round_canopy.radial_segments = 9
	round_canopy.rings = 5
	var cone_canopy := CylinderMesh.new()
	cone_canopy.top_radius = 0.0
	cone_canopy.bottom_radius = 1.9
	cone_canopy.height = 5.5
	cone_canopy.radial_segments = 8
	cone_canopy.rings = 2
	var rock := SphereMesh.new()
	rock.radius = 0.8
	rock.height = 1.1
	rock.radial_segments = 7
	rock.rings = 4
	var flat_rock := SphereMesh.new()
	flat_rock.radius = 1.1
	flat_rock.height = 0.8
	flat_rock.radial_segments = 6
	flat_rock.rings = 3
	var bush := SphereMesh.new()
	bush.radius = 1.0
	bush.height = 1.3
	bush.radial_segments = 8
	bush.rings = 4
	var pebble := SphereMesh.new()
	pebble.radius = 0.15
	pebble.height = 0.2
	pebble.radial_segments = 5
	pebble.rings = 3
	var boulder := SphereMesh.new()
	boulder.radius = 3.0
	boulder.height = 4.2
	boulder.radial_segments = 11
	boulder.rings = 7
	var dead_trunk := CylinderMesh.new()
	dead_trunk.top_radius = 0.15
	dead_trunk.bottom_radius = 0.6
	dead_trunk.height = 8.0
	dead_trunk.radial_segments = 8
	dead_trunk.rings = 3

	_meshes["trunk"] = _jittered(trunk, Color(0.4, 0.28, 0.18), 0.03, 2.25, 11)
	_meshes["round_canopy"] = _jittered(round_canopy, Color(0.25, 0.5, 0.2), 0.35, 5.6, 12)
	_meshes["cone_canopy"] = _jittered(cone_canopy, Color(0.18, 0.4, 0.22), 0.2, 6.5, 13)
	_meshes["rock"] = _jittered(rock, Color(0.52, 0.5, 0.47), 0.18, 0.3, 14)
	_meshes["flat_rock"] = _jittered(flat_rock, Color(0.47, 0.45, 0.42), 0.2, 0.15, 15)
	_meshes["bush"] = _jittered(bush, Color(0.3, 0.52, 0.22), 0.2, 0.45, 16)
	_meshes["pebble"] = _jittered(pebble, Color(0.55, 0.52, 0.48), 0.04, 0.05, 17)
	_meshes["boulder"] = _jittered(boulder, Color(0.5, 0.47, 0.44), 0.6, 1.6, 18)
	_meshes["dead_tree"] = _jittered(dead_trunk, Color(0.45, 0.4, 0.35), 0.08, 4.0, 19)
	_meshes["fern"] = _fern()
	for key: String in _meshes:
		var err := _save(_meshes[key], "props/%s.tres" % key)
		if err != OK:
			return err
	return OK


## A primitive baked to an ArrayMesh (as a Blender import would be), with its vertices pushed in or
## out a little and vertex colours, raised by lift_m so its base sits on the ground.
func _jittered(prim: PrimitiveMesh, colour: Color, jitter_m: float, lift_m: float, seed: int) -> ArrayMesh:
	var arrays := prim.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var colours := PackedColorArray()
	colours.resize(verts.size())
	for i in verts.size():
		var p := verts[i]
		# Hash the original position so vertices shared along UV seams stay welded.
		var push := _hash01(p, seed) * 2.0 - 1.0
		var out := Vector3(p.x, 0.0, p.z).normalized() if absf(p.x) + absf(p.z) > 0.001 else Vector3.UP
		verts[i] = p + out * push * jitter_m + Vector3.UP * lift_m
		var shade := 0.8 + 0.3 * _hash01(p, seed + 1)
		colours[i] = Color(colour.r * shade, colour.g * shade, colour.b * shade)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = colours
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, _vertex_mat)
	return mesh


## Three crossed quads.
func _fern() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 3:
		var dir := Vector3.RIGHT.rotated(Vector3.UP, k * PI / 3.0) * 0.6
		var a := -dir
		var b := dir
		var c := dir + Vector3(0.0, 0.9, 0.0)
		var d := -dir + Vector3(0.0, 0.9, 0.0)
		var normal := dir.cross(Vector3.UP).normalized()
		for v: Vector3 in [a, b, c, a, c, d]:
			st.set_color(Color(0.3, 0.55, 0.22) if v.y < 0.1 else Color(0.45, 0.7, 0.3))
			st.set_normal(normal)
			st.add_vertex(v)
	var mesh := st.commit()
	mesh.surface_set_material(0, _foliage_mat)
	return mesh


func _dead_tree_shape() -> CylinderShape3D:
	var shape := CylinderShape3D.new()
	shape.radius = 0.5
	shape.height = 8.0
	return shape


func _landmark_scene(scene_name: String, mesh: ArrayMesh, shape: Shape3D) -> PackedScene:
	var root := Node3D.new()
	root.name = scene_name.to_pascal_case()
	var view := MeshInstance3D.new()
	view.name = "Mesh"
	view.mesh = mesh
	root.add_child(view)
	var body := StaticBody3D.new()
	body.name = "Body"
	root.add_child(body)
	var col := CollisionShape3D.new()
	col.name = "Shape"
	col.shape = shape
	if shape is CylinderShape3D:
		col.position.y = 4.0
	body.add_child(col)
	_own(root, root)
	var packed := PackedScene.new()
	var err := packed.pack(root)
	root.free()
	var path := OUT.path_join("props/%s.tscn" % scene_name)
	if err == OK:
		err = ResourceSaver.save(packed, path)
	if err != OK:
		return null
	# Loaded back from the file, so instances of it are saved in chunks as instances.
	return ResourceLoader.load(path, "PackedScene", ResourceLoader.CACHE_MODE_REPLACE) as PackedScene


# --- Chunks ------------------------------------------------------------------------------------

func _chunk(size_m: int, ix: int, iz: int) -> Node3D:
	var x0 := float(ix * size_m)
	var z0 := float(iz * size_m)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash([size_m, ix, iz])
	var area_scale := float(size_m * size_m) / BASE_AREA_M2

	var root := Node3D.new()
	root.name = "Chunk_%d_%d" % [ix, iz]

	var terrain := MeshInstance3D.new()
	terrain.name = "Terrain"
	terrain.mesh = _terrain_mesh(size_m, x0, z0)
	root.add_child(terrain)

	var body := StaticBody3D.new()
	body.name = "TerrainBody"
	root.add_child(body)
	var col := CollisionShape3D.new()
	col.name = "Shape"
	col.shape = _terrain_shape(size_m, x0, z0)
	col.position = Vector3(size_m * 0.5, 0.0, size_m * 0.5) # HeightMapShape3D is centred
	body.add_child(col)

	var props := Node3D.new()
	props.name = "Props"
	root.add_child(props)
	var tree_xforms := _scatter(rng, roundi(TREES * area_scale), size_m, x0, z0, 0.8, 1.3, false)
	var round_trees: Array[Transform3D] = []
	var cone_trees: Array[Transform3D] = []
	for i in tree_xforms.size():
		(round_trees if i % 3 != 0 else cone_trees).append(tree_xforms[i])
	var rocks := _scatter(rng, roundi(ROCKS * area_scale), size_m, x0, z0, 0.6, 1.6, true)
	var rocks_a: Array[Transform3D] = rocks.slice(0, rocks.size() / 2)
	var rocks_b: Array[Transform3D] = rocks.slice(rocks.size() / 2)
	_multimesh(props, "Trunks", "trunk", tree_xforms, 0.0)
	_multimesh(props, "RoundCanopies", "round_canopy", round_trees, 0.0)
	_multimesh(props, "ConeCanopies", "cone_canopy", cone_trees, 0.0)
	_multimesh(props, "Rocks", "rock", rocks_a, ROCK_RANGE_M)
	_multimesh(props, "FlatRocks", "flat_rock", rocks_b, ROCK_RANGE_M)
	_multimesh(props, "Bushes", "bush",
		_scatter(rng, roundi(BUSHES * area_scale), size_m, x0, z0, 0.7, 1.4, false), BUSH_RANGE_M)
	_multimesh(props, "Ferns", "fern",
		_scatter(rng, roundi(FERNS * area_scale), size_m, x0, z0, 0.6, 1.5, false), FERN_RANGE_M)
	_multimesh(props, "Pebbles", "pebble",
		_scatter(rng, roundi(PEBBLES * area_scale), size_m, x0, z0, 0.5, 2.0, true), FERN_RANGE_M)

	var landmarks := Node3D.new()
	landmarks.name = "Landmarks"
	root.add_child(landmarks)
	var n_boulders := maxi(roundi(BOULDERS * area_scale), 1)
	var n_dead := maxi(roundi(DEAD_TREES * area_scale), 1)
	var spots := _scatter(rng, n_boulders + n_dead, size_m, x0, z0, 0.7, 1.2, false)
	for i in spots.size():
		var scene := _boulder if i < n_boulders else _dead_tree
		var inst := scene.instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE) as Node3D
		inst.name = "%s%d" % [inst.name, i]
		inst.transform = spots[i]
		landmarks.add_child(inst)

	_own(root, root)
	return root


func _terrain_mesh(size_m: int, x0: float, z0: float) -> ArrayMesh:
	var n := int(size_m / SPACING_M) + 1
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var colours := PackedColorArray()
	verts.resize(n * n)
	normals.resize(n * n)
	colours.resize(n * n)
	for iz in n:
		for ix in n:
			var lx := ix * SPACING_M
			var lz := iz * SPACING_M
			var wx := x0 + lx
			var wz := z0 + lz
			var h := _snapped_height(wx, wz)
			var i := iz * n + ix
			verts[i] = Vector3(lx, h, lz)
			var dx := _snapped_height(wx + SPACING_M, wz) - _snapped_height(wx - SPACING_M, wz)
			var dz := _snapped_height(wx, wz + SPACING_M) - _snapped_height(wx, wz - SPACING_M)
			var normal := Vector3(-dx, 2.0 * SPACING_M, -dz).normalized()
			normals[i] = normal
			var tint := 0.85 + 0.25 * _hash01(Vector3(wx, 0.0, wz), 7)
			var grass := Color(0.4, 0.6, 0.28) if normal.y > 0.85 else Color(0.5, 0.45, 0.36)
			colours[i] = Color(grass.r * tint, grass.g * tint, grass.b * tint)
	var indices := PackedInt32Array()
	indices.resize((n - 1) * (n - 1) * 6)
	var k := 0
	for iz in n - 1:
		for ix in n - 1:
			var i00 := iz * n + ix
			var i10 := i00 + 1
			var i01 := i00 + n
			var i11 := i01 + 1
			for idx: int in [i00, i10, i01, i10, i11, i01]:
				indices[k] = idx
				k += 1
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, _vertex_mat)
	return mesh


func _terrain_shape(size_m: int, x0: float, z0: float) -> HeightMapShape3D:
	var n := int(size_m / SPACING_M) + 1
	var heights := PackedFloat32Array()
	heights.resize(n * n)
	for iz in n:
		for ix in n:
			heights[iz * n + ix] = _snapped_height(x0 + ix * SPACING_M, z0 + iz * SPACING_M)
	var shape := HeightMapShape3D.new()
	shape.map_width = n
	shape.map_depth = n
	shape.map_data = heights
	return shape


## Heights to the centimetre, so the scene text stays shorter.
func _snapped_height(x: float, z: float) -> float:
	return snappedf(SpikeTerrain.height_at(x, z), 0.01)


func _scatter(rng: RandomNumberGenerator, count: int, size_m: int, x0: float, z0: float,
		min_scale: float, max_scale: float, tilt: bool) -> Array[Transform3D]:
	var out: Array[Transform3D] = []
	for i in count:
		var lx := rng.randf_range(0.0, size_m)
		var lz := rng.randf_range(0.0, size_m)
		var s := rng.randf_range(min_scale, max_scale)
		var basis := Basis(Vector3.UP, rng.randf_range(0.0, TAU))
		if tilt:
			basis = Basis(Vector3.RIGHT, rng.randf_range(-0.3, 0.3)) * basis
		var y := SpikeTerrain.height_at(x0 + lx, z0 + lz) - 0.1
		out.append(Transform3D(basis.scaled(Vector3(s, s, s)), Vector3(lx, y, lz)))
	return out


## range_m > 0 hides the whole MultiMesh beyond that distance (small props, as the game would).
func _multimesh(parent: Node3D, node_name: String, mesh_key: String, xforms: Array[Transform3D],
		range_m: float) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = _meshes[mesh_key]
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
	var view := MultiMeshInstance3D.new()
	view.name = node_name
	view.multimesh = mm
	view.visibility_range_end = range_m
	parent.add_child(view)


## Sets the owner of every node under node to root, but not inside instanced sub-scenes (their
## roots get it, so they're saved as instances).
func _own(node: Node, root: Node) -> void:
	for child in node.get_children():
		child.owner = root
		if child.scene_file_path == "":
			_own(child, root)


## A stable pseudo-random number in [0, 1) for a position.
func _hash01(p: Vector3, seed: int) -> float:
	var h := hash([seed, roundi(p.x * 1000.0), roundi(p.y * 1000.0), roundi(p.z * 1000.0)])
	return float(posmod(h, 100003)) / 100003.0
