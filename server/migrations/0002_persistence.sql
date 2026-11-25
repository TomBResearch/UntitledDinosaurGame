-- M1 persistence: where a character stands, its HP, and the online lease's id. Plus udg_world, the
-- database role the world servers log in as, which can only read and write what a world needs.
-- docs/architecture/world-server.md, "Saving characters", and ADR 0017.

-- Position in whole centimetres from the region's origin (the protocol's pos), in characters.region.
-- All three are null until the first save: the character starts at a spawn point.
-- hp is null for full HP. Nothing changes HP until combat (M3), which also defines maximum HP.
-- lease_id is the online lease's token: a random id the world picks when it takes the lease. A
-- world only saves, renews or releases a lease whose id it holds, so a world that lost its lease
-- (it stalled past lease_until and another world took the character) can't overwrite anything.
ALTER TABLE characters
    ADD COLUMN pos_x    integer,
    ADD COLUMN pos_y    integer,
    ADD COLUMN pos_z    integer,
    ADD COLUMN hp       integer CHECK (hp >= 0),
    ADD COLUMN lease_id uuid,
    ADD CONSTRAINT characters_pos_all_or_none
        CHECK ((pos_x IS NULL) = (pos_y IS NULL) AND (pos_y IS NULL) = (pos_z IS NULL));

-- A starting world releases every lease it held before a crash; renewals find leases by id.
CREATE INDEX characters_online_world ON characters (online_world_id) WHERE online_world_id IS NOT NULL;
CREATE INDEX characters_lease ON characters (lease_id) WHERE lease_id IS NOT NULL;

-- The world servers' role. It's made without a password, so it can't log in until the API sets one
-- from WORLD_DB_PASSWORD when it starts (migrations.SetWorldPassword). Roles belong to the whole
-- Postgres server, not one database, so it may already exist.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'udg_world') THEN
        CREATE ROLE udg_world NOLOGIN;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO udg_world', current_schema());
END
$$;

-- A world reads a character to load it and to check the account's other leases, and writes only its
-- position, region, HP, last played time and the lease. It can't see or change names, appearance,
-- skills, slots or deletions, and it can't read any other table except the world ids.
GRANT SELECT (id, account_id, deleted_at, region, pos_x, pos_y, pos_z, hp, online_world_id, lease_until, lease_id)
    ON characters TO udg_world;
GRANT UPDATE (region, pos_x, pos_y, pos_z, hp, last_played_at, online_world_id, lease_until, lease_id)
    ON characters TO udg_world;
GRANT SELECT (id) ON worlds TO udg_world;
