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

A region is a folder in `client/regions/<region_id>/`:

| Node or scene | Purpose |
|---|---|
| `chunks/chunk_<x>_<z>.tscn` | 64 m terrain and props. The client streams these. |
| `region.tscn` | Authoring root: instances every chunk, plus the nodes below |
| `NavigationRegion3D` | Baked navmesh. Agent radius 0.4 m, height 1.8 m, max climb 0.4 m, max slope 40° |
| `SpawnPoint` markers (script) | `creature_id`, count, wander radius, respawn time, or player spawn |
| `RespawnPoint` markers | Where players reappear after dying (the nearest one is used) |
| `ResourceNode` markers | `node_id` from `data/nodes/`. The visual comes from the node definition. |
| `RegionExit` areas | Target region and entry point id |
| `EntryPoint` markers | Named arrival points for exits and teleports |

**Export:** `tools/export-regions.sh` runs `client/tools/export_region.gd` headless and writes `data/regions/<region_id>.region.json` ([ADR 0004](../decisions/0004-navmesh-baked-in-godot.md)). The fast check fails if a region scene's hash doesn't match its export.

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
