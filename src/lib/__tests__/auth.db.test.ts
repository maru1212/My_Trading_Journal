import { beforeEach, expect, it, vi } from "vitest";
import { describeDb } from "../../test/db";
import { createSessionRow, createUser } from "../../test/fixtures";
import { hashToken } from "../sessions";

// Next.js request APIs are the boundary here: an in-memory cookie jar stands in for cookies(),
// and redirect() throws like the real one does.
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  },
}));

const auth = await import("../auth");

describeDb("auth sessions", (db) => {
  let alice: number;
  let bob: number;

  beforeEach(async () => {
    jar.clear();
    alice = await createUser(db.sql, "alice@example.com");
    bob = await createUser(db.sql, "bob@example.com");
  });

  it("createSession stores only a hash and sets a secure-by-default cookie", async () => {
    await auth.createSession(alice);
    const cookie = jar.get(auth.SESSION_COOKIE)!;
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const rows = await db.sql<{ token_hash: string; user_id: number }[]>`select token_hash, user_id from sessions`;
    expect(rows).toEqual([{ token_hash: hashToken(cookie.value), user_id: alice }]);
    expect(rows[0].token_hash).not.toBe(cookie.value);
  });

  it("getCurrentUser / requireUser resolve the cookie's own user only", async () => {
    await createSessionRow(db.sql, bob, "bob-token");
    jar.set(auth.SESSION_COOKIE, { value: "bob-token" });
    expect((await auth.getCurrentUser())?.id).toBe(bob);
    expect((await auth.requireUser()).email).toBe("bob@example.com");
    expect(await auth.currentSessionTokenHash()).toBe(hashToken("bob-token"));
  });

  it("no cookie, an unknown token or an expired session is not signed in", async () => {
    expect(await auth.getCurrentUser()).toBeNull();
    await expect(auth.requireUser()).rejects.toMatchObject({ url: "/auth/clear" });

    jar.set(auth.SESSION_COOKIE, { value: "forged" });
    expect(await auth.getCurrentUser()).toBeNull();

    await createSessionRow(db.sql, alice, "old", -60_000);
    jar.set(auth.SESSION_COOKIE, { value: "old" });
    expect(await auth.getCurrentUser()).toBeNull();
    await expect(auth.requireUser()).rejects.toMatchObject({ url: "/auth/clear" });
  });

  it("creating a session purges expired ones", async () => {
    await createSessionRow(db.sql, bob, "stale", -60_000);
    await auth.createSession(alice);
    expect(await db.sql`select 1 from sessions where token_hash = ${hashToken("stale")}`).toHaveLength(0);
  });

  it("destroySession removes only the current session", async () => {
    await createSessionRow(db.sql, alice, "alice-phone");
    await createSessionRow(db.sql, bob, "bob-token");
    await auth.createSession(alice);
    const current = jar.get(auth.SESSION_COOKIE)!.value;
    await auth.destroySession();
    expect(jar.has(auth.SESSION_COOKIE)).toBe(false);
    const left = (await db.sql<{ token_hash: string }[]>`select token_hash from sessions`).map((r) => r.token_hash).sort();
    expect(left).toEqual([hashToken("alice-phone"), hashToken("bob-token")].sort());
    expect(left).not.toContain(hashToken(current));
  });
});
