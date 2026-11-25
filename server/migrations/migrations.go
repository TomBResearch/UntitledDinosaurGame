// Package migrations applies the API's database migrations: the numbered SQL files in this folder,
// embedded in the binary. The API runs them when it starts; the world servers never do
// (docs/architecture/backend.md, ADR 0016).
//
// Each file runs once, in its own transaction, in file-name order, and is recorded in
// schema_migrations. A Postgres advisory lock stops two API copies migrating at the same time.
// Files are never edited once merged: a change is a new file.
package migrations

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var files embed.FS

// lockID is the advisory lock key ("udg" migrations).
const lockID = 0x756467

var namePattern = regexp.MustCompile(`^(\d{4})_[a-z0-9_]+\.sql$`)

// Migration is one SQL file.
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// All returns the embedded migrations in order. File names must be NNNN_words.sql with versions
// counting up from 1 without gaps.
func All() ([]Migration, error) {
	entries, err := fs.Glob(files, "*.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(entries)
	var out []Migration
	for i, name := range entries {
		m := namePattern.FindStringSubmatch(name)
		if m == nil {
			return nil, fmt.Errorf("migration %s: name must be NNNN_words.sql", name)
		}
		v, _ := strconv.Atoi(m[1])
		if v != i+1 {
			return nil, fmt.Errorf("migration %s: expected version %04d", name, i+1)
		}
		sql, err := files.ReadFile(name)
		if err != nil {
			return nil, err
		}
		out = append(out, Migration{Version: v, Name: name, SQL: string(sql)})
	}
	return out, nil
}

// WorldRole is the database role the world servers log in as (migration 0002, ADR 0017).
const WorldRole = "udg_world"

var passwordPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{24,128}$`)

// SetWorldPassword lets the world servers' role log in with this password. The API calls it when it
// starts, after Apply, with WORLD_DB_PASSWORD (made by tools/set-secrets.sh). The password must be
// 24 to 128 letters, digits, _ or -, so it's safe in a database URL and in SQL.
func SetWorldPassword(ctx context.Context, pool *pgxpool.Pool, password string) error {
	if !passwordPattern.MatchString(password) {
		return fmt.Errorf("WORLD_DB_PASSWORD must be 24 to 128 letters, digits, _ or - (openssl rand -hex 24)")
	}
	// ALTER ROLE can't take a parameter; the pattern above keeps the literal safe.
	_, err := pool.Exec(ctx, "ALTER ROLE "+WorldRole+" WITH LOGIN PASSWORD '"+password+"'")
	return err
}

// Apply runs every migration the database hasn't had yet and returns the names it ran.
func Apply(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	all, err := All()
	if err != nil {
		return nil, err
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockID); err != nil {
		return nil, err
	}
	defer func() { _, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", lockID) }()
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    integer     PRIMARY KEY,
		name       text        NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return nil, err
	}
	var current int
	if err := conn.QueryRow(ctx, "SELECT coalesce(max(version), 0) FROM schema_migrations").Scan(&current); err != nil {
		return nil, err
	}
	if current > len(all) {
		return nil, fmt.Errorf("the database is at migration %d, newer than this build (%d): deploy a newer API", current, len(all))
	}
	var ran []string
	for _, m := range all[current:] {
		err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, m.SQL); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", m.Version, m.Name)
			return err
		})
		if err != nil {
			return ran, fmt.Errorf("migration %s: %w", m.Name, err)
		}
		ran = append(ran, m.Name)
	}
	return ran, nil
}
