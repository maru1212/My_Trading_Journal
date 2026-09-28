import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../csv";
import { closedTrades, dailyPnl, groupBy, groupings, summarize, weekdayOf } from "../stats";
import { netPnl, rMultiple } from "../trade-math";
import type { Trade } from "../types";
import { tradeSchema } from "../validation";

let nextId = 1;
function trade(p: Partial<Trade>): Trade {
  return {
    id: nextId++, user_id: 1, symbol: "AAPL", asset_class: "stock", side: "long", quantity: 10,
    multiplier: 1, entry_date: "2026-03-02T09:30", entry_price: 100, exit_date: "2026-03-02T10:30",
    exit_price: 110, stop_loss: null, take_profit: null, fees: 0, setup: null, tags: null, notes: null,
    rating: null, created_at: "", updated_at: "", ...p,
  };
}

describe("trade math", () => {
  it("computes long and short P&L net of fees and multiplier", () => {
    expect(netPnl(trade({ fees: 2 }))).toBe(98);
    expect(netPnl(trade({ side: "short", exit_price: 90, fees: 1 }))).toBe(99);
    expect(netPnl(trade({ multiplier: 100, quantity: 1, exit_price: 101.5 }))).toBe(150);
    expect(netPnl(trade({ exit_price: null }))).toBeNull();
  });

  it("computes R from the stop", () => {
    expect(rMultiple(trade({ stop_loss: 95 }))).toBe(2);
    expect(rMultiple(trade({ side: "short", stop_loss: 105, exit_price: 110 }))).toBe(-2);
    expect(rMultiple(trade({}))).toBeNull();
  });
});

describe("summarize", () => {
  const trades = [
    trade({ exit_price: 110, exit_date: "2026-03-02T10:00" }), // +100
    trade({ exit_price: 95, exit_date: "2026-03-03T10:00" }), // -50
    trade({ exit_price: 90, exit_date: "2026-03-04T10:00" }), // -100
    trade({ exit_price: 130, exit_date: "2026-03-04T12:00" }), // +300
    trade({ exit_price: null, exit_date: null }), // open
  ];
  const s = summarize(trades, 1000);

  it("counts and ratios", () => {
    expect(s.closedTrades).toBe(4);
    expect(s.openTrades).toBe(1);
    expect(s.winRate).toBe(50);
    expect(s.netPnl).toBe(250);
    expect(s.grossProfit).toBe(400);
    expect(s.grossLoss).toBe(150);
    expect(s.profitFactor).toBeCloseTo(400 / 150);
    expect(s.avgWin).toBe(200);
    expect(s.avgLoss).toBe(75);
    expect(s.expectancy).toBe(62.5);
  });

  it("drawdown and streaks follow close order", () => {
    // Equity: 1100, 1050, 950, 1250 → peak 1100, trough 950.
    expect(s.maxDrawdown).toBe(150);
    expect(s.maxDrawdownPct).toBeCloseTo((150 / 1100) * 100);
    expect(s.maxLossStreak).toBe(2);
    expect(s.maxWinStreak).toBe(1);
    expect(s.currentStreak).toBe(1);
  });

  it("groups by day", () => {
    const days = dailyPnl(closedTrades(trades));
    expect(days.map((d) => [d.date, d.pnl])).toEqual([
      ["2026-03-02", 100],
      ["2026-03-03", -50],
      ["2026-03-04", 200],
    ]);
    expect(s.greenDays).toBe(2);
    expect(s.bestDay?.date).toBe("2026-03-04");
  });

  it("handles no trades", () => {
    const empty = summarize([]);
    expect(empty.winRate).toBeNull();
    expect(empty.profitFactor).toBeNull();
    expect(empty.netPnl).toBe(0);
  });

  it("splits tags into separate groups", () => {
    const g = groupBy(closedTrades([trade({ tags: "a, b" }), trade({ tags: "a", exit_price: 90 })]), groupings.tag);
    expect(g.find((x) => x.key === "a")).toMatchObject({ trades: 2, pnl: 0 });
    expect(g.find((x) => x.key === "b")).toMatchObject({ trades: 1, pnl: 100 });
  });

  it("finds weekday independent of timezone", () => {
    expect(weekdayOf("2026-03-02T23:59")).toBe("Mon");
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [["a", 'say "hi"', "x,y", "line1\nline2", null]];
    expect(parseCsv(toCsv(rows as never))).toEqual([["a", 'say "hi"', "x,y", "line1\nline2", ""]]);
  });
});

describe("tradeSchema", () => {
  const base = { symbol: "msft", side: "long", quantity: "5", entry_date: "2026-03-02", entry_price: "10" };
  it("normalizes input", () => {
    const t = tradeSchema.parse({ ...base, exit_price: "", fees: "" });
    expect(t).toMatchObject({ symbol: "MSFT", entry_date: "2026-03-02T00:00", exit_price: null, fees: 0, multiplier: 1 });
  });
  it("rejects exit before entry", () => {
    const r = tradeSchema.safeParse({ ...base, exit_date: "2026-03-01", exit_price: "11" });
    expect(r.success).toBe(false);
  });
});
