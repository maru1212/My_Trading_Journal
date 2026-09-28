import type { Metadata } from "next";
import Link from "next/link";
import { EquityChart, PnlBarChart } from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, RangeTabs, Stat, TradeTable, toneOf } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDuration, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { parseRange, rangeStart, RANGES } from "@/lib/range";
import { closedTrades, dailyPnl, equityCurve, groupBy, groupings, summarize } from "@/lib/stats";
import { listTrades } from "@/lib/trades";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const user = await requireUser();
  const range = parseRange((await props.searchParams).range);
  const from = rangeStart(range);
  const trades = await listTrades(user.id, { from });
  const c = user.currency;

  if (trades.length === 0 && range === "all") {
    return (
      <>
        <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle="Your dashboard fills in as you log trades." />
        <EmptyState
          title="No trades yet"
          body="Log your first trade, or import a CSV from your broker, to see your P&L, win rate and equity curve."
          action={
            <div className="flex gap-2">
              <Link href="/trades/new" className="btn-primary">Log a trade</Link>
              <Link href="/trades/import" className="btn-ghost">Import CSV</Link>
            </div>
          }
        />
      </>
    );
  }

  // Equity starts from the balance at the beginning of the range.
  const priorPnl = from
    ? closedTrades(await listTrades(user.id, { to: prevDay(from) })).reduce((a, t) => a + t.pnl, 0)
    : 0;
  const baseline = user.starting_balance + priorPnl;
  const s = summarize(trades, baseline);
  const closed = closedTrades(trades);
  const days = dailyPnl(closed);
  const bySymbol = groupBy(closed, groupings.symbol).slice(0, 8);
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={range === "all" ? "All time" : `${rangeLabel} · since ${formatDate(from!)}`}>
        <RangeTabs current={range} basePath="/dashboard" />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Net P&L"
          value={formatMoney(s.netPnl, c, true)}
          tone={toneOf(s.netPnl)}
          hint={baseline > 0 ? `${formatPct((s.netPnl / baseline) * 100)} return on ${formatMoney(baseline, c)}` : `${s.closedTrades} closed trades`}
        />
        <Stat
          label="Win rate"
          value={formatPct(s.winRate)}
          hint={`${s.wins} W · ${s.losses} L${s.breakeven ? ` · ${s.breakeven} BE` : ""}`}
        />
        <Stat
          label="Profit factor"
          value={s.profitFactor === null ? (s.grossProfit > 0 ? "∞" : "—") : formatNumber(s.profitFactor)}
          hint={`${formatMoney(s.grossProfit, c)} won / ${formatMoney(s.grossLoss, c)} lost`}
        />
        <Stat
          label="Expectancy"
          value={formatMoney(s.expectancy, c, true)}
          tone={toneOf(s.expectancy)}
          hint={s.avgR === null ? "per trade" : `per trade · avg ${s.avgR.toFixed(2)}R`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel title="Equity curve" subtitle="Account balance after each closed trade" className="lg:col-span-2">
          {closed.length ? (
            <EquityChart data={equityCurve(closed, baseline)} currency={c} baseline={baseline} />
          ) : (
            <p className="py-20 text-center text-sm text-muted">No closed trades in this range.</p>
          )}
        </Panel>
        <Panel title="Performance">
          <dl className="tnum space-y-2.5 text-sm">
            <Row label="Average win" value={formatMoney(s.avgWin, c)} className="text-profit" />
            <Row label="Average loss" value={s.avgLoss === null ? "—" : formatMoney(-s.avgLoss, c)} className="text-loss" />
            <Row label="Win / loss ratio" value={formatNumber(s.payoffRatio)} />
            <Row label="Largest win" value={formatMoney(s.largestWin, c)} className="text-profit" />
            <Row label="Largest loss" value={formatMoney(s.largestLoss, c)} className="text-loss" />
            <Row label="Max drawdown" value={`${formatMoney(s.maxDrawdown ? -s.maxDrawdown : 0, c)}${s.maxDrawdownPct !== null ? ` (${formatPct(s.maxDrawdownPct)})` : ""}`} />
            <Row label="Streaks (best / worst)" value={`${s.maxWinStreak}W / ${s.maxLossStreak}L`} />
            <Row label="Avg hold time" value={formatDuration(s.avgHoldMinutes)} />
            <Row label="Fees paid" value={formatMoney(s.totalFees, c)} />
            <Row label="Open positions" value={String(s.openTrades)} />
          </dl>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel
          title="Daily P&L"
          subtitle={`${s.greenDays} of ${s.tradingDays} trading days green`}
          className="lg:col-span-2"
          action={<Link href="/calendar" className="text-xs text-accent hover:underline">Calendar →</Link>}
        >
          {days.length ? (
            <PnlBarChart data={days.map((d) => ({ label: d.date, pnl: d.pnl, trades: d.trades }))} currency={c} dateLabels />
          ) : (
            <p className="py-20 text-center text-sm text-muted">No closed trades in this range.</p>
          )}
        </Panel>
        <Panel title="P&L by symbol" subtitle="Top 8 by net P&L" action={<Link href="/analytics" className="text-xs text-accent hover:underline">More →</Link>}>
          {bySymbol.length ? (
            <PnlBarChart
              data={bySymbol.map((g) => ({ label: g.key, pnl: g.pnl, trades: g.trades, winRate: g.winRate }))}
              currency={c}
              layout="horizontal-bars"
              height={200}
            />
          ) : (
            <p className="py-20 text-center text-sm text-muted">Nothing yet.</p>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent trades"
        className="mt-3"
        action={<Link href="/trades" className="text-xs text-accent hover:underline">All trades →</Link>}
      >
        {trades.length ? (
          <TradeTable trades={trades.slice(0, 8)} currency={c} />
        ) : (
          <p className="py-8 text-center text-sm text-muted">No trades in this range.</p>
        )}
      </Panel>
    </>
  );
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`font-medium ${value === "—" ? "" : className}`}>{value}</dd>
    </div>
  );
}

function prevDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
