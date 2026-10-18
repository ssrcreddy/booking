# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                  # Vite dev server on http://localhost:5173 (needs .env.local)
npm test                     # Vitest, run once (jsdom environment)
npx vitest run -t "caps bookings"   # run a single test by name
npx tsc -b                   # type-check only (there is no linter)
npm run build                # tsc -b && vite build
```

`.env.local` (git-ignored; template in `.env.example`) must define `VITE_NEON_AUTH_URL` (host contains `.neonauth.`) and `VITE_NEON_DATA_API_URL` (host contains `.apirest.`, path ends `/rest/v1`). If they are missing, the app renders a "Neon isn't configured" screen instead of crashing. A common misconfiguration is pointing the Data API URL at the `neonauth` host, which makes every query return 404 "Route … not found".

## Architecture

A static React 19 + Vite SPA with **no backend of our own**. The browser talks directly to Neon:

- **Neon Auth** (managed Better Auth): email/password and Google sign-in.
- **Neon Data API** (PostgREST-style): reads and writes `public.bookings`. The user's JWT is attached automatically.

Both go through the single client in `src/lib/neon.ts` (`createClient` from `@neondatabase/neon-js`, currently a 0.x beta).

**The database is the source of truth for every booking rule and for authorization.** `db/migrations/001_bookings.sql` defines:
- the `bookings` table, with a unique constraint `(court_id, date, hour)` and check constraints for courts c1–c4 and hours 7–20;
- a `SECURITY DEFINER` `BEFORE INSERT` trigger. It forces `user_id := auth.user_id()`, copies the display name from `neon_auth."user"`, and enforces the no-past-slots rule, the 14-day window and the max-2-per-day rule, all in `America/New_York`;
- a `BEFORE DELETE` trigger that blocks cancelling a slot that has already started;
- RLS policies: any authenticated user can select, but insert and delete only their own rows. There is no update policy.

Trigger exceptions come back as PostgREST code `P0001`. `neonBookingService.ts` maps `P0001` → `BookingError(message)`, `23505` → "slot taken", and `42501` → "not allowed". The UI shows `BookingError` messages verbatim.

`src/config.ts` mirrors the DB rules (courts, hours, window, per-day cap) for rendering only. **Changing a rule means changing both the SQL and `config.ts`.** Schema changes go in a new numbered file in `db/migrations/`, which the user runs in the Neon SQL editor and follows with "Refresh schema" on the Data API page. Nothing applies migrations automatically.

### Booking assistant (the one server-side piece)
`server/bookingAgent.ts` is the endpoint for a chat agent with two tools, `get_availability` and `book_court`. The provider-neutral parts (prompt, tool schemas, tool code, Data API calls) are in `server/bookingTools.ts`. Each AI provider implements `AgentProvider` (`server/agentProvider.ts`) with just its model loop; today that is only `server/providers/claude.ts` (`@anthropic-ai/sdk`, manual tool-use loop), chosen in `bookingAgentHandlerFromEnv`. `server/bookingAgent.test.ts` tests the endpoint and tools with a scripted fake provider. It needs `ANTHROPIC_API_KEY` in `.env.local` (no `VITE_` prefix, so it never reaches the browser). The browser (`src/components/BookingAssistant.tsx`) POSTs `{history, message}` to `/api/booking-agent` with the player's Neon Auth JWT, and the agent calls the Data API **with that JWT**, so triggers and RLS still decide everything. Locally the endpoint is served by a Vite plugin in `vite.config.ts` (`npm run dev` / `vite preview`); on Vercel by the function `api/booking-agent.ts` (timeout in `vercel.json`). Both wrap the same web-standard `Request → Response` handler. Vercel runs the function as Node ESM, so relative imports reachable from `api/` need `.js` extensions (type-only imports are exempt). The conversation state (`history`) round-trips through the browser. `BOOKING_ASSISTANT_ENABLED` in `src/config.ts` is the admin kill switch: `false` hides the panel and makes the endpoint return 403.

### Data flow
- `App.tsx` wraps everything in `AuthProvider` (`src/auth/`). `Gate` picks one of three screens: not configured, `AuthScreen`, or `Schedule`.
- The UI only uses the `BookingService` interface (`src/services/bookingService.ts`). The concrete instance is chosen in `src/services/index.ts` (currently `NeonBookingService`).
- Identity is never passed to the service; it comes from the auth session/JWT. "Mine" is determined by comparing `booking.userId` with the session user id.
- `useBookings` refetches when the window regains focus and every 30 s. There is no realtime subscription.
- Dates are `YYYY-MM-DD` strings in browser-local time (`src/dateUtils.ts`). The DB evaluates time rules in `America/New_York`.

### Tests
`LocalBookingService` is a localStorage implementation of the same interface and rules, with injectable `getUser`, `storage` and `now`. It is not used by the app; it exists as the fake for unit tests (`localBookingService.test.ts`). The real rules live in SQL and have no automated tests.
