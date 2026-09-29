import type { Trade } from "./types";

export type TradeFormValues = Record<string, string>;

/**
 * The strings the trade form starts with: every column as text, nulls as "". The form posts
 * these back, so any value (including a negative `fees` credit) must survive the round trip.
 */
export function tradeToFormValues(t?: Trade | null): TradeFormValues {
  if (!t) return { side: "long", asset_class: "stock", multiplier: "1", fees: "0" };
  const v: TradeFormValues = {};
  for (const [k, val] of Object.entries(t)) v[k] = val === null ? "" : String(val);
  return v;
}
