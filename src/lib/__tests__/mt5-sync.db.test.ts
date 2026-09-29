import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { describeDb } from "../../test/db";
import { createUser } from "../../test/fixtures";
import { BridgeError } from "../metaapi";
import { getConnection, syncUser } from "../mt5-sync";
import { createTrade, getTrade, listTrades, updateTrade } from "../trades";
import { tradeSchema } from "../validation";

// MetaApi is the one external boundary: use the built-in mock bridge (allowed under NODE_ENV=test).
let previousToken: string | undefined;
beforeAll(() => {
  previousToken = process.env.METAAPI_TOKEN;
  process.env.METAAPI_TOKEN = "mock";
});
afterAll(() => {
  if (previousToken === undefined) delete process.env.METAAPI_TOKEN;
  else process.env.METAAPI_TOKEN = previousToken;
});

describeDb("mt5 sync upsert", (db) => {
  let alice: number;
  let bob: number;

  const connect = (userId: number, accountId: string) =>
    db.sql`update users set metaapi_account_id = ${accountId}, mt5_login = '5001', mt5_server = 'ICMarketsSC-Demo' where id = ${userId}`;
  const byExternalId = async (userId: number) =>
    Object.fromEntries((await listTrades(userId)).map((t) => [t.external_id, t]));

  beforeEach(async () => {
    alice = await createUser(db.sql, "alice@example.com");
    bob = await createUser(db.sql, "bob@example.com");
  });

  it("first sync inserts positions for that user with broker P&L and signed fees", async () => {
    await connect(alice, "mock-5001-a");
    expect(await syncUser(alice)).toEqual({ received: 3, inserted: 3, updated: 0 });
    const t = await byExternalId(alice);
    expect(Object.keys(t).sort()).toEqual(["mt5:5001:7001", "mt5:5001:7002", "mt5:5001:7003"]);
    expect(t["mt5:5001:7001"]).toMatchObject({ source: "mt5", symbol: "EURUSD", fees: 7, broker_pnl: 293, user_id: alice });
    expect(t["mt5:5001:7002"]).toMatchObject({ symbol: "XAUUSD", fees: 5.5, broker_pnl: 494.5 });
    expect(t["mt5:5001:7003"]).toMatchObject({ exit_price: null, broker_pnl: null });
    const conn = await getConnection(alice);
    expect(conn.lastSync).not.toBeNull();
    expect(conn.lastError).toBeNull();
  });

  it("re-syncing upserts instead of duplicating", async () => {
    await connect(alice, "mock-5001-a");
    await syncUser(alice);
    expect(await syncUser(alice)).toEqual({ received: 3, inserted: 0, updated: 3 });
    expect(await listTrades(alice)).toHaveLength(3);
  });

  it("re-sync keeps journal fields and restores broker-owned fields", async () => {
    await connect(alice, "mock-5001-a");
    await syncUser(alice);
    const gold = (await byExternalId(alice))["mt5:5001:7002"];
    // User edits journal fields and (by mistake) the exit price.
    const edited = tradeSchema.parse({
      symbol: gold.symbol, asset_class: gold.asset_class, side: gold.side, quantity: String(gold.quantity),
      multiplier: String(gold.multiplier), entry_date: gold.entry_date, entry_price: String(gold.entry_price),
      exit_date: gold.exit_date ?? "", exit_price: "2600", fees: String(gold.fees),
      setup: "Silver bullet", tags: "ict,ny", notes: "Displacement after FVG", rating: "5",
    });
    await updateTrade(alice, gold.id, edited);
    await syncUser(alice);
    expect(await getTrade(alice, gold.id)).toMatchObject({
      setup: "Silver bullet", tags: "ict,ny", notes: "Displacement after FVG", rating: 5,
      exit_price: 2640.5, fees: 5.5, broker_pnl: 494.5,
    });
  });

  it("is scoped per user: the same MT5 account synced by two users yields separate rows", async () => {
    await connect(alice, "mock-5001-a");
    await connect(bob, "mock-5001-b");
    const manual = await createTrade(bob, tradeSchema.parse({ symbol: "US30", side: "long", quantity: "1", entry_date: "2026-07-01", entry_price: "40000" }));
    await syncUser(alice);
    expect(await listTrades(bob)).toHaveLength(1); // Alice's sync didn't touch Bob
    await syncUser(bob);
    expect(await listTrades(alice)).toHaveLength(3);
    expect(await listTrades(bob)).toHaveLength(4);
    expect((await getTrade(bob, manual))?.source).toBe("manual");
    const aliceIds = new Set((await listTrades(alice)).map((t) => t.id));
    expect((await listTrades(bob)).some((t) => aliceIds.has(t.id))).toBe(false);
  });

  it("refuses to sync a user without a connected account", async () => {
    await expect(syncUser(alice)).rejects.toBeInstanceOf(BridgeError);
    expect(await listTrades(alice)).toHaveLength(0);
  });
});
