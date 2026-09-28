import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { removeTrade } from "@/app/actions/trades";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader } from "@/components/page-header";
import { SideBadge, Stat, toneOf } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDuration, formatMoney, formatNumber, formatPct } from "@/lib/format";
import { initialRisk, netPnl, parseTags, returnPct, rMultiple } from "@/lib/trade-math";
import { getTrade } from "@/lib/trades";

export const metadata: Metadata = { title: "Trade" };

export default async function TradePage(props: PageProps<"/trades/[id]">) {
  const user = await requireUser();
  const t = await getTrade(user.id, Number((await props.params).id));
  if (!t) notFound();
  const c = user.currency;
  const pnl = netPnl(t);
  const r = rMultiple(t);
  const risk = initialRisk(t);
  const hold = t.exit_date ? (Date.parse(t.exit_date + "Z") - Date.parse(t.entry_date + "Z")) / 60_000 : null;
  const tags = parseTags(t.tags);

  return (
    <div className="max-w-4xl">
      <Link href="/trades" className="text-sm text-ink-2 hover:text-ink">← Trades</Link>
      <PageHeader title={t.symbol} subtitle={`${t.asset_class} · opened ${formatDate(t.entry_date)}`}>
        <SideBadge side={t.side} />
        {t.source === "mt5" && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2" title={`Position #${t.external_id?.split(":").pop()}`}>
            MT5
          </span>
        )}
        <Link href={`/trades/${t.id}/edit`} className="btn-ghost">Edit</Link>
        <form action={removeTrade}>
          <input type="hidden" name="id" value={t.id} />
          <ConfirmButton message="Delete this trade? This cannot be undone." className="btn-danger">Delete</ConfirmButton>
        </form>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Net P&L" value={pnl === null ? "Open" : formatMoney(pnl, c, true)} tone={toneOf(pnl)} hint={t.broker_pnl !== null ? "as reported by MT5, after costs" : t.fees ? `after ${formatMoney(t.fees, c)} fees` : undefined} />
        <Stat label="Return" value={formatPct(returnPct(t), 2)} tone={toneOf(returnPct(t))} hint="price move, before fees" />
        <Stat label="R-multiple" value={r === null ? "—" : `${r.toFixed(2)}R`} tone={toneOf(r)} hint={t.broker_pnl !== null ? (r === null ? "no stop loss set" : "price move ÷ stop distance") : risk ? `risked ${formatMoney(risk, c)}` : "add a stop to track R"} />
        <Stat label="Hold time" value={formatDuration(hold)} />
      </div>

      <section className="card mt-3 p-5">
        <dl className="tnum grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
          <Item label="Quantity" value={formatNumber(t.quantity, 6)} />
          <Item label="Multiplier" value={formatNumber(t.multiplier, 4)} />
          <Item label="Entry price" value={formatNumber(t.entry_price, 6)} />
          <Item label="Exit price" value={t.exit_price === null ? "—" : formatNumber(t.exit_price, 6)} />
          <Item label="Entry" value={formatDate(t.entry_date)} />
          <Item label="Exit" value={formatDate(t.exit_date)} />
          <Item label="Stop loss" value={t.stop_loss === null ? "—" : formatNumber(t.stop_loss, 6)} />
          <Item label="Take profit" value={t.take_profit === null ? "—" : formatNumber(t.take_profit, 6)} />
          <Item label="Setup" value={t.setup ?? "—"} />
          <Item label="Rating" value={t.rating ? "★".repeat(t.rating) + "☆".repeat(5 - t.rating) : "—"} />
          <div className="col-span-2">
            <dt className="text-xs text-muted">Tags</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {tags.length ? tags.map((tag) => (
                <Link key={tag} href={`/trades?q=${encodeURIComponent(tag)}`} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs hover:text-accent">{tag}</Link>
              )) : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card mt-3 p-5">
        <h2 className="mb-2 text-sm font-semibold">Notes</h2>
        {t.notes ? <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{t.notes}</p> : <p className="text-sm text-muted">No notes for this trade.</p>}
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
