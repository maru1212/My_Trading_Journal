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
2. When the project is ready, open **SQL Editor** → **New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success. No rows returned".
3. Click **Connect** (top of the project page) → **Connection string** tab → choose **Transaction pooler** (port `6543`). Copy the URI and replace `[YOUR-PASSWORD]` with your database password. This is your `DATABASE_URL`.

> If your password contains special characters (`@`, `#`, `/`, `%`, …), URL-encode them, or reset the password to letters and numbers under **Project Settings → Database**.

### 2. Deploy (Vercel)

1. Sign in at [vercel.com](https://vercel.com) with GitHub → **Add New… → Project** → import this repository.
2. Leave the framework preset as **Next.js**. Open **Environment Variables** and add `DATABASE_URL` with the value from step 1.3.
3. Click **Deploy**. When it finishes, open the URL, create an account and start logging trades.

Changing `DATABASE_URL` later requires a redeploy (**Deployments → ⋯ → Redeploy**).

### Run it locally (optional)

Requires Node.js 20.9+.

```bash
npm install
cp .env.example .env.local   # then paste your DATABASE_URL into .env.local
npm run db:setup             # applies supabase/schema.sql (same as step 1.2)
npm run dev                  # http://localhost:3000
```

## MetaTrader 5 sync

MT5 has no web API of its own, so TradeLog uses [MetaApi](https://metaapi.cloud). It runs an MT5 terminal in the cloud for your account, and the app reads your history through it. No Expert Advisor is needed, and your computer doesn't have to be on.

**One-time setup (app owner)**

1. Create an account at [app.metaapi.cloud](https://app.metaapi.cloud) and copy your **API access token** (in the MetaApi dashboard, under API access).
2. In Vercel → **Settings → Environment Variables**, add:
   - `METAAPI_TOKEN`: the MetaApi token.
   - `CRON_SECRET`: any long random string. It lets the daily auto-sync run.
3. Redeploy. Re-run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor if you haven't since the MT5 update.

**Connecting an account (in the app)**

**Settings → MetaTrader 5**: enter the MT5 **login** (account number), **investor password** and **server** (as shown in MT5 under *File → Login to Trade Account*), choose how much history to import, and click **Connect MT5**. The cloud terminal takes 1–3 minutes to start, then the first sync runs automatically.

- **Sync now** is on the Settings and Trades pages. A cron job (`vercel.json`) also syncs every connected account once a day.
- Use the **investor (read-only) password**. It can read trades but can't trade. TradeLog passes it to MetaApi when connecting and never stores it.
- Deals are grouped into positions (partial closes are volume-weighted). P&L is the broker's figure in your account currency: profit + commission + swap.
- Syncing is idempotent: positions are matched by account and position ID. Your setup, tags, notes and rating are never overwritten.
- **Disconnect** removes the cloud terminal from MetaApi (which stops its billing). Trades already synced stay.
- MetaApi is a paid third-party service; see their pricing. Each connected account uses one MetaApi account.
- For local development without MetaApi, set `METAAPI_TOKEN=mock` to use a fake account with sample trades.

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
| `npm test` | Unit tests for P&L math, stats, CSV and validation |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run db:setup` | Create or update the database tables (safe to re-run) |

## Environment variables

| Name | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase transaction-pooler connection string |
| `METAAPI_TOKEN` | for MT5 | MetaApi API access token (`mock` for local testing) |
| `CRON_SECRET` | for daily MT5 sync | Any long random string; Vercel Cron sends it to `/api/cron/mt5-sync` |

## How P&L is calculated

- **Net P&L** = (exit − entry) × quantity × multiplier × (1 for long, −1 for short) − fees
- **R-multiple** = net P&L ÷ (|entry − stop| × quantity × multiplier)
- **Win rate** excludes break-even trades.
- **Profit factor** = gross profit ÷ gross loss. **Expectancy** = net P&L ÷ closed trades.
- **Max drawdown** is the largest peak-to-trough fall of the equity curve, starting from your starting balance.
- Dates are stored as entered (your local time). Daily and calendar figures use the day a trade closed.

## Security notes

- Passwords are hashed with scrypt; sessions are random tokens stored hashed, sent as an httpOnly cookie.
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
supabase/schema.sql     database tables
scripts/db-setup.mjs    applies the schema to DATABASE_URL
```
