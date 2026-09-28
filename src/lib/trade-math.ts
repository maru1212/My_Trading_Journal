import type { Trade } from "./types";

type PnlInput = Pick<
  Trade,
  "side" | "quantity" | "multiplier" | "entry_price" | "exit_price" | "fees"
>;

export function isClosed(t: Pick<Trade, "exit_price">): boolean {
  return t.exit_price !== null;
}

/** Net P&L after fees. Null while the trade is still open. */
export function netPnl(t: PnlInput): number | null {
  if (t.exit_price === null) return null;
  const direction = t.side === "long" ? 1 : -1;
  return (t.exit_price - t.entry_price) * t.quantity * t.multiplier * direction - t.fees;
}

/** Money at risk between entry and stop. Null without a stop. */
export function initialRisk(
  t: Pick<Trade, "entry_price" | "stop_loss" | "quantity" | "multiplier">,
): number | null {
  if (t.stop_loss === null) return null;
  const risk = Math.abs(t.entry_price - t.stop_loss) * t.quantity * t.multiplier;
  return risk > 0 ? risk : null;
}

/** P&L expressed in multiples of initial risk. */
export function rMultiple(t: PnlInput & Pick<Trade, "stop_loss">): number | null {
  const pnl = netPnl(t);
  const risk = initialRisk(t);
  return pnl === null || risk === null ? null : pnl / risk;
}

/** Percent move in the trade's favour, before fees. */
export function returnPct(t: PnlInput): number | null {
  if (t.exit_price === null || t.entry_price === 0) return null;
  const direction = t.side === "long" ? 1 : -1;
  return ((t.exit_price - t.entry_price) / t.entry_price) * 100 * direction;
}

export function parseTags(tags: string | null): string[] {
  return (tags ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
