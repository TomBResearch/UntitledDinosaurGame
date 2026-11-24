package region

import (
	"math/rand/v2"
	"slices"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// botClient counts what a bot is sent, and is never slow.
type botClient struct{ bytes, frames int }

func (c *botClient) Deliver(b []byte) bool       { c.bytes += len(b); c.frames++; return true }
func (c *botClient) Disconnect(DisconnectReason) {}

// BenchmarkBots is the M0 bot walk test (tools/slow-tests.sh): 50 bots on the greybox region, all
// joining at the spawn, then walking to random points, pausing, and sometimes changing their mind
// mid-walk. Each benchmark iteration is one tick; it reports the p99 tick time, which must stay under
// 2 ms (docs/roadmap/milestones.md, M0 acceptance). Run with -benchtime 6000x for five minutes of play.
func BenchmarkBots(b *testing.B) {
	const bots = 50
	h := newHarness(b)
	rng := rand.New(rand.NewPCG(1, 2))
	polys := h.mesh.PolygonCount()
	centre := func(p int) navmesh.Vec3 {
		v := h.mesh.Polygon(p)
		return v[0].Add(v[1]).Add(v[2]).Scale(1.0 / 3)
	}
	clients := make([]*botClient, bots)
	idle := make([]int, bots) // ticks until the bot clicks again
	for i := range bots {
		clients[i] = &botClient{}
		h.send(Input{Kind: InputJoin, Session: SessionID(i + 1), Client: clients[i], Name: "Bot"})
		idle[i] = rng.IntN(40)
	}
	h.r.Step()
	times := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		b.StopTimer()
		for i := range bots {
			e := h.r.get(h.r.sessions[SessionID(i+1)])
			switch {
			case e.moving && rng.IntN(60) == 0: // about once every 3 s of walking: change of mind
			case !e.moving && idle[i] <= 0:
			case !e.moving:
				idle[i]--
				continue
			default:
				continue
			}
			var target navmesh.Vec3
			for range 10 { // a random point within click range
				if target = centre(rng.IntN(polys)); target.Dist(e.pos) < 140 {
					break
				}
			}
			h.send(Input{Kind: InputIntent, Session: SessionID(i + 1), Msg: &proto.MoveTo{Position: quantise(target)}})
			idle[i] = rng.IntN(60)
		}
		b.StartTimer()
		began := time.Now()
		h.r.Step()
		times = append(times, time.Since(began))
	}
	b.StopTimer()
	slices.Sort(times)
	pct := func(p float64) float64 {
		return float64(times[min(len(times)-1, int(float64(len(times))*p))].Nanoseconds())
	}
	b.ReportMetric(pct(0.50), "p50-ns/tick")
	b.ReportMetric(pct(0.99), "p99-ns/tick")
	b.ReportMetric(float64(times[len(times)-1].Nanoseconds()), "max-ns/tick")
	var bytes int
	for _, c := range clients {
		bytes += c.bytes
	}
	seconds := float64(b.N) / float64(h.hz)
	b.ReportMetric(float64(bytes)/bots/seconds, "B/s/player")
	if h.r.Players() != bots {
		b.Fatalf("%d bots left", bots-h.r.Players())
	}
}
