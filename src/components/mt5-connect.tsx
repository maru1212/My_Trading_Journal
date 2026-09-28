"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { connectMt5, disconnectMt5, getMt5Status, syncMt5 } from "@/app/actions/mt5";
import type { Mt5Connection } from "@/lib/mt5-sync";

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleString();
}

function Dot({ tone }: { tone: "ok" | "wait" | "bad" | "off" }) {
  const cls = { ok: "bg-profit-fill", wait: "bg-[var(--warn)] animate-pulse", bad: "bg-loss-fill", off: "bg-surface-2 ring-1 ring-line" }[tone];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden="true" />;
}

export function SyncButton({ className = "btn-ghost", onDone }: { className?: string; onDone?: (msg: { ok: boolean; message: string }) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncMt5();
            setMsg(r);
            onDone?.(r);
            router.refresh();
          })
        }
      >
        {pending ? "Syncing MT5…" : "Sync MT5"}
      </button>
      {msg && !onDone && <span className={`text-xs ${msg.ok ? "text-profit" : "text-loss"}`}>{msg.message}</span>}
    </span>
  );
}

function ConnectForm() {
  const [state, action, pending] = useActionState(connectMt5, undefined);
  const err = (k: string) => state?.errors?.[k]?.[0];
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="mt5-login" className="label">Login (account number)</label>
          <input id="mt5-login" name="login" inputMode="numeric" autoComplete="off" defaultValue={state?.values?.login} placeholder="51234567" className="input" required />
          {err("login") && <p className="field-error">{err("login")}</p>}
        </div>
        <div>
          <label htmlFor="mt5-password" className="label">Investor password</label>
          <input id="mt5-password" name="password" type="password" autoComplete="new-password" className="input" required />
          {err("password") && <p className="field-error">{err("password")}</p>}
        </div>
        <div>
          <label htmlFor="mt5-server" className="label">Server</label>
          <input id="mt5-server" name="server" autoComplete="off" defaultValue={state?.values?.server} placeholder="ICMarketsSC-Demo" className="input" required />
          {err("server") && <p className="field-error">{err("server")}</p>}
        </div>
      </div>
      <div className="max-w-xs">
        <label htmlFor="mt5-history" className="label">Import history from the last</label>
        <select id="mt5-history" name="history_days" defaultValue={state?.values?.history_days ?? "90"} className="input">
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">6 months</option>
          <option value="365">1 year</option>
          <option value="730">2 years</option>
        </select>
      </div>
      {state?.message && !state.ok && <p className="text-sm text-loss">{state.message}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Connecting… this can take a minute" : "Connect MT5"}</button>
      <p className="text-xs text-muted">
        Use your <b>investor (read-only) password</b>: it can see trades but can&apos;t place them. Your login and server are shown in
        MT5 under <b>File → Login to Trade Account</b>. The password is passed to MetaApi, which runs the MT5 connection in the
        cloud. TradeLog never stores it.
      </p>
    </form>
  );
}

function Connected({ conn }: { conn: Mt5Connection }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ state?: string; connectionStatus?: string; error?: string } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, startSync] = useTransition();
  const [removing, startRemove] = useTransition();
  const firstSyncDone = useRef(false);
  const ready = status?.state === "DEPLOYED" && status?.connectionStatus === "CONNECTED";

  // Poll the connection until it's up (new accounts take 1–3 minutes to deploy).
  useEffect(() => {
    let stop = false;
    let tries = 0;
    async function poll() {
      const s = await getMt5Status();
      if (stop) return;
      setStatus(s);
      const up = s.state === "DEPLOYED" && s.connectionStatus === "CONNECTED";
      if (!up && !s.error && tries++ < 60) setTimeout(poll, 5000);
    }
    poll();
    return () => {
      stop = true;
    };
  }, []);

  // First sync runs automatically once the account is connected.
  useEffect(() => {
    if (ready && !conn.lastSync && !firstSyncDone.current) {
      firstSyncDone.current = true;
      startSync(async () => {
        setNote(await syncMt5());
        router.refresh();
      });
    }
  }, [ready, conn.lastSync, router]);

  let tone: "ok" | "wait" | "bad" = "wait";
  let label = "Checking connection…";
  if (status?.error) [tone, label] = ["bad", status.error];
  else if (status && !ready) {
    [tone, label] = status.state === "DEPLOY_FAILED" || status.connectionStatus === "DISCONNECTED_FROM_BROKER"
      ? ["bad", "Can't reach your broker. Check the login, password and server, then disconnect and connect again."]
      : ["wait", "Starting your MT5 connection… this usually takes 1–3 minutes"];
  } else if (ready) [tone, label] = ["ok", "Connected"];

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-line p-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5"><Dot tone={syncing ? "wait" : tone} /></span>
          <div className="min-w-0">
            <p className="font-medium">
              {conn.login} · {conn.server}
            </p>
            <p className="text-ink-2">{syncing ? "Syncing trades…" : label}</p>
            <p className="mt-1 text-xs text-muted">
              {conn.lastSync ? `Last synced ${timeAgo(conn.lastSync)}` : "Not synced yet"}
              {" · syncs automatically once a day"}
            </p>
          </div>
        </div>
        {conn.lastError && !note && <p className="mt-3 text-sm text-loss">Last sync failed: {conn.lastError}</p>}
        {note && <p className={`mt-3 text-sm ${note.ok ? "text-profit" : "text-loss"}`}>{note.message}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={syncing || !ready}
          onClick={() =>
            startSync(async () => {
              setNote(await syncMt5());
              router.refresh();
            })
          }
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={removing}
          onClick={() => {
            if (!confirm("Disconnect MT5? Syncing stops and the cloud connection is removed. Trades already synced stay in your journal.")) return;
            startRemove(async () => {
              const r = await disconnectMt5();
              if (!r.ok) setNote({ ok: false, message: r.message ?? "Couldn't disconnect" });
              router.refresh();
            });
          }}
        >
          {removing ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </div>
  );
}

export function Mt5Connect({ conn }: { conn: Mt5Connection }) {
  if (!conn.configured) {
    return (
      <div className="space-y-2 text-sm text-ink-2">
        <p>MT5 connection isn&apos;t set up on this server yet.</p>
        <p>
          Create a free account at <a href="https://app.metaapi.cloud" target="_blank" rel="noreferrer" className="text-accent hover:underline">metaapi.cloud</a>,
          copy your API token, and add it in Vercel as the environment variable <code className="font-mono text-xs">METAAPI_TOKEN</code>. Then redeploy.
        </p>
      </div>
    );
  }
  return conn.accountId ? <Connected key={conn.accountId} conn={conn} /> : <ConnectForm />;
}
