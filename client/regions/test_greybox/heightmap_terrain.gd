@tool
extends Node3D
## Greybox terrain visual: builds a flat-coloured mesh from the collision heightmap when the scene
## loads (in the editor too). The scene stores the heights once, in the HeightMapShape3D, so the
## visual can't drift from what the navmesh was baked on, and the generated mesh is an internal
## child that is never saved into the scene. Colours are per surface type (grass, cliff too steep to
## walk, river bed) as plain vertex colours, so it renders on WebGL 2.

## The heightmap to draw. Its cell spacing is `spacing_m` (the CollisionShape3D's x/z scale).
@export var heightmap: HeightMapShape3D:
	set(value):
		heightmap = value
		_rebuild()
@export var spacing_m: float = 2.0:
	set(value):
		spacing_m = value
		_rebuild()
## Should use vertex colours as albedo.
@export var material: Material:
	set(value):
		material = value
		_rebuild()
@export var grass_colour: Color = Color(0.42, 0.6, 0.3)
@export var cliff_colour: Color = Color(0.5, 0.45, 0.4)
@export var bed_colour: Color = Color(0.62, 0.55, 0.4)
## Slopes steeper than this are drawn as cliff. Matches the navmesh agent's max slope.
@export_range(0.0, 90.0) var cliff_slope_deg: float = 40.0
## Ground below this height is drawn as river bed.
@export var bed_below_m: float = -0.3

var _view: MeshInstance3D


func _ready() -> void:
	_rebuild()


func _rebuild() -> void:
	if not is_inside_tree() or heightmap == null:
		return
	var w := heightmap.map_width
	var d := heightmap.map_depth
	var heights := heightmap.map_data
	if w < 2 or d < 2 or heights.size() != w * d:
		return
	if _view == null:
		_view = MeshInstance3D.new()
		add_child(_view, false, Node.INTERNAL_MODE_FRONT)
	# HeightMapShape3D is centred on its origin.
	var x0 := -(w - 1) * 0.5 * spacing_m
	var z0 := -(d - 1) * 0.5 * spacing_m
	var cliff_cos := cos(deg_to_rad(cliff_slope_deg))
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for iz in d - 1:
		for ix in w - 1:
			var p00 := Vector3(x0 + ix * spacing_m, heights[iz * w + ix], z0 + iz * spacing_m)
			var p10 := Vector3(p00.x + spacing_m, heights[iz * w + ix + 1], p00.z)
			var p01 := Vector3(p00.x, heights[(iz + 1) * w + ix], p00.z + spacing_m)
			var p11 := Vector3(p10.x, heights[(iz + 1) * w + ix + 1], p01.z)
			_triangle(st, p00, p10, p01, cliff_cos)
			_triangle(st, p10, p11, p01, cliff_cos)
	st.index()
	_view.mesh = st.commit()
	_view.material_override = material


func _triangle(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, cliff_cos: float) -> void:
	var normal := (c - a).cross(b - a).normalized()
	var colour := grass_colour
	if normal.y < cliff_cos:
		colour = cliff_colour
	elif minf(a.y, minf(b.y, c.y)) < bed_below_m:
		colour = bed_colour
	st.set_color(colour)
	st.set_normal(normal)
	st.add_vertex(a)
	st.add_vertex(b)
	st.add_vertex(c)
