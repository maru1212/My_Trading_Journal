import { NextResponse, type NextRequest } from "next/server";
import { connectedUserIds, syncUser } from "@/lib/mt5-sync";

export const maxDuration = 300;

/** Daily sync for every connected MT5 account. Vercel Cron calls this with CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results: Record<number, string> = {};
  for (const id of await connectedUserIds()) {
    try {
      const r = await syncUser(id);
      results[id] = `ok: ${r.inserted} new, ${r.updated} updated`;
    } catch (err) {
      results[id] = `error: ${(err as Error).message}`;
    }
  }
  return NextResponse.json({ ok: true, results });
}
