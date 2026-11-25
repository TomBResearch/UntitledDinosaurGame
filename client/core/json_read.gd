class_name JsonRead
extends RefCounted
## Typed reads from parsed JSON (API answers and data files), with a fallback when a field is
## missing or has the wrong type. JSON numbers arrive as floats.


static func text(d: Dictionary, key: String, fallback: String = "") -> String:
	var v: Variant = d.get(key)
	if v is String:
		var s: String = v
		return s
	return fallback


static func whole(d: Dictionary, key: String, fallback: int = 0) -> int:
	var v: Variant = d.get(key)
	if v is float or v is int:
		var f: float = v
		return roundi(f)
	return fallback


static func number(d: Dictionary, key: String, fallback: float = 0.0) -> float:
	var v: Variant = d.get(key)
	if v is float or v is int:
		var f: float = v
		return f
	return fallback


static func object(d: Dictionary, key: String) -> Dictionary:
	var v: Variant = d.get(key)
	if v is Dictionary:
		var o: Dictionary = v
		return o
	return {}
