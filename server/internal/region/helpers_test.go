package region

import (
	"math"
	"sync"
	"testing"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// The tests run on the real greybox region with the real data/ settings. Useful points on it (from the
// greybox hand-over): the spawn (-6, 1.25, 14); the NE hill top (58, ~15.5, -52), about 92 m away and
// out of view, reached over the river ford; the cave mouth (-55, ~1, -36).
var loadData = sync.OnceValues(func() (*content.Content, error) { return content.Load("../../../data") })

func testData(t testing.TB) (*content.Content, *navmesh.Region) {
	t.Helper()
	c, err := loadData()
	if err != nil {
		t.Fatal(err)
	}
	for _, rf := range c.Regions {
		if rf.ID == "test_greybox" {
			return c, rf
		}
	}
	t.Fatal("no test_greybox region in data/regions")
	return nil, nil
}

// fakeClient records what a region sends one player.
type fakeClient struct {
	t      testing.TB
	r      *Region
	frames []frame
	full   bool             // Deliver refuses frames, like a slow connection
	gone   DisconnectReason // set by Disconnect
	seen   int              // frames already returned by take
}

type frame struct {
	tick uint32
	data []byte
}

func (c *fakeClient) Deliver(b []byte) bool {
	if c.full {
		return false
	}
	if n := len(c.frames); n > 0 && c.frames[n-1].tick == c.r.tick {
		c.t.Errorf("two frames in tick %d", c.r.tick)
	}
	c.frames = append(c.frames, frame{c.r.tick, b})
	return true
}

func (c *fakeClient) Disconnect(why DisconnectReason) {
	if c.gone != 0 {
		c.t.Errorf("disconnected twice")
	}
	c.gone = why
}

// take decodes every frame received since the last take.
func (c *fakeClient) take() []proto.Message {
	c.t.Helper()
	var out []proto.Message
	for _, f := range c.frames[c.seen:] {
		msgs, err := proto.Decode(f.data, proto.FromServer)
		if err != nil {
			c.t.Fatalf("tick %d: undecodable frame: %v", f.tick, err)
		}
		out = append(out, msgs...)
	}
	c.seen = len(c.frames)
	return out
}

type harness struct {
	t       testing.TB
	r       *Region
	mesh    *navmesh.Mesh
	hz      int
	speed   uint32
	clients map[SessionID]*fakeClient
	ids     map[SessionID]EntityID
}

func newHarness(t testing.TB) *harness {
	t.Helper()
	c, rf := testData(t)
	r, err := New(rf, DefaultConfig(c.Progression.Server.TickHz, c.Progression.Movement.WalkSpeed))
	if err != nil {
		t.Fatal(err)
	}
	return &harness{t: t, r: r, mesh: rf.Mesh, hz: c.Progression.Server.TickHz,
		speed:   uint32(math.Round(c.Progression.Movement.WalkSpeed * 100)),
		clients: map[SessionID]*fakeClient{}, ids: map[SessionID]EntityID{}}
}

func (h *harness) send(in Input) {
	select {
	case h.r.inbox <- in:
	default:
		h.t.Fatal("inbox full")
	}
}

// join adds a player and steps once. The join frame is left for take.
func (h *harness) join(s SessionID, name string) *fakeClient {
	h.t.Helper()
	c := &fakeClient{t: h.t, r: h.r}
	h.clients[s] = c
	h.send(Input{Kind: InputJoin, Session: s, Client: c, Name: name})
	h.r.Step()
	msgs, err := proto.Decode(c.frames[0].data, proto.FromServer)
	if err != nil {
		h.t.Fatal(err)
	}
	w, ok := first[*proto.Welcome](msgs)
	if !ok {
		h.t.Fatalf("%s got no welcome: %v", name, msgs)
	}
	h.ids[s] = EntityID(w.Entity)
	return c
}

func (h *harness) moveTo(s SessionID, p navmesh.Vec3) {
	h.send(Input{Kind: InputIntent, Session: s, Msg: &proto.MoveTo{Position: quantise(p)}})
}

// ground is the point on the mesh at (x, z).
func (h *harness) ground(x, z float64) navmesh.Vec3 {
	h.t.Helper()
	loc, ok := h.mesh.ClosestPoint(navmesh.Vec3{X: x, Y: 50, Z: z}, 100)
	if !ok {
		h.t.Fatalf("(%v, %v) is off the mesh", x, z)
	}
	return loc.Pos
}

func (h *harness) steps(n int) {
	for range n {
		h.r.Step()
	}
}

// stepUntil steps until cond holds, failing after max ticks.
func (h *harness) stepUntil(max int, what string, cond func() bool) {
	h.t.Helper()
	for range max {
		h.r.Step()
		if cond() {
			return
		}
	}
	h.t.Fatalf("no %s within %d ticks", what, max)
}

// spawn is the region's (only) player spawn, as broadcast.
func (h *harness) spawn() proto.Pos { return quantise(h.r.spawns[0]) }

func (h *harness) entity(s SessionID) *entity { return h.r.get(h.ids[s]) }

// first returns the first message of type T.
func first[T proto.Message](msgs []proto.Message) (T, bool) {
	for _, m := range msgs {
		if v, ok := m.(T); ok {
			return v, true
		}
	}
	var zero T
	return zero, false
}

func all[T proto.Message](msgs []proto.Message) []T {
	var out []T
	for _, m := range msgs {
		if v, ok := m.(T); ok {
			out = append(out, v)
		}
	}
	return out
}

// playback is the client's calculation, written independently of the server's: where a broadcast path
// puts its entity at tick t (docs/architecture/networking.md, "Movement playback").
func playback(p proto.Path, t uint32, hz int) navmesh.Vec3 {
	dist := float64(p.Speed) * float64(t-p.StartTick) / float64(hz)
	for i := 1; i < len(p.Waypoints); i++ {
		a, b := dequantise(p.Waypoints[i-1]).Scale(100), dequantise(p.Waypoints[i]).Scale(100)
		seg := a.Dist(b)
		if dist < seg {
			return a.Lerp(b, dist/seg).Scale(0.01)
		}
		dist -= seg
	}
	return dequantise(p.Waypoints[len(p.Waypoints)-1])
}

// pathLength is a path's length in centimetres.
func pathLength(p proto.Path) float64 {
	var total float64
	for i := 1; i < len(p.Waypoints); i++ {
		total += dequantise(p.Waypoints[i-1]).Dist(dequantise(p.Waypoints[i])) * 100
	}
	return total
}
