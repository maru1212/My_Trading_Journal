import { netPnl, parseTags, rMultiple } from "./trade-math";
import type { Trade } from "./types";

export type ClosedTrade = Trade & { pnl: number; r: number | null; closeDate: string };

export type Summary = {
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoffRatio: number | null;
  expectancy: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number; // positive = wins in a row, negative = losses
  avgR: number | null;
  totalFees: number;
  avgHoldMinutes: number | null;
  bestDay: DayPnl | null;
  worstDay: DayPnl | null;
  tradingDays: number;
  greenDays: number;
};

export type DayPnl = { date: string; pnl: number; trades: number };
export type EquityPoint = { index: number; date: string; symbol: string; pnl: number; equity: number };
export type Group = {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
  avgPnl: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayOf(date: string) {
  return date.slice(0, 10);
}

export function weekdayOf(date: string) {
  const [y, m, d] = dayOf(date).split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function minutesBetween(a: string, b: string) {
  return (Date.parse(b + "Z") - Date.parse(a + "Z")) / 60_000;
}

/** Closed trades with computed P&L, oldest close first. */
export function closedTrades(trades: Trade[]): ClosedTrade[] {
  return trades
    .flatMap((t) => {
      const pnl = netPnl(t);
      if (pnl === null) return [];
      return [{ ...t, pnl, r: rMultiple(t), closeDate: t.exit_date ?? t.entry_date }];
    })
    .sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id - b.id);
}

export function dailyPnl(closed: ClosedTrade[]): DayPnl[] {
  const map = new Map<string, DayPnl>();
  for (const t of closed) {
    const date = dayOf(t.closeDate);
    const day = map.get(date) ?? { date, pnl: 0, trades: 0 };
    day.pnl += t.pnl;
    day.trades += 1;
    map.set(date, day);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function equityCurve(closed: ClosedTrade[], startingBalance = 0): EquityPoint[] {
  let equity = startingBalance;
  return closed.map((t, i) => {
    equity += t.pnl;
    return { index: i + 1, date: t.closeDate, symbol: t.symbol, pnl: t.pnl, equity };
  });
}

export function summarize(trades: Trade[], startingBalance = 0): Summary {
  const closed = closedTrades(trades);
  const winners = closed.filter((t) => t.pnl > 0);
  const losers = closed.filter((t) => t.pnl < 0);
  const grossProfit = sum(winners.map((t) => t.pnl));
  const grossLoss = -sum(losers.map((t) => t.pnl));
  const net = grossProfit - grossLoss;
  const decided = winners.length + losers.length;

  // Drawdown measured on the equity curve, starting from the account balance.
  let peak = startingBalance;
  let equity = startingBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct: number | null = null;
  for (const t of closed) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : null;
    }
  }

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let streak = 0;
  for (const t of closed) {
    if (t.pnl > 0) streak = streak > 0 ? streak + 1 : 1;
    else if (t.pnl < 0) streak = streak < 0 ? streak - 1 : -1;
    else streak = 0;
    maxWinStreak = Math.max(maxWinStreak, streak);
    maxLossStreak = Math.max(maxLossStreak, -streak);
  }

  const rs = closed.map((t) => t.r).filter((r): r is number => r !== null);
  const holds = closed
    .filter((t) => t.exit_date)
    .map((t) => minutesBetween(t.entry_date, t.exit_date!))
    .filter((m) => Number.isFinite(m) && m >= 0);
  const days = dailyPnl(closed);
  const byPnl = [...days].sort((a, b) => b.pnl - a.pnl);

  const avgWin = winners.length ? grossProfit / winners.length : null;
  const avgLoss = losers.length ? grossLoss / losers.length : null;

  return {
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    wins: winners.length,
    losses: losers.length,
    breakeven: closed.length - decided,
    winRate: decided ? (winners.length / decided) * 100 : null,
    netPnl: net,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avgWin,
    avgLoss,
    payoffRatio: avgWin !== null && avgLoss ? avgWin / avgLoss : null,
    expectancy: closed.length ? net / closed.length : null,
    largestWin: winners.length ? Math.max(...winners.map((t) => t.pnl)) : null,
    largestLoss: losers.length ? Math.min(...losers.map((t) => t.pnl)) : null,
    maxDrawdown,
    maxDrawdownPct,
    maxWinStreak,
    maxLossStreak,
    currentStreak: streak,
    avgR: rs.length ? sum(rs) / rs.length : null,
    totalFees: sum(closed.map((t) => t.fees)),
    avgHoldMinutes: holds.length ? sum(holds) / holds.length : null,
    bestDay: byPnl.length && byPnl[0].pnl > 0 ? byPnl[0] : null,
    worstDay: byPnl.length && byPnl.at(-1)!.pnl < 0 ? byPnl.at(-1)! : null,
    tradingDays: days.length,
    greenDays: days.filter((d) => d.pnl > 0).length,
  };
}

export function groupBy(
  closed: ClosedTrade[],
  keyFn: (t: ClosedTrade) => string | string[] | null,
): Group[] {
  const map = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of closed) {
    const raw = keyFn(t);
    const keys = raw === null ? [] : Array.isArray(raw) ? raw : [raw];
    for (const key of keys) {
      const g = map.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
      g.trades += 1;
      g.wins += t.pnl > 0 ? 1 : 0;
      g.pnl += t.pnl;
      map.set(key, g);
    }
  }
  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      ...g,
      winRate: (g.wins / g.trades) * 100,
      avgPnl: g.pnl / g.trades,
    }))
    .sort((a, b) => b.pnl - a.pnl);
}

export const groupings = {
  symbol: (t: ClosedTrade) => t.symbol,
  setup: (t: ClosedTrade) => t.setup || "No setup",
  side: (t: ClosedTrade) => (t.side === "long" ? "Long" : "Short"),
  assetClass: (t: ClosedTrade) => t.asset_class[0].toUpperCase() + t.asset_class.slice(1),
  tag: (t: ClosedTrade) => parseTags(t.tags),
  weekday: (t: ClosedTrade) => weekdayOf(t.entry_date),
  hour: (t: ClosedTrade) => `${t.entry_date.slice(11, 13) || "00"}:00`,
};

export const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
