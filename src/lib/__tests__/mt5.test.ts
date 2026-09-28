import { describe, expect, it } from "vitest";
import type { BridgeDeal, BridgeSnapshot } from "../metaapi";
import { guessAssetClass, positionsFromSnapshot, toTradeRow } from "../mt5";
import { netPnl, rMultiple } from "../trade-math";

const deal = (d: Partial<BridgeDeal> & Pick<BridgeDeal, "id" | "brokerTime">): BridgeDeal => ({
  type: "DEAL_TYPE_BUY", entryType: "DEAL_ENTRY_IN", profit: 0, commission: 0, swap: 0, ...d,
});

const snap: BridgeSnapshot = {
  login: "5001",
  server: "Demo",
  currency: "USD",
  deals: [
    deal({ id: "0", type: "DEAL_TYPE_BALANCE", entryType: undefined, brokerTime: "2026-07-01 00:00:00.000", profit: 5000 }),
    // USDJPY short: price move is in JPY, broker profit is in USD
    deal({ id: "1", positionId: "11", symbol: "USDJPY", type: "DEAL_TYPE_SELL", volume: 1, price: 157.5, brokerTime: "2026-07-01 10:05:12.000", commission: -3.5, stopLoss: 157.8 }),
    deal({ id: "2", positionId: "11", symbol: "USDJPY", type: "DEAL_TYPE_BUY", entryType: "DEAL_ENTRY_OUT", volume: 1, price: 157.2, brokerTime: "2026-07-01 12:30:59.000", profit: 190.84, commission: -3.5, swap: -1.5 }),
    // EURUSD long closed in two halves
    deal({ id: "3", positionId: "12", symbol: "EURUSD", volume: 1, price: 1.1, brokerTime: "2026-07-02 09:00:00.000" }),
    deal({ id: "4", positionId: "12", symbol: "EURUSD", type: "DEAL_TYPE_SELL", entryType: "DEAL_ENTRY_OUT", volume: 0.5, price: 1.102, brokerTime: "2026-07-02 10:00:00.000", profit: 100 }),
    deal({ id: "5", positionId: "12", symbol: "EURUSD", type: "DEAL_TYPE_SELL", entryType: "DEAL_ENTRY_OUT", volume: 0.5, price: 1.104, brokerTime: "2026-07-02 11:00:00.000", profit: 200 }),
    // exit whose entry is unknown: skipped
    deal({ id: "6", positionId: "13", symbol: "EURUSD", type: "DEAL_TYPE_SELL", entryType: "DEAL_ENTRY_OUT", volume: 1, price: 1.1, brokerTime: "2026-07-03 11:00:00.000", profit: 5 }),
  ],
  // Gold position opened before the sync window, still open
  positions: [{ id: 14, type: "POSITION_TYPE_SELL", symbol: "XAUUSD", brokerTime: "2026-06-20 08:00:00.000", openPrice: 2400, volume: 0.2, stopLoss: 2410, swap: -3 }],
  specs: { USDJPY: { contractSize: 100000, path: "Forex\\USDJPY" }, EURUSD: { contractSize: 100000 } },
};

describe("positionsFromSnapshot", () => {
  const byId = Object.fromEntries(positionsFromSnapshot(snap).map((p) => [p.position_id, p]));

  it("builds a closed position with broker P&L in account currency", () => {
    const row = toTradeRow(1, "5001", byId["11"]);
    expect(row).toMatchObject({
      external_id: "mt5:5001:11", source: "mt5", side: "short", asset_class: "forex", multiplier: 100000,
      entry_date: "2026-07-01T10:05", exit_date: "2026-07-01T12:30", exit_price: 157.2, stop_loss: 157.8,
      fees: 8.5, broker_pnl: 182.34,
    });
    expect(netPnl(row as never)).toBe(182.34);
    expect(rMultiple(row as never)).toBeCloseTo(1);
  });

  it("averages partial closes", () => {
    expect(byId["12"]).toMatchObject({ volume: 1, close_time: "2026-07-02T11:00", profit: 300 });
    expect(byId["12"].close_price).toBeCloseTo(1.103);
  });

  it("keeps open positions open, even without an entry deal in range", () => {
    const row = toTradeRow(1, "5001", byId["14"]);
    expect(row).toMatchObject({ side: "short", asset_class: "commodity", multiplier: 100, exit_price: null, broker_pnl: null, fees: 3 });
  });

  it("skips balance deals and exits without entries", () => {
    expect(Object.keys(byId).sort()).toEqual(["11", "12", "14"]);
  });
});

describe("guessAssetClass", () => {
  it("uses symbol and path", () => {
    expect(guessAssetClass("XAUUSD")).toBe("commodity");
    expect(guessAssetClass("XAUUSD.m")).toBe("commodity");
    expect(guessAssetClass("EURUSD.r")).toBe("forex");
    expect(guessAssetClass("BTCUSD")).toBe("crypto");
    expect(guessAssetClass("US30", "Indices\\US30")).toBe("other");
    expect(guessAssetClass("AAPL.US", "Stocks\\US\\AAPL")).toBe("stock");
  });
});
