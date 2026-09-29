import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";
import { changePasswordAndRevokeOtherSessions, findSessionUser, hashToken } from "../sessions";

/**
 * Runs against a real Postgres when DATABASE_URL_TEST is set, e.g.
 *   DATABASE_URL_TEST=postgres://postgres@localhost:5432/journal_test npm test
 * Each run creates its own throwaway schema and drops it afterwards; nothing else is touched.
 */
const url = process.env.DATABASE_URL_TEST;
const schema = `t1_sessions_${crypto.randomBytes(4).toString("hex")}`;

describe.skipIf(!url)("password change and sessions (Postgres)", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let alice: number;
  let bob: number;
  const token = { aliceCurrent: "alice-current", aliceOther: "alice-laptop", bob: "bob-phone" };

  beforeAll(async () => {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url!);
    const opts = { prepare: false, max: 1, ssl: local ? false : ("require" as const), onnotice: () => {} };
    admin = postgres(url!, opts);
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { ...opts, connection: { search_path: schema } });
    await sql.unsafe(fs.readFileSync(path.resolve(import.meta.dirname, "../../../supabase/schema.sql"), "utf8"));
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.end();
  });

  beforeEach(async () => {
    await sql`truncate sessions, trades, users restart identity cascade`;
    const hash = await hashPassword("old-password-1");
    [{ id: alice }] = await sql<{ id: number }[]>`insert into users (email, name, password_hash) values ('alice@example.com', 'Alice', ${hash}) returning id`;
    [{ id: bob }] = await sql<{ id: number }[]>`insert into users (email, name, password_hash) values ('bob@example.com', 'Bob', ${hash}) returning id`;
    const expires = new Date(Date.now() + 86_400_000);
    for (const [t, id] of [[token.aliceCurrent, alice], [token.aliceOther, alice], [token.bob, bob]] as const) {
      await sql`insert into sessions (token_hash, user_id, expires_at) values (${hashToken(t)}, ${id}, ${expires})`;
    }
  });

  const storedHash = async (id: number) =>
    (await sql<{ password_hash: string }[]>`select password_hash from users where id = ${id}`)[0].password_hash;

  it("keeps the current session, signs out the user's other sessions, leaves other users alone", async () => {
    const result = await changePasswordAndRevokeOtherSessions(sql, {
      userId: alice,
      keepTokenHash: hashToken(token.aliceCurrent),
      currentPassword: "old-password-1",
      newPassword: "new-password-2",
    });
    expect(result).toBe("ok");
    expect((await findSessionUser(sql, hashToken(token.aliceCurrent)))?.id).toBe(alice);
    expect(await findSessionUser(sql, hashToken(token.aliceOther))).toBeNull();
    expect((await findSessionUser(sql, hashToken(token.bob)))?.id).toBe(bob);

    const hash = await storedHash(alice);
    expect(await verifyPassword("new-password-2", hash)).toBe(true);
    expect(await verifyPassword("old-password-1", hash)).toBe(false);
    expect(await verifyPassword("old-password-1", await storedHash(bob))).toBe(true);
  });

  it("changes nothing when the current password is wrong", async () => {
    const before = await storedHash(alice);
    const result = await changePasswordAndRevokeOtherSessions(sql, {
      userId: alice,
      keepTokenHash: hashToken(token.aliceCurrent),
      currentPassword: "not-my-password",
      newPassword: "new-password-2",
    });
    expect(result).toBe("wrong-password");
    expect(await storedHash(alice)).toBe(before);
    for (const t of Object.values(token)) expect(await findSessionUser(sql, hashToken(t))).not.toBeNull();
  });

  it("rolls back the sign-outs if storing the new password fails", async () => {
    const before = await storedHash(alice);
    // Hash function yields NULL, so the UPDATE (after the DELETE) violates NOT NULL.
    const failingHash = async () => null as unknown as string;
    await expect(
      changePasswordAndRevokeOtherSessions(
        sql,
        { userId: alice, keepTokenHash: hashToken(token.aliceCurrent), currentPassword: "old-password-1", newPassword: "x".repeat(8) },
        failingHash,
      ),
    ).rejects.toThrow();
    expect(await storedHash(alice)).toBe(before);
    expect((await findSessionUser(sql, hashToken(token.aliceOther)))?.id).toBe(alice);
    expect((await findSessionUser(sql, hashToken(token.aliceCurrent)))?.id).toBe(alice);
    expect((await findSessionUser(sql, hashToken(token.bob)))?.id).toBe(bob);
  });

  it("returns not-found for a missing user without touching sessions", async () => {
    const result = await changePasswordAndRevokeOtherSessions(sql, {
      userId: 999_999,
      keepTokenHash: hashToken(token.aliceCurrent),
      currentPassword: "old-password-1",
      newPassword: "new-password-2",
    });
    expect(result).toBe("not-found");
    expect(await sql`select 1 from sessions`).toHaveLength(3);
  });
});
