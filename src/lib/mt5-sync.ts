import "server-only";
import { db } from "./db";
import { BridgeError, bridgeConfigured, getBridge } from "./metaapi";
import { positionsFromSnapshot, toTradeRow } from "./mt5";

export type Mt5Connection = {
  configured: boolean; // METAAPI_TOKEN present on the server
  accountId: string | null;
  login: string | null;
  server: string | null;
  lastSync: string | null; // ISO, UTC
  lastError: string | null;
};

export async function getConnection(userId: number): Promise<Mt5Connection> {
  const [row] = await db()<{ account_id: string | null; login: string | null; server: string | null; last_sync: Date | null; last_error: string | null }[]>`
    select metaapi_account_id as account_id, mt5_login as login, mt5_server as server,
           mt5_last_sync_at as last_sync, mt5_last_error as last_error
      from users where id = ${userId}`;
  return {
    configured: bridgeConfigured(),
    accountId: row?.account_id ?? null,
    login: row?.login ?? null,
    server: row?.server ?? null,
    lastSync: row?.last_sync ? row.last_sync.toISOString() : null,
    lastError: row?.last_error ?? null,
  };
}

/** Registers the account with MetaApi. The password goes to MetaApi only; we never store it. */
export async function connectAccount(userId: number, input: { login: string; password: string; server: string; historyDays: number }) {
  const existing = await getConnection(userId);
  if (existing.accountId) throw new BridgeError("An MT5 account is already connected. Disconnect it first.");
  const bridge = await getBridge();
  const accountId = await bridge.createAccount({
    login: input.login,
    password: input.password,
    server: input.server,
    name: `TradeLog user ${userId} · ${input.login}`,
  });
  const from = new Date(Date.now() - input.historyDays * 86_400_000);
  await db()`
    update users set metaapi_account_id = ${accountId}, mt5_login = ${input.login}, mt5_server = ${input.server},
           mt5_account = ${`${input.login} · ${input.server}`}, mt5_sync_from = ${from},
           mt5_last_sync_at = null, mt5_last_error = null
     where id = ${userId}`;
  return accountId;
}

export async function connectionStatus(userId: number) {
  const conn = await getConnection(userId);
  if (!conn.accountId) return null;
  return (await getBridge()).status(conn.accountId);
}

export type SyncResult = { received: number; inserted: number; updated: number };

/** Pulls deals since the last sync (minus a 2-day overlap) and upserts them as trades. */
export async function syncUser(userId: number): Promise<SyncResult> {
  const sql = db();
  const [u] = await sql<{ account_id: string | null; login: string | null; sync_from: Date | null; last_sync: Date | null }[]>`
    select metaapi_account_id as account_id, mt5_login as login, mt5_sync_from as sync_from, mt5_last_sync_at as last_sync
      from users where id = ${userId}`;
  if (!u?.account_id) throw new BridgeError("No MT5 account is connected.");

  const from = u.last_sync
    ? new Date(u.last_sync.getTime() - 2 * 86_400_000)
    : (u.sync_from ?? new Date(Date.now() - 90 * 86_400_000));
  const startedAt = new Date();
  try {
    const snap = await (await getBridge()).fetch(u.account_id, from);
    const login = snap.login || u.login || "mt5";
    const rows = positionsFromSnapshot(snap).map((p) => toTradeRow(userId, login, p));

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const result = await sql<{ inserted: boolean }[]>`
        insert into trades ${sql(chunk as unknown as Record<string, string | number | null>[], Object.keys(chunk[0]))}
        on conflict (user_id, external_id) do update set
          symbol = excluded.symbol, asset_class = excluded.asset_class, side = excluded.side,
          quantity = excluded.quantity, multiplier = excluded.multiplier,
          entry_date = excluded.entry_date, entry_price = excluded.entry_price,
          exit_date = excluded.exit_date, exit_price = excluded.exit_price,
          stop_loss = excluded.stop_loss, take_profit = excluded.take_profit,
          fees = excluded.fees, broker_pnl = excluded.broker_pnl, updated_at = now()
        returning (xmax = 0) as inserted`;
      inserted += result.filter((r) => r.inserted).length;
    }
    await sql`
      update users set mt5_last_sync_at = ${startedAt}, mt5_last_error = null,
             mt5_account = ${`${login} · ${snap.server}`}
       where id = ${userId}`;
    return { received: rows.length, inserted, updated: rows.length - inserted };
  } catch (err) {
    const message = err instanceof BridgeError ? err.message : "Sync failed. Please try again in a minute.";
    await sql`update users set mt5_last_error = ${message} where id = ${userId}`;
    if (!(err instanceof BridgeError)) console.error("MT5 sync failed", err);
    throw err instanceof BridgeError ? err : new BridgeError(message);
  }
}

/** Removes the MetaApi account (stops its billing). Synced trades stay in the journal. */
export async function disconnect(userId: number) {
  const conn = await getConnection(userId);
  if (conn.accountId) await (await getBridge()).remove(conn.accountId);
  await db()`
    update users set metaapi_account_id = null, mt5_last_sync_at = null, mt5_last_error = null, mt5_sync_from = null
     where id = ${userId}`;
}

/** All users with a connected account, for the scheduled sync. */
export async function connectedUserIds(): Promise<number[]> {
  const rows = await db()<{ id: number }[]>`select id from users where metaapi_account_id is not null`;
  return rows.map((r) => r.id);
}
