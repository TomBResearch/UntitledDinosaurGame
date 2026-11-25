// Package joine2e tests joining a world end to end, in one process: the backend API (memory store,
// stand-in platform) issues join tickets, and two real world servers check them over WebSockets.
// World 1 is free and World 2 is premium only (-premium-only), as on the live server
// (docs/design/worlds-and-premium.md).
//
// Live, the API and the worlds share one Postgres. Here the API has its memory store and the worlds
// share a persist.MemStore, and each character the API makes is added to both. Leases the worlds
// take aren't seen by the API's store here; the slow lane checks that on Postgres.
//
// The regions tick every millisecond instead of every 50 ms, and every wait is bounded by a context
// deadline, never a sleep (CLAUDE.md rule 5).
package joine2e

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/navmesh"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform/platformtest"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/region"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/world"
)

var (
	loadData  = sync.OnceValues(func() (*content.Content, error) { return content.Load("../../../data") })
	ticketKey = bytes.Repeat([]byte{7}, 32)
)

type stack struct {
	t      *testing.T
	data   *content.Content
	plat   *platformtest.Platform
	api    *httptest.Server
	worlds map[int]*httptest.Server
	// chars is the worlds' side of the shared database: saved positions and online leases.
	chars *persist.MemStore
}

// statusByID asks each test world's real GET /status.
type statusByID map[int]*api.HTTPWorldStatus

func (s statusByID) Status(ctx context.Context, id int) (int, bool) {
	if h, ok := s[id]; ok {
		return h.Status(ctx, id)
	}
	return 0, false
}

func start(t *testing.T) *stack {
	t.Helper()
	data, err := loadData()
	if err != nil {
		t.Fatal(err)
	}
	s := &stack{t: t, data: data, plat: platformtest.New(), worlds: map[int]*httptest.Server{}, chars: persist.NewMemStore()}
	status := statusByID{}
	for id, premiumOnly := range map[int]bool{1: false, 2: true} {
		hs := s.startWorld(strconv.Itoa(id), premiumOnly)
		s.worlds[id] = hs
		h := api.NewHTTPWorldStatus(hs.URL + "/status")
		h.TTL = 0 // always ask
		status[id] = h
	}
	srv := api.New(api.Config{
		Store: api.NewMemStore(
			api.World{ID: 1, Name: "World 1", MaxPlayers: 1000, WSPath: "/w/1"},
			api.World{ID: 2, Name: "World 2", PremiumOnly: true, MaxPlayers: 1000, WSPath: "/w/2"},
		),
		Tokens:    &platform.Verifier{Keys: s.plat, Issuer: platformtest.Issuer, Audience: platformtest.Audience, Now: time.Now},
		Accounts:  s.plat,
		Worlds:    status,
		TicketKey: ticketKey,
		PublicWS:  "ws://worlds.test",
		Data:      data,
		Version:   "test",
	})
	s.api = httptest.NewServer(srv.Handler())
	t.Cleanup(s.api.Close)
	return s
}

// startWorld runs a world server as cmd/world does, with join tickets on and dev tickets off, and a
// saver over the shared character store.
func (s *stack) startWorld(id string, premiumOnly bool) *httptest.Server {
	t := s.t
	worldNum, _ := strconv.Atoi(id)
	saver := persist.NewSaver(persist.SaverConfig{Store: s.chars, World: worldNum})
	saving, stopSaving := context.WithCancel(context.Background())
	saverDone := make(chan struct{})
	go func() { saver.Run(saving); close(saverDone) }()
	t.Cleanup(func() { stopSaving(); <-saverDone }) // after the world's own cleanup (LIFO)
	var rf *navmesh.Region
	for _, r := range s.data.Regions {
		if r.ID == "test_greybox" {
			rf = r
		}
	}
	rcfg := region.ConfigFor(s.data)
	rcfg.Saver = saver
	reg, err := region.New(rf, rcfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, stop := context.WithCancel(context.Background())
	ticking := make(chan struct{})
	go func() { reg.Run(ctx, time.Millisecond); close(ticking) }()
	cfg := world.DefaultConfig(id, s.data.Hash)
	cfg.TicketKey = ticketKey
	cfg.PremiumOnly = premiumOnly
	cfg.Saver = saver
	srv := world.New(cfg, []*region.Region{reg}, reg, ctx.Done(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	saver.SetOnLost(srv.LostLease)
	hs := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		shut, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shut)
		hs.Close()
		stop()
		<-ticking
	})
	return hs
}

var accountSeq int

// account makes a platform account and returns its id.
func (s *stack) account(role platform.Role, premium bool) string {
	accountSeq++
	id := "0b7c1e2a-4444-4000-8000-" + strings.Repeat("0", 12-len(strconv.Itoa(accountSeq))) + strconv.Itoa(accountSeq)
	s.plat.Set(platform.Account{ID: id, Username: "player", Role: role, Premium: premium})
	return id
}

// call sends a request to the API as the account and decodes the answer into out (if not nil).
func (s *stack) call(method, path, account string, body, out any) (int, string) {
	s.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, s.api.URL+path, rd)
	if account != "" {
		req.Header.Set("Authorization", "Bearer "+s.plat.Token(account, time.Now()))
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &e)
	if out != nil && res.StatusCode < 300 {
		if err := json.Unmarshal(raw, out); err != nil {
			s.t.Fatalf("%s %s: %v (%s)", method, path, err, raw)
		}
	}
	return res.StatusCode, e.Error
}

type character struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *stack) createCharacter(account, name string) character {
	s.t.Helper()
	var c character
	if code, e := s.call("POST", "/api/characters", account,
		map[string]any{"name": name, "slot": 1, "appearance": s.data.Appearance.Default}, &c); code != 201 {
		s.t.Fatalf("create %s: %d %s", name, code, e)
	}
	s.chars.AddCharacter(account, c.ID) // the shared database
	return c
}

type joinAnswer struct {
	Ticket string `json:"ticket"`
	WSURL  string `json:"wsUrl"`
}

// enter connects to a world with a ticket, as the client does, and returns what the world said
// first: the player's own entity_enter, or the kick.
func (s *stack) enter(worldID int, tk string) (*proto.EntityEnter, *proto.Kick) {
	t := s.t
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(s.worlds[worldID].URL, "http") + "/w/" + strconv.Itoa(worldID)
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	hello, _ := proto.Append(nil, &proto.Hello{ProtocolHash: proto.ProtocolHash, Ticket: tk, ContentHash: s.data.Hash, ClientVersion: "test"})
	if err := c.Write(ctx, websocket.MessageBinary, hello); err != nil {
		t.Fatal(err)
	}
	for {
		typ, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("world %d: closed without a kick or entity_enter: %v", worldID, err)
		}
		if typ != websocket.MessageBinary {
			t.Fatal("text frame")
		}
		msgs, err := proto.Decode(b, proto.FromServer)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range msgs {
			switch m := m.(type) {
			case *proto.Kick:
				return nil, m
			case *proto.EntityEnter:
				return m, nil
			}
		}
	}
}

// mustEnter joins and checks the world shows the character's name, and the look it was made with
// (createCharacter uses the default look).
func (s *stack) mustEnter(worldID int, tk, name string) {
	s.t.Helper()
	s.mustEnterAt(worldID, tk, name)
}

// mustEnterAt is mustEnter, returning the player's own entity_enter.
func (s *stack) mustEnterAt(worldID int, tk, name string) *proto.EntityEnter {
	s.t.Helper()
	self, kick := s.enter(worldID, tk)
	if kick != nil {
		s.t.Fatalf("world %d kicked %s: %v", worldID, name, kick.Reason)
	}
	if self.Name != name {
		s.t.Fatalf("world %d: joined as %q, want %q", worldID, self.Name, name)
	}
	d := s.data.Appearance.Default
	want := proto.Look{BodyType: d.BodyType, SkinTone: d.SkinTone, HairStyle: d.HairStyle, HairColour: d.HairColour, Beard: d.Beard}
	if self.Look == nil || *self.Look != want {
		s.t.Fatalf("world %d: %s's look is %+v, want %+v", worldID, name, self.Look, want)
	}
	return self
}

func (s *stack) mustBeRefused(worldID int, tk string) {
	s.t.Helper()
	if _, kick := s.enter(worldID, tk); kick == nil || kick.Reason != proto.KickReasonBadTicket {
		s.t.Fatalf("world %d let the ticket in (kick %v)", worldID, kick)
	}
}

func (s *stack) join(account, characterID string, worldID int) (int, string, joinAnswer) {
	s.t.Helper()
	var j joinAnswer
	code, e := s.call("POST", "/api/join", account, map[string]any{"characterId": characterID, "worldId": worldID}, &j)
	if code == 200 && j.WSURL != "ws://worlds.test/w/"+strconv.Itoa(worldID) {
		s.t.Fatalf("wsUrl %q", j.WSURL)
	}
	return code, e, j
}

func TestWorldListShowsBothWorlds(t *testing.T) {
	s := start(t)
	var worlds []struct {
		ID          int     `json:"id"`
		Name        string  `json:"name"`
		PremiumOnly bool    `json:"premiumOnly"`
		Population  *string `json:"population"`
		Online      bool    `json:"online"`
	}
	if code, e := s.call("GET", "/api/worlds", "", nil, &worlds); code != 200 {
		t.Fatalf("%d %s", code, e)
	}
	if len(worlds) != 2 || worlds[0].PremiumOnly || !worlds[1].PremiumOnly {
		t.Fatalf("worlds %+v", worlds)
	}
	for _, w := range worlds {
		if !w.Online || w.Population == nil || *w.Population != "low" {
			t.Errorf("%s: online %v, population %v", w.Name, w.Online, w.Population)
		}
	}
}

// A player without Premium joins World 1, but not World 2: the API refuses to issue the ticket, and
// World 2 refuses a non-premium ticket even if one were issued.
func TestPremiumRefused(t *testing.T) {
	s := start(t)
	acct := s.account(platform.RoleNormal, false)
	c := s.createCharacter(acct, "Grug")

	code, _, j := s.join(acct, c.ID, 1)
	if code != 200 {
		t.Fatalf("join world 1: %d", code)
	}
	s.mustEnter(1, j.Ticket, "Grug")

	if code, e, _ := s.join(acct, c.ID, 2); code != 403 || e != "premium_required" {
		t.Fatalf("join world 2: %d %s, want 403 premium_required", code, e)
	}

	// The world's own check: a correctly signed ticket without Premium, for World 2.
	forged, err := ticket.Sign(ticketKey, ticket.Payload{AccountID: acct, CharacterID: c.ID, WorldID: "2", Name: "Grug",
		Role: "normal", Nonce: ticket.NewNonce(), Exp: time.Now().Add(ticket.TTL).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	s.mustBeRefused(2, forged)

	// A World 1 ticket doesn't open World 2 either.
	_, _, j = s.join(acct, c.ID, 1)
	s.mustBeRefused(2, j.Ticket)
}

// Premium players and staff (who count as Premium) join World 2. Premium comes fresh from the
// platform at join time, so buying it works without logging in again.
func TestPremiumAllowed(t *testing.T) {
	s := start(t)
	for i, who := range []struct {
		role    platform.Role
		premium bool
	}{{platform.RolePremium, true}, {platform.RoleNormal, true}, {platform.RoleModerator, false}, {platform.RoleAdmin, false}} {
		acct := s.account(who.role, who.premium)
		name := "Ugg" + strconv.Itoa(i)
		c := s.createCharacter(acct, name)
		code, e, j := s.join(acct, c.ID, 2)
		if code != 200 {
			t.Fatalf("%s premium=%v: join world 2: %d %s", who.role, who.premium, code, e)
		}
		s.mustEnter(2, j.Ticket, name)
		// A ticket works once.
		s.mustBeRefused(2, j.Ticket)
	}

	// Premium bought after logging in: the token still says normal, but the fresh state says Premium.
	acct := s.account(platform.RoleNormal, false)
	c := s.createCharacter(acct, "Late")
	if code, _, _ := s.join(acct, c.ID, 2); code != 403 {
		t.Fatalf("before Premium: %d", code)
	}
	s.plat.Set(platform.Account{ID: acct, Username: "player", Role: platform.RoleNormal, Premium: true})
	code, e, j := s.join(acct, c.ID, 2)
	if code != 200 {
		t.Fatalf("after Premium: %d %s", code, e)
	}
	s.mustEnter(2, j.Ticket, "Late")
}

// With persistence: a new character starts at a spawn point, and one saved earlier starts where it
// was saved. Both arrive with the look they were made with.
func TestJoinStartsWhereSaved(t *testing.T) {
	s := start(t)
	fresh := s.account(platform.RoleNormal, false)
	c := s.createCharacter(fresh, "Newbie")
	_, _, j := s.join(fresh, c.ID, 1)
	self := s.mustEnterAt(1, j.Ticket, "Newbie")
	spawn := self.Position

	// A character saved somewhere else on the region by an earlier session.
	saved := proto.Pos{X: 2000, Y: 100, Z: 1000}
	if saved == spawn {
		t.Fatal("pick a saved position that isn't the spawn point")
	}
	back := s.account(platform.RoleNormal, false)
	old := s.createCharacter(back, "Oldtimer")
	ctx := context.Background()
	lease := persist.NewLease()
	then := time.Now().Add(-time.Hour)
	if _, err := s.chars.Claim(ctx, persist.Claim{AccountID: back, CharacterID: old.ID, World: 1, Lease: lease,
		Now: then, Until: then.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.chars.Write(ctx, 1, []persist.Save{{CharacterID: old.ID, Lease: lease, Region: "test_greybox",
		Pos: saved, HP: persist.HPFull, Release: true}}, then, time.Now()); err != nil {
		t.Fatal(err)
	}
	_, _, j = s.join(back, old.ID, 1)
	self = s.mustEnterAt(1, j.Ticket, "Oldtimer")
	if self.Position.X != saved.X || self.Position.Z != saved.Z {
		t.Fatalf("rejoined at %+v, want the saved %+v", self.Position, saved)
	}
}
