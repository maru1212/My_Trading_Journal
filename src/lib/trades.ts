import "server-only";
import { db } from "./db";
import type { Trade } from "./types";
import type { TradeInput } from "./validation";

export type TradeFilters = {
  from?: string;
  to?: string;
  symbol?: string;
  setup?: string;
  side?: string;
  status?: "open" | "closed";
  q?: string;
};

const COLUMNS = [
  "symbol", "asset_class", "side", "quantity", "multiplier", "entry_date", "entry_price",
  "exit_date", "exit_price", "stop_loss", "take_profit", "fees", "setup", "tags", "notes", "rating",
] as const;

export function listTrades(userId: number, f: TradeFilters = {}): Trade[] {
  const where = ["user_id = @userId"];
  const params: Record<string, unknown> = { userId };
  // Date filters apply to the day the trade closed (or opened, if still open).
  if (f.from) {
    where.push("substr(coalesce(exit_date, entry_date), 1, 10) >= @from");
    params.from = f.from;
  }
  if (f.to) {
    where.push("substr(coalesce(exit_date, entry_date), 1, 10) <= @to");
    params.to = f.to;
  }
  if (f.symbol) {
    where.push("symbol = @symbol");
    params.symbol = f.symbol.toUpperCase();
  }
  if (f.setup) {
    where.push("setup = @setup");
    params.setup = f.setup;
  }
  if (f.side === "long" || f.side === "short") {
    where.push("side = @side");
    params.side = f.side;
  }
  if (f.status === "open") where.push("exit_price IS NULL");
  if (f.status === "closed") where.push("exit_price IS NOT NULL");
  if (f.q) {
    where.push("(symbol LIKE @q OR notes LIKE @q OR tags LIKE @q OR setup LIKE @q)");
    params.q = `%${f.q}%`;
  }
  return db
    .prepare(`SELECT * FROM trades WHERE ${where.join(" AND ")} ORDER BY entry_date DESC, id DESC`)
    .all(params) as Trade[];
}

export function getTrade(userId: number, id: number): Trade | null {
  return (
    (db.prepare("SELECT * FROM trades WHERE id = ? AND user_id = ?").get(id, userId) as
      | Trade
      | undefined) ?? null
  );
}

export function createTrade(userId: number, input: TradeInput): number {
  const result = db
    .prepare(
      `INSERT INTO trades (user_id, ${COLUMNS.join(", ")})
       VALUES (@user_id, ${COLUMNS.map((c) => "@" + c).join(", ")})`,
    )
    .run({ ...input, user_id: userId });
  return Number(result.lastInsertRowid);
}

export const createTrades = db.transaction((userId: number, inputs: TradeInput[]) => {
  for (const input of inputs) createTrade(userId, input);
  return inputs.length;
});

export function updateTrade(userId: number, id: number, input: TradeInput): boolean {
  const result = db
    .prepare(
      `UPDATE trades SET ${COLUMNS.map((c) => `${c} = @${c}`).join(", ")}, updated_at = datetime('now')
        WHERE id = @id AND user_id = @user_id`,
    )
    .run({ ...input, id, user_id: userId });
  return result.changes > 0;
}

export function deleteTrade(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM trades WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function distinctValues(userId: number, column: "symbol" | "setup"): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT ${column} AS v FROM trades
          WHERE user_id = ? AND ${column} IS NOT NULL AND ${column} != '' ORDER BY v`,
      )
      .all(userId) as { v: string }[]
  ).map((r) => r.v);
}
