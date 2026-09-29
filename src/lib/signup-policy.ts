/**
 * Who may create an account. Pure (reads only the env object it is given) so it can be
 * unit-tested; call it from server code only so the allowlist never reaches the browser.
 *
 * - ALLOW_SIGNUP=true           → anyone may register ("open").
 * - ALLOWED_SIGNUP_EMAILS=a,b   → only those addresses may register ("allowlist").
 * - neither                     → registration is closed (default).
 */

type Env = Record<string, string | undefined>;
export type SignupMode = "open" | "allowlist" | "closed";

export const SIGNUPS_CLOSED = "Sign-ups are closed.";

/** Same normalisation the signup form applies: trimmed, lower-case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function allowlist(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_SIGNUP_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

export function signupMode(env: Env = process.env): SignupMode {
  if ((env.ALLOW_SIGNUP ?? "").trim().toLowerCase() === "true") return "open";
  return allowlist(env).size > 0 ? "allowlist" : "closed";
}

export function isSignupAllowed(email: string, env: Env = process.env): boolean {
  const mode = signupMode(env);
  if (mode === "open") return true;
  if (mode === "closed") return false;
  return allowlist(env).has(normalizeEmail(email));
}
