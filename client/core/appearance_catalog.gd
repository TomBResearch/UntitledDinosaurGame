class_name AppearanceCatalog
extends RefCounted
## The character appearance choices, from data/appearance.json (generated into res://data/). The
## API refuses anything not in that file; the client only shows the choices and draws them.
##
## A look is a Dictionary {bodyType, skinTone, hairStyle, hairColour, beard} of choice ids, the
## same JSON the API stores and sends.

const DATA_PATH := "res://data/appearance.json"

## The five parts of a look, in the order the creation screen shows them.
const PARTS: PackedStringArray = ["bodyType", "skinTone", "hairStyle", "hairColour", "beard"]
## Each part's list in appearance.json.
const LISTS := {
	"bodyType": "body_types",
	"skinTone": "skin_tones",
	"hairStyle": "hair_styles",
	"hairColour": "hair_colours",
	"beard": "beards",
}
## Each part's label on the creation screen.
const LABELS := {
	"bodyType": "Body",
	"skinTone": "Skin",
	"hairStyle": "Hair",
	"hairColour": "Hair colour",
	"beard": "Beard",
}

var default_look: Dictionary = {}
## Part -> the choices, each a Dictionary from the file ({id, name} plus colour, width, height).
var _choices: Dictionary[String, Array] = {}

static var _shared: AppearanceCatalog = null


## The catalog from the game's data, loaded once.
static func shared() -> AppearanceCatalog:
	if _shared == null:
		var text := FileAccess.get_file_as_string(DATA_PATH)
		assert(text != "", "Missing %s: run tools/check.sh (it generates client data)" % DATA_PATH)
		var parsed: Variant = JSON.parse_string(text)
		assert(parsed is Dictionary, "%s is not a JSON object" % DATA_PATH)
		_shared = from_dict(parsed as Dictionary)
	return _shared


static func from_dict(data: Dictionary) -> AppearanceCatalog:
	var c := AppearanceCatalog.new()
	for part in PARTS:
		var list: Variant = data.get(LISTS[part], [])
		c._choices[part] = list if list is Array else []
	c.default_look = c.resolve(JsonRead.object(data, "default"))
	return c


## The choices for a part.
func choices(part: String) -> Array:
	return _choices.get(part, [])


## The ids of a part's choices, in order.
func ids(part: String) -> PackedStringArray:
	var out := PackedStringArray()
	for c: Variant in choices(part):
		out.append(_id_of(c))
	return out


## A look with every part filled in: unknown or missing ids become the default's (or the first
## choice). Characters made before a choice was removed still draw.
func resolve(look: Dictionary) -> Dictionary:
	var out := {}
	for part in PARTS:
		var id := JsonRead.text(look, part)
		if id != "" and _index(part, id) >= 0:
			out[part] = id
		elif default_look.has(part):
			out[part] = default_look[part]
		else:
			var list := choices(part)
			out[part] = _id_of(list[0]) if not list.is_empty() else ""
	return out


## The look with one part moved step choices along (wrapping round), for the < and > buttons.
func step(look: Dictionary, part: String, by: int) -> Dictionary:
	var out := resolve(look)
	var list := choices(part)
	if list.is_empty():
		return out
	var at: String = out[part]
	out[part] = _id_of(list[posmod(_index(part, at) + by, list.size())])
	return out


## A random look (the creation screen starts with one, and has a Randomise button).
func random_look(rng: RandomNumberGenerator) -> Dictionary:
	var out := {}
	for part in PARTS:
		var list := choices(part)
		out[part] = _id_of(list[rng.randi_range(0, list.size() - 1)]) if not list.is_empty() else ""
	return out


## The name players see for a choice, or "" for an unknown one.
func name_of(part: String, id: String) -> String:
	return JsonRead.text(_choice(part, id), "name")


## A colour part's colour (skinTone, hairColour), or white for an unknown one.
func colour_of(part: String, id: String) -> Color:
	var hex := JsonRead.text(_choice(part, id), "colour")
	return Color.html(hex) if Color.html_is_valid(hex) else Color.WHITE


## A body type's scale: x across, y up. 1 for an unknown one.
func body_scale(id: String) -> Vector2:
	var c := _choice("bodyType", id)
	return Vector2(JsonRead.number(c, "width", 1.0), JsonRead.number(c, "height", 1.0))


func _choice(part: String, id: String) -> Dictionary:
	var i := _index(part, id)
	if i < 0:
		return {}
	var c: Variant = choices(part)[i]
	if c is Dictionary:
		var d: Dictionary = c
		return d
	return {}


func _index(part: String, id: String) -> int:
	var list := choices(part)
	for i in list.size():
		if _id_of(list[i]) == id:
			return i
	return -1


static func _id_of(choice: Variant) -> String:
	if choice is Dictionary:
		var d: Dictionary = choice
		return JsonRead.text(d, "id")
	return ""
