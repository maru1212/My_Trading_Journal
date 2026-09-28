import Link from "next/link";
import { formatDate, formatMoney, formatNumber, pnlClass } from "@/lib/format";
import { RANGES, type RangeKey } from "@/lib/range";
import { netPnl, rMultiple } from "@/lib/trade-math";
import type { Trade } from "@/lib/types";

export function Stat({
  label, value, hint, tone,
}: { label: string; value: string; hint?: React.ReactNode; tone?: "profit" | "loss" | null }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tracking-tight ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function toneOf(v: number | null | undefined) {
  return !v ? null : v > 0 ? "profit" : "loss";
}

export function Panel({
  title, subtitle, children, action, className = "",
}: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RangeTabs({ current, basePath }: { current: RangeKey; basePath: string }) {
  return (
    <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Date range">
      {RANGES.map((r) => (
        <Link
          key={r.key}
          href={r.key === "all" ? basePath : `${basePath}?range=${r.key}`}
          role="tab"
          aria-selected={current === r.key}
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            current === r.key ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
          }`}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}

export function SideBadge({ side }: { side: Trade["side"] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
      side === "long" ? "bg-profit-fill/12 text-profit" : "bg-loss-fill/12 text-loss"
    }`}>
      {side}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function TradeTable({ trades, currency, compact = false }: { trades: Trade[]; currency: string; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="tnum w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Symbol</th>
            <th className="py-2 pr-3 font-medium">Side</th>
            {!compact && <th className="py-2 pr-3 text-right font-medium">Qty</th>}
            {!compact && <th className="py-2 pr-3 text-right font-medium">Entry</th>}
            {!compact && <th className="py-2 pr-3 text-right font-medium">Exit</th>}
            {!compact && <th className="py-2 pr-3 font-medium">Setup</th>}
            {!compact && <th className="py-2 pr-3 text-right font-medium">R</th>}
            <th className="py-2 text-right font-medium">Net P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnl = netPnl(t);
            const r = rMultiple(t);
            return (
              <tr key={t.id} className="group border-b border-line last:border-0 hover:bg-surface-2">
                <td className="py-2.5 pr-3 whitespace-nowrap text-ink-2">
                  <Link href={`/trades/${t.id}`} className="block">{formatDate(t.entry_date.slice(0, 10))}</Link>
                </td>
                <td className="py-2.5 pr-3 font-medium">
                  <Link href={`/trades/${t.id}`} className="hover:text-accent">{t.symbol}</Link>
                </td>
                <td className="py-2.5 pr-3"><SideBadge side={t.side} /></td>
                {!compact && <td className="py-2.5 pr-3 text-right">{formatNumber(t.quantity, 4)}</td>}
                {!compact && <td className="py-2.5 pr-3 text-right">{formatNumber(t.entry_price, 5)}</td>}
                {!compact && <td className="py-2.5 pr-3 text-right">{t.exit_price === null ? "—" : formatNumber(t.exit_price, 5)}</td>}
                {!compact && <td className="max-w-40 truncate py-2.5 pr-3 text-ink-2">{t.setup ?? "—"}</td>}
                {!compact && <td className={`py-2.5 pr-3 text-right ${pnlClass(r)}`}>{r === null ? "—" : `${r.toFixed(2)}R`}</td>}
                <td className={`py-2.5 text-right font-medium whitespace-nowrap ${pnlClass(pnl)}`}>
                  {pnl === null ? <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">Open</span> : formatMoney(pnl, currency, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
