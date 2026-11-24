class_name EntryPoint
extends Marker3D
## A named arrival point for region exits and teleports. Its yaw is the way the player faces on
## arrival. Exported to the region file as `entry_points` (docs/architecture/content-pipeline.md).

## Unique within the region. A RegionExit in another region names it as `target_entry`.
@export var entry_id: String = ""
