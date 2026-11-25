package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
)

// The deletion hook (security.md, "Required tests"): a wrong or missing service key is refused, it
// answers 204 for an unknown account, it's idempotent, and the characters are gone afterwards.

const serviceKey = "test-service-key-0123456789abcdefghij"

// hook calls DELETE /internal/players/{id} on the internal handler with this Authorization header.
func (e *env) hook(id, auth string) int {
	req := httptest.NewRequest("DELETE", "/internal/players/"+id, nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	e.srv.InternalHandler().ServeHTTP(rec, req)
	return rec.Code
}

func TestDeletionHookNeedsTheServiceKey(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	e.create(acct, 1, "Grug")
	for name, auth := range map[string]string{
		"no header":                "",
		"wrong key":                "Service not-the-key",
		"key without the scheme":   serviceKey,
		"bearer with the key":      "Bearer " + serviceKey,
		"the player's own token":   "Bearer " + e.tokenFor(acct),
		"key with extra":           "Service " + serviceKey + "x",
		"lower-case scheme":        "service " + serviceKey,
		"empty key after a scheme": "Service ",
	} {
		if code := e.hook(acct, auth); code != http.StatusUnauthorized {
			t.Errorf("%s: %d, want 401", name, code)
		}
	}
	var list []characterJSON
	e.do("GET", "/api/characters", acct, nil).decode(t, &list)
	if len(list) != 1 {
		t.Fatalf("a refused hook deleted characters: %+v", list)
	}
}

// With no service key configured, nobody gets in (not even with an empty key).
func TestDeletionHookWithoutAConfiguredKey(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.ServiceKey = ""
	if code := e.hook(e.account(platform.RoleNormal, false), "Service "); code != http.StatusUnauthorized {
		t.Fatalf("%d, want 401", code)
	}
}

func TestDeletionHook(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	other := e.account(platform.RoleNormal, false)
	a := e.create(acct, 1, "Grug")
	b := e.create(acct, 2, "Ugg")
	c := e.create(acct, 3, "Zog")
	kept := e.create(other, 1, "Keeper")
	// One renamed (its old name is held), one soft-deleted (its name is held), one online.
	e.expect(e.do("PATCH", "/api/characters/"+a.ID, acct, map[string]string{"name": "Grugson"}), 200, "")
	e.expect(e.do("DELETE", "/api/characters/"+b.ID, acct, map[string]string{"confirmName": "Ugg"}), 204, "")
	e.store.SetOnline(c.ID, 1, t0.Add(time.Minute))

	if code := e.hook(acct, "Service "+serviceKey); code != http.StatusNoContent {
		t.Fatalf("hook: %d, want 204", code)
	}
	// Everything of the account is gone, including the soft-deleted and the online character.
	for _, id := range []string{a.ID, b.ID, c.ID} {
		if _, ok := e.store.chars[id]; ok {
			t.Errorf("character %s is still stored", id)
		}
	}
	// Its token, still unexpired, is refused everywhere.
	e.expect(e.do("GET", "/api/characters", acct, nil), http.StatusUnauthorized, "unauthorized")
	e.expect(e.join(acct, c.ID, 1), http.StatusUnauthorized, "unauthorized")
	// Its names are free at once: current, held by a rename, and held by a soft delete.
	for slot, name := range []string{"Grugson", "Grug", "Ugg", "Zog"} {
		e.now = e.now.Add(time.Hour) // under the create limit
		e.create(e.account(platform.RoleNormal, false), 1+slot%3, name)
	}
	// Other accounts are untouched.
	var list []characterJSON
	e.do("GET", "/api/characters", other, nil).decode(t, &list)
	if len(list) != 1 || list[0].ID != kept.ID {
		t.Fatalf("other account: %+v", list)
	}

	// Idempotent, and fine for an account never seen.
	for _, id := range []string{acct, "0b7c1e2a-9999-4000-8000-000000000000"} {
		if code := e.hook(id, "Service "+serviceKey); code != http.StatusNoContent {
			t.Fatalf("hook again for %s: %d, want 204", id, code)
		}
	}
	if code := e.hook("not-a-uuid", "Service "+serviceKey); code != http.StatusBadRequest {
		t.Fatalf("bad id: %d, want 400", code)
	}
}

// A request already past auth when the hook runs can't make a character afterwards.
func TestCreateAfterTheHookIsRefused(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	if _, err := e.store.DeleteAccount(t.Context(), acct, t0); err != nil {
		t.Fatal(err)
	}
	r := e.srv.cfg.Store
	if _, err := r.CreateCharacter(t.Context(), acct, 1, "Grug", look, t0); err != ErrAccountDeleted {
		t.Fatalf("create after deletion: %v, want ErrAccountDeleted", err)
	}
}

// The hook isn't on the public handler (the one Caddy proxies to), even with the key.
func TestDeletionHookIsNotPublic(t *testing.T) {
	e := newEnv(t)
	acct := e.account(platform.RoleNormal, false)
	e.create(acct, 1, "Grug")
	req := httptest.NewRequest("DELETE", "/internal/players/"+acct, nil)
	req.Header.Set("Authorization", "Service "+serviceKey)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("public handler: %d, want 404", rec.Code)
	}
	if code := e.do("GET", "/api/characters", acct, nil).code; code != 200 {
		t.Fatalf("account after a public attempt: %d", code)
	}
	// And the internal handler has nothing else: the API's routes aren't there.
	req = httptest.NewRequest("GET", "/api/worlds", nil)
	rec = httptest.NewRecorder()
	e.srv.InternalHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("internal handler serves /api/worlds: %d", rec.Code)
	}
}
