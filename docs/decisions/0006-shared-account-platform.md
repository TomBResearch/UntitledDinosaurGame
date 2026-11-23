# 0006: Use the shared account platform, integrated through config only

**Status:** Accepted (2026-11-23)

## Context

The owner already runs an account platform (`TomBResearch/UntitledAccountSystem`, at `accounts.untitledgames.co.uk`) for Untitled Racing Game. It covers accounts, global roles, Premium, bans, friends and reports. The owner wants one account across all their games, with Premium and moderator status shared. That platform must keep working unchanged for the racing game.

## Decision

- This game **uses the platform as is**. No platform code changes are needed. Details: [architecture/accounts.md](../architecture/accounts.md).
- **Game data stays in this game's own database:** characters (3 slots per account), skills, inventory, bank, quests. The platform holds no game data, by design.
- **Three additive config changes** on the platform's container, which is deployed from the racing repo's `infra/production/docker-compose.yml`:
  1. Add `https://dinosaur.untitledgames.co.uk` to `ALLOWED_ORIGINS`.
  2. Add `dinosaur=<secret>` to `SERVICE_KEYS`.
  3. Add `dinosaur=http://udg-api:3000/internal/players/{id}` to `DELETION_HOOKS`. **Add this only after this game's deletion endpoint is deployed and answering `204`.** Otherwise every account deletion, including racing players', fails with `503`.
- The changes are made as a PR to the racing repo, and the racing game's login and deletion are checked afterwards.

## Consequences

- Role and Premium checks use the platform's service API for anything that must be current: joining a premium world, staff actions, bans.
- **Gaps that affect every game**, tracked in [open-questions.md](../open-questions.md):
  - Verification and reset emails used to link to the racing site. They're moving to generic pages on the accounts domain ([accounts.md](../architecture/accounts.md#known-gaps-affect-every-game)).
  - Production email is still Mailpit (deferred), so playtesters can't verify themselves. Staff verify them by hand until real email is set up.

## Rejected

- **Accounts inside this game:** two logins for the owner's players, and no shared Premium or moderator status.
- **Moving the platform into its own stack now:** a good idea eventually, but it disrupts the racing game for no benefit today.
