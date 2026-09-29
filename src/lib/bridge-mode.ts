/**
 * Decides which MT5 bridge to use. Pure, so every configuration can be unit-tested.
 *
 * - No METAAPI_TOKEN → not configured.
 * - METAAPI_TOKEN=mock → fake account, but only in development/test, or when
 *   ALLOW_MT5_MOCK=true is set explicitly. Anything else (production, a missing or unknown
 *   NODE_ENV, an ALLOW_MT5_MOCK value other than "true") fails closed.
 * - Any other token → the real MetaApi SDK.
 */

type Env = Record<string, string | undefined>;

export type BridgeMode =
  | { kind: "sdk"; token: string }
  | { kind: "mock" }
  | { kind: "error"; message: string };

export const MOCK_BLOCKED_MESSAGE =
  "MT5 test mode (METAAPI_TOKEN=mock) is disabled in production. Set a real MetaApi token.";
export const NOT_CONFIGURED_MESSAGE =
  "MT5 connection is not set up on the server (METAAPI_TOKEN is missing).";

export function resolveBridgeMode(env: Env = process.env): BridgeMode {
  const token = (env.METAAPI_TOKEN ?? "").trim();
  if (!token) return { kind: "error", message: NOT_CONFIGURED_MESSAGE };
  if (token !== "mock") return { kind: "sdk", token };

  const nodeEnv = env.NODE_ENV;
  const devOrTest = nodeEnv === "development" || nodeEnv === "test";
  const explicitlyAllowed = (env.ALLOW_MT5_MOCK ?? "").trim().toLowerCase() === "true";
  return devOrTest || explicitlyAllowed ? { kind: "mock" } : { kind: "error", message: MOCK_BLOCKED_MESSAGE };
}
