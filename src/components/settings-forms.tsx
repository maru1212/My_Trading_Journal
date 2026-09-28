"use client";

import { useActionState } from "react";
import { changePassword, updateSettings } from "@/app/actions/settings";
import type { FormState } from "@/lib/validation";

function Result({ state }: { state: FormState }) {
  if (!state?.message) return null;
  return <p className={`text-sm ${state.ok ? "text-profit" : "text-loss"}`}>{state.message}</p>;
}

function Err({ state, name }: { state: FormState; name: string }) {
  const e = state?.errors?.[name];
  return e ? <p className="field-error">{e[0]}</p> : null;
}

export function SettingsForm({ user }: { user: { name: string; currency: string; starting_balance: number } }) {
  const [state, action, pending] = useActionState(updateSettings, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="label">Name</label>
          <input id="name" name="name" defaultValue={state?.values?.name ?? user.name} className="input" required />
          <Err state={state} name="name" />
        </div>
        <div>
          <label htmlFor="currency" className="label">Currency</label>
          <input id="currency" name="currency" defaultValue={state?.values?.currency ?? user.currency} maxLength={3} className="input uppercase" required />
          <Err state={state} name="currency" />
        </div>
        <div>
          <label htmlFor="starting_balance" className="label">Starting balance</label>
          <input id="starting_balance" name="starting_balance" type="number" step="any" min="0" defaultValue={state?.values?.starting_balance ?? user.starting_balance} className="input" />
          <Err state={state} name="starting_balance" />
        </div>
      </div>
      <p className="text-xs text-muted">The starting balance anchors your equity curve, % return and drawdown.</p>
      <Result state={state} />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="current" className="label">Current password</label>
          <input id="current" name="current" type="password" autoComplete="current-password" className="input" required />
          <Err state={state} name="current" />
        </div>
        <div>
          <label htmlFor="next" className="label">New password</label>
          <input id="next" name="next" type="password" autoComplete="new-password" className="input" required />
          <Err state={state} name="next" />
        </div>
      </div>
      <Result state={state} />
      <button className="btn-primary" disabled={pending}>{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
