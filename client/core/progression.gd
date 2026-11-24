class_name Progression
extends RefCounted
## Levels from XP, for display only (XP bars, "XP to next level"). The server owns XP and levels;
## this reads the same curve from data/progression.json (generated into res://data/) so the
## numbers on screen always match the server's. See docs/design/progression.md.

const DATA_PATH := "res://data/progression.json"

var max_level: int
var max_xp: int
## _totals[L] = total XP needed to reach level L (index 0 unused, _totals[1] = 0).
var _totals: PackedInt64Array = PackedInt64Array()


static func load_default() -> Progression:
	var text := FileAccess.get_file_as_string(DATA_PATH)
	assert(text != "", "Missing %s: run tools/check.sh (it generates client data)" % DATA_PATH)
	var parsed: Variant = JSON.parse_string(text)
	assert(parsed is Dictionary, "%s is not a JSON object" % DATA_PATH)
	return from_dict(parsed as Dictionary)


static func from_dict(data: Dictionary) -> Progression:
	# JSON numbers arrive as floats; typed locals keep the conversions explicit and warning-free.
	var max_level_f: float = data["max_level"]
	var max_xp_f: float = data["max_xp"]
	var curve: Dictionary = data["xp_curve"]
	var base: float = curve["base"]
	var growth: float = curve["growth"]
	var linear: float = curve["linear"]
	var p := Progression.new()
	p.max_level = roundi(max_level_f)
	p.max_xp = roundi(max_xp_f)
	p._totals.resize(p.max_level + 1)
	p._totals[1] = 0
	for level in range(1, p.max_level):
		var step: int = roundi(base * pow(growth, level - 1) + linear * level)
		p._totals[level + 1] = p._totals[level] + step
	return p


## Total XP needed to reach `level` (1..max_level).
func xp_for_level(level: int) -> int:
	return _totals[clampi(level, 1, max_level)]


## The level a given total XP gives.
func level_for_xp(xp: int) -> int:
	var level := 1
	while level < max_level and xp >= _totals[level + 1]:
		level += 1
	return level
