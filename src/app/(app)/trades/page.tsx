import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, TradeTable } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMoney, formatPct, pnlClass } from "@/lib/format";
import { summarize } from "@/lib/stats";
import { distinctValues, listTrades, type TradeFilters } from "@/lib/trades";

export const metadata: Metadata = { title: "Trades" };

const PAGE_SIZE = 50;

export default async function TradesPage(props: PageProps<"/trades">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters: TradeFilters = {
    q: str("q"),
    symbol: str("symbol"),
    setup: str("setup"),
    side: str("side"),
    status: str("status") as TradeFilters["status"],
    from: str("from"),
    to: str("to"),
  };
  const page = Math.max(1, Number(str("page")) || 1);
  const trades = await listTrades(user.id, filters);
  const s = summarize(trades);
  const symbols = await distinctValues(user.id, "symbol");
  const setups = await distinctValues(user.id, "setup");
  const filtered = Object.values(filters).some(Boolean);
  const pages = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  const pageHref = (p: number) => {
    const q = new URLSearchParams(exportQuery);
    if (p > 1) q.set("page", String(p));
    return `/trades${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Trades" subtitle={`${trades.length} trade${trades.length === 1 ? "" : "s"}${filtered ? " match your filters" : ""}`}>
        <Link href="/trades/import" className="btn-ghost">Import</Link>
        <a href={`/api/trades/export${exportQuery ? `?${exportQuery}` : ""}`} className="btn-ghost">Export CSV</a>
        <Link href="/trades/new" className="btn-primary">+ Log trade</Link>
      </PageHeader>

      <form className="card mb-3 grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-8" role="search">
        <input name="q" defaultValue={filters.q} placeholder="Search notes, tags…" className="input col-span-2" aria-label="Search" />
        <select name="symbol" defaultValue={filters.symbol ?? ""} className="input" aria-label="Symbol">
          <option value="">All symbols</option>
          {symbols.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="setup" defaultValue={filters.setup ?? ""} className="input" aria-label="Setup">
          <option value="">All setups</option>
          {setups.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="side" defaultValue={filters.side ?? ""} className="input" aria-label="Side">
          <option value="">Any side</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="input" aria-label="Status">
          <option value="">Any status</option>
          <option value="closed">Closed</option>
          <option value="open">Open</option>
        </select>
        <input type="date" name="from" defaultValue={filters.from} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={filters.to} className="input" aria-label="To date" />
        <div className="col-span-2 flex gap-2 sm:col-span-4 lg:col-span-8">
          <button className="btn-primary">Apply filters</button>
          {filtered && <Link href="/trades" className="btn-ghost">Clear</Link>}
        </div>
      </form>

      {trades.length === 0 ? (
        <EmptyState
          title={filtered ? "No trades match" : "No trades yet"}
          body={filtered ? "Try widening your filters." : "Every trade you log shows up here."}
          action={!filtered && <Link href="/trades/new" className="btn-primary">Log your first trade</Link>}
        />
      ) : (
        <>
          <div className="tnum mb-3 flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm text-ink-2">
            <span>Net: <b className={pnlClass(s.netPnl)}>{formatMoney(s.netPnl, user.currency, true)}</b></span>
            <span>Win rate: <b className="text-ink">{formatPct(s.winRate)}</b></span>
            <span>Closed: <b className="text-ink">{s.closedTrades}</b></span>
            <span>Open: <b className="text-ink">{s.openTrades}</b></span>
          </div>
          <div className="card px-4 py-2">
            <TradeTable trades={trades.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} currency={user.currency} />
          </div>
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
              {page > 1 && <Link href={pageHref(page - 1)} className="btn-ghost">← Newer</Link>}
              <span className="text-ink-2">Page {page} of {pages}</span>
              {page < pages && <Link href={pageHref(page + 1)} className="btn-ghost">Older →</Link>}
            </nav>
          )}
        </>
      )}
    </>
  );
}
