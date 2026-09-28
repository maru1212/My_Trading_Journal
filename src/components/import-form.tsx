"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importTrades } from "@/app/actions/trades";

export function ImportForm() {
  const [state, action, pending] = useActionState(importTrades, undefined);
  return (
    <form action={action} className="space-y-4">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="block w-full text-sm text-ink-2 file:mr-4 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-ink"
      />
      {state?.message && (
        <p className={`text-sm whitespace-pre-line ${state.ok ? "text-profit" : "text-loss"}`}>
          {state.message} {state.ok && <Link href="/trades" className="text-accent underline">View trades</Link>}
        </p>
      )}
      <button className="btn-primary" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
    </form>
  );
}
