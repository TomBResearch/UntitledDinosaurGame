class_name RegionExit
extends Area3D
## Walking into this box moves the player to another region. Needs one CollisionShape3D child with
## a BoxShape3D (the trigger), rotated about +Y only. Exported to the region file as `exits`
## (docs/architecture/content-pipeline.md). The server decides when a player has entered it.

## The region id (folder name under client/regions/) this exit leads to.
@export var target_region: String = ""
## The EntryPoint `entry_id` in the target region where the player arrives.
@export var target_entry: String = ""
