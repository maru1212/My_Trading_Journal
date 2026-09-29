import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// trades.ts is server code; run it against a real database from the test.
vi.mock("server-only", () => ({}));

/**
 * Runs when DATABASE_URL_TEST is set; uses a throwaway schema that is dropped afterwards.
 * Exercises the real getTrade → form values → tradeSchema → updateTrade path.
 */
const url = process.env.DATABASE_URL_TEST;
const schema = `t2_trades_${crypto.randomBytes(4).toString("hex")}`;

describe.skipIf(!url)("editing trades keeps fees and broker P&L (Postgres)", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let userId: number;
  let trades: typeof import("../trades");
  let formValues: typeof import("../trade-form-values");
  let validation: typeof import("../validation");

  beforeAll(async () => {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url!);
    const opts = { prepare: false, max: 1, ssl: local ? false : ("require" as const), onnotice: () => {} };
    admin = postgres(url!, opts);
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { ...opts, connection: { search_path: schema } });
    await sql.unsafe(fs.readFileSync(path.resolve(import.meta.dirname, "../../../supabase/schema.sql"), "utf8"));
    // db() reuses this pool instead of opening one from DATABASE_URL.
    (globalThis as { __journalSql?: postgres.Sql }).__journalSql = sql;
    trades = await import("../trades");
    formValues = await import("../trade-form-values");
    validation = await import("../validation");
  });

  afterAll(async () => {
    delete (globalThis as { __journalSql?: postgres.Sql }).__journalSql;
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  beforeEach(async () => {
    await sql`truncate sessions, trades, users restart identity cascade`;
    [{ id: userId }] = await sql<{ id: number }[]>`
      insert into users (email, name, password_hash) values ('t2@example.com', 'T2', 'scrypt$00$00') returning id`;
  });

  /** Load a trade like the edit page, change some fields like the user would, save like saveTrade. */
  async function editAndSave(id: number, changes: Record<string, string>) {
    const loaded = await trades.getTrade(userId, id);
    const parsed = validation.tradeSchema.safeParse({ ...formValues.tradeToFormValues(loaded), ...changes });
    expect(parsed.success, JSON.stringify(parsed.error?.flatten().fieldErrors)).toBe(true);
    expect(await trades.updateTrade(userId, id, parsed.data!)).toBe(true);
    return trades.getTrade(userId, id);
  }

  it("an MT5 trade with fees = -9.5 can be edited and saved; fees and broker P&L unchanged", async () => {
    const [{ id }] = await sql<{ id: number }[]>`
      insert into trades (user_id, source, external_id, symbol, asset_class, side, quantity, multiplier,
                          entry_date, entry_price, exit_date, exit_price, fees, broker_pnl)
      values (${userId}, 'mt5', 'mt5:5001:1', 'EURUSD', 'forex', 'long', 1, 100000,
              '2026-07-01T10:00', 1.1, '2026-07-05T10:00', 1.101, -9.5, 109.5)
      returning id`;

    const after = await editAndSave(id, { setup: "London breakout", notes: "Held for the swap", tags: "carry", rating: "4" });
    expect(after).toMatchObject({
      setup: "London breakout", notes: "Held for the swap", tags: "carry", rating: 4,
      fees: -9.5, broker_pnl: 109.5, source: "mt5", external_id: "mt5:5001:1",
    });
  });

  it("positive and zero fees on manual trades are unchanged by an edit", async () => {
    for (const fees of [7.25, 0]) {
      const [{ id }] = await sql<{ id: number }[]>`
        insert into trades (user_id, symbol, side, quantity, entry_date, entry_price, exit_date, exit_price, fees)
        values (${userId}, 'AAPL', 'long', 10, '2026-07-01T10:00', 100, '2026-07-01T11:00', 101, ${fees})
        returning id`;
      const after = await editAndSave(id, { notes: "reviewed" });
      expect(after).toMatchObject({ fees, broker_pnl: null, source: "manual", notes: "reviewed" });
    }
  });

  it("a manual trade can store a negative fee (credit) and P&L adds it", async () => {
    const [{ id }] = await sql<{ id: number }[]>`
      insert into trades (user_id, symbol, side, quantity, entry_date, entry_price, exit_date, exit_price, fees)
      values (${userId}, 'XAUUSD', 'long', 1, '2026-07-01T10:00', 2400, '2026-07-01T11:00', 2401, 0)
      returning id`;
    const after = await editAndSave(id, { fees: "-1.5" });
    expect(after?.fees).toBe(-1.5);
    const { netPnl } = await import("../trade-math");
    expect(netPnl(after!)).toBeCloseTo(2.5); // 1 point × 1 × 1 + 1.5 credit
  });
});
