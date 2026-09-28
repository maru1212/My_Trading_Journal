import { NextResponse, type NextRequest } from "next/server";
import { userIdForApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { mt5PayloadSchema, toTradeRow } from "@/lib/mt5";

/**
 * Receives positions from the TradeLogSync Expert Advisor running in MetaTrader 5.
 * Auth: `Authorization: Bearer <api key>` from Settings. Idempotent: positions are
 * upserted by account + position id, so re-sending is safe.
 */
export async function POST(request: NextRequest) {
  const userId = await userIdForApiKey(request.headers.get("authorization"));
  if (!userId) {
    return NextResponse.json({ error: "Invalid or missing API key. Create one in TradeLog → Settings." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = mt5PayloadSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `Invalid payload at ${issue.path.join(".")}: ${issue.message}` }, { status: 400 });
  }
  const { login, server, positions } = parsed.data;

  // Last copy wins if the same position appears twice in one batch.
  const rows = [...new Map(positions.map((p) => [p.position_id, toTradeRow(userId, login, p)])).values()];
  const sql = db();
  let inserted = 0;
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    const result = await sql<{ inserted: boolean }[]>`
      insert into trades ${sql(rows as unknown as Record<string, string | number | null>[], cols)}
      on conflict (user_id, external_id) do update set
        symbol = excluded.symbol, asset_class = excluded.asset_class, side = excluded.side,
        quantity = excluded.quantity, multiplier = excluded.multiplier,
        entry_date = excluded.entry_date, entry_price = excluded.entry_price,
        exit_date = excluded.exit_date, exit_price = excluded.exit_price,
        stop_loss = excluded.stop_loss, take_profit = excluded.take_profit,
        fees = excluded.fees, broker_pnl = excluded.broker_pnl, updated_at = now()
      returning (xmax = 0) as inserted`;
    inserted = result.filter((r) => r.inserted).length;
  }
  const account = server ? `${login} · ${server}` : login;
  await sql`update users set mt5_last_sync_at = now(), mt5_account = ${account} where id = ${userId}`;

  return NextResponse.json({ ok: true, received: rows.length, inserted, updated: rows.length - inserted });
}
