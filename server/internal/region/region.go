// Package region is the simulation of one region of a world (docs/architecture/world-server.md).
//
// A Region owns its entities, navmesh pathfinder and spatial grid. Nothing else touches them: sessions
// talk to it only through its inbox, and it talks back only through each player's Client. Step runs
// one tick. Tests call Step directly, so a whole walk runs in microseconds with no real time involved
// (CLAUDE.md rule 5); Run is the real-time loop used by cmd/world.
package region

import (
	"errors"
	"fmt"
	"math"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/chat"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// Client is how a region sends to one connected player. The region calls both methods from its tick
// goroutine, so neither may block.
type Client interface {
	// Deliver hands over one encoded frame (all of a tick's events for this player), which the client
	// now owns. It returns false if the client's outbound queue is full: the region then drops the
	// player and calls Disconnect(DisconnectTooSlow).
	Deliver(frame []byte) bool
	// Disconnect tells the connection to close. The player has already been removed from the region.
	Disconnect(reason DisconnectReason)
}

// DisconnectReason says why the region dropped a player.
type DisconnectReason uint8

const (
	// DisconnectMisbehaving: more than the allowed number of invalid intents in a minute.
	DisconnectMisbehaving DisconnectReason = iota + 1
	// DisconnectTooSlow: the client's outbound queue overflowed.
	DisconnectTooSlow
	// DisconnectIdle: no input for Config.IdleTicks (the idle logout).
	DisconnectIdle
)

func (d DisconnectReason) String() string {
	switch d {
	case DisconnectMisbehaving:
		return "misbehaving"
	case DisconnectTooSlow:
		return "too slow"
	case DisconnectIdle:
		return "idle"
	}
	return fmt.Sprintf("DisconnectReason(%d)", uint8(d))
}

// SessionID identifies one connection. The world assigns them; the region maps them to entities.
type SessionID uint64

// InputKind says what an inbox Input is.
type InputKind uint8

const (
	// InputJoin adds a player: Session, Client, Name and Role are set.
	InputJoin InputKind = iota + 1
	// InputLeave removes the session's player (it disconnected). Unknown sessions are ignored.
	InputLeave
	// InputIntent is a decoded client message (move_to, chat_say) from the session's player.
	InputIntent
	// InputNotice sends Msg, a *proto.SystemMessage, to every player in the region (the shutdown
	// warning). Session is unused.
	InputNotice
)

// Input is one item in a region's inbox.
type Input struct {
	Kind    InputKind
	Session SessionID
	Client  Client        // InputJoin
	Name    string        // InputJoin: the display name, already validated
	Role    proto.Role    // InputJoin: the account's role, shown as a chat badge
	Look    *proto.Look   // InputJoin: the character's appearance, or nil (dev players: the default)
	Msg     proto.Message // InputIntent, InputNotice

	// InputJoin, for a saved character (empty for dev players, who are never saved): its id and the
	// online lease the world holds for it.
	Character, Lease string
	// InputJoin: where the player starts, as saved, or nil for a spawn point. A position that isn't
	// on this region's navmesh (within the snap radius) is ignored.
	Start *proto.Pos
	// InputJoin: the saved HP (persist.HPFull for full).
	HP int32
}

// Saver takes character saves off the tick (persist.Saver). Enqueue must never block or wait for the
// database.
type Saver interface {
	Enqueue(persist.Save)
}

// Config is a region's settings. Game numbers (tick rate, walk speed) come from data/; the rest are
// engine settings with defaults from DefaultConfig.
type Config struct {
	// TickHz is ticks per second (data/progression.json server.tick_hz).
	TickHz int
	// WalkSpeed is the player walk speed in metres per second (data/progression.json
	// movement.walk_speed_m_s). It's sent in cm/s, rounded.
	WalkSpeed float64
	// CellSize is the interest grid's cell size in metres.
	CellSize float64
	// ViewRadius (metres): a player sees every cell whose centre is within this distance of the centre
	// of their own cell.
	ViewRadius float64
	// MaxClickDistance (metres): a move_to further than this from the player is invalid.
	MaxClickDistance float64
	// InboxSize is the inbox channel's buffer.
	InboxSize int
	// Paths limits path finding.
	Paths navmesh.Limits
	// ChatRadius (metres, data/progression.json chat.radius_m): a chat line reaches every player within
	// this 3D distance of the speaker. It must fit inside the view (see New).
	ChatRadius float64
	// ChatMaxChars (data/progression.json chat.max_chars) is the longest chat line in code points,
	// after cleaning. Longer lines are invalid.
	ChatMaxChars int
	// ChatFilter masks words in chat (data/chat_filter.json). Nil masks nothing.
	ChatFilter *chat.Filter
	// Rate limits per player, per message type (docs/architecture/networking.md), and the invalid
	// intent limit that disconnects a player (docs/architecture/security.md).
	MoveLimit, ChatLimit, InvalidLimit Limit

	// Saver gets each saved character's saves: every SaveEvery ticks if it changed, and when it leaves
	// the region for any reason (releasing its lease). Nil saves nothing.
	Saver Saver
	// SaveEvery is how often (in ticks) a player whose position or HP changed is saved. 0: only when
	// they leave.
	SaveEvery uint32
	// IdleTicks: a player who sends no intent for this many ticks is logged out (the idle logout,
	// data/progression.json session.idle_logout_s). 0 turns it off. IdleWarnTicks before that, they get
	// system_message(idle_warning).
	IdleTicks, IdleWarnTicks uint32
}

// Limit is a token bucket: PerMinute tokens a minute, holding at most Burst.
type Limit struct{ PerMinute, Burst int }

// DefaultConfig gives the spec's engine settings for the given tick rate and walk speed.
func DefaultConfig(tickHz int, walkSpeed float64) Config {
	return Config{
		TickHz:           tickHz,
		WalkSpeed:        walkSpeed,
		CellSize:         16,
		ViewRadius:       64,
		MaxClickDistance: 150,
		InboxSize:        4096,
		Paths:            navmesh.DefaultLimits,
		MoveLimit:        Limit{PerMinute: 600, Burst: 10}, // 10/s
		ChatLimit:        Limit{PerMinute: 60, Burst: 3},   // 1/s, burst 3
		InvalidLimit:     Limit{PerMinute: 50, Burst: 50},  // more than 50 a minute disconnects
		SaveEvery:        uint32(60 * tickHz),              // world-server.md: every 60 s if changed
	}
}

// ConfigFor is DefaultConfig with the game numbers from data/.
func ConfigFor(c *content.Content) Config {
	cfg := DefaultConfig(c.Progression.Server.TickHz, c.Progression.Movement.WalkSpeed)
	cfg.ChatRadius = c.Progression.Chat.RadiusM
	cfg.ChatMaxChars = c.Progression.Chat.MaxChars
	cfg.ChatFilter = c.ChatFilter
	hz := c.Progression.Server.TickHz
	cfg.IdleTicks = uint32(c.Progression.Session.IdleLogoutS * hz)
	cfg.IdleWarnTicks = uint32(c.Progression.Session.IdleWarningS * hz)
	return cfg
}

// Stats counts what a region has dropped. Read it only from the tick goroutine (or after Run returns).
type Stats struct {
	// Invalid intents, by reason. Each one is dropped without a reply.
	MoveRateLimited, MoveTooFar, UnknownIntent uint64
	ChatRateLimited, ChatTooLong               uint64
	// Chat lines that were dropped without counting as invalid: empty once cleaned, or from a muted
	// player.
	ChatEmpty, ChatMuted uint64
	// Chat lines sent, and how many of them had a word masked. Never the text itself.
	ChatSent, ChatFiltered uint64
	// Players dropped by the region.
	Misbehaving, TooSlow, Idle uint64
	// Saves handed to the Saver.
	Saves uint64
}

// Region is one region's simulation. Everything except Inbox, ID and Clock belongs to the goroutine
// that calls Step (or Run).
type Region struct {
	id    string
	cfg   Config
	mesh  *navmesh.Mesh
	pf    *navmesh.Pathfinder
	inbox chan Input
	clock Clock

	tick           uint32
	speed          uint32 // walk speed, cm/s
	ticksPerMinute int64
	spawns         []navmesh.Vec3
	nextSpawn      int

	ents     []entity // by index
	free     []uint32 // free indices, reused last-in first-out
	sessions map[SessionID]EntityID
	grid     grid

	pending  []EntityID // players with a move_to to start this tick, in arrival order
	overflow []EntityID // players whose Deliver failed in this tick's flush
	idle     []EntityID // players to log out for being idle this tick
	pathBuf  []navmesh.Vec3
	scratch  []byte // one encoded message, appended to every player who should get it

	// Reused message structs, so encoding doesn't allocate.
	mWelcome proto.Welcome
	mStarted proto.PathStarted
	mStopped proto.PathStopped
	mEnter   proto.EntityEnter
	mLeave   proto.EntityLeave
	mChat    proto.Chat
	mSystem  proto.SystemMessage

	chatRunes []rune // the chat line being cleaned
	chatBytes []byte // the filter's scratch buffer

	Stats Stats
}

// New makes a region from a loaded region file. Players join at its player spawns, in turn.
func New(rf *navmesh.Region, cfg Config) (*Region, error) {
	switch {
	case cfg.TickHz < 1 || cfg.TickHz > 255:
		return nil, fmt.Errorf("region %s: tick rate %d out of range", rf.ID, cfg.TickHz)
	case !(cfg.WalkSpeed > 0) || cfg.WalkSpeed > 100:
		return nil, fmt.Errorf("region %s: walk speed %v out of range", rf.ID, cfg.WalkSpeed)
	case !(cfg.CellSize > 0) || !(cfg.ViewRadius >= 0):
		return nil, fmt.Errorf("region %s: bad interest grid settings", rf.ID)
	case cfg.ChatMaxChars < 1:
		return nil, fmt.Errorf("region %s: chat max chars %d out of range", rf.ID, cfg.ChatMaxChars)
	// A chat line goes to the speaker's watchers who are in range, so the view must reach every point
	// within the chat radius: a listener can be up to a cell's diagonal further from the speaker's cell
	// centre than from the speaker.
	case !(cfg.ChatRadius > 0) || cfg.ChatRadius+cfg.CellSize*math.Sqrt2 > cfg.ViewRadius:
		return nil, fmt.Errorf("region %s: chat radius %v m must be above 0 and at most the view radius less a cell diagonal (%.1f m)",
			rf.ID, cfg.ChatRadius, cfg.ViewRadius-cfg.CellSize*math.Sqrt2)
	case len(rf.PlayerSpawns) == 0:
		return nil, fmt.Errorf("region %s: no player spawns", rf.ID)
	case cfg.IdleTicks > 0 && (cfg.IdleWarnTicks == 0 || cfg.IdleWarnTicks >= cfg.IdleTicks || cfg.IdleWarnTicks/uint32(cfg.TickHz) > math.MaxUint16):
		return nil, fmt.Errorf("region %s: the idle warning must come after the player goes idle and before the logout", rf.ID)
	}
	r := &Region{
		id:             rf.ID,
		cfg:            cfg,
		mesh:           rf.Mesh,
		pf:             navmesh.NewPathfinder(rf.Mesh, cfg.Paths),
		inbox:          make(chan Input, cfg.InboxSize),
		speed:          uint32(math.Round(cfg.WalkSpeed * 100)),
		ticksPerMinute: int64(cfg.TickHz) * 60,
		sessions:       map[SessionID]EntityID{},
	}
	for _, s := range rf.PlayerSpawns {
		loc, ok := rf.Mesh.ClosestPoint(s, cfg.Paths.SnapRadius)
		if !ok {
			return nil, fmt.Errorf("region %s: spawn %v is off the navmesh", rf.ID, s)
		}
		r.spawns = append(r.spawns, dequantise(quantise(loc.Pos)))
	}
	r.grid = newGrid(rf.Mesh, cfg.CellSize, cfg.ViewRadius)
	r.clock.interval.Store(int64(1e9 / cfg.TickHz))
	return r, nil
}

// ID is the region id.
func (r *Region) ID() string { return r.id }

// Inbox is where sessions send joins, leaves and intents. Safe to use from any goroutine.
func (r *Region) Inbox() chan<- Input { return r.inbox }

// Clock is the region's tick clock as Run last set it. Safe to read from any goroutine.
func (r *Region) Clock() *Clock { return &r.clock }

// Tick is the last tick Step ran.
func (r *Region) Tick() uint32 { return r.tick }

// Players is how many players are in the region.
func (r *Region) Players() int { return len(r.sessions) }

// Step runs one tick: drain the inbox, start paths, advance movement, update interest, and send each
// player at most one frame holding all of this tick's events for them.
func (r *Region) Step() {
	r.tick++
	r.drainInbox()
	r.startPaths()
	r.advance()
	r.timers()
	r.updateInterest()
	r.flush()
}

func (r *Region) drainInbox() {
	for {
		select {
		case in := <-r.inbox:
			r.handle(in)
		default:
			return
		}
	}
}

func (r *Region) handle(in Input) {
	switch in.Kind {
	case InputJoin:
		r.join(in)
	case InputLeave:
		if id, ok := r.sessions[in.Session]; ok {
			r.remove(id)
		}
	case InputIntent:
		id, ok := r.sessions[in.Session]
		if !ok {
			return // the player already left (or was dropped); late intents are ignored
		}
		r.intent(r.get(id), in.Msg)
	case InputNotice:
		m, ok := in.Msg.(*proto.SystemMessage)
		if !ok {
			return
		}
		r.scratch = mustAppend(r.scratch[:0], m)
		for i := range r.ents {
			if e := &r.ents[i]; e.id != 0 && e.kind == proto.EntityKindPlayer {
				e.out = append(e.out, r.scratch...)
			}
		}
	}
}

func (r *Region) join(in Input) {
	if _, dup := r.sessions[in.Session]; dup || in.Client == nil {
		return
	}
	e := r.alloc()
	e.kind = proto.EntityKindPlayer
	e.name = in.Name
	e.role = in.Role
	e.look = in.Look
	e.session = in.Session
	e.client = in.Client
	e.character, e.lease = in.Character, in.Lease
	e.hp = in.HP
	if in.Character == "" {
		e.hp = persist.HPFull
	}
	// savedPos and savedHP are what the database has, so a save is only needed once something
	// changes. A player put at a spawn point is saved at the first chance.
	e.savedHP = e.hp
	if loc, ok := r.startOf(in.Start); ok {
		e.pos = loc
		e.savedPos = quantise(loc)
	} else {
		e.pos = r.spawns[r.nextSpawn%len(r.spawns)]
		r.nextSpawn++
		e.savedPos = proto.Pos{Y: math.MinInt32}
	}
	e.lastInput = r.tick
	e.nextSave = r.tick + r.cfg.SaveEvery
	e.moveTokens.fill(r.cfg.MoveLimit, r.tick, r.ticksPerMinute)
	e.chatTokens.fill(r.cfg.ChatLimit, r.tick, r.ticksPerMinute)
	e.invalidTokens.fill(r.cfg.InvalidLimit, r.tick, r.ticksPerMinute)
	r.sessions[in.Session] = e.id

	// welcome first, then everything in view (which includes the player itself).
	r.mWelcome = proto.Welcome{Entity: uint32(e.id), Region: r.id, ServerTick: r.tick, TickHz: uint8(r.cfg.TickHz)}
	e.out = mustAppend(e.out, &r.mWelcome)
	r.grid.insert(r, e)
}

// startOf is where a saved position puts a joining player: the nearest point on the navmesh within
// the snap radius, on the centimetre grid. False for no saved position, or one off this region's mesh.
func (r *Region) startOf(p *proto.Pos) (navmesh.Vec3, bool) {
	if p == nil {
		return navmesh.Vec3{}, false
	}
	loc, ok := r.mesh.ClosestPoint(dequantise(*p), r.cfg.Paths.SnapRadius)
	if !ok {
		return navmesh.Vec3{}, false
	}
	return dequantise(quantise(loc.Pos)), true
}

// remove takes an entity out of the region: everyone who could see it gets entity_leave. A player
// is saved where they stand, and their lease released.
func (r *Region) remove(id EntityID) {
	e := r.get(id)
	if e == nil {
		return
	}
	r.grid.remove(r, e)
	if e.kind == proto.EntityKindPlayer {
		r.save(e, true)
		delete(r.sessions, e.session)
	}
	r.release(e)
}

// save hands a player's state to the Saver: always when release is set (they're leaving), otherwise
// only if it changed since the last save. Dev players (no character) are never saved.
func (r *Region) save(e *entity, release bool) {
	if e.character == "" || r.cfg.Saver == nil {
		return
	}
	pos := quantise(e.pos)
	if !release && pos == e.savedPos && e.hp == e.savedHP {
		return
	}
	e.savedPos, e.savedHP = pos, e.hp
	r.Stats.Saves++
	r.cfg.Saver.Enqueue(persist.Save{CharacterID: e.character, Lease: e.lease, Region: r.id, Pos: pos, HP: e.hp, Release: release})
}

// timers runs the per-player timers: the idle warning and logout, and periodic saves.
func (r *Region) timers() {
	for i := range r.ents {
		e := &r.ents[i]
		if e.id == 0 || e.kind != proto.EntityKindPlayer {
			continue
		}
		if r.cfg.IdleTicks > 0 {
			idle := r.tick - e.lastInput
			if idle >= r.cfg.IdleTicks {
				r.idle = append(r.idle, e.id)
				continue
			}
			if !e.idleWarned && idle >= r.cfg.IdleTicks-r.cfg.IdleWarnTicks {
				e.idleWarned = true
				r.mSystem = proto.SystemMessage{Key: proto.SystemKeyIdleWarning,
					Seconds: uint16((r.cfg.IdleTicks - idle + uint32(r.cfg.TickHz) - 1) / uint32(r.cfg.TickHz))}
				e.out = mustAppend(e.out, &r.mSystem)
			}
		}
		if r.cfg.SaveEvery > 0 && r.tick >= e.nextSave {
			e.nextSave = r.tick + r.cfg.SaveEvery
			r.save(e, false)
		}
	}
	for _, id := range r.idle {
		if e := r.get(id); e != nil {
			r.drop(e, DisconnectIdle)
		}
	}
	r.idle = r.idle[:0]
}

// Stop ends the region's simulation: it handles whatever is left in the inbox (players who just
// left), then removes every player still in it, so each is saved and their lease released. Run calls
// it when its context ends; the world stops the regions only after every connection has closed.
func (r *Region) Stop() {
	r.drainInbox()
	for i := range r.ents {
		if e := &r.ents[i]; e.id != 0 && e.kind == proto.EntityKindPlayer {
			r.remove(e.id)
		}
	}
}

// drop removes a player and tells its connection to close.
func (r *Region) drop(e *entity, why DisconnectReason) {
	c := e.client
	switch why {
	case DisconnectMisbehaving:
		r.Stats.Misbehaving++
	case DisconnectTooSlow:
		r.Stats.TooSlow++
	case DisconnectIdle:
		r.Stats.Idle++
	}
	r.remove(e.id)
	c.Disconnect(why)
}

func (r *Region) intent(e *entity, msg proto.Message) {
	// Any intent is input: it resets the idle logout (a click, chat, and later attacks, abilities and
	// items). The client's pings and the browser's keepalive pongs aren't intents, so they don't.
	e.lastInput, e.idleWarned = r.tick, false
	switch m := msg.(type) {
	case *proto.MoveTo:
		if !e.moveTokens.take(r.cfg.MoveLimit, r.tick, r.ticksPerMinute) {
			r.Stats.MoveRateLimited++
			r.invalid(e)
			return
		}
		target := dequantise(m.Position)
		if target.Dist(e.pos) > r.cfg.MaxClickDistance {
			r.Stats.MoveTooFar++
			r.invalid(e)
			return
		}
		// Clicks are coalesced: only the last one in a tick is walked.
		if !e.pendingMove {
			e.pendingMove = true
			r.pending = append(r.pending, e.id)
		}
		e.moveTarget = target
	case *proto.ChatSay:
		r.chat(e, m)
	default:
		r.Stats.UnknownIntent++
		r.invalid(e)
	}
}

// chat handles chat_say (docs/architecture/world-server.md, "Local chat"): rate limit, clean, length,
// mute, filter, then a chat message to every player within ChatRadius, the speaker included, in this
// tick's frame. Chat text is never logged.
func (r *Region) chat(e *entity, m *proto.ChatSay) {
	if !e.chatTokens.take(r.cfg.ChatLimit, r.tick, r.ticksPerMinute) {
		r.Stats.ChatRateLimited++
		r.invalid(e)
		return
	}
	text := chat.Clean(r.chatRunes[:0], m.Text)
	r.chatRunes = text
	switch {
	case len(text) == 0:
		r.Stats.ChatEmpty++
		return
	case len(text) > r.cfg.ChatMaxChars:
		// A real client stops at the limit, so this one isn't playing fair.
		r.Stats.ChatTooLong++
		r.invalid(e)
		return
	case e.muted:
		r.Stats.ChatMuted++
		r.mSystem = proto.SystemMessage{Key: proto.SystemKeyChatMuted}
		e.out = mustAppend(e.out, &r.mSystem)
		return
	}
	if r.cfg.ChatFilter != nil {
		var n int
		n, r.chatBytes = r.cfg.ChatFilter.Mask(text, r.chatBytes)
		if n > 0 {
			r.Stats.ChatFiltered++
		}
	}
	r.Stats.ChatSent++
	r.mChat = proto.Chat{Entity: uint32(e.id), Name: e.name, Role: e.role, Text: string(text)}
	r.scratch = mustAppend(r.scratch[:0], &r.mChat)
	r.mChat.Text = ""
	r2 := r.cfg.ChatRadius * r.cfg.ChatRadius
	r.grid.forWatchers(r, e, func(w *entity) {
		if w.pos.DistSq(e.pos) <= r2 {
			w.out = append(w.out, r.scratch...)
		}
	})
}

// invalid counts an invalid intent against the player, and drops them past the limit.
func (r *Region) invalid(e *entity) {
	if !e.invalidTokens.take(r.cfg.InvalidLimit, r.tick, r.ticksPerMinute) {
		r.drop(e, DisconnectMisbehaving)
	}
}

// flush hands each player this tick's frame, if anything happened for them. Players whose queue is
// full are dropped afterwards; the entity_leave that causes goes out with the next tick.
func (r *Region) flush() {
	for i := range r.ents {
		e := &r.ents[i]
		if e.id == 0 || e.kind != proto.EntityKindPlayer || len(e.out) == 0 {
			continue
		}
		frame := append([]byte(nil), e.out...)
		e.out = e.out[:0]
		if !e.client.Deliver(frame) {
			r.overflow = append(r.overflow, e.id)
		}
	}
	for _, id := range r.overflow {
		if e := r.get(id); e != nil {
			r.drop(e, DisconnectTooSlow)
		}
	}
	r.overflow = r.overflow[:0]
}

// broadcast sends msg to every player who can see e (including e itself, if it's a player).
func (r *Region) broadcast(e *entity, msg proto.Message) {
	r.scratch = mustAppend(r.scratch[:0], msg)
	r.grid.forWatchers(r, e, func(w *entity) { w.out = append(w.out, r.scratch...) })
}

// sendEnter tells player to about entity e, with its full current state.
func (r *Region) sendEnter(to, e *entity) {
	r.mEnter = proto.EntityEnter{
		Entity:   uint32(e.id),
		Kind:     e.kind,
		Name:     e.name,
		Position: quantise(e.pos),
		HP:       255,
		Look:     e.look,
	}
	if e.moving {
		r.mEnter.Path = &e.path
	}
	to.out = mustAppend(to.out, &r.mEnter)
	r.mEnter.Path = nil
	r.mEnter.Look = nil
}

func (r *Region) sendLeave(to, e *entity) {
	r.mLeave = proto.EntityLeave{Entity: uint32(e.id)}
	to.out = mustAppend(to.out, &r.mLeave)
}

// mustAppend encodes a message the region built itself. Every field is in range by construction, so
// an error is a bug.
func mustAppend(b []byte, m proto.Message) []byte {
	b, err := proto.Append(b, m)
	if err != nil {
		panic(errors.Join(errors.New("region: encoding a server message"), err))
	}
	return b
}
