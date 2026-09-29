import { beforeEach, describe, expect, it } from "vitest";
import { describeDb } from "../../test/db";
import { createUser } from "../../test/fixtures";
import { netPnl } from "../trade-math";
import { tradeToFormValues } from "../trade-form-values";
import {
  createTrade, createTrades, deleteTrade, distinctValues, getTrade, listTrades, updateTrade,
} from "../trades";
import { tradeSchema, type TradeInput } from "../validation";

const input = (over: Record<string, string> = {}): TradeInput =>
  tradeSchema.parse({
    symbol: "XAUUSD", asset_class: "commodity", side: "long", quantity: "1", multiplier: "100",
    entry_date: "2026-07-01T10:00", entry_price: "2400", exit_date: "2026-07-01T11:00", exit_price: "2405",
    fees: "7", setup: "Silver bullet", tags: "ict,london", notes: "note", rating: "4", ...over,
  });

describeDb("trades repository", (db) => {
  let alice: number;
  let bob: number;

  beforeEach(async () => {
    alice = await createUser(db.sql, "alice@example.com");
    bob = await createUser(db.sql, "bob@example.com");
  });

  const rowCount = async () => Number((await db.sql<{ n: string }[]>`select count(*)::int as n from trades`)[0].n);

  describe("own trades", () => {
    it("create → get → update → delete", async () => {
      const id = await createTrade(alice, input());
      const created = await getTrade(alice, id);
      expect(created).toMatchObject({ user_id: alice, symbol: "XAUUSD", fees: 7, source: "manual", broker_pnl: null });
      expect(netPnl(created!)).toBe(493);

      expect(await updateTrade(alice, id, input({ exit_price: "2410", notes: "moved target" }))).toBe(true);
      expect(await getTrade(alice, id)).toMatchObject({ exit_price: 2410, notes: "moved target" });

      expect(await deleteTrade(alice, id)).toBe(true);
      expect(await getTrade(alice, id)).toBeNull();
      expect(await deleteTrade(alice, id)).toBe(false);
    });

    it("bulk import is atomic and owned by the importer", async () => {
      expect(await createTrades(alice, [input(), input({ symbol: "EURUSD", asset_class: "forex" })])).toBe(2);
      expect((await listTrades(alice)).map((t) => t.user_id)).toEqual([alice, alice]);
      // A row the database rejects (side check constraint) rolls the whole batch back.
      const bad = { ...input(), side: "sideways" } as unknown as TradeInput;
      await expect(createTrades(alice, [input({ symbol: "GBPUSD" }), bad])).rejects.toThrow();
      expect(await rowCount()).toBe(2);
    });
  });

  describe("ownership", () => {
    it("another user cannot get, update or delete a trade by its id", async () => {
      const id = await createTrade(alice, input());
      expect(await getTrade(bob, id)).toBeNull();
      expect(await updateTrade(bob, id, input({ notes: "hijacked", exit_price: "1" }))).toBe(false);
      expect(await deleteTrade(bob, id)).toBe(false);
      expect(await getTrade(alice, id)).toMatchObject({ notes: "note", exit_price: 2405, user_id: alice });
    });

    it("listing and filters are scoped to the user", async () => {
      await createTrade(alice, input());
      await createTrade(alice, input({ symbol: "EURUSD", setup: "Judas swing", exit_date: "", exit_price: "" }));
      await createTrade(bob, input({ notes: "bob's note" }));
      await createTrade(bob, input({ symbol: "GBPUSD", setup: "Turtle soup" }));

      expect((await listTrades(alice)).every((t) => t.user_id === alice)).toBe(true);
      expect(await listTrades(alice)).toHaveLength(2);
      expect(await listTrades(bob)).toHaveLength(2);
      expect(await listTrades(alice, { symbol: "GBPUSD" })).toHaveLength(0);
      expect(await listTrades(alice, { q: "bob" })).toHaveLength(0);
      expect(await listTrades(alice, { status: "open" })).toHaveLength(1);
      expect(await listTrades(bob, { q: "%" })).toHaveLength(0); // LIKE wildcards are escaped
      expect(await distinctValues(alice, "setup")).toEqual(["Judas swing", "Silver bullet"]);
      expect(await distinctValues(bob, "symbol")).toEqual(["GBPUSD", "XAUUSD"]);
    });

    it("rejects invalid ids without querying", async () => {
      for (const id of [0, -1, 1.5, Number.NaN, 2 ** 31]) expect(await getTrade(alice, id)).toBeNull();
      for (const id of [0, -1, 1.5, Number.NaN]) expect(await deleteTrade(alice, id)).toBe(false);
    });
  });

  describe("MT5 external ids", () => {
    const insertSynced = (userId: number, externalId: string) => db.sql`
      insert into trades (user_id, source, external_id, symbol, asset_class, side, quantity, multiplier,
                          entry_date, entry_price, exit_date, exit_price, fees, broker_pnl)
      values (${userId}, 'mt5', ${externalId}, 'EURUSD', 'forex', 'long', 1, 100000,
              '2026-07-01T10:00', 1.1, '2026-07-05T10:00', 1.101, -9.5, 109.5)
      returning id`;

    it("are unique per user, but two users may hold the same id", async () => {
      await insertSynced(alice, "mt5:5001:1");
      await expect(insertSynced(alice, "mt5:5001:1")).rejects.toThrow(/trades_external_idx|duplicate key/);
      await insertSynced(bob, "mt5:5001:1");
      expect(await rowCount()).toBe(2);
    });

    it("manual trades (no external id) never collide", async () => {
      await createTrade(alice, input());
      await createTrade(alice, input());
      expect(await rowCount()).toBe(2);
    });

    it("editing a synced trade keeps negative fees, broker P&L and identity; only journal fields change", async () => {
      const [{ id }] = await insertSynced(alice, "mt5:5001:9");
      const loaded = await getTrade(alice, id);
      const parsed = tradeSchema.parse({ ...tradeToFormValues(loaded), setup: "London breakout", notes: "Held for the swap", tags: "carry", rating: "5" });
      expect(await updateTrade(alice, id, parsed)).toBe(true);
      const after = await getTrade(alice, id);
      expect(after).toMatchObject({
        setup: "London breakout", notes: "Held for the swap", tags: "carry", rating: 5,
        fees: -9.5, broker_pnl: 109.5, source: "mt5", external_id: "mt5:5001:9",
      });
      expect(netPnl(after!)).toBe(109.5);
    });
  });

  describe("fees", () => {
    it.each([7.25, 0, -1.5])("stores fee %d unchanged through an edit", async (fees) => {
      const id = await createTrade(alice, input({ fees: String(fees) }));
      const parsed = tradeSchema.parse({ ...tradeToFormValues(await getTrade(alice, id)), notes: "reviewed" });
      await updateTrade(alice, id, parsed);
      expect(await getTrade(alice, id)).toMatchObject({ fees, broker_pnl: null, notes: "reviewed" });
    });
  });
});
