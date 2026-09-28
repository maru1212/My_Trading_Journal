import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { CSV_COLUMNS, toCsv } from "@/lib/csv";
import { listTrades, type TradeFilters } from "@/lib/trades";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const template = sp.has("template");
  const filters: TradeFilters = {};
  for (const key of ["q", "symbol", "setup", "side", "status", "from", "to"] as const) {
    const v = sp.get(key);
    if (v) (filters as Record<string, string>)[key] = v;
  }

  const rows = template
    ? [["AAPL", "stock", "long", 100, 1, "2026-01-05T09:35", 185.2, "2026-01-05T11:10", 187.9, 184, 190, 2, "Breakout", "A+,morning", "Clean break of premarket high", 4]]
    : listTrades(user.id, filters)
        .reverse()
        .map((t) => CSV_COLUMNS.map((c) => t[c]));
  const csv = toCsv([[...CSV_COLUMNS], ...rows]);
  const name = template ? "trades-template.csv" : `trades-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
