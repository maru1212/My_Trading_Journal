import "server-only";
import crypto from "node:crypto";
import { db } from "./db";

const PREFIX = "tl_";

function hash(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Creates a new key for the user, replacing any old one. The plain key is only returned here. */
export async function rotateApiKey(userId: number): Promise<string> {
  const key = PREFIX + crypto.randomBytes(24).toString("base64url");
  const hint = `${key.slice(0, 7)}…${key.slice(-4)}`;
  await db()`update users set api_key_hash = ${hash(key)}, api_key_hint = ${hint} where id = ${userId}`;
  return key;
}

export async function revokeApiKey(userId: number) {
  await db()`update users set api_key_hash = null, api_key_hint = null where id = ${userId}`;
}

/** Resolves a Bearer token to a user id, or null. */
export async function userIdForApiKey(authorization: string | null): Promise<number | null> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key?.startsWith(PREFIX)) return null;
  const [row] = await db()<{ id: number }[]>`select id from users where api_key_hash = ${hash(key)}`;
  return row?.id ?? null;
}

export type Mt5Status = { hint: string | null; lastSync: string | null; account: string | null };

export async function mt5Status(userId: number): Promise<Mt5Status> {
  const [row] = await db()<{ hint: string | null; last_sync: string | null; account: string | null }[]>`
    select api_key_hint as hint, mt5_last_sync_at::text as last_sync, mt5_account as account
      from users where id = ${userId}`;
  return { hint: row?.hint ?? null, lastSync: row?.last_sync ?? null, account: row?.account ?? null };
}
