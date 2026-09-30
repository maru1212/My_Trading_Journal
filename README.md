# TradeLog — Trading Journal

A full-stack trading journal: log trades, track P&L, and find out which setups actually make money.

Built with Next.js 16 (App Router, Server Actions), React 19, Tailwind CSS 4, Postgres on [Supabase](https://supabase.com) and Recharts. Deploys to [Vercel](https://vercel.com).

## Features

- **Accounts** — email + password sign-up, hashed with scrypt; database-backed sessions in an httpOnly cookie. Every trade is private to its owner.
- **Trade logging** — stocks, options, futures, forex, commodities (e.g. gold), crypto. Long/short, quantity, contract multiplier, entry/exit date and price, stop loss, take profit, fees, setup, tags, notes and a 1–5 execution rating. Leave the exit empty to keep a position open. Live P&L and R preview while you type.
- **Dashboard** — net P&L, % return, win rate, profit factor, expectancy, average win/loss, payoff ratio, largest win/loss, max drawdown, win/loss streaks, average hold time, fees; equity curve, daily P&L chart and P&L by symbol. Filter by 7D / 30D / 90D / YTD / All.
- **Trades list** — search, filter by symbol, setup, side, status and date range, with totals for the filtered set.
- **Calendar** — monthly P&L heatmap with weekly totals; click a day to see its trades.
- **Analytics** — breakdowns by setup, symbol, tag, day of week, hour of day, long vs short and asset class, plus an R-multiple distribution.
- **MetaTrader 5 sync**: connect with your account login, investor password and server. Trades are logged automatically. Details below.
- **CSV import / export** — import from a spreadsheet or broker export (validated row by row, all-or-nothing), export any filtered view.
- **Settings** — name, currency, starting balance (anchors the equity curve and drawdown), change password.
- Light and dark mode (follows your OS), responsive down to phone width.

## Setup: Supabase + Vercel

### 1. Create the database (Supabase)

1. Sign in at [supabase.com](https://supabase.com) → **New project**. Pick a region near you and **save the database password** you set.
2. Click **Connect** (top of the project page) → **Connection string** tab → choose **Transaction pooler** (port `6543`). Copy the URI and replace `[YOUR-PASSWORD]` with your database password. This is your `DATABASE_URL`.
3. Create the tables from the versioned migrations, from your computer (Node.js 20.9+):
   ```bash
   npm install
   DATABASE_URL="<the URI from step 2>" npm run db:migrate
   ```
   It prints `applied 0001_baseline.sql`. Don't paste SQL files into the SQL editor. That bypasses the migration history. See [Database migrations](#database-migrations).

> If your password contains special characters (`@`, `#`, `/`, `%`, …), URL-encode them, or reset the password to letters and numbers under **Project Settings → Database**.

### 2. Deploy (Vercel)

1. Sign in at [vercel.com](https://vercel.com) with GitHub → **Add New… → Project** → import this repository.
2. Leave the framework preset as **Next.js**. Open **Environment Variables** and add `DATABASE_URL` with the value from step 1.3, and `ALLOWED_SIGNUP_EMAILS` with your own email address.
3. Click **Deploy**. When it finishes, open `/signup` on your deployment, create your account with that email, and start logging trades.

Sign-up is **closed by default**. Only addresses in `ALLOWED_SIGNUP_EMAILS` can register, and the landing page doesn't link to sign-up. See [Access control](#access-control).

Changing `DATABASE_URL` later requires a redeploy (**Deployments → ⋯ → Redeploy**).

### Run it locally (optional)

Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env.local   # then paste your DATABASE_URL into .env.local
npm run db:migrate           # creates/updates the tables from supabase/migrations
npm run dev                  # http://localhost:3000
```

## MetaTrader 5 sync

MT5 has no web API of its own, so TradeLog uses [MetaApi](https://metaapi.cloud). It runs an MT5 terminal in the cloud for your account, and the app reads your history through it. No Expert Advisor is needed, and your computer doesn't have to be on.

**One-time setup (app owner)**

1. Create an account at [app.metaapi.cloud](https://app.metaapi.cloud) and copy your **API access token** (in the MetaApi dashboard, under API access).
2. In Vercel → **Settings → Environment Variables**, add:
   - `METAAPI_TOKEN`: the MetaApi token.
   - `CRON_SECRET`: any long random string. It lets the daily auto-sync run.
3. Redeploy. Make sure the database is up to date: `npm run db:status` (see [Database migrations](#database-migrations)).

**Connecting an account (in the app)**

**Settings → MetaTrader 5**: enter the MT5 **login** (account number), **investor password** and **server** (as shown in MT5 under *File → Login to Trade Account*), choose how much history to import, and click **Connect MT5**. The cloud terminal takes 1–3 minutes to start, then the first sync runs automatically.

- **Sync now** is on the Settings and Trades pages. A cron job (`vercel.json`) also syncs every connected account once a day.
- Use the **investor (read-only) password**. It can read trades but can't trade. TradeLog passes it to MetaApi when connecting and never stores it.
- Deals are grouped into positions (partial closes are volume-weighted). P&L is the broker's figure in your account currency: profit + commission + swap.
- Syncing is idempotent: positions are matched by account and position ID. Your setup, tags, notes and rating are never overwritten.
- **Disconnect** removes the cloud terminal from MetaApi (which stops its billing). Trades already synced stay.
- MetaApi is a paid third-party service; see their pricing. Each connected account uses one MetaApi account.
- For local development without MetaApi, set `METAAPI_TOKEN=mock` to use a fake account with sample trades. The mock works under `npm run dev` and in tests. In production (`next start`, Vercel) it is refused unless `ALLOW_MT5_MOCK=true`.

## Sample data

Two 60-trade files in [`samples/`](samples) to try the importer (**Trades → Import**):

- `sample-60-forex-gold.csv` — EURUSD, GBPUSD, AUDUSD, NZDUSD and XAUUSD. Quantity is in lots, with multiplier 100,000 per forex lot and 100 oz per gold lot, so P&L is in USD. Net P&L: **+$7,416.50**.
- `sample-60-trades.csv` — US stocks. Net P&L: **+$4,017.70**.

For forex, enter lots as quantity and the contract size as multiplier (100000 standard, 10000 mini, 1000 micro). P&L is in the pair's quote currency, so USD-quoted pairs match a USD account directly.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | All tests. Database tests run when `DATABASE_URL_TEST` is set ([Testing](#testing)) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run db:status` | Show migration status. Read-only |
| `npm run db:migrate` | Apply pending migrations. Also creates a new database. Safe to re-run (`db:setup` is an alias) |
| `npm run db:adopt` | Bring a database created by the old `schema.sql` under migration management ([details](#adopting-an-existing-database)) |

## Database migrations

The schema is managed by ordered, immutable SQL files in `supabase/migrations/`, named `NNNN_snake_case.sql` (`0001_baseline.sql` is the initial schema). The runner (`scripts/lib/migrator.mjs`, no extra dependencies) records every migration in a `schema_migrations` table: version, name, SHA-256 checksum, `applied` or `adopted`, time and duration.

- Each migration runs in **its own transaction** and is recorded in that same transaction. A failure rolls back the whole migration and records nothing.
- Runners take a **per-schema advisory lock** (`pg_advisory_xact_lock`), so concurrent runs apply each migration exactly once. The lock is transaction-scoped, so it also works through Supabase's transaction pooler.
- Before doing anything, the runner checks history against the files. It **stops** if an applied file was edited (checksum), renamed or deleted, or if an unapplied migration is numbered below the latest applied one. It never skips or marks anything silently.
- Files may not contain `BEGIN`/`COMMIT` or `CONCURRENTLY` (they can't run inside the runner's transaction). Bad names and duplicate versions are errors.

All commands read `DATABASE_URL` (from `.env.local` if present) and print the target host and database, never the password:

| Command | Effect | Exit code |
| --- | --- | --- |
| `npm run db:status` | Lists each migration as `applied`, `adopted`, `pending` or a problem. Read-only | 0 up to date · 3 pending · 4 unmanaged (needs adopt) · 1 problem |
| `npm run db:migrate` | Applies pending migrations in order. On an empty database, creates everything | 0 · 1 on error |
| `npm run db:adopt -- --check` | Validates a legacy database for adoption. Read-only | 0 adoptable · 1 not |
| `npm run db:adopt` | Adopts a legacy database (see below) | 0 · 1 |

**Adding a migration:** create the next number, e.g. `supabase/migrations/0002_add_trading_accounts.sql`, containing plain SQL without `BEGIN`/`COMMIT`. Run the tests (they build every test schema from the migrations), then `npm run db:migrate`. Never edit a migration after it has been applied anywhere; add a new one instead.

### Fresh database

`npm run db:migrate` against an empty database creates the tables and records `0001` as `applied`. Running it again prints "Already up to date".

### Adopting an existing database

Databases created before migrations existed (by pasting or re-running the old `supabase/schema.sql`) have tables but no history. `db:migrate` refuses to touch them (`UNMANAGED_SCHEMA`) rather than risk re-running the baseline. Adopt them instead.

Adoption **never changes application tables or data**. It compares the live schema with a fingerprint of `0001_baseline.sql`: every column (type, nullability, default, identity), constraint, index, row-level-security flag, policy and trigger. The fingerprint is built in a temporary schema inside a transaction that is always rolled back. If everything matches, adoption records `0001` as **`adopted`** (not `applied`) without running it. Any difference stops it with a list of what differs, and nothing is written.

1. **Back up** the database (Supabase → Database → Backups, or `pg_dump`).
2. `DATABASE_URL=… npm run db:status` should say `unmanaged`.
3. `DATABASE_URL=… npm run db:adopt -- --check`, then act on the result:
   - **"can be adopted"**: go to step 4.
   - **`LEGACY_EXTRAS`**: the database also has `users.api_key_hash`, `users.api_key_hint` and index `users_api_key_idx`, left over from the old Expert Advisor version. They're unused and harmless. Adopt with `npm run db:adopt -- --allow-legacy-extras`. They're kept, and the adoption notes list them.
   - **`INCOMPATIBLE_SCHEMA` with only `missing:` lines for MT5 columns** (`metaapi_account_id`, `mt5_*`, `source`, `external_id`, `broker_pnl`, `trades_external_idx`): the database was created by an older `schema.sql`. Review [`supabase/legacy/schema.sql`](supabase/legacy/schema.sql) (additive, `IF NOT EXISTS`, drops nothing), run it once in the Supabase SQL editor, then repeat step 3.
   - **Anything else** (`different:`, `unexpected:`, missing tables): stop. The database was changed by hand. Reconcile it manually and don't force adoption.
4. `DATABASE_URL=… npm run db:adopt`, then `npm run db:status`. It should say `0001 baseline adopted … Up to date`. From then on use only `npm run db:migrate`.

`supabase/legacy/schema.sql` is **frozen**. Its only role is step 3's upgrade of old databases before adoption. Never run it on a managed database, and never change the schema through it. A test checks that it and the migrations produce identical schemas.

## Testing

`npm test` runs every test file under `src/`. It includes unit tests for P&L math, stats, validation, redirects and the MT5 mapping. It also includes database tests against real Postgres for trades, sessions/auth and the MT5 sync upsert.

**Database tests** need a disposable Postgres in `DATABASE_URL_TEST`:

```bash
# e.g. a local Postgres, or: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/postgres npm test
```

- Each database suite creates its own schema, `jt_<suite>_<random>`, and builds it by running the migrations in `supabase/migrations`. Tables are truncated before every test, and the schema is dropped (by that exact name) when the suite finishes. Nothing outside it is read or written.
- Tests never use `DATABASE_URL`: it is removed from the test process (`src/test/setup.ts`). A `DATABASE_URL_TEST` equal to `DATABASE_URL`, or on a Supabase host, is refused unless `ALLOW_REMOTE_TEST_DB=1`.
- Without `DATABASE_URL_TEST`, database suites are **skipped** locally: the summary counts them as skipped, and `--reporter=verbose` labels them `(set DATABASE_URL_TEST to run)`. With `CI=true` or `REQUIRE_DB_TESTS=1` they **fail** instead. If the database is unreachable they fail with "Cannot reach the test database".
- MetaApi is replaced by the built-in mock bridge, and Next's `cookies()`/`redirect()` by in-memory stand-ins. Everything else runs for real.
- A crashed run can leave a `jt_…` schema behind. List them with `select nspname from pg_namespace where nspname like 'jt\_%';`.

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request. It uses Node 22, `npm ci` and a throwaway `postgres:16` service. It runs `migrate` twice (the second run must be a no-op) and `status`, then `npm test` with database tests required, lint, typecheck and build. It uses no secrets and doesn't deploy.

## Environment variables

| Name | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase transaction-pooler connection string |
| `METAAPI_TOKEN` | for MT5 | MetaApi API access token (`mock` for local testing) |
| `CRON_SECRET` | for daily MT5 sync | Any long random string; Vercel Cron sends it to `/api/cron/mt5-sync` |
| `ALLOWED_SIGNUP_EMAILS` | to create accounts | Comma-separated emails allowed to register, e.g. `me@example.com`. Matching ignores case and surrounding spaces. Unset or empty: nobody can register |
| `ALLOW_SIGNUP` | no (default closed) | `true` opens registration to **anyone** and shows sign-up links. Any other value, or unset, keeps it closed |
| `ALLOW_MT5_MOCK` | no | `true` allows `METAAPI_TOKEN=mock` in production. Default: the mock only runs in development/test |
| `DATABASE_URL_TEST` | tests only | Disposable Postgres for the database tests (see [Testing](#testing)). Never your production database |
| `REQUIRE_DB_TESTS` | tests only | `1` makes database tests fail instead of skip when `DATABASE_URL_TEST` is missing. CI sets it; `CI=true` has the same effect |

## How P&L is calculated

- **Net P&L** = (exit − entry) × quantity × multiplier × (1 for long, −1 for short) − fees
- **R-multiple** = net P&L ÷ (|entry − stop| × quantity × multiplier)
- **Win rate** excludes break-even trades.
- **Profit factor** = gross profit ÷ gross loss. **Expectancy** = net P&L ÷ closed trades.
- **Max drawdown** is the largest peak-to-trough fall of the equity curve, starting from your starting balance.
- Dates are stored as entered (your local time). Daily and calendar figures use the day a trade closed.

## Access control

This is a private journal, so registration is **closed unless you open it**:

| Setting | Who can sign up | Sign-up links on landing/login pages | `/signup` page |
| --- | --- | --- | --- |
| Neither variable set (default) | Nobody | Hidden | "Sign-ups are closed" |
| `ALLOWED_SIGNUP_EMAILS=me@example.com` | Only listed addresses | Hidden | Form. Other emails are refused |
| `ALLOW_SIGNUP=true` | Anyone | Shown | Form |

- The check runs inside the server-side sign-up action, so hiding the page isn't what protects it. Calls made directly to the action are refused too.
- The allowlist is read only on the server and never sent to the browser.
- Existing accounts can always sign in, whatever these settings are.
- **Production:** keep `ALLOW_SIGNUP` unset. Every account shares your MetaApi token (and its bill) and your database, so an open sign-up lets strangers use both. After creating your account you can remove `ALLOWED_SIGNUP_EMAILS` to close registration completely. Changes take effect after a redeploy.

## Security notes

- Passwords are hashed with scrypt; sessions are random tokens stored hashed, sent as an httpOnly cookie.
- Changing your password signs out every other session (other browsers and devices). The session you changed it from stays signed in.
- After sign-in you are only sent back to a path on this site. External, protocol-relative, backslash, encoded and control-character redirects fall back to `/dashboard` (`src/lib/safe-next-path.ts`).
- The app talks to Postgres directly with `DATABASE_URL` (server-side only). Row-level security is enabled on all tables with no policies, so Supabase's public REST API cannot read them even with the anon key.
- Keep `DATABASE_URL` secret. Never commit `.env.local`.

## Project layout

```
src/
  app/
    (auth)/             login, signup
    (app)/              dashboard, trades, calendar, analytics, settings (signed-in only)
    actions/            server actions (auth, trades, settings)
    api/trades/export/  CSV export
    page.tsx            landing page
  components/           UI, charts, forms
  lib/
    db.ts               Postgres connection pool
    auth.ts             passwords and sessions
    trades.ts           trade queries
    trade-math.ts       per-trade P&L, R, return
    stats.ts            summary stats, equity curve, breakdowns
    validation.ts       zod schemas
  proxy.ts              redirects signed-out users away from app pages
supabase/migrations/    versioned SQL migrations (0001_baseline.sql = initial schema)
supabase/legacy/        frozen pre-migration schema.sql (only for adopting old databases)
scripts/migrate.mjs     migration CLI (status / migrate / adopt)
scripts/lib/migrator.mjs  migration runner, history checks, adoption validation
```
