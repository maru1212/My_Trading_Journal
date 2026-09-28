import type { Metadata } from "next";
import { headers } from "next/headers";
import { logout } from "@/app/actions/auth";
import { PageHeader } from "@/components/page-header";
import { Mt5Connect } from "@/components/mt5-connect";
import { PasswordForm, SettingsForm } from "@/components/settings-forms";
import { mt5Status } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const status = await mt5Status(user.id);
  return (
    <div className="max-w-2xl space-y-3">
      <PageHeader title="Settings" subtitle={user.email} />
      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold">Account</h2>
        <SettingsForm user={user} />
      </section>
      <section id="mt5" className="card p-5">
        <h2 className="mb-1 text-sm font-semibold">MetaTrader 5</h2>
        <p className="mb-4 text-xs text-muted">Sync trades automatically from your MT5 terminal with the TradeLogSync Expert Advisor.</p>
        <Mt5Connect status={status} syncUrl={`${proto}://${host}/api/mt5/trades`} />
      </section>
      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold">Change password</h2>
        <PasswordForm />
      </section>
      <section className="card flex items-center justify-between p-5">
        <div>
          <h2 className="text-sm font-semibold">Sign out</h2>
          <p className="text-xs text-muted">End your session on this device.</p>
        </div>
        <form action={logout}><button className="btn-ghost">Sign out</button></form>
      </section>
    </div>
  );
}
