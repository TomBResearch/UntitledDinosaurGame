package pgpersist_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api/pgstore"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api/storetest"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist/persisttest"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist/pgpersist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/migrations"
)

// These run only with UDG_TEST_DATABASE_URL set (the slow lane, tools/slow-tests.sh, starts a
// Postgres for them). Each run gets its own schema, dropped afterwards. The API's store (as the admin
// user) makes the characters, and the world's store logs in as udg_world, as in production.

const worldPassword = "test_world_password_0123456789"

type dbs struct {
	admin *pgxpool.Pool // the API's connection
	world *pgxpool.Pool // udg_world's connection
}

func testDBs(t *testing.T) dbs {
	raw := os.Getenv("UDG_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("UDG_TEST_DATABASE_URL not set (tools/slow-tests.sh runs these)")
	}
	ctx := context.Background()
	schema := fmt.Sprintf("test_%d", time.Now().UnixNano())
	root, err := pgxpool.New(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	open := func(u string) *pgxpool.Pool {
		cfg, err := pgxpool.ParseConfig(u)
		if err != nil {
			t.Fatal(err)
		}
		cfg.ConnConfig.RuntimeParams["search_path"] = schema
		p, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	admin := open(raw)
	if _, err := migrations.Apply(ctx, admin); err != nil {
		t.Fatal(err)
	}
	if err := migrations.SetWorldPassword(ctx, admin, worldPassword); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(migrations.WorldRole, worldPassword)
	world := open(u.String())
	t.Cleanup(func() {
		world.Close()
		admin.Close()
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	return dbs{admin: admin, world: world}
}

var look = api.Appearance{BodyType: "b", SkinTone: "s", HairStyle: "h", HairColour: "c", Beard: "none"}

func hooks(db dbs) persisttest.Hooks {
	apiStore := pgstore.New(db.admin)
	n := 0
	return persisttest.Hooks{
		NewAccount: func(*testing.T) string { return storetest.NewAccount() },
		AddCharacter: func(t *testing.T, acc string) string {
			chars, err := apiStore.Characters(context.Background(), acc)
			if err != nil {
				t.Fatal(err)
			}
			n++
			c, err := apiStore.CreateCharacter(context.Background(), acc, len(chars)+1,
				fmt.Sprintf("Pers%d", n), look, persisttest.T0)
			if err != nil {
				t.Fatal(err)
			}
			return c.ID
		},
		DeleteCharacter: func(t *testing.T, acc, id string) {
			if err := apiStore.DeleteCharacter(context.Background(), acc, id, persisttest.T0); err != nil {
				t.Fatal(err)
			}
		},
		// The API's own reading of the lease: what POST /api/join's already_online, rename and delete
		// go by.
		Online: func(t *testing.T, acc, id string, now time.Time) bool {
			c, err := apiStore.Character(context.Background(), acc, id)
			if err != nil {
				t.Fatal(err)
			}
			return c.Online(now)
		},
	}
}

func TestPostgresContract(t *testing.T) {
	db := testDBs(t)
	persisttest.Run(t, pgpersist.New(db.world), hooks(db))
}

// While the world holds the lease, the API refuses a second login (already_online), a rename and a
// delete. After the world releases it, the API sees where the character was saved.
func TestTheAPISeesTheWorldsLease(t *testing.T) {
	db := testDBs(t)
	ctx := context.Background()
	apiStore := pgstore.New(db.admin)
	world := pgpersist.New(db.world)
	h := hooks(db)
	acc := h.NewAccount(t)
	id := h.AddCharacter(t, acc)
	other := h.AddCharacter(t, acc)
	now := persisttest.T0.Add(time.Hour)
	lease := persist.NewLease()
	if _, err := world.Claim(ctx, persist.Claim{AccountID: acc, CharacterID: id, World: 1, Lease: lease, Now: now,
		Until: now.Add(persist.LeaseTTL)}); err != nil {
		t.Fatal(err)
	}
	chars, err := apiStore.Characters(ctx, acc)
	if err != nil {
		t.Fatal(err)
	}
	online := 0
	for _, c := range chars {
		if c.Online(now) {
			online++
		}
	}
	if online != 1 {
		t.Fatalf("%d characters online for the API, want 1 (so /api/join answers already_online)", online)
	}
	if _, err := apiStore.RenameCharacter(ctx, acc, id, "Renamed", now); !errors.Is(err, api.ErrOnline) {
		t.Fatalf("rename while online: %v", err)
	}
	if err := apiStore.DeleteCharacter(ctx, acc, id, now); !errors.Is(err, api.ErrOnline) {
		t.Fatalf("delete while online: %v", err)
	}
	if _, err := world.Claim(ctx, persist.Claim{AccountID: acc, CharacterID: other, World: 2, Lease: persist.NewLease(),
		Now: now, Until: now.Add(persist.LeaseTTL)}); !errors.Is(err, persist.ErrOnline) {
		t.Fatalf("a second character on another world: %v", err)
	}

	saved := now.Add(time.Minute)
	if lost, err := world.Write(ctx, 1, []persist.Save{{CharacterID: id, Lease: lease, Region: "test_greybox",
		HP: persist.HPFull, Release: true}}, saved, saved); err != nil || len(lost) > 0 {
		t.Fatalf("release: %v %v", lost, err)
	}
	c, err := apiStore.Character(ctx, acc, id)
	if err != nil {
		t.Fatal(err)
	}
	if c.Online(saved) || c.Region != "test_greybox" || c.LastPlayedAt == nil || !c.LastPlayedAt.Equal(saved) {
		t.Fatalf("after the release the API sees %+v", c)
	}
}

// The deletion hook removes an account while a world holds a lease on one of its characters (the
// player is online). The world's saves then change nothing and can't bring the row back (udg_world
// can only update), its renewal reports the lease lost, so it disconnects the player, and a ticket
// issued just before can't claim the character any more.
func TestDeletingAnOnlineAccount(t *testing.T) {
	db := testDBs(t)
	ctx := context.Background()
	apiStore := pgstore.New(db.admin)
	world := pgpersist.New(db.world)
	h := hooks(db)
	acc := h.NewAccount(t)
	id := h.AddCharacter(t, acc)
	other := h.AddCharacter(t, acc)
	now := persisttest.T0.Add(time.Hour)
	lease := persist.NewLease()
	if _, err := world.Claim(ctx, persist.Claim{AccountID: acc, CharacterID: id, World: 1, Lease: lease, Now: now,
		Until: now.Add(persist.LeaseTTL)}); err != nil {
		t.Fatal(err)
	}

	if n, err := apiStore.DeleteAccount(ctx, acc, now); err != nil || n != 2 {
		t.Fatalf("DeleteAccount: %d %v", n, err)
	}

	later := now.Add(persist.RenewEvery)
	lost, err := world.Write(ctx, 1, []persist.Save{{CharacterID: id, Lease: lease, Region: "test_greybox",
		HP: persist.HPFull}}, later, later.Add(persist.LeaseTTL))
	if err != nil || len(lost) != 1 || lost[0] != id {
		t.Fatalf("save after deletion: lost %v, err %v (want the character lost)", lost, err)
	}
	gone, err := world.Renew(ctx, 1, []string{lease}, later.Add(persist.LeaseTTL))
	if err != nil || len(gone) != 1 || gone[0] != lease {
		t.Fatalf("renew after deletion: lost %v, err %v (want the lease lost)", gone, err)
	}
	var rows int
	if err := db.admin.QueryRow(ctx, "SELECT count(*) FROM characters WHERE account_id = $1", acc).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("%d character rows after the world saved, err %v", rows, err)
	}
	if _, err := world.Claim(ctx, persist.Claim{AccountID: acc, CharacterID: other, World: 2, Lease: persist.NewLease(),
		Now: later, Until: later.Add(persist.LeaseTTL)}); !errors.Is(err, persist.ErrNotFound) {
		t.Fatalf("claim after deletion: %v, want ErrNotFound", err)
	}
}

// udg_world can do what a world needs and nothing else.
func TestTheWorldRoleIsRestricted(t *testing.T) {
	db := testDBs(t)
	ctx := context.Background()
	h := hooks(db)
	acc := h.NewAccount(t)
	id := h.AddCharacter(t, acc)
	refused := []string{
		"SELECT name FROM characters",
		"SELECT appearance FROM characters",
		"UPDATE characters SET name = 'Hacked' WHERE id = '" + id + "'",
		"UPDATE characters SET deleted_at = now() WHERE id = '" + id + "'",
		"UPDATE characters SET account_id = gen_random_uuid() WHERE id = '" + id + "'",
		"DELETE FROM characters",
		"INSERT INTO characters (account_id, slot, name, created_at) VALUES (gen_random_uuid(), 1, 'X', now())",
		"SELECT * FROM character_names",
		"SELECT * FROM character_skills",
		"UPDATE character_skills SET xp = 1",
		"SELECT * FROM deleted_accounts",
		"SELECT name FROM worlds",
		"SELECT * FROM schema_migrations",
		"CREATE TABLE sneaky (x int)",
	}
	for _, q := range refused {
		_, err := db.world.Exec(ctx, q)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Errorf("%s: %v, want permission denied", q, err)
		}
	}
	// What it may do.
	if ok, err := pgpersist.New(db.world).WorldExists(ctx, 1); err != nil || !ok {
		t.Fatalf("world 1: %v %v", ok, err)
	}
	if ok, err := pgpersist.New(db.world).WorldExists(ctx, 99); err != nil || ok {
		t.Fatalf("world 99: %v %v", ok, err)
	}
}

func TestSetWorldPasswordRefusesUnsafePasswords(t *testing.T) {
	db := testDBs(t)
	for _, pw := range []string{"short", "has a space in it 0123456789", "quote'0123456789012345678901", ""} {
		if err := migrations.SetWorldPassword(context.Background(), db.admin, pw); err == nil {
			t.Errorf("%q was accepted", pw)
		}
	}
}
