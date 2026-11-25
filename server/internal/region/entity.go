package region

import (
	"math"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// EntityID is an entity's id within its region: the slot index in the low 20 bits and a generation in
// the high 12, so a recycled slot gets a new id. 0 is never a valid id.
type EntityID uint32

const (
	indexBits = 20
	indexMask = 1<<indexBits - 1
	genMask   = 1<<(32-indexBits) - 1
	// MaxEntities is how many entities a region can hold at once.
	MaxEntities = 1 << indexBits
)

func (id EntityID) index() uint32 { return uint32(id) & indexMask }

// entity is one thing in the region. Only players exist in M0; creatures, nodes, ground items and NPCs
// add their own optional fields (docs/architecture/world-server.md, "Entities").
type entity struct {
	id   EntityID // 0 while the slot is free
	gen  uint32   // the slot's generation, kept while it's free
	kind proto.EntityKind
	name string

	// pos is where the entity is at the current tick, in metres. A standing entity is always exactly on
	// the centimetre grid, so what clients are told is exactly what the server has.
	pos navmesh.Vec3
	// cell and cellSlot place the entity in the interest grid (cell -1: not in it).
	cell, cellSlot int32

	// Movement. path is the quantised path as broadcast: it's the authoritative one, so the server and
	// every client compute the same positions from it (see positionAt).
	moving bool
	path   proto.Path
	cum    []float64 // cum[i]: distance in cm along the path from waypoint 0 to waypoint i
	seg    int       // the segment the entity was last on, so the search for the next one is short

	// Players only.
	session                               SessionID
	client                                Client
	out                                   []byte // this tick's encoded events
	pendingMove                           bool
	moveTarget                            navmesh.Vec3
	moveTokens, chatTokens, invalidTokens bucket
	// role is the account role shown as a chat badge, from the join ticket (normal for dev tickets).
	role proto.Role
	// muted players' chat is dropped, and only they are told. Always false until staff tools (M7).
	muted bool
}

// alloc takes a free slot (or a new one) and gives it a fresh id.
func (r *Region) alloc() *entity {
	var idx uint32
	if n := len(r.free); n > 0 {
		idx = r.free[n-1]
		r.free = r.free[:n-1]
	} else {
		if len(r.ents) >= MaxEntities {
			panic("region: out of entity slots")
		}
		idx = uint32(len(r.ents))
		r.ents = append(r.ents, entity{})
	}
	e := &r.ents[idx]
	e.gen = (e.gen + 1) & genMask
	if e.gen == 0 {
		e.gen = 1
	}
	e.id = EntityID(e.gen<<indexBits | idx)
	e.cell = -1
	return e
}

// release frees an entity's slot. Its buffers are kept for the next entity in the slot.
func (r *Region) release(e *entity) {
	idx := e.id.index()
	*e = entity{
		gen:  e.gen,
		cell: -1,
		out:  e.out[:0],
		cum:  e.cum[:0],
		path: proto.Path{Waypoints: e.path.Waypoints[:0]},
	}
	r.free = append(r.free, idx)
}

// get returns the live entity with this id, or nil.
func (r *Region) get(id EntityID) *entity {
	idx := id.index()
	if id == 0 || int(idx) >= len(r.ents) || r.ents[idx].id != id {
		return nil
	}
	return &r.ents[idx]
}

// quantise turns metres into the protocol's whole centimetres.
func quantise(p navmesh.Vec3) proto.Pos {
	return proto.Pos{X: cm(p.X), Y: cm(p.Y), Z: cm(p.Z)}
}

func cm(v float64) int32 {
	return int32(max(math.MinInt32, min(math.MaxInt32, math.Round(v*100))))
}

func dequantise(p proto.Pos) navmesh.Vec3 {
	return navmesh.Vec3{X: float64(p.X) / 100, Y: float64(p.Y) / 100, Z: float64(p.Z) / 100}
}
