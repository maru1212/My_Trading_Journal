import "server-only";
import type postgres from "postgres";
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

const COLUMNS: (keyof TradeInput)[] = [
  "symbol", "asset_class", "side", "quantity", "multiplier", "entry_date", "entry_price",
  "exit_date", "exit_price", "stop_loss", "take_profit", "fees", "setup", "tags", "notes", "rating",
];
const INSERT_COLUMNS: string[] = ["user_id", ...COLUMNS];
type Row = Record<string, string | number | null>;

function selectTrades() {
  const sql = db();
  return sql`
    select id, user_id, ${sql(COLUMNS)},
           created_at::text as created_at, updated_at::text as updated_at
      from trades`;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export async function listTrades(userId: number, f: TradeFilters = {}): Promise<Trade[]> {
  const sql = db();
  const empty = sql``;
  // Date filters apply to the day the trade closed (or opened, if still open).
  const day = sql`substr(coalesce(exit_date, entry_date), 1, 10)`;
  const q = f.q ? `%${escapeLike(f.q)}%` : null;
  return sql<Trade[]>`
    ${selectTrades()}
     where user_id = ${userId}
       ${f.from ? sql`and ${day} >= ${f.from}` : empty}
       ${f.to ? sql`and ${day} <= ${f.to}` : empty}
       ${f.symbol ? sql`and symbol = ${f.symbol.toUpperCase()}` : empty}
       ${f.setup ? sql`and setup = ${f.setup}` : empty}
       ${f.side === "long" || f.side === "short" ? sql`and side = ${f.side}` : empty}
       ${f.status === "open" ? sql`and exit_price is null` : empty}
       ${f.status === "closed" ? sql`and exit_price is not null` : empty}
       ${q ? sql`and (symbol ilike ${q} or notes ilike ${q} or tags ilike ${q} or setup ilike ${q})` : empty}
     order by entry_date desc, id desc`;
}

export async function getTrade(userId: number, id: number): Promise<Trade | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2 ** 31 - 1) return null;
  const [trade] = await db()<Trade[]>`${selectTrades()} where id = ${id} and user_id = ${userId}`;
  return trade ?? null;
}

export async function createTrade(userId: number, input: TradeInput): Promise<number> {
  const sql = db();
  const [row] = await sql<{ id: number }[]>`
    insert into trades ${sql({ ...input, user_id: userId } as Row, INSERT_COLUMNS)} returning id`;
  return row.id;
}

export async function createTrades(userId: number, inputs: TradeInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const sql = db();
  const rows = inputs.map((input) => ({ ...input, user_id: userId }));
  // One multi-row insert per chunk, all inside a single transaction.
  await sql.begin(async (transaction) => {
    // TransactionSql drops the tagged-template call signature in postgres.js's types.
    const tx = transaction as unknown as postgres.Sql;
    for (let i = 0; i < rows.length; i += 500) {
      await tx`insert into trades ${tx(rows.slice(i, i + 500) as Row[], INSERT_COLUMNS)}`;
    }
  });
  return inputs.length;
}

export async function updateTrade(userId: number, id: number, input: TradeInput): Promise<boolean> {
  const sql = db();
  const result = await sql`
    update trades set ${sql(input as Row, COLUMNS as string[])}, updated_at = now()
     where id = ${id} and user_id = ${userId}`;
  return result.count > 0;
}

export async function deleteTrade(userId: number, id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id <= 0) return false;
  const result = await db()`delete from trades where id = ${id} and user_id = ${userId}`;
  return result.count > 0;
}

export async function distinctValues(userId: number, column: "symbol" | "setup"): Promise<string[]> {
  const sql = db();
  const rows = await sql<{ v: string }[]>`
    select distinct ${sql(column)} as v from trades
     where user_id = ${userId} and ${sql(column)} is not null and ${sql(column)} <> ''
     order by v`;
  return rows.map((r) => r.v);
}
