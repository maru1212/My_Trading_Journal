import type postgres from "postgres";
import { hashPassword } from "../lib/password";
import { hashToken } from "../lib/sessions";

export async function createUser(sql: postgres.Sql, email: string, password = "password-123") {
  const [{ id }] = await sql<{ id: number }[]>`
    insert into users (email, name, password_hash)
    values (${email}, ${email.split("@")[0]}, ${await hashPassword(password)}) returning id`;
  return id;
}

export async function createSessionRow(sql: postgres.Sql, userId: number, token: string, expiresInMs = 86_400_000) {
  await sql`insert into sessions (token_hash, user_id, expires_at)
            values (${hashToken(token)}, ${userId}, ${new Date(Date.now() + expiresInMs)})`;
}
