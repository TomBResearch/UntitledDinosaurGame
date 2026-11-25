class_name SpikeTerrain
extends RefCounted
## Height and layout of the streaming spike's generated region (client/spikes/streaming/). The
## heights repeat every TILE_M metres on both axes, so the bench can tile the generated chunks over an
## endless plane and walk as far as it likes. Spike-only numbers, not game content.

## The generated region is TILE_M x TILE_M metres (8 x 8 chunks of 64 m), wider than the
## 2 x 220 m unload window, so a window never holds two copies of one chunk file. Every chunk size
## must divide it.
const TILE_M := 512.0
## Chunk sizes the generator writes, each into generated/chunks<size>/.
const CHUNK_SIZES: Array[int] = [64, 32]
const GENERATED_DIR := "res://spikes/streaming/generated"


## Ground height (metres) at world x, z. Periodic in TILE_M.
static func height_at(x: float, z: float) -> float:
	var u := TAU * x / TILE_M
	var v := TAU * z / TILE_M
	return (
		5.0 * sin(2.0 * u) * cos(4.0 * v)
		+ 3.0 * sin(6.0 * u + 4.0 * v + 1.3)
		+ 1.5 * sin(10.0 * u - 8.0 * v + 0.7)
		+ 0.8 * sin(18.0 * u) * sin(14.0 * v)
	)


## The scene for the chunk at world chunk coordinates (cx, cz), tiling the generated region.
static func chunk_path(size_m: int, cx: int, cz: int) -> String:
	var per_side := int(TILE_M) / size_m
	return "%s/chunks%d/chunk_%d_%d.tscn" % [
		GENERATED_DIR, size_m, posmod(cx, per_side), posmod(cz, per_side)]
