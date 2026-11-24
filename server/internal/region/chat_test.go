package region

import (
	"strings"
	"testing"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

func (h *harness) say(s SessionID, text string) {
	h.send(Input{Kind: InputIntent, Session: s, Msg: &proto.ChatSay{Text: text}})
}

// place puts a standing player at p (anywhere: chat doesn't need the navmesh) and updates the
// interest grid. The enter and leave events that causes are discarded.
func (h *harness) place(s SessionID, p navmesh.Vec3) {
	h.t.Helper()
	e := h.entity(s)
	if e.moving {
		h.t.Fatal("place: the player is walking")
	}
	e.pos = p
	h.r.updateInterest()
	for i := range h.r.ents {
		h.r.ents[i].out = h.r.ents[i].out[:0]
	}
}

// chats returns the chat lines c received since the last take.
func chats(c *fakeClient) []*proto.Chat { return all[*proto.Chat](c.take()) }

// heardOnce says what one chat line from s was delivered as, failing unless exactly one arrived.
func (h *harness) heardOnce(c *fakeClient, from SessionID) string {
	h.t.Helper()
	got := chats(c)
	if len(got) != 1 {
		h.t.Fatalf("want one chat line, got %d", len(got))
	}
	if got[0].Entity != uint32(h.ids[from]) {
		h.t.Fatalf("chat from entity %d, want %d", got[0].Entity, h.ids[from])
	}
	return got[0].Text
}

// joinAll joins sessions 1..n at the spawn and discards their join frames.
func (h *harness) joinAll(names ...string) []*fakeClient {
	var cs []*fakeClient
	for i, n := range names {
		cs = append(cs, h.join(SessionID(i+1), n))
	}
	for _, c := range cs {
		c.take()
	}
	return cs
}

func TestChatRadius(t *testing.T) {
	h := newHarness(t)
	if h.r.cfg.ChatRadius != 40 {
		t.Fatalf("chat radius %v: the tests assume data/progression.json chat.radius_m is 40", h.r.cfg.ChatRadius)
	}
	cs := h.joinAll("Ugg", "Grok", "Zog", "Mog", "Bog")
	speaker, inside, outside, above, below := cs[0], cs[1], cs[2], cs[3], cs[4]
	s := h.r.spawns[0]
	h.place(2, s.Add(navmesh.Vec3{X: 39.99}))
	h.place(3, s.Add(navmesh.Vec3{Z: -40.01}))
	h.place(4, s.Add(navmesh.Vec3{X: 30, Y: 27}))  // 40.4 m in 3D, 30 m on the map
	h.place(5, s.Add(navmesh.Vec3{X: 30, Y: -26})) // 39.7 m in 3D

	h.say(1, "Rawr")
	h.r.Step()
	tick := h.r.tick
	for _, c := range []*fakeClient{speaker, inside, below} {
		got := chats(c)
		if len(got) != 1 {
			t.Fatalf("want one chat line, got %v", got)
		}
		want := proto.Chat{Entity: uint32(h.ids[1]), Name: "Ugg", Role: proto.RoleNormal, Text: "Rawr"}
		if *got[0] != want {
			t.Errorf("got %+v, want %+v", *got[0], want)
		}
		if f := c.frames[len(c.frames)-1]; f.tick != tick {
			t.Errorf("delivered in tick %d, not the tick it was said (%d)", f.tick, tick)
		}
	}
	for _, c := range []*fakeClient{outside, above} {
		if got := chats(c); len(got) != 0 {
			t.Errorf("a player over 40 m away heard %v", got)
		}
	}
	if h.r.Stats.ChatSent != 1 {
		t.Errorf("ChatSent = %d", h.r.Stats.ChatSent)
	}

	// Chat follows the speaker: walk the outsider in and they hear the next line.
	h.place(3, s.Add(navmesh.Vec3{Z: -39.99}))
	h.say(1, "Over here")
	h.r.Step()
	if got := h.heardOnce(outside, 1); got != "Over here" {
		t.Errorf("got %q", got)
	}
}

func TestChatRateLimit(t *testing.T) {
	h := newHarness(t)
	cs := h.joinAll("Ugg", "Grok")
	// A burst of 3, then the rest are dropped and counted as invalid.
	for i := range 5 {
		h.say(1, "line "+string(rune('a'+i)))
	}
	h.r.Step()
	if got := chats(cs[1]); len(got) != 3 || got[2].Text != "line c" {
		t.Fatalf("burst: got %v, want lines a-c", got)
	}
	if h.r.Stats.ChatRateLimited != 2 {
		t.Fatalf("ChatRateLimited = %d, want 2", h.r.Stats.ChatRateLimited)
	}
	if spent := h.entity(1).invalidTokens.level; spent != int64(h.r.cfg.InvalidLimit.Burst-2)*h.r.ticksPerMinute {
		t.Errorf("rate-limited chat should count as invalid (bucket level %d)", spent)
	}
	// Then one a second: 20 ticks at 20 Hz.
	h.steps(18)
	h.say(1, "too soon")
	h.r.Step()
	if got := chats(cs[1]); len(got) != 0 || h.r.Stats.ChatRateLimited != 3 {
		t.Fatalf("a line 19 ticks later got through: %v", got)
	}
	h.say(1, "now")
	h.r.Step()
	if got := h.heardOnce(cs[1], 1); got != "now" {
		t.Fatalf("got %q", got)
	}
	if cs[0].gone != 0 {
		t.Fatal("disconnected for a few limited lines")
	}
}

func TestChatLengthInCodePoints(t *testing.T) {
	h := newHarness(t)
	cs := h.joinAll("Ugg", "Grok")
	accepted := []string{
		strings.Repeat("a", 120),
		strings.Repeat("🦖", 120), // 4 bytes each: 480 bytes, the wire limit
		strings.Repeat("é", 120),
		"   " + strings.Repeat("a", 120) + "   ",                    // trimmed first
		strings.Repeat("a", 60) + "     " + strings.Repeat("a", 59), // 124 sent, 120 once collapsed
		strings.Repeat("a", 119) + "\u200b\u202e",                   // invisible characters don't count
	}
	for _, text := range accepted {
		h.say(1, text)
		h.steps(20)
		if got := chats(cs[1]); len(got) != 1 {
			t.Errorf("%d-byte line wasn't delivered", len(text))
		}
	}
	rejected := []string{
		strings.Repeat("a", 121),
		strings.Repeat("🦖", 41) + strings.Repeat("a", 80),
		strings.Repeat("👍🏽", 61), // each is 2 code points
	}
	for _, text := range rejected {
		h.say(1, text)
		h.steps(20)
		if got := chats(cs[1]); len(got) != 0 {
			t.Errorf("%d-code-point line was delivered as %d", len([]rune(text)), len([]rune(got[0].Text)))
		}
	}
	if h.r.Stats.ChatTooLong != uint64(len(rejected)) {
		t.Errorf("ChatTooLong = %d, want %d", h.r.Stats.ChatTooLong, len(rejected))
	}
}

func TestChatCleaning(t *testing.T) {
	h := newHarness(t)
	cs := h.joinAll("Ugg", "Grok")
	cases := []struct{ in, want string }{
		{"  hello \t\n world  ", "hello world"},
		{"hi\x00\x1b[31m there\x7f", "hi[31m there"},
		{"abc\u202edef", "abcdef"},
		{"in\u200bvis\u2060ible", "invisible"},
		{"[color=red]hi[/color] [b]x[/b]", "[color=red]hi[/color] [b]x[/b]"}, // the client shows it as plain text
		{"<script>alert(1)</script>", "<script>alert(1)</script>"},
	}
	for _, c := range cases {
		h.say(1, c.in)
		h.steps(20)
		if got := h.heardOnce(cs[1], 1); got != c.want {
			t.Errorf("%q arrived as %q, want %q", c.in, got, c.want)
		}
	}
}

func TestChatEmptyIsDropped(t *testing.T) {
	h := newHarness(t)
	cs := h.joinAll("Ugg", "Grok")
	for _, text := range []string{"", "   ", "\t\n", "\u200b\u202e\u2066", "\x00\x01", "\u3164"} {
		h.say(1, text)
		h.steps(20)
		for _, c := range cs {
			if msgs := c.take(); len(msgs) != 0 {
				t.Errorf("%q: sent %v", text, msgs)
			}
		}
	}
	if h.r.Stats.ChatEmpty != 6 || h.r.Stats.ChatSent != 0 {
		t.Errorf("ChatEmpty %d, ChatSent %d", h.r.Stats.ChatEmpty, h.r.Stats.ChatSent)
	}
	if lvl := h.entity(1).invalidTokens.level; lvl != int64(h.r.cfg.InvalidLimit.Burst)*h.r.ticksPerMinute {
		t.Error("an empty line counted as invalid")
	}
}

func TestChatFilterMasks(t *testing.T) {
	h := newHarness(t)
	cs := h.joinAll("Ugg", "Grok")
	cases := []struct{ in, want string }{
		{"oh SH1T a raptor", "oh **** a raptor"},
		{"$hit!", "****!"},
		{"shitake and a scunthorpe bass", "shitake and a scunthorpe bass"},
	}
	for _, c := range cases {
		h.say(1, c.in)
		h.steps(20)
		// The speaker sees the masked line too.
		for _, cl := range cs {
			if got := h.heardOnce(cl, 1); got != c.want {
				t.Errorf("%q arrived as %q, want %q", c.in, got, c.want)
			}
		}
	}
	if h.r.Stats.ChatFiltered != 2 {
		t.Errorf("ChatFiltered = %d, want 2", h.r.Stats.ChatFiltered)
	}
}

func TestMutedPlayerOnlyGetsANotice(t *testing.T) {
	h := newHarness(t)
	cs := h.joinAll("Ugg", "Grok")
	h.entity(1).muted = true
	h.say(1, "let me speak")
	h.r.Step()
	msgs := cs[0].take()
	if len(msgs) != 1 {
		t.Fatalf("the muted player got %v, want just the notice", msgs)
	}
	if n, ok := msgs[0].(*proto.SystemMessage); !ok || n.Key != proto.SystemKeyChatMuted {
		t.Fatalf("got %v, want system_message(chat_muted)", msgs[0])
	}
	if msgs := cs[1].take(); len(msgs) != 0 {
		t.Fatalf("another player got %v", msgs)
	}
	if h.r.Stats.ChatMuted != 1 || h.r.Stats.ChatSent != 0 {
		t.Fatalf("ChatMuted %d, ChatSent %d", h.r.Stats.ChatMuted, h.r.Stats.ChatSent)
	}
	// The notices are rate limited like chat.
	for range 5 {
		h.say(1, "spam")
	}
	h.r.Step()
	if got := all[*proto.SystemMessage](cs[0].take()); len(got) != 2 {
		t.Fatalf("got %d notices for 5 lines with 2 tokens left, want 2", len(got))
	}
	// Grok can still talk.
	h.say(2, "you're muted")
	h.r.Step()
	if got := h.heardOnce(cs[0], 2); got != "you're muted" {
		t.Fatalf("got %q", got)
	}
}

func TestChatAllocatesLittle(t *testing.T) {
	h := newHarness(t)
	h.joinAll("Ugg", "Grok")
	h.r.cfg.ChatLimit = Limit{PerMinute: 1 << 20, Burst: 1 << 20}
	e := h.entity(1)
	e.chatTokens.fill(h.r.cfg.ChatLimit, h.r.tick, h.r.ticksPerMinute)
	msg := &proto.ChatSay{Text: "  well sh1t, a raptor  "}
	h.r.chat(e, msg) // warm the buffers
	allocs := testing.AllocsPerRun(50, func() {
		h.r.chat(e, msg)
		e.out = e.out[:0]
		h.entity(2).out = h.entity(2).out[:0]
	})
	// The line's text as a string, and proto.Append's encoder (as for every message the region sends).
	if allocs > 2 {
		t.Errorf("chat allocates %v times a line", allocs)
	}
}

func TestChatRadiusMustFitTheView(t *testing.T) {
	c, rf := testData(t)
	cfg := ConfigFor(c)
	cfg.ChatRadius = 42 // 42 + 16·√2 > 64
	if _, err := New(rf, cfg); err == nil || !strings.Contains(err.Error(), "chat radius") {
		t.Fatalf("want a chat radius error, got %v", err)
	}
	cfg.ChatRadius = 41
	if _, err := New(rf, cfg); err != nil {
		t.Fatal(err)
	}
}
