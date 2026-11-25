// Package pgstore is the API's Postgres store (api.Store), using pgx. The schema is in
// server/migrations.
package pgstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
)

// Store implements api.Store.
type Store struct {
	pool *pgxpool.Pool
}

// New wraps a pool. Run migrations.Apply first.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ api.Store = (*Store)(nil)

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) AccountDeleted(ctx context.Context, accountID string) (bool, error) {
	var deleted bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM deleted_accounts WHERE account_id = $1)", accountID).Scan(&deleted)
	return deleted, err
}

func (s *Store) RecordDeletedAccount(ctx context.Context, accountID string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO deleted_accounts (account_id, deleted_at) VALUES ($1, $2)
		ON CONFLICT (account_id) DO NOTHING`, accountID, now)
	return err
}

func (s *Store) Worlds(ctx context.Context) ([]api.World, error) {
	rows, err := s.pool.Query(ctx, "SELECT id, name, premium_only, max_players, ws_path FROM worlds ORDER BY id")
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (api.World, error) {
		var w api.World
		err := r.Scan(&w.ID, &w.Name, &w.PremiumOnly, &w.MaxPlayers, &w.WSPath)
		return w, err
	})
}

// charColumns are read by scanChar.
const charColumns = `c.id::text, c.account_id::text, c.slot, c.name, c.appearance, coalesce(c.region, ''), c.created_at,
	c.last_played_at, c.renamed_at, c.online_world_id, c.lease_until,
	coalesce((SELECT jsonb_object_agg(skill, xp) FROM character_skills WHERE character_id = c.id), '{}')`

func scanChar(r pgx.Row) (api.Character, error) {
	var c api.Character
	err := r.Scan(&c.ID, &c.AccountID, &c.Slot, &c.Name, &c.Appearance, &c.Region, &c.CreatedAt,
		&c.LastPlayedAt, &c.RenamedAt, &c.OnlineWorld, &c.LeaseUntil, &c.SkillXP)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, api.ErrNotFound
	}
	if c.SkillXP == nil {
		c.SkillXP = map[string]int64{}
	}
	return c, err
}

func (s *Store) Characters(ctx context.Context, accountID string) ([]api.Character, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+charColumns+` FROM characters c
		WHERE c.account_id = $1 AND c.deleted_at IS NULL ORDER BY c.slot`, accountID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (api.Character, error) { return scanChar(r) })
}

func (s *Store) Character(ctx context.Context, accountID, id string) (api.Character, error) {
	return character(ctx, s.pool, accountID, id, "")
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// character reads one live character; lock is "" or "FOR UPDATE".
func character(ctx context.Context, q querier, accountID, id, lock string) (api.Character, error) {
	return scanChar(q.QueryRow(ctx, "SELECT "+charColumns+` FROM characters c
		WHERE c.id = $1 AND c.account_id = $2 AND c.deleted_at IS NULL `+lock, id, accountID))
}

// claim takes a name for a character if it's free, is already the character's, or its hold has run
// out. Two transactions claiming the same name queue on the row, so only one gets it.
func claim(ctx context.Context, tx pgx.Tx, name, characterID string, now time.Time) (bool, error) {
	var got string
	err := tx.QueryRow(ctx, `INSERT INTO character_names (name_lower, character_id) VALUES ($1, $2)
		ON CONFLICT (name_lower) DO UPDATE SET character_id = EXCLUDED.character_id, held_until = NULL
		WHERE character_names.character_id = EXCLUDED.character_id
		   OR (character_names.held_until IS NOT NULL AND character_names.held_until <= $3)
		RETURNING name_lower`, strings.ToLower(name), characterID, now).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) CreateCharacter(ctx context.Context, accountID string, slot int, name string, look api.Appearance, now time.Time) (api.Character, error) {
	if slot < 1 || slot > api.Slots {
		return api.Character{}, fmt.Errorf("slot %d out of range", slot)
	}
	var c api.Character
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO characters (account_id, slot, name, appearance, created_at)
			VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, accountID, slot, name, look, now).Scan(&id)
		if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "characters_slot" {
			return api.ErrSlotUsed
		} else if err != nil {
			return err
		}
		if ok, err := claim(ctx, tx, name, id, now); err != nil {
			return err
		} else if !ok {
			return api.ErrNameTaken
		}
		c, err = character(ctx, tx, accountID, id, "")
		return err
	})
	return c, err
}

func (s *Store) RenameCharacter(ctx context.Context, accountID, id, name string, now time.Time) (api.Character, error) {
	var c api.Character
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		old, err := character(ctx, tx, accountID, id, "FOR UPDATE OF c")
		if err != nil {
			return err
		}
		if old.Online(now) {
			return api.ErrOnline
		}
		if at := old.NextRename(now); !at.IsZero() {
			return &api.RenameTooSoonError{RetryAt: at}
		}
		if !strings.EqualFold(old.Name, name) {
			if ok, err := claim(ctx, tx, name, id, now); err != nil {
				return err
			} else if !ok {
				return api.ErrNameTaken
			}
			if _, err := tx.Exec(ctx, "UPDATE character_names SET held_until = $2 WHERE name_lower = $1",
				strings.ToLower(old.Name), now.Add(api.NameHold)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "UPDATE characters SET name = $2, renamed_at = $3 WHERE id = $1", id, name, now); err != nil {
			return err
		}
		c, err = character(ctx, tx, accountID, id, "")
		return err
	})
	return c, err
}

func (s *Store) DeleteCharacter(ctx context.Context, accountID, id string, now time.Time) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		c, err := character(ctx, tx, accountID, id, "FOR UPDATE OF c")
		if err != nil {
			return err
		}
		if c.Online(now) {
			return api.ErrOnline
		}
		if _, err := tx.Exec(ctx, "UPDATE characters SET deleted_at = $2 WHERE id = $1", id, now); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, "UPDATE character_names SET held_until = $3 WHERE name_lower = $2 AND character_id = $1",
			id, strings.ToLower(c.Name), now.Add(api.DeleteGrace))
		return err
	})
}

func (s *Store) Purge(ctx context.Context, now time.Time) (int, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "DELETE FROM characters WHERE deleted_at <= $1", now.Add(-api.DeleteGrace))
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
		_, err = tx.Exec(ctx, "DELETE FROM character_names WHERE held_until <= $1", now)
		return err
	})
	return int(n), err
}
