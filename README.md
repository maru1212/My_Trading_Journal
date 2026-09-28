# TradeLog — Trading Journal

A full-stack trading journal: log trades, track P&L, and find out which setups actually make money.

Built with Next.js 16 (App Router, Server Actions), React 19, Tailwind CSS 4, SQLite (`better-sqlite3`) and Recharts.

## Features

- **Accounts** — email + password sign-up, hashed with scrypt; database-backed sessions in an httpOnly cookie. Every trade is private to its owner.
- **Trade logging** — stocks, options, futures, forex, crypto. Long/short, quantity, contract multiplier, entry/exit date and price, stop loss, take profit, fees, setup, tags, notes and a 1–5 execution rating. Leave the exit empty to keep a position open. Live P&L and R preview while you type.
- **Dashboard** — net P&L, % return, win rate, profit factor, expectancy, average win/loss, payoff ratio, largest win/loss, max drawdown, win/loss streaks, average hold time, fees; equity curve, daily P&L chart and P&L by symbol. Filter by 7D / 30D / 90D / YTD / All.
- **Trades list** — search, filter by symbol, setup, side, status and date range, with totals for the filtered set.
- **Calendar** — monthly P&L heatmap with weekly totals; click a day to see its trades.
- **Analytics** — breakdowns by setup, symbol, tag, day of week, hour of day, long vs short and asset class, plus an R-multiple distribution.
- **CSV import / export** — import from a spreadsheet or broker export (validated row by row, all-or-nothing), export any filtered view.
- **Settings** — name, currency, starting balance (anchors the equity curve and drawdown), change password.
- Light and dark mode (follows your OS), responsive down to phone width.

## Getting started

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000, create an account, and log a trade. A CSV template is available on the **Import** page.

The database is created automatically at `data/journal.db`. Set `DATABASE_PATH` to put it elsewhere.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests for P&L math, stats, CSV and validation |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |

## How P&L is calculated

- **Net P&L** = (exit − entry) × quantity × multiplier × (1 for long, −1 for short) − fees
- **R-multiple** = net P&L ÷ (|entry − stop| × quantity × multiplier)
- **Win rate** excludes break-even trades.
- **Profit factor** = gross profit ÷ gross loss. **Expectancy** = net P&L ÷ closed trades.
- **Max drawdown** is the largest peak-to-trough fall of the equity curve, starting from your starting balance.
- Dates are stored as entered (your local time). Daily and calendar figures use the day a trade closed.

## Deploying

SQLite needs a persistent disk, so deploy to a host with one (a VPS, Fly.io or Railway with a volume, Render with a disk, etc.) and point `DATABASE_PATH` at the volume:

```bash
npm ci && npm run build
DATABASE_PATH=/data/journal.db npm start
```

Serverless hosts without a persistent filesystem (e.g. Vercel) need the data layer in `src/lib/db.ts` and `src/lib/trades.ts` swapped for a hosted database such as Postgres.

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
    db.ts               SQLite connection + schema
    auth.ts             passwords and sessions
    trades.ts           trade queries
    trade-math.ts       per-trade P&L, R, return
    stats.ts            summary stats, equity curve, breakdowns
    validation.ts       zod schemas
  proxy.ts              redirects signed-out users away from app pages
```
