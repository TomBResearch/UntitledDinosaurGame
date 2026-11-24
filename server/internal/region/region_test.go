package region

import (
	"crypto/sha256"
	"encoding/binary"
	"math"
	"math/rand/v2"
	"testing"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

func TestJoinSendsWelcomeThenSelf(t *testing.T) {
	h := newHarness(t)
	c := &fakeClient{t: t, r: h.r}
	h.send(Input{Kind: InputJoin, Session: 1, Client: c, Name: "Ugg"})
	h.r.Step()
	msgs := c.take()
	if len(msgs) != 2 {
		t.Fatalf("want welcome and entity_enter, got %v", msgs)
	}
	w, ok := msgs[0].(*proto.Welcome)
	if !ok || w.Region != "test_greybox" || w.ServerTick != 1 || int(w.TickHz) != h.hz || w.Entity == 0 {
		t.Fatalf("bad welcome %+v", msgs[0])
	}
	e, ok := msgs[1].(*proto.EntityEnter)
	want := h.spawn()
	if !ok || e.Entity != w.Entity || e.Kind != proto.EntityKindPlayer || e.Name != "Ugg" || e.Position != want || e.Path != nil {
		t.Fatalf("bad self entity_enter %+v", msgs[1])
	}
	h.steps(5)
	if msgs := c.take(); len(msgs) != 0 {
		t.Fatalf("idle ticks sent %v", msgs)
	}
}

func TestWalkToArrival(t *testing.T) {
	h := newHarness(t)
	c := h.join(1, "Ugg")
	target := h.ground(4, 14)
	h.moveTo(1, target)
	h.r.Step()
	start := h.r.tick
	ps, ok := first[*proto.PathStarted](c.take())
	if !ok {
		t.Fatal("no path_started")
	}
	p := ps.Path
	if p.StartTick != start || p.Speed != h.speed || p.Waypoints[0] != h.spawn() {
		t.Fatalf("bad path %+v", p)
	}
	if end := dequantise(p.Waypoints[len(p.Waypoints)-1]); end.Dist(target) > 0.02 {
		t.Fatalf("path ends at %v, want %v", end, target)
	}
	// It arrives on the first tick at or past the end of the path.
	arrive := start + uint32(math.Ceil(pathLength(p)/float64(p.Speed)*float64(h.hz)))
	for h.r.tick < arrive-1 {
		h.r.Step()
		// The server is where every client's playback puts it.
		if got, want := h.entity(1).pos, playback(p, h.r.tick, h.hz); got.Dist(want) > 1e-6 {
			t.Fatalf("tick %d: server at %v, playback at %v", h.r.tick, got, want)
		}
		if msgs := c.take(); len(msgs) != 0 {
			t.Fatalf("tick %d: walking sent %v", h.r.tick, msgs)
		}
	}
	h.r.Step()
	stop, ok := first[*proto.PathStopped](c.take())
	if !ok || stop.Tick != arrive || stop.Position != p.Waypoints[len(p.Waypoints)-1] {
		t.Fatalf("want path_stopped at tick %d at the end, got %+v (ok %v)", arrive, stop, ok)
	}
	if e := h.entity(1); e.moving || e.pos != dequantise(stop.Position) {
		t.Fatalf("entity still moving or off its stop position: %+v", e.pos)
	}
	h.steps(10)
	if msgs := c.take(); len(msgs) != 0 {
		t.Fatalf("after arrival sent %v", msgs)
	}
}

func TestRepathMidWalk(t *testing.T) {
	h := newHarness(t)
	c := h.join(1, "Ugg")
	h.moveTo(1, h.ground(-6, -10))
	h.r.Step()
	first1, _ := first[*proto.PathStarted](c.take())
	h.steps(20)
	h.moveTo(1, h.ground(10, 20))
	h.r.Step()
	msgs := c.take()
	if len(msgs) != 1 {
		t.Fatalf("want one path_started, got %v", msgs)
	}
	second := msgs[0].(*proto.PathStarted).Path
	if second.StartTick != h.r.tick {
		t.Fatalf("new path starts at %d, want %d", second.StartTick, h.r.tick)
	}
	// It starts from where the first path had the entity this tick, so nobody sees a jump.
	if want := quantise(playback(first1.Path, h.r.tick, h.hz)); second.Waypoints[0] != want {
		t.Fatalf("repath from %v, want %v", second.Waypoints[0], want)
	}
	h.stepUntil(400, "arrival", func() bool { _, ok := first[*proto.PathStopped](c.take()); return ok })
	if got := h.entity(1).pos; got.DistXZ(h.ground(10, 20)) > 0.05 {
		t.Fatalf("ended at %v", got)
	}
}

func TestClickOnTheSpotStops(t *testing.T) {
	h := newHarness(t)
	a := h.join(1, "Ugg")
	b := h.join(2, "Grok")
	a.take()
	h.moveTo(1, h.ground(-6, -10))
	h.r.Step()
	ps, _ := first[*proto.PathStarted](b.take())
	a.take()
	h.steps(15)
	// The client clicks right where it's drawn: the path's position now.
	here := playback(ps.Path, h.r.tick+1, h.hz)
	h.moveTo(1, here)
	h.r.Step()
	for _, c := range []*fakeClient{a, b} {
		msgs := c.take()
		stop, ok := first[*proto.PathStopped](msgs)
		if len(msgs) != 1 || !ok || stop.Tick != h.r.tick || stop.Position != quantise(here) {
			t.Fatalf("want path_stopped at %v on tick %d, got %d messages: %+v %+v", quantise(here), h.r.tick, len(msgs), msgs[0], msgs[len(msgs)-1])
		}
	}
	h.steps(30)
	if msgs := append(a.take(), b.take()...); len(msgs) != 0 {
		t.Fatalf("after stopping sent %v", msgs)
	}
}

func TestFailedPath(t *testing.T) {
	h := newHarness(t)
	a := h.join(1, "Ugg")
	b := h.join(2, "Grok")
	a.take()
	b.take()
	sky := navmesh.Vec3{X: 0, Y: 40, Z: 14} // far above the ground: no point of the mesh within 5 m

	// Standing: only the clicker hears about it (it clears the click marker).
	h.moveTo(1, sky)
	h.r.Step()
	stop, ok := first[*proto.PathStopped](a.take())
	if !ok || stop.Position != h.spawn() {
		t.Fatalf("standing failed click: got %+v", stop)
	}
	if msgs := b.take(); len(msgs) != 0 {
		t.Fatalf("a watcher heard about a standing failed click: %v", msgs)
	}

	// Walking: it stops where it is, and everyone who sees it is told.
	h.moveTo(1, h.ground(-6, -10))
	h.r.Step()
	ps, _ := first[*proto.PathStarted](b.take())
	h.steps(10)
	h.moveTo(1, sky)
	h.r.Step()
	want := quantise(playback(ps.Path, h.r.tick, h.hz))
	for _, c := range []*fakeClient{a, b} {
		stop, ok := first[*proto.PathStopped](c.take())
		if !ok || stop.Tick != h.r.tick || stop.Position != want {
			t.Fatalf("walking failed click: got %+v, want stop at %v", stop, want)
		}
	}
	if h.entity(1).moving {
		t.Fatal("still moving")
	}
}

func TestClickTooFarIsDropped(t *testing.T) {
	h := newHarness(t)
	c := h.join(1, "Ugg")
	c.take()
	h.moveTo(1, navmesh.Vec3{X: 200, Y: 1, Z: 14})
	h.steps(3)
	if msgs := c.take(); len(msgs) != 0 || h.r.Stats.MoveTooFar != 1 {
		t.Fatalf("too-far click: sent %v, counted %d", msgs, h.r.Stats.MoveTooFar)
	}
}

func TestOnlyLastClickInATickCounts(t *testing.T) {
	h := newHarness(t)
	c := h.join(1, "Ugg")
	h.moveTo(1, h.ground(-6, -10))
	h.moveTo(1, h.ground(4, 14))
	h.r.Step()
	got := all[*proto.PathStarted](c.take())
	if len(got) != 1 {
		t.Fatalf("want one path_started, got %d", len(got))
	}
	if end := dequantise(got[0].Path.Waypoints[len(got[0].Path.Waypoints)-1]); end.DistXZ(h.ground(4, 14)) > 0.05 {
		t.Fatalf("walked to %v, not the last click", end)
	}
}

func TestViewEnterAndLeave(t *testing.T) {
	h := newHarness(t)
	a := h.join(1, "Ugg")
	b := h.join(2, "Grok")
	idA, idB := uint32(h.ids[1]), uint32(h.ids[2])

	// Both at the spawn: each sees the other.
	if got := all[*proto.EntityEnter](a.take()); len(got) != 2 || got[0].Entity != idA || got[1].Entity != idB {
		t.Fatalf("A should see itself then B join, got %+v", got)
	}
	if got := all[*proto.EntityEnter](b.take()); len(got) != 2 || got[0].Entity != idB || got[1].Entity != idA {
		t.Fatalf("B should see itself then A, got %+v", got)
	}

	// A walks to the NE hill top, out of view. Both lose sight of each other in the same tick, and B
	// hears nothing more about A after that.
	hill := h.ground(58, -52)
	h.moveTo(1, hill)
	h.r.Step()
	if _, ok := first[*proto.PathStarted](b.take()); !ok {
		t.Fatal("B didn't see A start walking")
	}
	var leftAt uint32
	h.stepUntil(2000, "A out of B's view", func() bool {
		ma, mb := a.take(), b.take()
		la, okA := first[*proto.EntityLeave](ma)
		lb, okB := first[*proto.EntityLeave](mb)
		if okA != okB {
			t.Fatalf("tick %d: view isn't symmetric (A left %v, B left %v)", h.r.tick, okA, okB)
		}
		if okA && (la.Entity != idB || lb.Entity != idA) {
			t.Fatalf("wrong entity_leave: %+v %+v", la, lb)
		}
		if okA {
			leftAt = h.r.tick
		}
		return okA
	})
	if d := h.entity(1).pos.DistXZ(h.entity(2).pos); d < 64-16*math.Sqrt2 || d > 64+32*math.Sqrt2 {
		t.Fatalf("left view at %.1f m apart", d)
	}
	h.stepUntil(2000, "A's arrival", func() bool {
		_, ok := first[*proto.PathStopped](a.take())
		return ok
	})
	if msgs := b.take(); len(msgs) != 0 {
		t.Fatalf("B heard about A while out of view: %v", msgs)
	}
	if h.r.tick == leftAt {
		t.Fatal("A arrived the tick it left view; the test proves nothing")
	}

	// B follows. When they meet again, B gets A standing still, and A gets B with its path, which
	// places B exactly where the server has it.
	h.moveTo(2, h.ground(52, -46))
	h.r.Step()
	b.take()
	h.stepUntil(2000, "B in A's view", func() bool {
		ea, okA := first[*proto.EntityEnter](a.take())
		eb, okB := first[*proto.EntityEnter](b.take())
		if okA != okB {
			t.Fatalf("tick %d: view isn't symmetric", h.r.tick)
		}
		if !okA {
			return false
		}
		if ea.Entity != idB || ea.Path == nil || eb.Entity != idA || eb.Path != nil {
			t.Fatalf("bad entity_enter: A got %+v, B got %+v", ea, eb)
		}
		if got, want := playback(*ea.Path, h.r.tick, h.hz), h.entity(2).pos; got.Dist(want) > 1e-6 {
			t.Fatalf("B's path puts it at %v, server has %v", got, want)
		}
		if dequantise(eb.Position).Dist(hill) > 0.02 {
			t.Fatalf("A is at %v, want %v", eb.Position, quantise(hill))
		}
		return true
	})
	// Now in view, A sees B arrive.
	h.stepUntil(2000, "B's arrival seen by A", func() bool {
		s, ok := first[*proto.PathStopped](a.take())
		return ok && s.Entity == idB
	})
}

func TestLeaveAndIDRecycling(t *testing.T) {
	h := newHarness(t)
	h.join(1, "Ugg")
	b := h.join(2, "Grok")
	old := h.ids[1]
	h.send(Input{Kind: InputLeave, Session: 1})
	h.send(Input{Kind: InputLeave, Session: 99}) // unknown: ignored
	h.send(Input{Kind: InputIntent, Session: 1, Msg: &proto.MoveTo{}})
	h.r.Step()
	if l, ok := first[*proto.EntityLeave](b.take()); !ok || l.Entity != uint32(old) {
		t.Fatalf("B didn't see A leave: %+v", l)
	}
	if h.r.Players() != 1 {
		t.Fatalf("%d players left", h.r.Players())
	}
	h.join(3, "Zog")
	if n := h.ids[3]; n == old || n.index() != old.index() {
		t.Fatalf("slot reuse: old id %x, new id %x", old, n)
	}
}

func TestMoveRateLimit(t *testing.T) {
	h := newHarness(t)
	c := h.join(1, "Ugg")
	for range 15 {
		h.moveTo(1, h.ground(4, 14))
	}
	h.r.Step()
	if n := len(all[*proto.PathStarted](c.take())); n != 1 || h.r.Stats.MoveRateLimited != 5 {
		t.Fatalf("burst: %d path_started, %d limited; want 1 and 5", n, h.r.Stats.MoveRateLimited)
	}
	// 10 a second at 20 Hz: a new click is allowed every other tick.
	h.moveTo(1, h.ground(-6, 4))
	h.r.Step()
	if h.r.Stats.MoveRateLimited != 6 {
		t.Fatalf("a click one tick later should be limited")
	}
	h.r.Step()
	h.moveTo(1, h.ground(-6, 4))
	h.r.Step()
	if n := len(all[*proto.PathStarted](c.take())); n != 1 || h.r.Stats.MoveRateLimited != 6 {
		t.Fatalf("after two ticks: %d path_started, %d limited", n, h.r.Stats.MoveRateLimited)
	}
	if c.gone != 0 {
		t.Fatal("disconnected for a few limited clicks")
	}
}

func TestInvalidFloodDisconnects(t *testing.T) {
	h := newHarness(t)
	a := h.join(1, "Ugg")
	b := h.join(2, "Grok")
	a.take()
	// 10 clicks pass, then 50 invalid ones are tolerated, and the 51st disconnects.
	for range 10 + 50 {
		h.moveTo(1, h.ground(4, 14))
	}
	h.r.Step()
	if a.gone != 0 {
		t.Fatalf("disconnected at the limit")
	}
	a.take()
	h.moveTo(1, h.ground(4, 14))
	h.moveTo(1, h.ground(4, 14)) // after the disconnect: ignored
	h.r.Step()
	if a.gone != DisconnectMisbehaving || h.r.Stats.Misbehaving != 1 || h.r.Players() != 1 {
		t.Fatalf("want a misbehaving disconnect, got %v (players %d)", a.gone, h.r.Players())
	}
	if l, ok := first[*proto.EntityLeave](b.take()); !ok || l.Entity != uint32(h.ids[1]) {
		t.Fatal("B didn't see A go")
	}
	if msgs := a.take(); len(msgs) != 0 {
		t.Fatalf("a dropped player was sent %v", msgs)
	}
}

func TestUnknownIntentIsInvalid(t *testing.T) {
	h := newHarness(t)
	c := h.join(1, "Ugg")
	c.take()
	h.send(Input{Kind: InputIntent, Session: 1, Msg: &proto.Ping{}})
	h.r.Step()
	if msgs := c.take(); len(msgs) != 0 || h.r.Stats.UnknownIntent != 1 {
		t.Fatalf("sent %v, counted %d", msgs, h.r.Stats.UnknownIntent)
	}
}

func TestSlowClientIsDropped(t *testing.T) {
	h := newHarness(t)
	a := h.join(1, "Ugg")
	b := h.join(2, "Grok")
	a.take()
	b.take()
	a.full = true
	h.moveTo(1, h.ground(4, 14)) // gives both of them a frame this tick
	h.r.Step()
	if a.gone != DisconnectTooSlow || h.r.Stats.TooSlow != 1 || h.r.Players() != 1 {
		t.Fatalf("want a too-slow disconnect, got %v", a.gone)
	}
	if _, ok := first[*proto.EntityLeave](b.take()); ok {
		t.Fatal("entity_leave sent in the same tick as the overflow, after its frame was flushed")
	}
	h.r.Step()
	if l, ok := first[*proto.EntityLeave](b.take()); !ok || l.Entity != uint32(h.ids[1]) {
		t.Fatal("B didn't see the slow client leave on the next tick")
	}
}

// The same inputs give exactly the same event stream: no map order, clock or scheduling leaks in.
func TestDeterminism(t *testing.T) {
	first := runScenario(t, 7)
	for range 2 {
		if got := runScenario(t, 7); got != first {
			t.Fatal("two runs of the same inputs sent different frames")
		}
	}
	if runScenario(t, 8) == first {
		t.Fatal("a different scenario gave the same frames; the hash isn't covering anything")
	}
}

// runScenario: 12 players join, wander between random polygons, sometimes leave and rejoin. It
// returns a hash of every frame every player got, with its tick.
func runScenario(t *testing.T, seed uint64) [32]byte {
	h := newHarness(t)
	rng := rand.New(rand.NewPCG(seed, 1))
	sum := sha256.New()
	online := map[SessionID]bool{}
	next := SessionID(1)
	var clients []*fakeClient
	var sessions []SessionID
	for tick := 0; tick < 1500; tick++ {
		if len(sessions) < 12 && rng.IntN(10) == 0 {
			c := &fakeClient{t: t, r: h.r}
			h.send(Input{Kind: InputJoin, Session: next, Client: c, Name: "Bot"})
			clients, sessions = append(clients, c), append(sessions, next)
			online[next] = true
			next++
		}
		for i, s := range sessions {
			if !online[s] {
				continue
			}
			switch n := rng.IntN(200); {
			case n < 6:
				poly := h.mesh.Polygon(rng.IntN(h.mesh.PolygonCount()))
				h.moveTo(s, poly[0].Lerp(poly[1], 0.5).Lerp(poly[2], 0.5))
			case n == 6:
				h.send(Input{Kind: InputLeave, Session: s})
				online[s] = false
				_ = clients[i]
			}
		}
		h.r.Step()
	}
	for i, c := range clients {
		for _, f := range c.frames {
			var hdr [12]byte
			binary.LittleEndian.PutUint32(hdr[0:], uint32(i))
			binary.LittleEndian.PutUint32(hdr[4:], f.tick)
			binary.LittleEndian.PutUint32(hdr[8:], uint32(len(f.data)))
			sum.Write(hdr[:])
			sum.Write(f.data)
		}
	}
	var out [32]byte
	copy(out[:], sum.Sum(nil))
	return out
}
