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
- **MetaTrader 5 sync**: a read-only Expert Advisor sends your closed and open positions automatically. Details below.
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

The `TradeLogSync` Expert Advisor ([`public/TradeLogSync.mq5`](public/TradeLogSync.mq5), also downloadable from **Settings → MetaTrader 5**) runs inside your MT5 terminal and posts positions to `/api/mt5/trades`.

1. **Settings → MetaTrader 5 → Create API key**, then download the EA.
2. MT5: **File → Open Data Folder**, put the file in `MQL5/Experts`, then refresh **Expert Advisors** in the Navigator. MT5 compiles it on first load.
3. **Tools → Options → Expert Advisors**: tick **Allow WebRequest for listed URL** and add your app's address (e.g. `https://your-app.vercel.app`).
4. Drag **TradeLogSync** onto any chart, paste the sync URL and API key into **Inputs**, and turn on **Algo Trading**.

How it works:

- On the first run it sends the last 90 days (`InpHistoryDays`), then syncs every minute and right after each trade. Every run re-sends the last 2 days, so partial closes and swaps stay correct.
- Deals are grouped per position (partial closes are averaged). P&L is the broker's figure in your account currency: profit + commission + swap + fees.
- Re-sending is safe. Positions are matched by account and position ID. Your setup, tags, notes and rating are never overwritten.
- It only reads history. It never opens, closes or modifies orders. It needs MT5 running (a VPS works for 24/7 syncing), and times are your broker's server time.
- Netting accounts that reverse a position in one deal are not split into two trades.

**Upgrading an existing database:** re-run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor (or `npm run db:setup`) to add the MT5 columns. It is safe to run again.

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
