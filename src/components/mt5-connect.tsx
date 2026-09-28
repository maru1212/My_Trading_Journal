"use client";

import { useState, useTransition } from "react";
import { createMt5Key, disconnectMt5 } from "@/app/actions/settings";
import type { Mt5Status } from "@/lib/api-keys";
import { formatDate } from "@/lib/format";

function Copy({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex gap-2">
        <code className="input flex-1 truncate font-mono text-xs leading-5 select-all">{value}</code>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function Mt5Connect({ status, syncUrl }: { status: Mt5Status; syncUrl: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const host = new URL(syncUrl).origin;

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${status.lastSync ? "bg-profit-fill" : status.hint ? "bg-[var(--warn)]" : "bg-surface-2 ring-1 ring-line"}`} />
        <span className="text-ink-2">
          {status.lastSync
            ? `Connected${status.account ? ` to ${status.account}` : ""} · last sync ${formatDate(status.lastSync.slice(0, 16).replace(" ", "T"))} (UTC)`
            : status.hint
              ? "Key created — waiting for the first sync from MT5"
              : "Not connected"}
        </span>
      </div>

      {key ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
          <Copy label="Your API key — copy it now, it won't be shown again" value={key} />
        </div>
      ) : (
        status.hint && <p className="text-ink-2">Current key: <code className="font-mono text-xs">{status.hint}</code></p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() => {
            if (status.hint && !confirm("Create a new key? The old key stops working and you'll need to paste the new one into MT5.")) return;
            start(async () => setKey((await createMt5Key()).key));
          }}
        >
          {status.hint ? "Create new key" : "Create API key"}
        </button>
        <a href="/TradeLogSync.mq5" download className="btn-ghost">Download EA (TradeLogSync.mq5)</a>
        {status.hint && (
          <button
            type="button"
            className="btn-danger"
            disabled={pending}
            onClick={() => {
              if (!confirm("Disconnect MT5? The EA will stop syncing. Trades already synced stay in your journal.")) return;
              start(async () => {
                await disconnectMt5();
                setKey(null);
              });
            }}
          >
            Disconnect
          </button>
        )}
      </div>

      <Copy label="Sync URL (paste into the EA's ApiUrl input)" value={syncUrl} />

      <ol className="list-decimal space-y-1.5 pl-5 text-ink-2">
        <li>Create an API key above and download the EA.</li>
        <li>In MT5: <b>File → Open Data Folder</b>, then put the file in <code>MQL5/Experts</code>. Restart MT5 or right-click <b>Expert Advisors → Refresh</b> in the Navigator.</li>
        <li><b>Tools → Options → Expert Advisors</b>: tick <b>Allow WebRequest for listed URL</b> and add <code>{host}</code>.</li>
        <li>Drag <b>TradeLogSync</b> onto any chart. On the <b>Inputs</b> tab paste the sync URL and API key, then click OK. Turn on <b>Algo Trading</b> in the toolbar.</li>
        <li>Check the <b>Experts</b> tab at the bottom of MT5 for “TradeLog: synced …”. Trades appear here within a minute of closing.</li>
      </ol>
      <p className="text-xs text-muted">
        The EA only reads your history. It never places or changes orders. Keep MT5 running (or on a VPS) for live syncing; when it
        restarts it catches up automatically. Times are your broker&apos;s server time.
      </p>
    </div>
  );
}
