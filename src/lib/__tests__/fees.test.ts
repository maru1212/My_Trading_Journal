import { describe, expect, it } from "vitest";
import { toTradeRow, type Mt5Position } from "../mt5";
import { tradeToFormValues } from "../trade-form-values";
import { netPnl } from "../trade-math";
import type { Trade } from "../types";
import { tradeSchema } from "../validation";

// R1 from the audit: swap credit (+12.5) larger than commission (-3) → net fees -9.5.
const position: Mt5Position = {
  position_id: "1", symbol: "EURUSD", type: "buy", volume: 1, contract_size: 100000,
  open_time: "2026-07-01T10:00", open_price: 1.1, close_time: "2026-07-05T10:00", close_price: 1.101,
  sl: null, tp: null, commission: -3, swap: 12.5, profit: 100,
};

/** A stored trade as the edit page loads it. */
function stored(overrides: Partial<Trade> = {}): Trade {
  const row = toTradeRow(1, "5001", position);
  return {
    ...row,
    id: 7, setup: null, tags: null, notes: null, rating: null,
    created_at: "2026-07-05 10:00:00+00", updated_at: "2026-07-05 10:00:00+00",
    ...overrides,
  } as Trade;
}

describe("negative fees (R1 regression)", () => {
  it("MT5 mapping yields a negative net fee for a swap credit", () => {
    const row = toTradeRow(1, "5001", position);
    expect(row.fees).toBe(-9.5);
    expect(row.broker_pnl).toBe(109.5);
  });

  it("a synced trade with fees = -9.5 loads into the form and saves", () => {
    const values = tradeToFormValues(stored());
    expect(values.fees).toBe("-9.5");
    const parsed = tradeSchema.safeParse(values);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.fees).toBe(-9.5);
  });

  it.each([-9.5, -0.01, -1234.56, -1e-7, 0.1 + 0.2 - 1])("fee %d survives a form round trip unchanged", (fee) => {
    const parsed = tradeSchema.parse(tradeToFormValues(stored({ fees: fee })));
    expect(parsed.fees).toBe(fee);
    expect(parsed.fees).toBeLessThan(0);
  });

  it("editing journal fields keeps fees and never touches broker P&L", () => {
    const values = { ...tradeToFormValues(stored()), setup: "London breakout", notes: "Held through rollover for the swap" };
    const parsed = tradeSchema.parse(values);
    expect(parsed).toMatchObject({ fees: -9.5, setup: "London breakout", notes: "Held through rollover for the swap" });
    // The form schema has no broker_pnl/source/external_id, so an update can't overwrite them.
    expect(parsed).not.toHaveProperty("broker_pnl");
    expect(parsed).not.toHaveProperty("source");
    expect(parsed).not.toHaveProperty("external_id");
  });

  it("P&L follows the existing conventions", () => {
    // Synced trades show the broker's figure regardless of fees.
    expect(netPnl(stored())).toBe(109.5);
    // Manual trades subtract fees, so a credit adds to P&L.
    const manual = { side: "long" as const, quantity: 1, multiplier: 100, entry_price: 10, exit_price: 11, broker_pnl: null };
    expect(netPnl({ ...manual, fees: 2 })).toBe(98);
    expect(netPnl({ ...manual, fees: 0 })).toBe(100);
    expect(netPnl({ ...manual, fees: -2 })).toBe(102);
  });
});

describe("fee validation (unchanged cases)", () => {
  const base = { symbol: "EURUSD", side: "long", quantity: "1", entry_date: "2026-07-01T10:00", entry_price: "1.1" };

  it.each([
    ["positive", "7", 7],
    ["positive decimal", "3.25", 3.25],
    ["zero", "0", 0],
    ["empty means zero", "", 0],
    ["missing means zero", undefined, 0],
  ])("accepts %s fees", (_name, input, expected) => {
    expect(tradeSchema.parse({ ...base, fees: input }).fees).toBe(expected);
  });

  it.each(["abc", "1,5", "--1", "1e", "-", "Infinity", "-Infinity", "NaN", "0x", "12abc"])("rejects non-numeric fees %j", (input) => {
    const r = tradeSchema.safeParse({ ...base, fees: input });
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.fees).toBeDefined();
  });
});
