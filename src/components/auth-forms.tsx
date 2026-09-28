"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup } from "@/app/actions/auth";

function Field({
  name, label, type = "text", error, autoComplete, defaultValue,
}: { name: string; label: string; type?: string; error?: string[]; autoComplete?: string; defaultValue?: string }) {
  return (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} name={name} type={type} autoComplete={autoComplete} defaultValue={defaultValue} className="input" required />
      {error && <p className="field-error">{error[0]}</p>}
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-2">Sign in to your journal.</p>
      </div>
      <input type="hidden" name="next" value={next ?? ""} />
      <Field name="email" label="Email" type="email" autoComplete="email" error={state?.errors?.email} defaultValue={state?.values?.email} />
      <Field name="password" label="Password" type="password" autoComplete="current-password" error={state?.errors?.password} />
      {state?.message && <p className="text-sm text-loss">{state.message}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-center text-sm text-ink-2">
        No account? <Link href="/signup" className="text-accent hover:underline">Create one</Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Create your journal</h1>
        <p className="mt-1 text-sm text-ink-2">Free, private, and yours.</p>
      </div>
      <Field name="name" label="Name" autoComplete="name" error={state?.errors?.name} defaultValue={state?.values?.name} />
      <Field name="email" label="Email" type="email" autoComplete="email" error={state?.errors?.email} defaultValue={state?.values?.email} />
      <Field name="password" label="Password (8+ characters)" type="password" autoComplete="new-password" error={state?.errors?.password} />
      {state?.message && <p className="text-sm text-loss">{state.message}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Creating…" : "Create account"}</button>
      <p className="text-center text-sm text-ink-2">
        Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
