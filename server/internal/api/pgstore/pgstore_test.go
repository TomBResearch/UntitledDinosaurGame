package pgstore_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api/pgstore"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api/storetest"
	"github.com/TomBResearch/UntitledDinosaurGame/server/migrations"
)

// These run only with UDG_TEST_DATABASE_URL set (the slow lane, tools/slow-tests.sh, starts a
// Postgres for them). Each run gets its own schema, dropped afterwards.
func testPool(t *testing.T) *pgxpool.Pool {
	url := os.Getenv("UDG_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("UDG_TEST_DATABASE_URL not set (tools/slow-tests.sh runs these)")
	}
	ctx := context.Background()
	schema := fmt.Sprintf("test_%d", time.Now().UnixNano())
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return pool
}

func TestMigrations(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	ran, err := migrations.Apply(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	all, _ := migrations.All()
	if len(ran) != len(all) {
		t.Fatalf("ran %v, want all %d", ran, len(all))
	}
	// Running again does nothing.
	if ran, err := migrations.Apply(ctx, pool); err != nil || len(ran) != 0 {
		t.Fatalf("second run: %v %v", ran, err)
	}
}

func TestPostgresContract(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if _, err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store := pgstore.New(pool)
	storetest.Run(t,
		func(*testing.T) api.Store { return store },
		storetest.Hooks{
			SetOnline: func(t *testing.T, _ api.Store, id string, world int, until time.Time) {
				if _, err := pool.Exec(ctx, "UPDATE characters SET online_world_id = $2, lease_until = $3 WHERE id = $1", id, world, until); err != nil {
					t.Fatal(err)
				}
			},
			SetSkillXP: func(t *testing.T, _ api.Store, id, skill string, xp int64) {
				if _, err := pool.Exec(ctx, `INSERT INTO character_skills (character_id, skill, xp) VALUES ($1, $2, $3)
					ON CONFLICT (character_id, skill) DO UPDATE SET xp = EXCLUDED.xp`, id, skill, xp); err != nil {
					t.Fatal(err)
				}
			},
		})
}

// After DeleteAccount no table holds anything of the account: every column named account_id or
// character_id, in every table (deleted_accounts aside), is checked, so a table added later (items,
// quests) that forgets ON DELETE CASCADE fails here.
func TestDeleteAccountLeavesNothing(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	if _, err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store := pgstore.New(pool)
	acct := storetest.NewAccount()
	var ids []string
	for slot, name := range []string{"Gone One", "Gone Two"} {
		c, err := store.CreateCharacter(ctx, acct, slot+1, name, api.Appearance{}, storetest.T0)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, c.ID)
		if _, err := pool.Exec(ctx, "INSERT INTO character_skills (character_id, skill, xp) VALUES ($1, 'angling', 5)", c.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.RenameCharacter(ctx, acct, ids[0], "Gone Three", storetest.T0); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteAccount(ctx, acct, storetest.T0); err != nil {
		t.Fatal(err)
	}

	rows, err := pool.Query(ctx, `SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND column_name IN ('account_id', 'character_id')
		  AND table_name <> 'deleted_accounts'`)
	if err != nil {
		t.Fatal(err)
	}
	type col struct{ table, column string }
	var cols []col
	for rows.Next() {
		var c col
		if err := rows.Scan(&c.table, &c.column); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	if rows.Err() != nil || len(cols) < 3 {
		t.Fatalf("columns found: %v (err %v)", cols, rows.Err())
	}
	for _, c := range cols {
		var n int
		q := fmt.Sprintf("SELECT count(*) FROM %q WHERE %q::text = ANY($1)", c.table, c.column)
		if err := pool.QueryRow(ctx, q, append([]string{acct}, ids...)).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%s.%s still has %d rows for the deleted account", c.table, c.column, n)
		}
	}
}
