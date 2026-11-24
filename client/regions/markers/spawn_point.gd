class_name SpawnPoint
extends Marker3D
## Where players or creatures appear. tools/export-regions.sh writes these to the region file as
## `player_spawns` or `creature_spawns` (docs/architecture/content-pipeline.md). The server picks
## the spawn; the client never reads these markers.

enum Kind { PLAYER, CREATURE }

@export var kind: Kind = Kind.PLAYER
@export_group("Creature")
## An id from data/creatures/. Creature spawns only.
@export var creature_id: String = ""
## How many of the creature live at this spawn.
@export_range(1, 50) var count: int = 1
## How far each creature wanders from the marker.
@export_range(0.0, 50.0, 0.5, "suffix:m") var wander_radius_m: float = 5.0
## Seconds from death to respawn.
@export_range(1.0, 3600.0, 1.0, "suffix:s") var respawn_s: float = 30.0
