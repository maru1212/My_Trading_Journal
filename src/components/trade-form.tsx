"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveTrade } from "@/app/actions/trades";
import { formatMoney } from "@/lib/format";
import { netPnl, rMultiple } from "@/lib/trade-math";
import { ASSET_CLASSES, type Trade } from "@/lib/types";

type Values = Record<string, string>;

function toValues(t?: Trade | null): Values {
  const v: Values = {};
  if (!t) return { side: "long", asset_class: "stock", multiplier: "1", fees: "0" };
  for (const [k, val] of Object.entries(t)) v[k] = val === null ? "" : String(val);
  return v;
}

function num(v: string | undefined) {
  return v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

export function TradeForm({
  trade, currency, setups, now,
}: { trade?: Trade | null; currency: string; setups: string[]; now: string }) {
  const [state, action, pending] = useActionState(saveTrade, undefined);
  const [values, setValues] = useState<Values>(() => ({ entry_date: now, ...toValues(trade) }));
  const errors = state?.errors ?? {};

  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  const preview = {
    side: (values.side as Trade["side"]) ?? "long",
    quantity: num(values.quantity) ?? 0,
    multiplier: num(values.multiplier) ?? 1,
    entry_price: num(values.entry_price) ?? 0,
    exit_price: num(values.exit_price),
    stop_loss: num(values.stop_loss),
    fees: num(values.fees) ?? 0,
    broker_pnl: trade?.broker_pnl ?? null,
  };
  const pnl = preview.quantity && preview.entry_price ? netPnl(preview) : null;
  const r = pnl !== null ? rMultiple(preview) : null;

  function field(name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    return (
      <div>
        <label htmlFor={name} className="label">{label}</label>
        <input id={name} name={name} value={values[name] ?? ""} onChange={set(name)} className="input" {...props} />
        {errors[name] && <p className="field-error">{errors[name]![0]}</p>}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {trade && <input type="hidden" name="id" value={trade.id} />}

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold">Position</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("symbol", "Symbol", { placeholder: "AAPL", required: true, autoFocus: !trade, className: "input uppercase" })}
          <div>
            <span className="label">Side</span>
            <div className="grid grid-cols-2 rounded-lg border border-line p-0.5">
              {(["long", "short"] as const).map((s) => (
                <label key={s} className={`cursor-pointer rounded-md py-1.5 text-center text-sm font-medium capitalize ${
                  values.side === s ? (s === "long" ? "bg-profit-fill text-white" : "bg-loss-fill text-white") : "text-ink-2"
                }`}>
                  <input type="radio" name="side" value={s} checked={values.side === s} onChange={set("side")} className="sr-only" />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="asset_class" className="label">Asset class</label>
            <select id="asset_class" name="asset_class" value={values.asset_class} onChange={set("asset_class")} className="input capitalize">
              {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {field("quantity", "Quantity", { type: "number", step: "any", min: "0", required: true, inputMode: "decimal" })}
          {field("multiplier", "Multiplier", { type: "number", step: "any", min: "0", inputMode: "decimal", title: "Contract size, e.g. 100 for options or 50 for ES futures" })}
          {field("fees", `Fees & commissions (${currency})`, { type: "number", step: "any", min: "0", inputMode: "decimal" })}
          {field("stop_loss", "Stop loss", { type: "number", step: "any", inputMode: "decimal" })}
          {field("take_profit", "Take profit", { type: "number", step: "any", inputMode: "decimal" })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold">Entry &amp; exit</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("entry_date", "Entry date & time", { type: "datetime-local", required: true })}
          {field("entry_price", "Entry price", { type: "number", step: "any", min: "0", required: true, inputMode: "decimal" })}
          {field("exit_date", "Exit date & time", { type: "datetime-local" })}
          {field("exit_price", "Exit price", { type: "number", step: "any", min: "0", inputMode: "decimal", placeholder: "Leave empty if open" })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-surface-2 px-4 py-3 text-sm">
          <span className="text-ink-2">
            Net P&amp;L:{" "}
            <b className={`tnum ${pnl === null ? "text-ink-2" : pnl > 0 ? "text-profit" : pnl < 0 ? "text-loss" : ""}`}>
              {pnl === null ? "open" : formatMoney(pnl, currency, true)}
            </b>
          </span>
          {r !== null && <span className="text-ink-2">R-multiple: <b className="tnum text-ink">{r.toFixed(2)}R</b></span>}
          {trade?.source === "mt5" && (
            <span className="text-xs text-muted">Synced from MT5. P&amp;L comes from your broker, and the next sync overwrites price and size edits.</span>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold">Journal</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            {field("setup", "Setup / strategy", { list: "setups", placeholder: "Breakout" })}
            <datalist id="setups">{setups.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          {field("tags", "Tags (comma separated)", { placeholder: "A+, news, revenge" })}
          <div>
            <label htmlFor="rating" className="label">Execution rating</label>
            <select id="rating" name="rating" value={values.rating ?? ""} onChange={set("rating")} className="input">
              <option value="">—</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5 - n)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="notes" className="label">Notes</label>
          <textarea id="notes" name="notes" rows={5} value={values.notes ?? ""} onChange={set("notes")} className="input" placeholder="Why did you take it? What went right or wrong?" />
        </div>
      </section>

      {state?.message && <p className="text-sm text-loss">{state.message}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : trade ? "Save changes" : "Log trade"}</button>
        <Link href={trade ? `/trades/${trade.id}` : "/trades"} className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
