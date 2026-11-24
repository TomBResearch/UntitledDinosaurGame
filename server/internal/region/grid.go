package region

import (
	"math"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// grid is the interest grid: square cells over the region in XZ, each listing the entities in it.
//
// A player sees every cell whose centre is within the view radius of the centre of their own cell, so
// what you can see only changes when you (or it) cross a cell boundary, and seeing is symmetric: two
// players either see each other or neither does. An event about an entity goes to the players in the
// cells that can see its cell.
type grid struct {
	x0, z0  float64
	size    float64
	w, h    int32
	cells   [][]uint32 // entity slot indices, in a deterministic order
	reach2  float64    // (view radius / cell size)², in cells
	offsets []cellOffset
}

type cellOffset struct{ dx, dz int32 }

// newGrid covers the mesh's bounds, plus a cell of margin each side.
func newGrid(m *navmesh.Mesh, size, viewRadius float64) grid {
	minX, minZ := math.Inf(1), math.Inf(1)
	maxX, maxZ := math.Inf(-1), math.Inf(-1)
	for p := range m.PolygonCount() {
		for _, v := range m.Polygon(p) {
			minX, maxX = math.Min(minX, v.X), math.Max(maxX, v.X)
			minZ, maxZ = math.Min(minZ, v.Z), math.Max(maxZ, v.Z)
		}
	}
	g := grid{x0: minX - size, z0: minZ - size, size: size}
	g.w = int32(math.Floor((maxX+size-g.x0)/size)) + 1
	g.h = int32(math.Floor((maxZ+size-g.z0)/size)) + 1
	g.cells = make([][]uint32, int(g.w)*int(g.h))
	g.reach2 = (viewRadius / size) * (viewRadius / size)
	reach := int32(viewRadius / size)
	for dz := -reach; dz <= reach; dz++ {
		for dx := -reach; dx <= reach; dx++ {
			if float64(dx*dx+dz*dz) <= g.reach2 {
				g.offsets = append(g.offsets, cellOffset{dx, dz})
			}
		}
	}
	return g
}

func (g *grid) cellOf(p navmesh.Vec3) int32 {
	cx := int32(max(0, min(float64(g.w-1), math.Floor((p.X-g.x0)/g.size))))
	cz := int32(max(0, min(float64(g.h-1), math.Floor((p.Z-g.z0)/g.size))))
	return cz*g.w + cx
}

// sees reports whether cell a can see cell b (and so b can see a).
func (g *grid) sees(a, b int32) bool {
	dx, dz := a%g.w-b%g.w, a/g.w-b/g.w
	return float64(dx*dx+dz*dz) <= g.reach2
}

// view calls fn for each cell that c can see, in a fixed order.
func (g *grid) view(c int32, fn func(c int32)) {
	cx, cz := c%g.w, c/g.w
	for _, o := range g.offsets {
		x, z := cx+o.dx, cz+o.dz
		if x >= 0 && x < g.w && z >= 0 && z < g.h {
			fn(z*g.w + x)
		}
	}
}

func (g *grid) add(e *entity, c int32) {
	idx := e.id.index()
	e.cell, e.cellSlot = c, int32(len(g.cells[c]))
	g.cells[c] = append(g.cells[c], idx)
}

func (g *grid) take(r *Region, e *entity) {
	list := g.cells[e.cell]
	last := len(list) - 1
	if int(e.cellSlot) != last {
		moved := list[last]
		list[e.cellSlot] = moved
		r.ents[moved].cellSlot = e.cellSlot
	}
	g.cells[e.cell] = list[:last]
	e.cell, e.cellSlot = -1, -1
}

// insert puts a new entity in the grid. It and everyone in view are told about each other; a player
// is told about itself first.
func (g *grid) insert(r *Region, e *entity) {
	c := g.cellOf(e.pos)
	if e.kind == proto.EntityKindPlayer {
		r.sendEnter(e, e)
	}
	g.view(c, func(vc int32) {
		for _, idx := range g.cells[vc] {
			r.meet(e, &r.ents[idx])
		}
	})
	g.add(e, c)
}

// remove takes an entity out of the grid. Every player who could see it is told it left.
func (g *grid) remove(r *Region, e *entity) {
	if e.cell < 0 {
		return
	}
	c := e.cell
	g.take(r, e)
	g.view(c, func(vc int32) {
		for _, idx := range g.cells[vc] {
			if o := &r.ents[idx]; o.kind == proto.EntityKindPlayer {
				r.sendLeave(o, e)
			}
		}
	})
}

// move puts e in cell `to`. Entities in cells that only the old cell could see, and e, stop seeing
// each other; those in cells that only the new one can see start to.
func (g *grid) move(r *Region, e *entity, to int32) {
	from := e.cell
	g.take(r, e)
	g.view(from, func(vc int32) {
		if g.sees(vc, to) {
			return
		}
		for _, idx := range g.cells[vc] {
			r.part(e, &r.ents[idx])
		}
	})
	g.view(to, func(vc int32) {
		if g.sees(vc, from) {
			return
		}
		for _, idx := range g.cells[vc] {
			r.meet(e, &r.ents[idx])
		}
	})
	g.add(e, to)
}

// forWatchers calls fn for every player who can see e, e included if it's a player.
func (g *grid) forWatchers(r *Region, e *entity, fn func(w *entity)) {
	if e.cell < 0 {
		return
	}
	g.view(e.cell, func(vc int32) {
		for _, idx := range g.cells[vc] {
			if o := &r.ents[idx]; o.kind == proto.EntityKindPlayer {
				fn(o)
			}
		}
	})
}

// meet: a and b have come into each other's view.
func (r *Region) meet(a, b *entity) {
	if b.kind == proto.EntityKindPlayer {
		r.sendEnter(b, a)
	}
	if a.kind == proto.EntityKindPlayer {
		r.sendEnter(a, b)
	}
}

// part: a and b have gone out of each other's view.
func (r *Region) part(a, b *entity) {
	if b.kind == proto.EntityKindPlayer {
		r.sendLeave(b, a)
	}
	if a.kind == proto.EntityKindPlayer {
		r.sendLeave(a, b)
	}
}

// updateInterest moves every entity that crossed a cell boundary this tick to its new cell.
func (r *Region) updateInterest() {
	for i := range r.ents {
		e := &r.ents[i]
		if e.id == 0 || e.cell < 0 {
			continue
		}
		if c := r.grid.cellOf(e.pos); c != e.cell {
			r.grid.move(r, e, c)
		}
	}
}
