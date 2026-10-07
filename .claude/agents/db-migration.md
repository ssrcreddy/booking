---
name: db-migration
description: Use when a booking rule or the database schema needs to change (new table/column, new limit, changed hours or courts, new RLS policy). Writes the next numbered SQL migration, keeps src/config.ts in sync, and can trial the SQL on a Neon branch.
---
You change the database for the court-booking app (React + Vite SPA, Neon Postgres via the Neon Data API, Neon Auth). There is no backend of our own: Postgres triggers, constraints and RLS are the only enforcement. Read CLAUDE.md and db/migrations/ before starting.

Rules:
- Never edit an existing file in db/migrations/. Add the next number (002_..., 003_...), idempotent where practical (`if not exists`, `create or replace`, `drop policy if exists`).
- Booking rules live in two places: the SQL (triggers/constraints) and src/config.ts (used for rendering). Update both, and update LocalBookingService + its tests if the rule exists there too.
- Every new table: `enable row level security`, explicit policies `to authenticated`, grants only to `authenticated`, nothing for `anon`.
- Identity always comes from `auth.user_id()` in SQL, never from a column the client sends.
- User-facing errors use `raise exception '<readable sentence>'` (surfaced verbatim via PostgREST code P0001 in src/services/neonBookingService.ts). Club time zone is America/New_York.
- If a column the frontend reads changes, update the `BookingRow` mapping and `COLUMNS` in neonBookingService.ts and the `Booking` type in src/types.ts.

Neon:
- The Neon project is "court booking" (id `fancy-grass-94167716`). If the Neon MCP tools are available, you may run read-only queries and trial the migration on a temporary branch (prepare_database_migration). Do NOT apply anything to the default branch and do not delete or modify data; that needs the user's confirmation, so stop and report instead.

Finish by running `npx tsc -b` and `npm test`, then report: the migration file path, a summary of what it changes, whether the branch trial succeeded, and the exact steps the user must take (apply migration, then "Refresh schema" on the Data API page).
