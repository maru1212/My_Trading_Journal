import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Stat, toneOf } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatCompactMoney, formatMoney, formatPct } from "@/lib/format";
import { today } from "@/lib/range";
import { closedTrades, dailyPnl, summarize } from "@/lib/stats";
import { listTrades } from "@/lib/trades";

export const metadata: Metadata = { title: "Calendar" };

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth).padStart(2, "0")}`;

  const trades = await listTrades(user.id, { from, to });
  const s = summarize(trades);
  const byDay = new Map(dailyPnl(closedTrades(trades)).map((d) => [d.date, d]));
  const maxAbs = Math.max(1, ...[...byDay.values()].map((d) => Math.abs(d.pnl)));
  const c = user.currency;

  // Monday-first grid with leading blanks.
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const todayStr = today();

  return (
    <>
      <PageHeader title="Calendar" subtitle="Daily net P&L by the day each trade closed">
        <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className="btn-ghost" aria-label="Previous month">←</Link>
        <span className="min-w-36 text-center text-sm font-medium">{title}</span>
        <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className="btn-ghost" aria-label="Next month">→</Link>
        <Link href="/calendar" className="btn-ghost">Today</Link>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Month P&L" value={formatMoney(s.netPnl, c, true)} tone={toneOf(s.netPnl)} />
        <Stat label="Trades" value={String(s.closedTrades)} hint={`${s.wins} W · ${s.losses} L`} />
        <Stat label="Win rate" value={formatPct(s.winRate)} />
        <Stat label="Green days" value={`${s.greenDays} / ${s.tradingDays}`} />
      </div>

      <div className="card overflow-x-auto p-3">
        <table className="tnum w-full min-w-[640px] table-fixed border-separate border-spacing-1.5 text-sm">
          <thead>
            <tr>
              {DOW.map((d) => <th key={d} className="pb-1 text-xs font-medium text-muted">{d}</th>)}
              <th className="pb-1 text-xs font-medium text-muted">Week</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => {
              const weekDays = week.map((d) => (d ? byDay.get(d) : undefined)).filter(Boolean);
              const weekPnl = weekDays.reduce((a, d) => a + d!.pnl, 0);
              const weekTrades = weekDays.reduce((a, d) => a + d!.trades, 0);
              return (
                <tr key={wi}>
                  {week.map((date, di) => {
                    if (!date) return <td key={di} />;
                    const day = byDay.get(date);
                    const intensity = day ? 0.15 + 0.45 * (Math.abs(day.pnl) / maxAbs) : 0;
                    const color = day && day.pnl > 0 ? "var(--profit)" : "var(--loss)";
                    const content = (
                      <>
                        <span className={`text-xs ${date === todayStr ? "rounded bg-accent px-1 font-semibold text-accent-ink" : "text-muted"}`}>
                          {Number(date.slice(8))}
                        </span>
                        {day && (
                          <span className="mt-auto">
                            <span className="block text-sm font-semibold">{formatCompactMoney(day.pnl, c)}</span>
                            <span className="block text-[11px] text-ink-2">{day.trades} trade{day.trades === 1 ? "" : "s"}</span>
                          </span>
                        )}
                      </>
                    );
                    const cellClass = "flex h-20 flex-col rounded-lg border border-line p-2 text-left";
                    return (
                      <td key={di} className="align-top">
                        {day ? (
                          <Link
                            href={`/trades?from=${date}&to=${date}`}
                            className={`${cellClass} hover:border-accent`}
                            style={{ background: day.pnl === 0 ? "var(--neutral-cell)" : `color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, var(--surface))` }}
                            title={`${date}: ${formatMoney(day.pnl, c, true)}`}
                          >
                            {content}
                          </Link>
                        ) : (
                          <div className={`${cellClass} bg-surface`}>{content}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="align-top">
                    <div className="flex h-20 flex-col justify-center rounded-lg bg-surface-2 p-2 text-center">
                      <span className={`text-sm font-semibold ${weekPnl > 0 ? "text-profit" : weekPnl < 0 ? "text-loss" : "text-muted"}`}>
                        {weekTrades ? formatCompactMoney(weekPnl, c) : "—"}
                      </span>
                      {weekTrades > 0 && <span className="text-[11px] text-ink-2">{weekTrades} trade{weekTrades === 1 ? "" : "s"}</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
