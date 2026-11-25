# 0016: Backend API: pgx, built-in migrations, and token checks with the standard library

**Status:** Proposed (2026-11-25)

## Context

The backend API (`cmd/api`, [backend.md](../architecture/backend.md)) is the first Go code to use a database, and the first to check the platform's access tokens. That needs three choices:
- a Postgres library;
- a way to run migrations;
- a way to verify EdDSA (Ed25519) JWTs against the platform's JWKS.

The server so far has two dependencies, and keeping it lean matters ([ADR 0003](0003-go-server.md)). The fast check must stay at a few seconds with no database ([ADR 0009](0009-fast-ci.md)).

## Decision

- **Postgres: [`github.com/jackc/pgx/v5`](https://github.com/jackc/pgx)** (v5.13), with its connection pool, `pgxpool`. It's the standard Go Postgres driver: maintained, fast, and it maps `jsonb`, `uuid` and `timestamptz` without extra code. It brings five small modules with it: `pgpassfile`, `pgservicefile`, `puddle`, `golang.org/x/sync` and `golang.org/x/text`.
- **Migrations: our own runner** (`server/migrations`, about 100 lines). Numbered SQL files are built into the API binary with `go:embed` and applied at start, each in a transaction, under a Postgres advisory lock, recorded in `schema_migrations`. Migrations only go forward: a mistake is fixed by a new file.
- **Tokens: the standard library** (`crypto/ed25519`, `encoding/json`) in `internal/platform`, about 150 lines. Only `alg: EdDSA` is accepted, then the key id, signature, `iss`, `aud`, `exp` and `nbf` are checked. Key cache: 5 minutes, refetching for an unknown key id at most every 30 s, and keeping old keys if a fetch fails.
- **Fast tests without a database:** an in-memory store (`api.MemStore`) with the same rules as the Postgres store. One contract test suite (`internal/api/storetest`) runs against the memory store in the fast check, and against a real Postgres 17 in the slow lane, so the two can't drift apart.

## Consequences

- One new direct dependency (pgx). Its version is pinned in `go.mod`.
- No migration tool to install: `go run ./cmd/api` brings a fresh database up to date. There are no down-migrations; rolling back means restoring a backup or writing a new migration.
- Our token code is security-critical, so its negative tests (wrong key, `alg: none`, `alg: HS256`, tampered claims, wrong issuer or audience, expired, unknown key id) are part of the fast check.
- Handler tests stay fast (no Docker), but a store bug that only shows in SQL is caught nightly, not on every push. Run `tools/slow-tests.sh` before pushing a change to `pgstore` or a migration.

## Rejected

- **`database/sql` with `lib/pq`:** `lib/pq` is in maintenance mode, and `database/sql` needs more code for `jsonb` and arrays.
- **sqlc or an ORM (GORM, ent):** code generation or a large dependency for a handful of queries. Worth another look if the query count grows a lot.
- **`golang-migrate` or `goose`:** both work, but each pulls in more dependencies (or a CLI to install) for what is a loop over files in a transaction.
- **A JWT library (`golang-jwt/jwt`, `lestrrat-go/jwx`):** they would still need our own JWKS cache, and their flexibility (many algorithms) is what has to be locked down. The standard library does Ed25519 directly.
- **Postgres in the fast check** (a CI service container, or testcontainers): adds start-up time and Docker to every push, against ADR 0009.
