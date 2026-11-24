# Content pipeline

## Models and art (Blender → Godot)

1. Model in Blender (the Blender MCP works for agents). Save the source to `assets-src/<category>/<name>.blend`, stored with Git LFS.
2. Export to glTF binary (`.glb`) in `client/assets/<category>/<name>.glb`. Apply transforms, use Y-up, and 1 unit = 1 m.
3. Godot imports the `.glb`. Set up materials once per asset in an inherited scene (`.tscn`).
4. Record the source and licence of any third-party asset in `assets-src/LICENSES.md`.

**Budgets:**

| Asset | Triangles | Textures |
|---|---|---|
| Player character | ~3k | One 512² atlas or vertex colours |
| Small creature | ~2k | |
| Large creature or boss | ~8k | |
| Prop | 50–800 | Shared palette texture where possible |

Animations: idle, walk, run, attack (per weapon type), hit, die, gather (chop, mine, dig, fish), and cast.

## Building a region (Godot)

A region is a folder in `client/regions/<region_id>/`. The folder name is the region id.

| Node or scene | Purpose |
|---|---|
| `chunks/chunk_<x>_<z>.tscn` | 64 m terrain and props. The client streams these. *(Comes with the streaming spike; `test_greybox` is a single scene for now.)* |
| `region.tscn` | Authoring root: instances every chunk, plus the nodes below |
| `NavigationRegion3D` (exactly one) | Baked navmesh. Agent radius 0.4 m, height 1.8 m, max climb 0.4 m, max slope 40°; cell size and height 0.2 m (the project's navigation map uses the same). Parse **static colliders** only. |
| `SpawnPoint` markers | `client/regions/markers/spawn_point.gd`. Kind Player, or Creature with `creature_id`, count, wander radius and respawn time |
| `RespawnPoint` markers | Where players reappear after dying (the nearest one is used) |
| `ResourceNode` markers | `node_id` from `data/nodes/`. The visual comes from the node definition. |
| `RegionExit` areas | Target region and entry point id. One `CollisionShape3D` child with a `BoxShape3D`, rotated about +Y only. |
| `EntryPoint` markers | Named arrival points (`entry_id`, unique in the region) for exits and teleports. Yaw is the arrival facing. |

Marker scripts live in `client/regions/markers/`. Place them anywhere under `region.tscn`.

**Navmesh tips:**

- Water and other no-go ground: a `NavigationObstacle3D` with **Affect Navigation Mesh** and **Carve Navigation Mesh** on. Keep its height range to the water, so banks above it stay walkable. Each obstacle's outline must be convex, so use several along a river.
- Recast doesn't fill closed shapes. Ground enclosed by a box wall or a boulder bakes as a walkable island *inside* it. Put an obstacle with **Affect Navigation Mesh** on (carve off) over the footprint, from below the ground to just above it.
- Flat-topped props taller than 0.4 m become unreachable islands on top. Use pointed or sloped tops, or let the top join walkable ground, like the cave outcrop in `test_greybox`.

### Export

`tools/export-regions.sh [--bake] [region_id ...]` runs `client/tools/export_region.gd` headless and writes `data/regions/<region_id>.region.json` ([ADR 0004](../decisions/0004-navmesh-baked-in-godot.md)). With no ids, it exports every region. The exporter only reads the baked navmesh. After changing level geometry, either bake in the editor (select `NavigationRegion3D`, then **Bake NavigationMesh**, then save) or pass `--bake`, which bakes headless and saves the scene. Commit the scene and its export together.

The exporter refuses a region with no player spawn, no respawn point, an empty navmesh, a navmesh baked for a different agent, or markers missing their ids.

**Staleness:** each export records `source_hash`, the SHA-256 of `region.tscn`'s bytes. The fast check recomputes it (it hashes only, with no bake or export) and fails if they differ, if a scene has no export, or if an export has no scene. Opening and re-saving the scene in the editor changes the hash even if nothing moved, so re-export after any save. The hash covers `region.tscn` only. When chunks arrive, the hash must cover them too. If you change a marker script in a way that changes the export, re-export every region.

**Region file, format 1.** Godot axes (+Y up), metres, every number written with 3 decimals (millimetres). Keys are sorted, and markers appear in scene-tree order, so re-exporting an unchanged scene gives a byte-identical file.

```json
{
  "creature_spawns": [{"count": 3, "creature_id": "small_raptor", "pos": [x, y, z], "respawn_s": 45.000, "wander_radius": 8.000}],
  "entry_points": [{"entry_id": "from_cave", "pos": [x, y, z], "yaw": 1.571}],
  "exits": [{"pos": [x, y, z], "size": [x, y, z], "target_entry": "from_outside", "target_region": "cave", "yaw": 0.000}],
  "format": 1,
  "navmesh": {
    "polygons": [[i0, i1, i2], ...],
    "vertices": [[x, y, z], ...]
  },
  "player_spawns": [{"pos": [x, y, z]}],
  "region_id": "test_greybox",
  "resource_nodes": [{"node_id": "oak_tree", "pos": [x, y, z]}],
  "respawn_points": [{"pos": [x, y, z]}],
  "source_hash": "<sha256 of region.tscn>"
}
```

- `polygons` come straight from `NavigationMesh.get_polygon(i)`. Godot builds them from Recast's detail mesh, so in practice they're all triangles, and vertex heights follow the ground. The file has no adjacency; the server's loader works it out from shared edges.
- `yaw` is radians about +Y: 0 faces −Z, and positive turns counter-clockwise seen from above (the same as a node's `rotation.y`). An exit's `pos` is its box centre and `size` the box's full size.

### The test region (`test_greybox`)

The M0 greybox is 200 m × 200 m with:
- rolling hills, the tallest about 15 m
- a 12 m plateau in the north-west, with a cliff on its south side and a walkable ramp on its east
- a cave mouth in the cliff: a 5 m wide, 10 m deep alcove, the future exit to a cave region
- a river running north to south, with one ford near the middle
- 32 boulders

Flat colours, no textures. The navmesh is one connected piece. `client/regions/test_greybox/build_greybox.gd` generated the scene and *overwrites* it when run, so once someone edits the region by hand, the scene is the only source. The terrain is a `HeightMapShape3D`; `heightmap_terrain.gd` draws it at load time, so the heights are stored once.

## Content data (`data/`)

[ADR 0011](../decisions/0011-content-as-json-data.md). An example item:

```json
{
  "id": "bone_club",
  "name": "Bone club",
  "examine": "A heavy femur. Still smells of raptor.",
  "icon": "items/bone_club.png",
  "model": "items/bone_club.glb",
  "stackable": false,
  "tradeable": true,
  "premium": false,
  "equip": {
    "slot": "weapon",
    "requirements": { "strength": 5 },
    "attack_speed_ms": 2400,
    "style": "crush",
    "bonuses": { "accuracy_melee": 8, "strength_melee": 10 }
  }
}
```

A drop table:

```json
{
  "id": "small_raptor",
  "always": [{ "item": "bones", "qty": 1 }],
  "rolls": 1,
  "table": [
    { "item": "raptor_pelt", "qty": 1, "weight": 40 },
    { "item": "small_raptor_tooth", "qty": [1, 2], "weight": 30 },
    { "nothing": true, "weight": 29 },
    { "item": "razor_sharp_tooth", "qty": 1, "weight": 1 }
  ]
}
```

The razor-sharp tooth above has a 1/100 chance, because the weights add up to 100.

## Generated outputs

| Output | Made by | Committed? |
|---|---|---|
| `client/data/*.json` (client-safe subset) | `dataval --emit-client` | No, built in check and export |
| `client/net/proto/*.gd`, `server/internal/proto/*.go` | `protogen` | Yes, checked for staleness |
| `data/regions/*.region.json` | `export_region.gd` | Yes, checked for staleness |
| Wiki tables (later) | `dataval --emit-wiki` | Yes |
