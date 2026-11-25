-- M1: worlds, characters and their names, skills (for levels in the character list), and the
-- deleted-accounts list. docs/architecture/backend.md, "Database".
-- Every time is set by the API (its own clock), never by now(), so tests control time.

CREATE TABLE worlds (
    id           integer PRIMARY KEY,
    name         text    NOT NULL UNIQUE,
    premium_only boolean NOT NULL DEFAULT false,
    max_players  integer NOT NULL CHECK (max_players > 0),
    -- The WebSocket path players connect to, for example /w/1.
    ws_path      text    NOT NULL
);

-- The test server's worlds (docs/design/worlds-and-premium.md). About 1,000 players per world is
-- the design target (ADR 0003).
INSERT INTO worlds (id, name, premium_only, max_players, ws_path) VALUES
    (1, 'World 1', false, 1000, '/w/1'),
    (2, 'World 2', true,  1000, '/w/2');

CREATE TABLE characters (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The platform account (its id); there's no accounts table here.
    account_id      uuid        NOT NULL,
    slot            smallint    NOT NULL CHECK (slot BETWEEN 1 AND 3),
    -- Display name; uniqueness is in character_names.
    name            text        NOT NULL,
    -- Appearance (S2): {bodyType, skinTone, hairStyle, hairColour, beard}, each a choice id.
    appearance      jsonb       NOT NULL DEFAULT '{}',
    -- Where the character last was. Persistence (a later M1 task) adds the position and HP.
    region          text,
    created_at      timestamptz NOT NULL,
    last_played_at  timestamptz,
    renamed_at      timestamptz,
    -- Soft delete: gone from the account at once, removed for good 7 days later.
    deleted_at      timestamptz,
    -- The online lease, kept by the world servers (persistence task).
    online_world_id integer     REFERENCES worlds (id),
    lease_until     timestamptz
);

-- One live character per slot. Deleted characters don't hold their slot.
CREATE UNIQUE INDEX characters_slot ON characters (account_id, slot) WHERE deleted_at IS NULL;
CREATE INDEX characters_account ON characters (account_id);
CREATE INDEX characters_deleted ON characters (deleted_at) WHERE deleted_at IS NOT NULL;

-- Names in use or reserved, case-insensitively unique. held_until is null for a character's current
-- name. After a rename the old name is held for that character for 30 days; after a delete the name
-- is held until the character is removed.
CREATE TABLE character_names (
    name_lower   text        PRIMARY KEY,
    character_id uuid        NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
    held_until   timestamptz
);
CREATE INDEX character_names_character ON character_names (character_id);

-- XP per skill. Levels are worked out from XP (data/progression.json).
CREATE TABLE character_skills (
    character_id uuid   NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
    skill        text   NOT NULL,
    xp           bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
    PRIMARY KEY (character_id, skill)
);

-- Accounts the platform told us were deleted. Their access tokens stay valid for up to 15 minutes,
-- so the API refuses these ids itself.
CREATE TABLE deleted_accounts (
    account_id uuid        PRIMARY KEY,
    deleted_at timestamptz NOT NULL
);
