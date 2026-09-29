import { beforeEach, expect, it } from "vitest";
import { describeDb } from "../../test/db";
import { createSessionRow, createUser } from "../../test/fixtures";
import { verifyPassword } from "../password";
import { changePasswordAndRevokeOtherSessions, findSessionUser, hashToken } from "../sessions";

describeDb("sessions and password change", (db) => {
  let alice: number;
  let bob: number;
  const token = { aliceCurrent: "alice-current", aliceOther: "alice-laptop", bob: "bob-phone" };

  beforeEach(async () => {
    alice = await createUser(db.sql, "alice@example.com", "old-password-1");
    bob = await createUser(db.sql, "bob@example.com", "old-password-1");
    await createSessionRow(db.sql, alice, token.aliceCurrent);
    await createSessionRow(db.sql, alice, token.aliceOther);
    await createSessionRow(db.sql, bob, token.bob);
  });

  const storedHash = async (id: number) =>
    (await db.sql<{ password_hash: string }[]>`select password_hash from users where id = ${id}`)[0].password_hash;

  it("a session authenticates only its own user", async () => {
    expect((await findSessionUser(db.sql, hashToken(token.aliceCurrent)))?.id).toBe(alice);
    expect((await findSessionUser(db.sql, hashToken(token.bob)))?.id).toBe(bob);
    expect((await findSessionUser(db.sql, hashToken(token.bob)))?.email).toBe("bob@example.com");
  });

  it("rejects unknown tokens, raw (unhashed) tokens and expired sessions", async () => {
    expect(await findSessionUser(db.sql, hashToken("never-issued"))).toBeNull();
    expect(await findSessionUser(db.sql, token.aliceCurrent)).toBeNull(); // lookups are by hash only
    await createSessionRow(db.sql, alice, "expired", -1000);
    expect(await findSessionUser(db.sql, hashToken("expired"))).toBeNull();
  });

  it("does not return password hashes or other private columns", async () => {
    const user = await findSessionUser(db.sql, hashToken(token.aliceCurrent));
    expect(Object.keys(user!).sort()).toEqual(["currency", "email", "id", "name", "starting_balance"]);
  });

  it("password change keeps the current session, signs out the user's others, leaves other users alone", async () => {
    const result = await changePasswordAndRevokeOtherSessions(db.sql, {
      userId: alice, keepTokenHash: hashToken(token.aliceCurrent), currentPassword: "old-password-1", newPassword: "new-password-2",
    });
    expect(result).toBe("ok");
    expect((await findSessionUser(db.sql, hashToken(token.aliceCurrent)))?.id).toBe(alice);
    expect(await findSessionUser(db.sql, hashToken(token.aliceOther))).toBeNull();
    expect((await findSessionUser(db.sql, hashToken(token.bob)))?.id).toBe(bob);
    expect(await verifyPassword("new-password-2", await storedHash(alice))).toBe(true);
    expect(await verifyPassword("old-password-1", await storedHash(alice))).toBe(false);
    expect(await verifyPassword("old-password-1", await storedHash(bob))).toBe(true);
  });

  it("a keep-token belonging to another user cannot shield or revoke that user's sessions", async () => {
    // Alice changes her password while (maliciously) naming Bob's token as the one to keep.
    const result = await changePasswordAndRevokeOtherSessions(db.sql, {
      userId: alice, keepTokenHash: hashToken(token.bob), currentPassword: "old-password-1", newPassword: "new-password-2",
    });
    expect(result).toBe("ok");
    expect(await findSessionUser(db.sql, hashToken(token.aliceCurrent))).toBeNull();
    expect(await findSessionUser(db.sql, hashToken(token.aliceOther))).toBeNull();
    expect((await findSessionUser(db.sql, hashToken(token.bob)))?.id).toBe(bob);
  });

  it("changes nothing when the current password is wrong", async () => {
    const before = await storedHash(alice);
    const result = await changePasswordAndRevokeOtherSessions(db.sql, {
      userId: alice, keepTokenHash: hashToken(token.aliceCurrent), currentPassword: "not-my-password", newPassword: "new-password-2",
    });
    expect(result).toBe("wrong-password");
    expect(await storedHash(alice)).toBe(before);
    for (const t of Object.values(token)) expect(await findSessionUser(db.sql, hashToken(t))).not.toBeNull();
  });

  it("rolls back the sign-outs if storing the new password fails", async () => {
    const before = await storedHash(alice);
    const failingHash = async () => null as unknown as string; // UPDATE violates NOT NULL after the DELETE
    await expect(
      changePasswordAndRevokeOtherSessions(
        db.sql,
        { userId: alice, keepTokenHash: hashToken(token.aliceCurrent), currentPassword: "old-password-1", newPassword: "x".repeat(8) },
        failingHash,
      ),
    ).rejects.toThrow();
    expect(await storedHash(alice)).toBe(before);
    expect((await findSessionUser(db.sql, hashToken(token.aliceOther)))?.id).toBe(alice);
    expect((await findSessionUser(db.sql, hashToken(token.aliceCurrent)))?.id).toBe(alice);
    expect((await findSessionUser(db.sql, hashToken(token.bob)))?.id).toBe(bob);
  });

  it("returns not-found for a missing user without touching sessions", async () => {
    const result = await changePasswordAndRevokeOtherSessions(db.sql, {
      userId: 999_999, keepTokenHash: hashToken(token.aliceCurrent), currentPassword: "old-password-1", newPassword: "new-password-2",
    });
    expect(result).toBe("not-found");
    expect(await db.sql`select 1 from sessions`).toHaveLength(3);
  });
});
