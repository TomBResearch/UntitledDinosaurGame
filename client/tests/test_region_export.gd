extends GutTest
## The region exporter's pure parts (client/tools/region_export.gd): number formatting, the
## deterministic JSON writer, and building the region file from an in-memory scene.

const SpawnPointScript := preload("res://regions/markers/spawn_point.gd")
const RespawnPointScript := preload("res://regions/markers/respawn_point.gd")
const ResourceNodeScript := preload("res://regions/markers/resource_node.gd")
const EntryPointScript := preload("res://regions/markers/entry_point.gd")
const RegionExitScript := preload("res://regions/markers/region_exit.gd")


func test_numbers_are_millimetres_with_fixed_decimals() -> void:
	assert_eq(RegionExport.format_number(1.0), "1.000")
	assert_eq(RegionExport.format_number(1.23456), "1.235")
	assert_eq(RegionExport.format_number(-2.5), "-2.500")
	assert_eq(RegionExport.format_number(12.0004), "12.000")


func test_negative_zero_is_written_as_zero() -> void:
	assert_eq(RegionExport.format_number(-0.0), "0.000")
	assert_eq(RegionExport.format_number(-0.0002), "0.000")


func test_json_sorts_keys_and_types_numbers() -> void:
	var text := RegionExport.to_json({"b": 1, "a": 2.5, "c": "x\"y", "d": true, "e": null})
	assert_eq(text, '{\n  "a": 2.500,\n  "b": 1,\n  "c": "x\\"y",\n  "d": true,\n  "e": null\n}\n')


func test_json_expands_lists_of_containers_and_inlines_the_rest() -> void:
	var data := {
		"navmesh": {"vertices": [[0.0, 1.0, 2.0], [3.0, 4.0, 5.0]], "polygons": [[0, 1, 2]]},
		"spawns": [{"pos": [1.0, 2.0, 3.0]}],
		"empty": [],
		"none": {},
	}
	var want := "\n".join([
		"{",
		'  "empty": [],',
		'  "navmesh": {',
		'    "polygons": [',
		"      [0,1,2]",
		"    ],",
		'    "vertices": [',
		"      [0.000,1.000,2.000],",
		"      [3.000,4.000,5.000]",
		"    ]",
		"  },",
		'  "none": {},',
		'  "spawns": [',
		'    {"pos":[1.000,2.000,3.000]}',
		"  ]",
		"}",
		"",
	])
	assert_eq(RegionExport.to_json(data), want)


func test_json_is_deterministic() -> void:
	var a := {"z": [1.0, 2.0], "a": {"y": 1, "x": 2}}
	var b := {"a": {"x": 2, "y": 1}, "z": [1.0, 2.0]}
	assert_eq(RegionExport.to_json(a), RegionExport.to_json(b))


func test_builds_a_full_region() -> void:
	var root := _region()
	var result := RegionExport.build(root, "test_region", "abc123")
	assert_eq(result.errors, PackedStringArray())
	var data := result.data
	_eq(data, "format", RegionExport.FORMAT)
	_eq(data, "region_id", "test_region")
	_eq(data, "source_hash", "abc123")
	var navmesh: Dictionary = data["navmesh"]
	# The NavigationRegion3D sits 10 m east of the root, so its vertices move with it.
	_eq(navmesh, "vertices", [[10.0, 0.0, 0.0], [14.0, 0.0, 0.0], [10.0, 0.0, 4.0]])
	_eq(navmesh, "polygons", [[0, 1, 2]])
	# Markers inherit their parents' transforms.
	_eq(data, "player_spawns", [{"pos": [1.0, 2.0, 3.0]}])
	_eq(data, "respawn_points", [{"pos": [5.0, 0.0, 5.0]}])
	_eq(data, "creature_spawns", [{
		"pos": [0.0, 0.0, 0.0], "creature_id": "small_raptor", "count": 3,
		"wander_radius": 8.0, "respawn_s": 45.0,
	}])
	_eq(data, "resource_nodes", [{"pos": [0.0, 0.0, 0.0], "node_id": "oak_tree"}])
	var entries: Array = data["entry_points"]
	var entry: Dictionary = entries[0]
	_eq(entry, "entry_id", "from_cave")
	assert_almost_eq(_at(entry, "yaw") as float, PI / 2.0, 0.0001)
	var exits: Array = data["exits"]
	var exit_data: Dictionary = exits[0]
	_eq(exit_data, "target_region", "cave")
	_eq(exit_data, "target_entry", "from_outside")
	_eq(exit_data, "pos", [0.0, 1.0, -20.0])
	_eq(exit_data, "size", [4.0, 2.0, 1.0])


func test_marker_order_follows_the_scene_tree() -> void:
	var root := _region()
	var second := _marker(SpawnPointScript, Vector3(9.0, 0.0, 9.0))
	root.add_child(second)
	var data := RegionExport.build(root, "r", "h").data
	_eq(data, "player_spawns", [{"pos": [1.0, 2.0, 3.0]}, {"pos": [9.0, 0.0, 9.0]}])


func test_a_region_needs_a_player_spawn_and_a_respawn_point() -> void:
	var root := _region()
	for n in root.find_children("*", "Marker3D", true, false):
		if n is SpawnPoint or n is RespawnPoint:
			n.get_parent().remove_child(n)
			n.free()
	var errors := RegionExport.build(root, "r", "h").errors
	assert_eq(errors.size(), 2, str(errors))


func test_a_navmesh_baked_for_another_agent_is_refused() -> void:
	var root := _region()
	var nav := root.get_node("Nav") as NavigationRegion3D
	nav.navigation_mesh.agent_radius = 0.5
	var errors := RegionExport.build(root, "r", "h").errors
	assert_eq(errors.size(), 1)
	assert_string_contains(errors[0], "agent_radius")


func test_an_unbaked_navmesh_is_refused() -> void:
	var root := _region()
	var nav := root.get_node("Nav") as NavigationRegion3D
	nav.navigation_mesh.clear_polygons()
	var errors := RegionExport.build(root, "r", "h").errors
	assert_eq(errors.size(), 1)
	assert_string_contains(errors[0], "empty")


func test_markers_missing_ids_are_refused() -> void:
	var root := _region()
	(root.find_child("Creature", true, false) as SpawnPoint).creature_id = ""
	(root.find_child("Tree", true, false) as ResourceNode).node_id = ""
	(root.find_child("Exit", true, false) as RegionExit).target_entry = ""
	var errors := RegionExport.build(root, "r", "h").errors
	assert_eq(errors.size(), 3, str(errors))


func test_duplicate_entry_ids_are_refused() -> void:
	var root := _region()
	var copy := _marker(EntryPointScript, Vector3.ZERO)
	copy.set("entry_id", "from_cave")
	root.add_child(copy)
	var errors := RegionExport.build(root, "r", "h").errors
	assert_eq(errors.size(), 1)
	assert_string_contains(errors[0], "duplicate")


func test_yaw_is_zero_facing_minus_z_and_counter_clockwise() -> void:
	assert_almost_eq(RegionExport.yaw_of(Basis.IDENTITY), 0.0, 0.0001)
	assert_almost_eq(RegionExport.yaw_of(Basis(Vector3.UP, 0.7)), 0.7, 0.0001)
	assert_almost_eq(RegionExport.yaw_of(Basis(Vector3.UP, -2.0)), -2.0, 0.0001)


## A small region: a one-triangle navmesh plus one of each marker type, some under moved parents.
func _region() -> Node3D:
	var root := Node3D.new()
	root.name = "Region"
	root.position = Vector3(100.0, 100.0, 100.0) # the root's own transform is ignored
	add_child_autofree(root)

	var nav := NavigationRegion3D.new()
	nav.name = "Nav"
	nav.position = Vector3(10.0, 0.0, 0.0)
	var mesh := NavigationMesh.new()
	mesh.agent_radius = RegionExport.AGENT_RADIUS_M
	mesh.agent_height = RegionExport.AGENT_HEIGHT_M
	mesh.agent_max_climb = RegionExport.AGENT_MAX_CLIMB_M
	mesh.agent_max_slope = RegionExport.AGENT_MAX_SLOPE_DEG
	mesh.vertices = PackedVector3Array([Vector3(0, 0, 0), Vector3(4, 0, 0), Vector3(0, 0, 4)])
	mesh.add_polygon(PackedInt32Array([0, 1, 2]))
	nav.navigation_mesh = mesh
	root.add_child(nav)

	var group := Node3D.new()
	group.name = "Markers"
	group.position = Vector3(1.0, 0.0, 0.0)
	root.add_child(group)
	group.add_child(_marker(SpawnPointScript, Vector3(0.0, 2.0, 3.0)))
	group.add_child(_marker(RespawnPointScript, Vector3(4.0, 0.0, 5.0)))

	var creature := _marker(SpawnPointScript, Vector3.ZERO)
	creature.name = "Creature"
	creature.set("kind", SpawnPoint.Kind.CREATURE)
	creature.set("creature_id", "small_raptor")
	creature.set("count", 3)
	creature.set("wander_radius_m", 8.0)
	creature.set("respawn_s", 45.0)
	root.add_child(creature)

	var tree := _marker(ResourceNodeScript, Vector3.ZERO)
	tree.name = "Tree"
	tree.set("node_id", "oak_tree")
	root.add_child(tree)

	var entry := _marker(EntryPointScript, Vector3(0.0, 0.0, -10.0))
	entry.rotation.y = PI / 2.0
	entry.set("entry_id", "from_cave")
	root.add_child(entry)

	var exit := Area3D.new()
	exit.name = "Exit"
	exit.set_script(RegionExitScript)
	exit.position = Vector3(0.0, 1.0, -20.0)
	exit.set("target_region", "cave")
	exit.set("target_entry", "from_outside")
	var box := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(4.0, 2.0, 1.0)
	box.shape = shape
	exit.add_child(box)
	root.add_child(exit)
	return root


## A Dictionary value as a typed Variant (for casts).
func _at(d: Dictionary, key: String) -> Variant:
	return d[key]


## Asserts d[key] equals want, compared as the exporter writes them (which also tells 1 from 1.0).
## Comparing text keeps assert_eq clear of the project's unsafe-argument warnings.
func _eq(d: Dictionary, key: String, want: Variant) -> void:
	var have: Variant = d[key]
	assert_eq(RegionExport.to_json(have), RegionExport.to_json(want), key)


func _marker(script: Script, at: Vector3) -> Marker3D:
	var m := Marker3D.new()
	m.set_script(script)
	m.position = at
	return m
