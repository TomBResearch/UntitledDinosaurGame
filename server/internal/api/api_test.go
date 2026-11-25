package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/content"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform/platformtest"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
)

// Handler tests: a memory store, a stand-in platform and a fixed clock, so nothing waits.

var (
	loadData  = sync.OnceValues(func() (*content.Content, error) { return content.Load("../../../data") })
	ticketKey = bytes.Repeat([]byte{9}, 32)
	t0        = time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)
	look      = Appearance{BodyType: "sturdy", SkinTone: "tone_3", HairStyle: "shaggy", HairColour: "brown", Beard: "none"}
)

type fakeWorlds struct {
	mu      sync.Mutex
	players map[int]int // missing: offline
}

func (f *fakeWorlds) Status(_ context.Context, id int) (int, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.players[id]
	return n, ok
}

type env struct {
	t      *testing.T
	srv    *Server
	h      http.Handler
	store  *MemStore
	plat   *platformtest.Platform
	worlds *fakeWorlds
	now    time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	data, err := loadData()
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, now: t0, plat: platformtest.New(), worlds: &fakeWorlds{players: map[int]int{1: 10, 2: 10}},
		store: NewMemStore(
			World{ID: 1, Name: "World 1", MaxPlayers: 100, WSPath: "/w/1"},
			World{ID: 2, Name: "World 2", PremiumOnly: true, MaxPlayers: 100, WSPath: "/w/2"},
		)}
	clock := func() time.Time { return e.now }
	e.srv = New(Config{
		Store:      e.store,
		Tokens:     &platform.Verifier{Keys: e.plat, Issuer: platformtest.Issuer, Audience: platformtest.Audience, Now: clock},
		Accounts:   e.plat,
		Worlds:     e.worlds,
		TicketKey:  ticketKey,
		ServiceKey: serviceKey,
		PublicWS:   "wss://dinosaur.example",
		Data:       data,
		Version:    "test",
		Now:        clock,
	})
	e.h = e.srv.Handler()
	return e
}

var accountSeq int

// account makes a platform account with this role and Premium flag.
func (e *env) account(role platform.Role, premium bool) string {
	accountSeq++
	id := fmt.Sprintf("0b7c1e2a-3333-4000-8000-%012x", accountSeq)
	e.plat.Set(platform.Account{ID: id, Username: "u", Role: role, Premium: premium})
	return id
}

type resp struct {
	code int
	body []byte
	hdr  http.Header
}

func (r resp) decode(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.body, v); err != nil {
		t.Fatalf("decoding %s: %v", r.body, err)
	}
}

func (r resp) errCode() string {
	var e apiError
	_ = json.Unmarshal(r.body, &e)
	return e.Error
}

// do sends a request as the account (empty: no token).
func (e *env) do(method, path, account string, body any) resp {
	return e.doToken(method, path, e.tokenFor(account), body)
}

func (e *env) tokenFor(account string) string {
	if account == "" {
		return ""
	}
	return e.plat.Token(account, e.now)
}

func (e *env) doToken(method, path, token string, body any) resp {
	var b bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&b).Encode(body)
	}
	req := httptest.NewRequest(method, path, &b)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return resp{rec.Code, rec.Body.Bytes(), rec.Header()}
}

func (e *env) expect(r resp, code int, errCode string) {
	e.t.Helper()
	if r.code != code || (errCode != "" && r.errCode() != errCode) {
		e.t.Fatalf("got %d %s, want %d %s", r.code, r.body, code, errCode)
	}
}

func (e *env) create(account string, slot int, name string) characterJSON {
	e.t.Helper()
	r := e.do("POST", "/api/characters", account, map[string]any{"name": name, "slot": slot, "appearance": look})
	e.expect(r, http.StatusCreated, "")
	var c characterJSON
	r.decode(e.t, &c)
	return c
}

func TestHealth(t *testing.T) {
	e := newEnv(t)
	r := e.do("GET", "/api/health", "", nil)
	e.expect(r, 200, "")
	if string(r.body) != `{"status":"ok","version":"test"}`+"\n" {
		t.Fatalf("health %s", r.body)
	}
}

func TestPlayerRoutesNeedAValidToken(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	_, otherKey, _ := ed25519.GenerateKey(nil)
	forged := e.plat.SignWith(map[string]any{"alg": "EdDSA", "kid": e.plat.Kid},
		map[string]any{"sub": acct, "role": "owner", "iss": platformtest.Issuer, "aud": platformtest.Audience,
			"exp": t0.Add(time.Hour).Unix()}, otherKey)
	expired := e.plat.Token(acct, t0.Add(-time.Hour))
	for _, rt := range e.srv.routes {
		if rt.auth == public {
			continue
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		path = strings.ReplaceAll(path, "{id}", "0b7c1e2a-0000-4000-8000-000000000000")
		for name, token := range map[string]string{"none": "", "garbage": "x.y.z", "forged": forged, "expired": expired} {
			if r := e.doToken(method, path, token, map[string]any{}); r.code != http.StatusUnauthorized {
				t.Errorf("%s with %s token: %d, want 401", rt.pattern, name, r.code)
			}
		}
	}
}

// A deleted account's token still verifies for up to 15 minutes; the API refuses it anyway.
func TestDeletedAccountsAreRefused(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	e.expect(e.do("GET", "/api/characters", acct, nil), 200, "")
	if err := e.store.RecordDeletedAccount(context.Background(), acct, t0); err != nil {
		t.Fatal(err)
	}
	e.expect(e.do("GET", "/api/characters", acct, nil), http.StatusUnauthorized, "unauthorized")
	e.expect(e.do("POST", "/api/join", acct, map[string]any{"characterId": "0b7c1e2a-0000-4000-8000-000000000000", "worldId": 1}),
		http.StatusUnauthorized, "unauthorized")
}

func TestWorlds(t *testing.T) {
	e := newEnv(t)
	e.store.worlds = append(e.store.worlds, World{ID: 3, Name: "World 3", MaxPlayers: 100, WSPath: "/w/3"})
	e.worlds.players = map[int]int{1: 24, 2: 100} // 3 is offline
	var got []map[string]any
	e.do("GET", "/api/worlds", "", nil).decode(t, &got)
	want := `[{"id":1,"name":"World 1","online":true,"population":"low","premiumOnly":false},` +
		`{"id":2,"name":"World 2","online":true,"population":"full","premiumOnly":true},` +
		`{"id":3,"name":"World 3","online":false,"population":null,"premiumOnly":false}]`
	if b, _ := json.Marshal(got); string(b) != want {
		t.Fatalf("worlds\n got %s\nwant %s", b, want)
	}
}

func TestPopulation(t *testing.T) {
	for _, c := range []struct {
		players int
		want    string
	}{{0, "low"}, {249, "low"}, {250, "medium"}, {599, "medium"}, {600, "high"}, {999, "high"}, {1000, "full"}, {1200, "full"}} {
		if got := Population(c.players, 1000); got != c.want {
			t.Errorf("Population(%d, 1000) = %s, want %s", c.players, got, c.want)
		}
	}
}

func TestCreateAndListCharacters(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	c := e.create(acct, 2, "Grug")
	if c.Name != "Grug" || c.Slot != 2 || c.Appearance != look || c.Online || c.LastRegion != nil || c.NextRenameAt != nil {
		t.Fatalf("created %+v", c)
	}
	// 14 skills at level 1.
	if c.TotalLevel != 14 {
		t.Fatalf("totalLevel %d, want 14", c.TotalLevel)
	}
	e.store.SetSkillXP(c.ID, "lumberjacking", e.srv.cfg.Data.XP.XPForLevel(10))
	e.create(acct, 1, "Ugg")
	var list []characterJSON
	e.do("GET", "/api/characters", acct, nil).decode(t, &list)
	if len(list) != 2 || list[0].Name != "Ugg" || list[1].TotalLevel != 23 {
		t.Fatalf("list %+v", list)
	}
	// Someone else's list is their own.
	var other []characterJSON
	e.do("GET", "/api/characters", e.account(platform.RoleNormal, false), nil).decode(t, &other)
	if len(other) != 0 {
		t.Fatalf("another account sees %+v", other)
	}
}

func TestCreateRefused(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	e.create(acct, 1, "Grug")
	cases := []struct {
		body       map[string]any
		code       int
		err, cause string
	}{
		{map[string]any{"name": "Ugg", "slot": 0, "appearance": look}, 400, "invalid_slot", ""},
		{map[string]any{"name": "Ugg", "slot": 4, "appearance": look}, 400, "invalid_slot", ""},
		{map[string]any{"name": "Ug", "slot": 2, "appearance": look}, 400, "invalid_name", "shape"},
		{map[string]any{"name": "Big  Ugg", "slot": 2, "appearance": look}, 400, "invalid_name", "shape"},
		{map[string]any{"name": "Shithead", "slot": 2, "appearance": look}, 400, "invalid_name", "not_allowed"},
		{map[string]any{"name": "Admin Ugg", "slot": 2, "appearance": look}, 400, "invalid_name", "reserved"},
		{map[string]any{"name": "Ugg", "slot": 2}, 400, "invalid_appearance", ""},
		{map[string]any{"name": "Ugg", "slot": 2, "appearance": map[string]string{"bodyType": "a"}}, 400, "invalid_appearance", ""},
		{map[string]any{"name": "Ugg", "slot": 2, "appearance": Appearance{BodyType: "a", SkinTone: "b", HairStyle: "c", HairColour: "d", Beard: "Bad Id"}}, 400, "invalid_appearance", ""},
		{map[string]any{"name": "Ugg", "slot": 1, "appearance": look}, 409, "slot_used", ""},
		{map[string]any{"name": "GRUG", "slot": 2, "appearance": look}, 409, "name_taken", ""},
	}
	for _, c := range cases {
		e.now = e.now.Add(time.Hour) // stay under the 10-an-hour create limit
		r := e.do("POST", "/api/characters", acct, c.body)
		var got apiError
		r.decode(t, &got)
		if r.code != c.code || got.Error != c.err || got.Reason != c.cause {
			t.Errorf("%v: got %d %s, want %d %s %s", c.body, r.code, r.body, c.code, c.err, c.cause)
		}
	}
	// A body that isn't JSON.
	req := httptest.NewRequest("POST", "/api/characters", strings.NewReader("{"))
	req.Header.Set("Authorization", "Bearer "+e.tokenFor(acct))
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != 400 {
		t.Errorf("bad JSON: %d", rec.Code)
	}
}

// The appearance must be made of choices in data/appearance.json: every listed choice is accepted, and
// an id that isn't listed is refused, in each of the five parts.
func TestCreateChecksAppearanceAgainstData(t *testing.T) {
	e := newEnv(t)
	data, _ := loadData()
	acct := e.account(platform.RoleNormal, false)
	slot := 0
	try := func(a Appearance) resp {
		e.now = e.now.Add(time.Hour) // stay under the 10-an-hour create limit
		slot++
		r := e.do("POST", "/api/characters", acct, map[string]any{"name": fmt.Sprintf("Ugg%d", slot), "slot": 1, "appearance": a})
		if r.code == 201 {
			var c characterJSON
			r.decode(t, &c)
			if c.Appearance != a {
				t.Errorf("stored %+v, sent %+v", c.Appearance, a)
			}
			e.do("DELETE", "/api/characters/"+c.ID, acct, map[string]string{"confirmName": c.Name})
		}
		return r
	}
	// Every choice of every part, on top of the default look.
	file := readAppearanceFile(t)
	parts := []struct {
		ids []string
		set func(*Appearance, string)
	}{
		{ids(file.BodyTypes, func(b content.BodyType) string { return b.ID }), func(a *Appearance, v string) { a.BodyType = v }},
		{ids(file.SkinTones, func(c content.ColourChoice) string { return c.ID }), func(a *Appearance, v string) { a.SkinTone = v }},
		{ids(file.HairStyles, func(c content.Choice) string { return c.ID }), func(a *Appearance, v string) { a.HairStyle = v }},
		{ids(file.HairColours, func(c content.ColourChoice) string { return c.ID }), func(a *Appearance, v string) { a.HairColour = v }},
		{ids(file.Beards, func(c content.Choice) string { return c.ID }), func(a *Appearance, v string) { a.Beard = v }},
	}
	for _, p := range parts {
		for _, id := range p.ids {
			a := data.Appearance.Default
			p.set(&a, id)
			if r := try(a); r.code != 201 {
				t.Errorf("%+v refused: %d %s", a, r.code, r.body)
			}
		}
		// Well formed, but not a choice.
		a := data.Appearance.Default
		p.set(&a, "purple_mohawk")
		e.expect(try(a), 400, "invalid_appearance")
		a = data.Appearance.Default
		p.set(&a, "")
		e.expect(try(a), 400, "invalid_appearance")
	}
}

func ids[T any](list []T, id func(T) string) []string {
	out := make([]string, len(list))
	for i, v := range list {
		out[i] = id(v)
	}
	return out
}

func readAppearanceFile(t *testing.T) content.AppearanceFile {
	t.Helper()
	raw, err := os.ReadFile("../../../data/appearance.json")
	if err != nil {
		t.Fatal(err)
	}
	var f content.AppearanceFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestRenameCharacter(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	c := e.create(acct, 1, "Grug")
	e.create(e.account(platform.RoleNormal, false), 1, "Taken")
	path := "/api/characters/" + c.ID

	e.expect(e.do("PATCH", path, acct, map[string]string{"name": "taken"}), 409, "name_taken")
	e.expect(e.do("PATCH", path, acct, map[string]string{"name": "Fuck Off"}), 400, "invalid_name")
	e.expect(e.do("PATCH", path, e.account(platform.RoleNormal, false), map[string]string{"name": "Grogg"}), 404, "not_found")
	e.expect(e.do("PATCH", "/api/characters/nope", acct, map[string]string{"name": "Grogg"}), 404, "not_found")

	r := e.do("PATCH", path, acct, map[string]string{"name": "Grogg"})
	e.expect(r, 200, "")
	var renamed characterJSON
	r.decode(t, &renamed)
	if renamed.Name != "Grogg" || renamed.NextRenameAt == nil || !renamed.NextRenameAt.Equal(t0.Add(RenameGap)) {
		t.Fatalf("renamed %+v", renamed)
	}
	e.now = t0.Add(RenameGap - time.Hour)
	r = e.do("PATCH", path, acct, map[string]string{"name": "Grugg"})
	e.expect(r, http.StatusTooManyRequests, "rename_too_soon")
	var tooSoon apiError
	r.decode(t, &tooSoon)
	if tooSoon.RetryAt == nil || !tooSoon.RetryAt.Equal(t0.Add(RenameGap)) {
		t.Fatalf("retryAt %v", tooSoon.RetryAt)
	}
	e.now = t0.Add(RenameGap)
	e.expect(e.do("PATCH", path, acct, map[string]string{"name": "Grugg"}), 200, "")
}

func TestDeleteCharacter(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	c := e.create(acct, 1, "Grug")
	path := "/api/characters/" + c.ID
	e.expect(e.do("DELETE", path, acct, map[string]string{"confirmName": "Grog"}), 400, "confirm_name")
	e.expect(e.do("DELETE", path, e.account(platform.RoleNormal, false), map[string]string{"confirmName": "Grug"}), 404, "not_found")
	e.store.SetOnline(c.ID, 1, t0.Add(time.Minute))
	e.expect(e.do("DELETE", path, acct, map[string]string{"confirmName": "grug"}), 409, "character_online")
	e.store.SetOnline(c.ID, 1, t0)
	e.expect(e.do("DELETE", path, acct, map[string]string{"confirmName": "grug"}), 204, "")
	var list []characterJSON
	e.do("GET", "/api/characters", acct, nil).decode(t, &list)
	if len(list) != 0 {
		t.Fatalf("still listed: %+v", list)
	}
	e.expect(e.do("DELETE", path, acct, map[string]string{"confirmName": "Grug"}), 404, "not_found")
}

func (e *env) join(account, characterID string, world int) resp {
	return e.do("POST", "/api/join", account, map[string]any{"characterId": characterID, "worldId": world})
}

func TestJoinIssuesATicketTheWorldAccepts(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleModerator, false)
	c := e.create(acct, 1, "Grug")
	r := e.join(acct, c.ID, 1)
	e.expect(r, 200, "")
	var got joinJSON
	r.decode(t, &got)
	if got.WSURL != "wss://dinosaur.example/w/1" {
		t.Fatalf("wsUrl %q", got.WSURL)
	}
	p, err := ticket.NewGuard(ticketKey, "1").Check(got.Ticket, t0)
	if err != nil {
		t.Fatal(err)
	}
	// The ticket carries the character's look, so the world can show it to everyone.
	if p.Appearance == nil || *p.Appearance != look {
		t.Fatalf("ticket appearance %+v, want %+v", p.Appearance, look)
	}
	p.Appearance = nil
	want := ticket.Payload{AccountID: acct, CharacterID: c.ID, WorldID: "1", Name: "Grug", Role: "moderator", Premium: true,
		Nonce: p.Nonce, Exp: t0.Add(ticket.TTL).Unix()}
	if p != want {
		t.Fatalf("ticket\n got %+v\nwant %+v", p, want)
	}
	// Each ticket is new.
	var again joinJSON
	e.join(acct, c.ID, 1).decode(t, &again)
	if again.Ticket == got.Ticket {
		t.Fatal("two joins gave the same ticket")
	}
	// It's only good for that world, and only for 30 s.
	if _, err := ticket.NewGuard(ticketKey, "2").Check(again.Ticket, t0); !errors.Is(err, ticket.ErrWrongWorld) {
		t.Fatalf("other world: %v", err)
	}
	if _, err := ticket.NewGuard(ticketKey, "1").Check(again.Ticket, t0.Add(ticket.TTL)); !errors.Is(err, ticket.ErrExpired) {
		t.Fatalf("after 30 s: %v", err)
	}
	// Local worlds on their own ports: {id} in PublicWS becomes the world's id.
	e.srv.cfg.PublicWS = "ws://127.0.0.1:809{id}"
	var local joinJSON
	e.join(acct, c.ID, 1).decode(t, &local)
	if local.WSURL != "ws://127.0.0.1:8091/w/1" {
		t.Fatalf("local wsUrl %q", local.WSURL)
	}
}

// security.md: a premium world refuses a non-premium account, and accepts a premium account and
// staff. The check uses the fresh account state, not the token.
func TestJoinPremiumWorld(t *testing.T) {
	cases := []struct {
		role    platform.Role
		premium bool
		allowed bool
	}{
		{platform.RoleNormal, false, false},
		{platform.RoleNormal, true, true}, // the Premium flag
		{platform.RolePremium, false, true},
		{platform.RoleModerator, false, true}, // staff count as Premium
		{platform.RoleAdmin, false, true},
		{platform.RoleOwner, false, true},
	}
	for _, c := range cases {
		t.Run(string(c.role), func(t *testing.T) {
			e := newEnv(t)
			acct := e.account(c.role, c.premium)
			ch := e.create(acct, 1, "Grug")
			r := e.join(acct, ch.ID, 2)
			if !c.allowed {
				e.expect(r, http.StatusForbidden, "premium_required")
				// The free world is fine.
				e.expect(e.join(acct, ch.ID, 1), 200, "")
				return
			}
			e.expect(r, 200, "")
			var got joinJSON
			r.decode(t, &got)
			p, err := ticket.NewGuard(ticketKey, "2").Check(got.Ticket, t0)
			if err != nil || !p.Premium || p.Role != string(c.role) {
				t.Fatalf("ticket %+v %v", p, err)
			}
		})
	}
}

// Premium that lapsed since the token was issued: the fresh state wins.
func TestJoinUsesFreshPremium(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RolePremium, true)
	token := e.plat.Token(acct, t0) // says premium
	e.plat.Set(platform.Account{ID: acct, Role: platform.RoleNormal})
	ch := e.create(acct, 1, "Grug")
	r := e.doToken("POST", "/api/join", token, map[string]any{"characterId": ch.ID, "worldId": 2})
	e.expect(r, http.StatusForbidden, "premium_required")
}

func TestJoinRefused(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	a := e.create(acct, 1, "Grug")
	b := e.create(acct, 2, "Ugg")

	e.expect(e.join(acct, "0b7c1e2a-0000-4000-8000-000000000000", 1), 404, "not_found")
	e.expect(e.join(acct, "not-a-uuid", 1), 404, "not_found")
	e.expect(e.join(e.account(platform.RoleNormal, false), a.ID, 1), 404, "not_found")
	e.expect(e.join(acct, a.ID, 9), 404, "unknown_world")

	// One character online per account: another of yours is online, so neither can join.
	e.store.SetOnline(b.ID, 2, t0.Add(time.Minute))
	e.expect(e.join(acct, a.ID, 1), 409, "already_online")
	e.expect(e.join(acct, b.ID, 1), 409, "already_online")
	e.store.SetOnline(b.ID, 2, t0) // the lease ran out
	e.expect(e.join(acct, a.ID, 1), 200, "")

	e.worlds.players = map[int]int{1: 100}
	e.expect(e.join(acct, a.ID, 1), 503, "world_full")
	e.worlds.players = map[int]int{}
	e.expect(e.join(acct, a.ID, 1), 503, "world_offline")
	e.worlds.players = map[int]int{1: 0}

	e.plat.Down = true
	e.expect(e.join(acct, a.ID, 1), 503, "accounts_unavailable")
	e.plat.Down = false
}

// security.md: a banned account can't get a join ticket, even with a token from before the ban.
func TestJoinBanned(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleModerator, true)
	ch := e.create(acct, 1, "Grug")
	e.plat.Set(platform.Account{ID: acct, Role: platform.RoleModerator, Premium: true, Banned: true})
	e.expect(e.join(acct, ch.ID, 1), http.StatusForbidden, "banned")
}

// CLAUDE.md rule 8: every staff action refuses every lower rank, using the fresh role from the
// service API (never the token's). M1 has no staff routes of its own yet, so this checks every staff
// route the server has, plus one test route per staff rank to prove the mechanism.
func TestStaffRoutesRefuseLowerRanks(t *testing.T) {
	e := newEnv(t)
	for _, min := range []platform.Role{platform.RoleModerator, platform.RoleAdmin, platform.RoleOwner} {
		e.srv.routes = append(e.srv.routes, route{pattern: "POST /api/test/" + string(min), auth: staff, minRole: min,
			h: func(w http.ResponseWriter, _ *http.Request, who *caller) {
				writeJSON(w, 200, map[string]string{"role": string(who.fresh.Role)})
			}})
	}
	e.h = e.srv.Handler()
	checked := 0
	for _, rt := range e.srv.routes {
		if rt.auth != staff {
			if rt.minRole != "" {
				t.Errorf("%s has a minimum role but isn't a staff route", rt.pattern)
			}
			continue
		}
		if !rt.minRole.IsStaff() {
			t.Errorf("%s: staff route with minimum role %q", rt.pattern, rt.minRole)
		}
		method, path, _ := strings.Cut(rt.pattern, " ")
		for _, role := range platform.Roles {
			acct := e.account(role, false)
			// The token claims owner; only the fresh role counts.
			token := e.plat.Sign(map[string]any{"sub": acct, "role": "owner", "premium": true,
				"iss": platformtest.Issuer, "aud": platformtest.Audience, "exp": t0.Add(time.Hour).Unix()})
			r := e.doToken(method, path, token, map[string]any{})
			if role.Rank() < rt.minRole.Rank() {
				if r.code != http.StatusForbidden {
					t.Errorf("%s as %s: %d, want 403", rt.pattern, role, r.code)
				}
			} else if r.code == http.StatusForbidden || r.code == http.StatusUnauthorized {
				t.Errorf("%s as %s: %d, want allowed", rt.pattern, role, r.code)
			}
		}
		// A banned staff member is refused too.
		banned := e.account(platform.RoleOwner, true)
		e.plat.Set(platform.Account{ID: banned, Role: platform.RoleOwner, Banned: true})
		e.expect(e.do(method, path, banned, map[string]any{}), http.StatusForbidden, "forbidden")
		checked++
	}
	if checked < 3 {
		t.Fatalf("checked %d staff routes", checked)
	}
}

func TestRateLimits(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	// 10 character creations an hour (each fails on the slot after the first, which still counts).
	for i := range 10 {
		r := e.do("POST", "/api/characters", acct, map[string]any{"name": "Grug", "slot": 1, "appearance": look})
		if r.code == http.StatusTooManyRequests {
			t.Fatalf("limited after %d", i)
		}
	}
	r := e.do("POST", "/api/characters", acct, map[string]any{"name": "Grug", "slot": 1, "appearance": look})
	e.expect(r, http.StatusTooManyRequests, "rate_limited")
	if r.hdr.Get("Retry-After") == "" {
		t.Fatal("no Retry-After")
	}
	e.now = e.now.Add(6 * time.Minute) // one token back
	e.expect(e.do("POST", "/api/characters", acct, map[string]any{"name": "Grug", "slot": 1, "appearance": look}), 409, "slot_used")

	// 60 a minute per IP (every test request comes from one address).
	e2 := newEnv(t)
	for range 60 {
		e2.expect(e2.do("GET", "/api/worlds", "", nil), 200, "")
	}
	e2.expect(e2.do("GET", "/api/worlds", "", nil), http.StatusTooManyRequests, "rate_limited")
	e2.now = e2.now.Add(time.Second)
	e2.expect(e2.do("GET", "/api/worlds", "", nil), 200, "")
}

func TestUnknownRoutes(t *testing.T) {
	e := newEnv(t)
	e.expect(e.do("GET", "/api/nope", "", nil), 404, "not_found")
	e.expect(e.do("PUT", "/api/worlds", "", nil), 404, "not_found")
}
