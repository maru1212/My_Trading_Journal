import type { Metadata } from "next";
import Link from "next/link";
import { PnlBarChart } from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, RangeTabs } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney, formatPct, pnlClass } from "@/lib/format";
import { parseRange, rangeStart } from "@/lib/range";
import { closedTrades, groupBy, groupings, WEEKDAY_ORDER, type Group } from "@/lib/stats";
import { listTrades } from "@/lib/trades";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage(props: PageProps<"/analytics">) {
  const user = await requireUser();
  const range = parseRange((await props.searchParams).range);
  const closed = closedTrades(await listTrades(user.id, { from: rangeStart(range), status: "closed" }));
  const c = user.currency;

  const header = (
    <PageHeader title="Analytics" subtitle="Where your edge is, and where it isn't">
      <RangeTabs current={range} basePath="/analytics" />
    </PageHeader>
  );
  if (!closed.length) {
    return (
      <>
        {header}
        <EmptyState title="Nothing to analyze yet" body="Close a few trades and your breakdowns by setup, symbol, day and time appear here." action={<Link href="/trades/new" className="btn-primary">Log a trade</Link>} />
      </>
    );
  }

  const weekdays = groupBy(closed, groupings.weekday).sort((a, b) => WEEKDAY_ORDER.indexOf(a.key) - WEEKDAY_ORDER.indexOf(b.key));
  const hours = groupBy(closed, groupings.hour).sort((a, b) => a.key.localeCompare(b.key));
  const rBuckets = rDistribution(closed.map((t) => t.r).filter((r): r is number => r !== null));
  const toBars = (gs: Group[]) => gs.map((g) => ({ label: g.key, pnl: g.pnl, trades: g.trades, winRate: g.winRate }));

  return (
    <>
      {header}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="By day of week" subtitle="Net P&L by the day the trade was opened">
          <PnlBarChart data={toBars(weekdays)} currency={c} height={220} />
        </Panel>
        <Panel title="By time of day" subtitle="Net P&L by entry hour">
          <PnlBarChart data={toBars(hours)} currency={c} height={220} />
        </Panel>
        <GroupTable title="By setup" groups={groupBy(closed, groupings.setup)} currency={c} />
        <GroupTable title="By symbol" groups={groupBy(closed, groupings.symbol)} currency={c} />
        <GroupTable title="By tag" groups={groupBy(closed, groupings.tag)} currency={c} empty="Add tags to your trades to compare them." />
        <div className="grid gap-3">
          <GroupTable title="Long vs short" groups={groupBy(closed, groupings.side)} currency={c} />
          <GroupTable title="By asset class" groups={groupBy(closed, groupings.assetClass)} currency={c} />
        </div>
        {rBuckets.length > 0 && (
          <Panel title="R-multiple distribution" subtitle="Trades with a stop loss, bucketed by result in R" className="lg:col-span-2">
            <div className="flex h-40 items-end gap-1.5">
              {rBuckets.map((b) => {
                const max = Math.max(...rBuckets.map((x) => x.count));
                return (
                  <div key={b.label} className="flex flex-1 flex-col items-center gap-1" title={`${b.label}: ${b.count} trades`}>
                    <span className="tnum text-[11px] text-ink-2">{b.count || ""}</span>
                    <div className="w-full rounded-t" style={{ height: `${(b.count / max) * 110}px`, background: b.positive ? "var(--profit)" : "var(--loss)", minHeight: b.count ? 2 : 0 }} />
                    <span className="tnum text-[11px] text-muted">{b.label}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

function GroupTable({ title, groups, currency, empty }: { title: string; groups: Group[]; currency: string; empty?: string }) {
  return (
    <Panel title={title}>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{empty ?? "No data."}</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="tnum w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 text-right font-medium">Trades</th>
                <th className="py-2 pr-3 text-right font-medium">Win %</th>
                <th className="py-2 pr-3 text-right font-medium">Avg</th>
                <th className="py-2 text-right font-medium">Net P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-b border-line last:border-0">
                  <td className="max-w-40 truncate py-2 pr-3 font-medium">{g.key}</td>
                  <td className="py-2 pr-3 text-right text-ink-2">{g.trades}</td>
                  <td className="py-2 pr-3 text-right text-ink-2">{formatPct(g.winRate, 0)}</td>
                  <td className={`py-2 pr-3 text-right ${pnlClass(g.avgPnl)}`}>{formatMoney(g.avgPnl, currency, true)}</td>
                  <td className={`py-2 text-right font-medium ${pnlClass(g.pnl)}`}>{formatMoney(g.pnl, currency, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function rDistribution(rs: number[]) {
  if (!rs.length) return [];
  const edges = [-Infinity, -2, -1, -0.5, 0, 0.5, 1, 2, 3, Infinity];
  const labels = ["< −2R", "−2 to −1", "−1 to −½", "−½ to 0", "0 to ½", "½ to 1", "1 to 2", "2 to 3", "> 3R"];
  return labels.map((label, i) => ({
    label,
    positive: edges[i] >= 0,
    count: rs.filter((r) => r > edges[i] && r <= edges[i + 1]).length,
  }));
}
