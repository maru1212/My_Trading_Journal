import type { Metadata } from "next";
import Link from "next/link";
import { ImportForm } from "@/components/import-form";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { CSV_COLUMNS } from "@/lib/csv";

export const metadata: Metadata = { title: "Import trades" };

export default async function ImportPage() {
  await requireUser();
  return (
    <div className="max-w-3xl">
      <Link href="/trades" className="text-sm text-ink-2 hover:text-ink">← Trades</Link>
      <PageHeader title="Import trades" subtitle="Upload a CSV. All rows are checked first; nothing is saved if any row is invalid." />
      <section className="card p-5">
        <ImportForm />
      </section>
      <section className="card mt-3 p-5 text-sm">
        <h2 className="mb-2 font-semibold">File format</h2>
        <p className="text-ink-2">
          The first row must be a header. Required columns: <code>symbol</code>, <code>side</code> (long/short),{" "}
          <code>quantity</code>, <code>entry_date</code>, <code>entry_price</code>. Dates use{" "}
          <code>YYYY-MM-DD</code> or <code>YYYY-MM-DDTHH:mm</code>. Leave <code>exit_price</code> empty for open positions.
        </p>
        <p className="mt-3 text-ink-2">All supported columns:</p>
        <p className="mt-1 rounded-lg bg-surface-2 p-3 font-mono text-xs break-all">{CSV_COLUMNS.join(",")}</p>
        <a href="/api/trades/export?template=1" className="mt-3 inline-block text-accent hover:underline">Download a template</a>
        <span className="text-ink-2"> · An export from this app can be imported back as is.</span>
      </section>
    </div>
  );
}
