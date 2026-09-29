import crypto from "node:crypto";
import type postgres from "postgres";
import { hashPassword, verifyPassword } from "./password";

// Session queries that take the connection as a parameter, so they can be tested against a
// real Postgres without Next.js request APIs. `auth.ts` wires them to cookies and db().

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  currency: string;
  starting_balance: number;
};

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function findSessionUser(sql: postgres.Sql, tokenHash: string): Promise<SessionUser | null> {
  const [row] = await sql<SessionUser[]>`
    select u.id, u.email, u.name, u.currency, u.starting_balance
      from sessions s join users u on u.id = s.user_id
     where s.token_hash = ${tokenHash} and s.expires_at > now()`;
  return row ?? null;
}

export type ChangePasswordResult = "ok" | "wrong-password" | "not-found";

/**
 * Verifies the current password, then in one transaction signs out every other session of
 * this user and stores the new hash. The session identified by `keepTokenHash` stays valid.
 * If anything in the transaction fails, nothing is changed.
 */
export async function changePasswordAndRevokeOtherSessions(
  sql: postgres.Sql,
  input: { userId: number; keepTokenHash: string; currentPassword: string; newPassword: string },
  hash: (password: string) => Promise<string> = hashPassword,
): Promise<ChangePasswordResult> {
  const [row] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${input.userId}`;
  if (!row) return "not-found";
  if (!(await verifyPassword(input.currentPassword, row.password_hash))) return "wrong-password";

  const newHash = await hash(input.newPassword);
  await sql.begin(async (transaction) => {
    // TransactionSql drops the tagged-template call signature in postgres.js's types.
    const tx = transaction as unknown as postgres.Sql;
    await tx`delete from sessions where user_id = ${input.userId} and token_hash <> ${input.keepTokenHash}`;
    await tx`update users set password_hash = ${newHash} where id = ${input.userId}`;
  });
  return "ok";
}
