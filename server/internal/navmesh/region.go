package navmesh

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
)

// RegionFormat is the region file format version this loader reads.
const RegionFormat = 1

// Region is one data/regions/<region_id>.region.json file, written by client/tools/export_region.gd.
// Never edit these by hand: change the scene and re-export (ADR 0004).
type Region struct {
	ID string
	// SourceHash is the SHA-256 (hex) of the region scene it was exported from.
	SourceHash    string
	Mesh          *Mesh
	PlayerSpawns  []Vec3
	RespawnPoints []Vec3
	// Not defined yet in format 1 (they arrive with the tasks that use them), so kept raw.
	CreatureSpawns []json.RawMessage
	ResourceNodes  []json.RawMessage
	Exits          []json.RawMessage
}

type regionFileV1 struct {
	Format     int    `json:"format"`
	RegionID   string `json:"region_id"`
	SourceHash string `json:"source_hash"`
	Navmesh    *struct {
		Vertices [][]float64 `json:"vertices"`
		Polygons [][]int     `json:"polygons"`
	} `json:"navmesh"`
	PlayerSpawns   []spawnV1         `json:"player_spawns"`
	RespawnPoints  []spawnV1         `json:"respawn_points"`
	CreatureSpawns []json.RawMessage `json:"creature_spawns"`
	ResourceNodes  []json.RawMessage `json:"resource_nodes"`
	Exits          []json.RawMessage `json:"exits"`
}

type spawnV1 struct {
	Pos []float64 `json:"pos"`
}

var (
	regionIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,47}$`)
	hashPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// LoadRegion reads and validates a region file.
func LoadRegion(path string) (*Region, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	r, err := ParseRegion(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return r, nil
}

// ParseRegion decodes and validates a region file: strict JSON (unknown fields are errors), format 1,
// a valid navmesh, and spawn points on it.
func ParseRegion(raw []byte) (*Region, error) {
	// Check the version first, so a newer file gets a clear message rather than "unknown field".
	var head struct {
		Format *int `json:"format"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, fmt.Errorf("region file: %w", err)
	}
	if head.Format == nil {
		return nil, errors.New(`region file: no "format" field`)
	}
	if *head.Format != RegionFormat {
		return nil, fmt.Errorf("region file: format %d, but this server reads format %d", *head.Format, RegionFormat)
	}

	var f regionFileV1
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("region file: %w", err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, errors.New("region file: unexpected data after the top-level object")
	}

	var problems []error
	bad := func(format string, args ...any) {
		problems = append(problems, fmt.Errorf("region file: "+format, args...))
	}
	if !regionIDPattern.MatchString(f.RegionID) {
		bad("bad region_id %q (lower-case letters, digits, underscores)", f.RegionID)
	}
	if !hashPattern.MatchString(f.SourceHash) {
		bad("source_hash must be 64 lower-case hex digits, got %q", f.SourceHash)
	}
	if f.Navmesh == nil {
		bad("no navmesh")
		return nil, errors.Join(problems...)
	}
	verts := make([]Vec3, len(f.Navmesh.Vertices))
	for i, v := range f.Navmesh.Vertices {
		if len(v) != 3 {
			bad("navmesh vertex %d has %d coordinates, want 3", i, len(v))
			continue
		}
		verts[i] = Vec3{v[0], v[1], v[2]}
	}
	if len(problems) > 0 {
		return nil, errors.Join(problems...)
	}
	mesh, err := Build(verts, f.Navmesh.Polygons)
	if err != nil {
		return nil, err
	}
	r := &Region{
		ID: f.RegionID, SourceHash: f.SourceHash, Mesh: mesh,
		CreatureSpawns: f.CreatureSpawns, ResourceNodes: f.ResourceNodes, Exits: f.Exits,
	}
	points := func(name string, in []spawnV1) []Vec3 {
		out := make([]Vec3, 0, len(in))
		for i, s := range in {
			if len(s.Pos) != 3 {
				bad("%s[%d].pos has %d coordinates, want 3", name, i, len(s.Pos))
				continue
			}
			p := Vec3{s.Pos[0], s.Pos[1], s.Pos[2]}
			if _, ok := mesh.ClosestPoint(p, DefaultLimits.SnapRadius); !ok {
				bad("%s[%d] at %v is more than %g m from the navmesh", name, i, p, DefaultLimits.SnapRadius)
			}
			out = append(out, p)
		}
		return out
	}
	r.PlayerSpawns = points("player_spawns", f.PlayerSpawns)
	r.RespawnPoints = points("respawn_points", f.RespawnPoints)
	if len(problems) > 0 {
		return nil, errors.Join(problems...)
	}
	return r, nil
}
