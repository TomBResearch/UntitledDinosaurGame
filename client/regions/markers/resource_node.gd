class_name ResourceNode
extends Marker3D
## A tree, rock, fishing spot or dig site. The visual and the rules come from the node definition
## in data/nodes/. Exported to the region file as `resource_nodes`
## (docs/architecture/content-pipeline.md).

## An id from data/nodes/.
@export var node_id: String = ""
