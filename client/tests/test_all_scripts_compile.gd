extends GutTest
## Compiles every GDScript in the project (except addons), so a parse or typing error fails the fast
## check even in a script no other test loads. Typing warnings are errors (project.godot [debug]).

const SKIP_DIRS := ["res://addons", "res://.godot"]


func test_every_script_compiles() -> void:
	var scripts := _find_scripts("res://")
	assert_gt(scripts.size(), 0, "found no scripts")
	for path in scripts:
		var script := load(path) as GDScript
		assert_not_null(script, "failed to load %s" % path)
		if script != null:
			assert_true(script.can_instantiate(), "%s doesn't compile" % path)


func _find_scripts(dir_path: String) -> PackedStringArray:
	var found := PackedStringArray()
	if dir_path in SKIP_DIRS:
		return found
	for file in DirAccess.get_files_at(dir_path):
		if file.ends_with(".gd"):
			found.append(dir_path.path_join(file))
	for sub in DirAccess.get_directories_at(dir_path):
		found.append_array(_find_scripts(dir_path.path_join(sub)))
	return found
