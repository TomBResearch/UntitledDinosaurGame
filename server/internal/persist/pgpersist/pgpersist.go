// Package pgpersist is the world server's Postgres store (persist.Store), using pgx. The world logs
// in as the udg_world role, which can only read and write what's used here (server/migrations, ADR
// 0017).
package pgpersist

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/persist"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/proto"
)

// Store implements persist.Store.
type Store struct {
	pool *pgxpool.Pool
}

// New wraps a pool. The API applies the migrations; the world never does.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ persist.Store = (*Store)(nil)

// WorldExists reports whether the worlds table has this id. A world checks it when it starts.
func (s *Store) WorldExists(ctx context.Context, world int) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM worlds WHERE id = $1)", world).Scan(&ok)
	return ok, err
}

func (s *Store) Claim(ctx context.Context, c persist.Claim) (persist.Character, error) {
	var out persist.Character
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Locking every row of the account (in id order, so two claims can't deadlock) makes claims
		// for one account take turns: only one can find no lease and take one. The API's renames and
		// deletes lock the character's row too.
		rows, err := tx.Query(ctx, `SELECT id::text, deleted_at IS NOT NULL, coalesce(region, ''), pos_x, pos_y, pos_z, hp,
				online_world_id IS NOT NULL AND lease_until > $2
			FROM characters WHERE account_id = $1 ORDER BY id FOR UPDATE`, c.AccountID, c.Now)
		if err != nil {
			return err
		}
		found, online := false, false
		for rows.Next() {
			var (
				id, region      string
				deleted, leased bool
				x, y, z, hp     *int32
			)
			if err := rows.Scan(&id, &deleted, &region, &x, &y, &z, &hp, &leased); err != nil {
				rows.Close()
				return err
			}
			online = online || leased
			if id == c.CharacterID && !deleted {
				found = true
				out = persist.Character{ID: id, AccountID: c.AccountID, Region: region, HP: persist.HPFull}
				if x != nil && y != nil && z != nil {
					out.Pos = &proto.Pos{X: *x, Y: *y, Z: *z}
				}
				if hp != nil {
					out.HP = *hp
				}
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		switch {
		case !found:
			return persist.ErrNotFound
		case online:
			return persist.ErrOnline
		}
		_, err = tx.Exec(ctx, "UPDATE characters SET online_world_id = $2, lease_until = $3, lease_id = $4 WHERE id = $1",
			c.CharacterID, c.World, c.Until, c.Lease)
		return err
	})
	if err != nil {
		return persist.Character{}, err
	}
	return out, nil
}

// hp is HP for the database: null for full.
func hp(v int32) *int32 {
	if v == persist.HPFull {
		return nil
	}
	return &v
}

func (s *Store) Write(ctx context.Context, world int, saves []persist.Save, now, until time.Time) ([]string, error) {
	var lost []string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		lost = lost[:0]
		b := &pgx.Batch{}
		for _, sv := range saves {
			var leaseUntil *time.Time
			if !sv.Release {
				leaseUntil = &until
			}
			if sv.LeaseOnly {
				b.Queue(`UPDATE characters SET
						online_world_id = CASE WHEN $4 THEN NULL ELSE online_world_id END,
						lease_id = CASE WHEN $4 THEN NULL ELSE lease_id END,
						lease_until = $5
					WHERE id = $1 AND lease_id = $2 AND online_world_id = $3`,
					sv.CharacterID, sv.Lease, world, sv.Release, leaseUntil)
				continue
			}
			b.Queue(`UPDATE characters SET
					region = $6, pos_x = $7, pos_y = $8, pos_z = $9, hp = $10, last_played_at = $11,
					online_world_id = CASE WHEN $4 THEN NULL ELSE online_world_id END,
					lease_id = CASE WHEN $4 THEN NULL ELSE lease_id END,
					lease_until = $5
				WHERE id = $1 AND lease_id = $2 AND online_world_id = $3`,
				sv.CharacterID, sv.Lease, world, sv.Release, leaseUntil,
				sv.Region, sv.Pos.X, sv.Pos.Y, sv.Pos.Z, hp(sv.HP), now)
		}
		res := tx.SendBatch(ctx, b)
		for _, sv := range saves {
			tag, err := res.Exec()
			if err != nil {
				_ = res.Close()
				return err
			}
			if tag.RowsAffected() == 0 {
				lost = append(lost, sv.CharacterID)
			}
		}
		return res.Close()
	})
	if err != nil {
		return nil, err
	}
	return lost, nil
}

func (s *Store) Renew(ctx context.Context, world int, leases []string, until time.Time) ([]string, error) {
	rows, err := s.pool.Query(ctx, `UPDATE characters SET lease_until = $3
		WHERE online_world_id = $1 AND lease_id = ANY($2::uuid[]) RETURNING lease_id::text`, world, leases, until)
	if err != nil {
		return nil, err
	}
	kept, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	have := make(map[string]bool, len(kept))
	for _, l := range kept {
		have[l] = true
	}
	var lost []string
	for _, l := range leases {
		if !have[l] {
			lost = append(lost, l)
		}
	}
	return lost, nil
}

func (s *Store) ReleaseWorld(ctx context.Context, world int) (int, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE characters SET online_world_id = NULL, lease_until = NULL, lease_id = NULL
		WHERE online_world_id = $1`, world)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
