# Court Booking

Book 1-hour tennis court slots at a single club. It's a React + Vite app that uses Neon Postgres, the Neon Data API and Neon Auth. There is no custom server: the browser calls the Data API with the signed-in user's JWT, and Postgres enforces the rules with row-level security and triggers.

## One-time Neon setup

1. Create a project at https://console.neon.tech.
2. **Auth**: open your project, then **Auth**, and enable Neon Auth.
   - Email/password and Google are available. Google uses Neon's shared development credentials until you add your own.
   - Under the Auth settings, add `http://localhost:5173` to **trusted domains**. Add your production URL later.
3. **Data API**: open **Data API**, enable it, and choose **Neon Auth** as the auth provider.
4. **Schema**: open the **SQL Editor**, paste [db/migrations/001_bookings.sql](db/migrations/001_bookings.sql), and run it. Then click **Refresh schema** on the Data API page.
5. **Env vars**: copy `.env.example` to `.env.local` and fill in:
   - `VITE_NEON_AUTH_URL`: the Auth URL from the Auth page.
   - `VITE_NEON_DATA_API_URL`: the URL shown on the Data API page.

## Run

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests (booking rules on the in-memory fake)
npm run build
```

## Where the rules live

The database is the source of truth:

| Rule | Enforced by |
| --- | --- |
| One booking per court + slot | `unique (court_id, date, hour)` |
| Courts c1–c4, hours 07–20 | `check` constraints |
| No past slots; 14-day window (America/New_York) | `bookings_before_insert` trigger |
| Max 2 bookings per user per day | same trigger, with an advisory lock |
| Booking owner/name come from the JWT, not the client | same trigger (`auth.user_id()`, `neon_auth."user"`) |
| Everyone signed in can see the schedule | RLS `select` policy |
| Only the owner can cancel, and only before the slot starts | RLS `delete` policy + `bookings_before_delete` trigger |

`src/config.ts` mirrors these values for the UI. If you change a rule, change it in both places.

## Production notes

- Google sign-in: create a Google OAuth client with the redirect URI `{VITE_NEON_AUTH_URL}/callback/google`, then add the client ID and secret under Neon **Auth → OAuth providers**.
- Add your deployed origin to Neon Auth's trusted domains.
