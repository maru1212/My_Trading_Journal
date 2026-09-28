import { describe, expect, it } from "vitest";
import { guessAssetClass, mt5PayloadSchema, toTradeRow } from "../mt5";
import { netPnl, rMultiple } from "../trade-math";

const closed = {
  position_id: "123456789",
  symbol: "USDJPY",
  path: "Forex\\Majors\\USDJPY",
  type: "sell",
  volume: 1,
  contract_size: 100000,
  open_time: "2026.07.01 10:05",
  open_price: 157.5,
  close_time: "2026.07.01 12:30",
  close_price: 157.2,
  profit: 190.84, // USD, although the price move is in JPY
  sl: 157.8,
  tp: 0,
  commission: -7,
  swap: -1.5,
  fee: 0,
};

describe("mt5 payload", () => {
  it("maps a closed position using the broker's P&L", () => {
    const { login, positions } = mt5PayloadSchema.parse({ login: 5001, positions: [closed] });
    const row = toTradeRow(1, login, positions[0]);
    expect(row).toMatchObject({
      external_id: "mt5:5001:123456789",
      source: "mt5",
      side: "short",
      asset_class: "forex",
      entry_date: "2026-07-01T10:05",
      exit_date: "2026-07-01T12:30",
      take_profit: null,
      fees: 8.5,
      broker_pnl: 182.34,
    });
    expect(netPnl(row as never)).toBe(182.34);
    expect(rMultiple(row as never)).toBeCloseTo(1);
  });

  it("keeps open positions open", () => {
    const open = { ...closed, close_time: undefined, close_price: undefined, profit: undefined };
    const row = toTradeRow(1, "5001", mt5PayloadSchema.parse({ login: "5001", positions: [open] }).positions[0]);
    expect(row.exit_price).toBeNull();
    expect(row.broker_pnl).toBeNull();
    expect(netPnl(row as never)).toBeNull();
  });

  it("rejects bad input", () => {
    expect(mt5PayloadSchema.safeParse({ login: "x", positions: [] }).success).toBe(false);
    expect(mt5PayloadSchema.safeParse({ login: 1, positions: [{ ...closed, type: "long" }] }).success).toBe(false);
  });

  it("guesses asset classes from symbol and path", () => {
    expect(guessAssetClass("XAUUSD")).toBe("commodity");
    expect(guessAssetClass("XAUUSD.m")).toBe("commodity");
    expect(guessAssetClass("EURUSD.r")).toBe("forex");
    expect(guessAssetClass("BTCUSD")).toBe("crypto");
    expect(guessAssetClass("US30", "Indices\\US30")).toBe("other");
    expect(guessAssetClass("AAPL.US", "Stocks\\US\\AAPL")).toBe("stock");
  });
});
