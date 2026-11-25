class_name CavemanModel
extends Node3D
## The placeholder caveman (entities/player/caveman.tscn), drawn from a look: body type (scales the
## body: height, and width with the face, hair and beard on it), skin tone and hair colour (colours), hair style and beard (which pieces show). He wears
## the starting pelt loincloth. Used by PlayerView in the world and by the creation screen's preview.
##
## Each hair style and beard is a child node named after its id in data/appearance.json, under
## Hair and Beard. An id with no node shows nothing there (like "bald" or "none").

const ROUGH := 0.95

var look: Dictionary = {}

var _skin := StandardMaterial3D.new()
var _hair := StandardMaterial3D.new()

@onready var _hair_root: Node3D = $Hair
@onready var _beard_root: Node3D = $Beard
@onready var _body: MeshInstance3D = $Body
@onready var _nose: MeshInstance3D = $Face/Nose
@onready var _face: Node3D = $Face
@onready var _loincloth: Node3D = $Loincloth
@onready var _strap: Node3D = $Strap


func _ready() -> void:
	_skin.roughness = ROUGH
	_hair.roughness = 1.0
	_body.material_override = _skin
	_nose.material_override = _skin
	for root: Node3D in [_hair_root, _beard_root]:
		for piece in root.find_children("*", "MeshInstance3D", true, false):
			(piece as MeshInstance3D).material_override = _hair
	apply(look if not look.is_empty() else AppearanceCatalog.shared().default_look)


## Draws a look ({bodyType, skinTone, hairStyle, hairColour, beard}). Unknown ids draw as the
## default (AppearanceCatalog.resolve).
func apply(new_look: Dictionary, catalog: AppearanceCatalog = null) -> void:
	if catalog == null:
		catalog = AppearanceCatalog.shared()
	look = catalog.resolve(new_look)
	if not is_node_ready():
		return
	var body_type: String = look["bodyType"]
	var hair_style: String = look["hairStyle"]
	var beard: String = look["beard"]
	var skin_tone: String = look["skinTone"]
	var hair_colour: String = look["hairColour"]
	var size := catalog.body_scale(body_type)
	scale = Vector3(1.0, size.y, 1.0)
	# Width scales across and front to back, so the face, hair and beard stay on the body's surface.
	for part: Node3D in [_body, _loincloth, _strap, _face, _hair_root, _beard_root]:
		part.scale = Vector3(size.x, 1.0, size.x)
	_skin.albedo_color = catalog.colour_of("skinTone", skin_tone)
	_hair.albedo_color = catalog.colour_of("hairColour", hair_colour)
	_show_only(_hair_root, hair_style)
	_show_only(_beard_root, beard)


## Which hair style or beard piece is showing (tests).
func showing(group: String) -> String:
	var root := _hair_root if group == "hair" else _beard_root
	for child in root.get_children():
		if (child as Node3D).visible:
			return child.name
	return ""


func skin_colour() -> Color:
	return _skin.albedo_color


func hair_colour() -> Color:
	return _hair.albedo_color


static func _show_only(root: Node3D, id: String) -> void:
	for child in root.get_children():
		(child as Node3D).visible = child.name == id
