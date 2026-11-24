class_name RegionExport
extends RefCounted
## Turns a region scene into the server's region file, format 1 (ADR 0004,
## docs/architecture/content-pipeline.md). Pure functions only, so GUT can test them without files;
## export_region.gd is the command-line wrapper that loads scenes and writes files.
##
## The output is deterministic: keys sorted, numbers in metres to 3 decimals, markers in scene-tree
## order. Re-exporting an unchanged scene gives a byte-identical file.

const FORMAT := 1

## The navmesh agent the whole game uses (content-pipeline.md). The exporter refuses a navmesh baked
## with anything else, so the server and every region agree on who fits where.
const AGENT_RADIUS_M := 0.4
const AGENT_HEIGHT_M := 1.8
const AGENT_MAX_CLIMB_M := 0.4
const AGENT_MAX_SLOPE_DEG := 40.0

## How deep the writer expands containers onto several lines; anything deeper is written inline.
const _EXPAND_DICT_DEPTH := 1
const _EXPAND_ARRAY_DEPTH := 2
const _INDENT := "  "


## What build() made: the file's data, and every problem found (an empty list means it's valid).
class Result:
	extends RefCounted
	var data: Dictionary = {}
	var errors: PackedStringArray = PackedStringArray()


## Builds the region file's data from an instanced region scene (it needn't be in the tree).
## Positions are in the scene root's space: Godot axes, metres, +Y up.
static func build(root: Node, region_id: String, source_hash: String) -> Result:
	var result := Result.new()
	var player_spawns: Array[Dictionary] = []
	var respawn_points: Array[Dictionary] = []
	var creature_spawns: Array[Dictionary] = []
	var resource_nodes: Array[Dictionary] = []
	var exits: Array[Dictionary] = []
	var entry_points: Array[Dictionary] = []
	var nav_regions: Array[NavigationRegion3D] = []
	var entry_ids := {}

	for node in _descendants(root):
		var where := _label(root, node)
		if node is NavigationRegion3D:
			nav_regions.append(node as NavigationRegion3D)
		elif node is SpawnPoint:
			var spawn := node as SpawnPoint
			var pos := vec3(region_transform(spawn, root).origin)
			if spawn.kind == SpawnPoint.Kind.PLAYER:
				player_spawns.append({"pos": pos})
			else:
				if spawn.creature_id == "":
					result.errors.append("%s: creature spawn has no creature_id" % where)
				creature_spawns.append({
					"pos": pos,
					"creature_id": spawn.creature_id,
					"count": spawn.count,
					"wander_radius": spawn.wander_radius_m,
					"respawn_s": spawn.respawn_s,
				})
		elif node is RespawnPoint:
			respawn_points.append({"pos": vec3(region_transform(node as Node3D, root).origin)})
		elif node is ResourceNode:
			var res_node := node as ResourceNode
			if res_node.node_id == "":
				result.errors.append("%s: resource node has no node_id" % where)
			resource_nodes.append({
				"pos": vec3(region_transform(res_node, root).origin),
				"node_id": res_node.node_id,
			})
		elif node is EntryPoint:
			var entry := node as EntryPoint
			if entry.entry_id == "":
				result.errors.append("%s: entry point has no entry_id" % where)
			elif entry_ids.has(entry.entry_id):
				result.errors.append("%s: duplicate entry_id \"%s\"" % [where, entry.entry_id])
			entry_ids[entry.entry_id] = true
			var xf := region_transform(entry, root)
			entry_points.append({"pos": vec3(xf.origin), "yaw": yaw_of(xf.basis), "entry_id": entry.entry_id})
		elif node is RegionExit:
			var exit_data := _exit(node as RegionExit, root, where, result.errors)
			if not exit_data.is_empty():
				exits.append(exit_data)

	var navmesh := {}
	if nav_regions.size() != 1:
		result.errors.append("expected exactly one NavigationRegion3D, found %d" % nav_regions.size())
	else:
		navmesh = _navmesh(nav_regions[0], root, result.errors)
	if player_spawns.is_empty():
		result.errors.append("no player spawn (add a SpawnPoint with kind Player)")
	if respawn_points.is_empty():
		result.errors.append("no respawn point (add a RespawnPoint)")

	result.data = {
		"format": FORMAT,
		"region_id": region_id,
		"source_hash": source_hash,
		"navmesh": navmesh,
		"player_spawns": player_spawns,
		"respawn_points": respawn_points,
		"creature_spawns": creature_spawns,
		"resource_nodes": resource_nodes,
		"exits": exits,
		"entry_points": entry_points,
	}
	return result


## The navmesh in root space. Vertices and polygons are exactly what the bake produced; the server
## computes adjacency itself.
static func _navmesh(region: NavigationRegion3D, root: Node, errors: PackedStringArray) -> Dictionary:
	var where := _label(root, region)
	var mesh := region.navigation_mesh
	if mesh == null:
		errors.append("%s: has no NavigationMesh" % where)
		return {}
	errors.append_array(check_agent(mesh, where))
	var xf := region_transform(region, root)
	var vertices: Array[Array] = []
	for v in mesh.get_vertices():
		vertices.append(vec3(xf * v))
	var polygons: Array[Array] = []
	for i in mesh.get_polygon_count():
		var poly: Array[int] = []
		for index in mesh.get_polygon(i):
			poly.append(index)
		polygons.append(poly)
	if polygons.is_empty():
		errors.append("%s: the navmesh is empty (bake it: select the node, then Bake NavigationMesh)" % where)
	return {"vertices": vertices, "polygons": polygons}


## Problems with the navmesh's agent settings, if it wasn't baked for the game's agent.
static func check_agent(mesh: NavigationMesh, where: String) -> PackedStringArray:
	var errors := PackedStringArray()
	var want := {
		"agent_radius": AGENT_RADIUS_M,
		"agent_height": AGENT_HEIGHT_M,
		"agent_max_climb": AGENT_MAX_CLIMB_M,
		"agent_max_slope": AGENT_MAX_SLOPE_DEG,
	}
	for key: String in want:
		var have: float = mesh.get(key)
		var expected: float = want[key]
		if not is_equal_approx(have, expected):
			errors.append("%s: navmesh %s is %s, the game's agent needs %s" % [where, key, have, expected])
	return errors


static func _exit(exit: RegionExit, root: Node, where: String, errors: PackedStringArray) -> Dictionary:
	if exit.target_region == "" or exit.target_entry == "":
		errors.append("%s: exit needs target_region and target_entry" % where)
	var box: CollisionShape3D = null
	for child in exit.get_children():
		if child is CollisionShape3D and (child as CollisionShape3D).shape is BoxShape3D:
			box = child as CollisionShape3D
			break
	if box == null:
		errors.append("%s: exit needs a CollisionShape3D child with a BoxShape3D" % where)
		return {}
	var xf := region_transform(box, root)
	var up := xf.basis.y.normalized()
	if not up.is_equal_approx(Vector3.UP) or not xf.basis.get_scale().is_equal_approx(Vector3.ONE):
		errors.append("%s: exit box may only be rotated about +Y, and not scaled" % where)
	return {
		"pos": vec3(xf.origin),
		"size": vec3((box.shape as BoxShape3D).size),
		"yaw": yaw_of(xf.basis),
		"target_region": exit.target_region,
		"target_entry": exit.target_entry,
	}


## The node's transform relative to root (root's own transform is left out).
static func region_transform(node: Node3D, root: Node) -> Transform3D:
	var xf := Transform3D.IDENTITY
	var n: Node = node
	while n != null and n != root:
		if n is Node3D:
			xf = (n as Node3D).transform * xf
		n = n.get_parent()
	return xf


## Rotation about +Y in radians, 0 facing -Z (Godot forward), counter-clockwise seen from above.
static func yaw_of(basis: Basis) -> float:
	var forward := -basis.z
	return atan2(-forward.x, -forward.z)


static func vec3(v: Vector3) -> Array[float]:
	return [v.x, v.y, v.z]


## Every node under root, depth first in tree order (root itself excluded).
static func _descendants(root: Node) -> Array[Node]:
	var out: Array[Node] = []
	for child in root.get_children():
		out.append(child)
		out.append_array(_descendants(child))
	return out


static func _label(root: Node, node: Node) -> String:
	return str(root.get_path_to(node)) if root.is_ancestor_of(node) else node.name


## A number as the file writes it: floats in metres to 3 decimals (millimetres), never "-0.000".
static func format_number(v: float) -> String:
	var s := "%.3f" % v
	return "0.000" if s == "-0.000" else s


## Deterministic JSON: sorted keys, fixed number formatting, a trailing newline. The root object and
## the arrays of objects or arrays are spread over lines (one vertex, polygon or marker per line);
## everything deeper is inline, so diffs stay readable and the file stays small.
static func to_json(value: Variant) -> String:
	return _write(value, 0, "") + "\n"


static func _write(value: Variant, depth: int, indent: String) -> String:
	match typeof(value):
		TYPE_DICTIONARY:
			return _write_dict(value as Dictionary, depth, indent)
		TYPE_ARRAY:
			return _write_array(value as Array, depth, indent)
		TYPE_FLOAT:
			return format_number(value as float)
		TYPE_INT:
			return str(value as int)
		TYPE_BOOL:
			return "true" if (value as bool) else "false"
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(value))
		TYPE_NIL:
			return "null"
	push_error("RegionExport.to_json: can't write a %s" % type_string(typeof(value)))
	return "null"


static func _write_dict(d: Dictionary, depth: int, indent: String) -> String:
	if d.is_empty():
		return "{}"
	var keys: Array[String] = []
	for key: Variant in d.keys():
		keys.append(str(key))
	keys.sort()
	var parts := PackedStringArray()
	var inner := indent + _INDENT
	var expand := depth <= _EXPAND_DICT_DEPTH
	for key in keys:
		var v: Variant = d[key]
		var written := _write(v, depth + 1, inner)
		parts.append(("%s: %s" if expand else "%s:%s") % [JSON.stringify(key), written])
	if expand:
		return "{\n%s%s\n%s}" % [inner, (",\n" + inner).join(parts), indent]
	return "{%s}" % ",".join(parts)


static func _write_array(a: Array, depth: int, indent: String) -> String:
	if a.is_empty():
		return "[]"
	var expand := depth <= _EXPAND_ARRAY_DEPTH and (a[0] is Array or a[0] is Dictionary)
	var inner := indent + _INDENT
	var parts := PackedStringArray()
	for v: Variant in a:
		parts.append(_write(v, depth + 1, inner))
	if expand:
		return "[\n%s%s\n%s]" % [inner, (",\n" + inner).join(parts), indent]
	return "[%s]" % ",".join(parts)
