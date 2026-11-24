extends SceneTree
## Exports region scenes to data/regions/<region_id>.region.json for the server (ADR 0004).
## Run it through tools/export-regions.sh, which passes these arguments after `--`:
##
##   [region_id ...]   regions to export (default: every client/regions/<id>/region.tscn)
##   --bake            re-bake each region's navmesh and save the scene first
##   --out <dir>       where to write (default: ../data/regions next to the Godot project)
##
## The exporter only reads the baked NavigationMesh. Without --bake, bake in the editor first
## (select NavigationRegion3D, then Bake NavigationMesh) and save the scene.

const REGIONS_DIR := "res://regions"
const SCENE_NAME := "region.tscn"


func _initialize() -> void:
	_main.call_deferred()


func _main() -> void:
	# Wait one frame so the root viewport is in the tree; baking needs it.
	await process_frame
	var bake := false
	var out_dir := ProjectSettings.globalize_path("res://").path_join("../data/regions").simplify_path()
	var ids := PackedStringArray()
	var args := OS.get_cmdline_user_args()
	var i := 0
	while i < args.size():
		match args[i]:
			"--bake":
				bake = true
			"--out":
				i += 1
				if i >= args.size():
					_fail("--out needs a directory")
					return
				out_dir = args[i]
			_:
				ids.append(args[i])
		i += 1
	if ids.is_empty():
		ids = _all_region_ids()
	if ids.is_empty():
		_fail("no regions found in %s" % REGIONS_DIR)
		return

	DirAccess.make_dir_recursive_absolute(out_dir)
	var failed := false
	for id in ids:
		var ok: bool = await _export(id, out_dir, bake)
		failed = failed or not ok
	quit(1 if failed else 0)


func _export(id: String, out_dir: String, bake: bool) -> bool:
	var scene_path := REGIONS_DIR.path_join(id).path_join(SCENE_NAME)
	if not ResourceLoader.exists(scene_path):
		printerr("%s: no scene at %s" % [id, scene_path])
		return false
	if bake:
		var baked: bool = await _bake(scene_path)
		if not baked:
			return false

	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	var scene := packed.instantiate()
	var result := RegionExport.build(scene, id, FileAccess.get_sha256(scene_path))
	scene.free()
	if not result.errors.is_empty():
		for e in result.errors:
			printerr("%s: %s" % [id, e])
		return false

	var out_path := out_dir.path_join("%s.region.json" % id)
	var file := FileAccess.open(out_path, FileAccess.WRITE)
	if file == null:
		printerr("%s: can't write %s (%s)" % [id, out_path, error_string(FileAccess.get_open_error())])
		return false
	var text := RegionExport.to_json(result.data)
	file.store_string(text)
	file.close()
	var navmesh: Dictionary = result.data["navmesh"]
	var vertices: Array = navmesh["vertices"]
	var polygons: Array = navmesh["polygons"]
	print("%s: wrote %s (%d vertices, %d polygons, %d bytes)" % [
		id, out_path, vertices.size(), polygons.size(), text.length()])
	return true


func _bake(scene_path: String) -> bool:
	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	var scene := packed.instantiate()
	root.add_child(scene)
	await process_frame
	var regions := scene.find_children("*", "NavigationRegion3D", true, false)
	if regions.size() != 1:
		printerr("%s: expected exactly one NavigationRegion3D, found %d" % [scene_path, regions.size()])
		scene.queue_free()
		return false
	var region := regions[0] as NavigationRegion3D
	region.bake_navigation_mesh(false)
	print("%s: baked %d polygons" % [scene_path, region.navigation_mesh.get_polygon_count()])
	root.remove_child(scene)
	var repacked := PackedScene.new()
	var err := repacked.pack(scene)
	if err == OK:
		err = ResourceSaver.save(repacked, scene_path)
	scene.free()
	if err != OK:
		printerr("%s: can't save the baked scene (%s)" % [scene_path, error_string(err)])
		return false
	return true


func _all_region_ids() -> PackedStringArray:
	var ids := PackedStringArray()
	for dir in DirAccess.get_directories_at(REGIONS_DIR):
		if FileAccess.file_exists(REGIONS_DIR.path_join(dir).path_join(SCENE_NAME)):
			ids.append(dir)
	ids.sort()
	return ids


func _fail(message: String) -> void:
	printerr("export_region: " + message)
	quit(1)
