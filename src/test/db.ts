import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Database test harness.
 *
 * - Enabled by DATABASE_URL_TEST (a disposable Postgres you don't mind tests writing to).
 * - Without it, database suites are skipped locally, but FAIL when CI=true or REQUIRE_DB_TESTS=1,
 *   so CI can never pass by silently skipping them.
 * - Each suite gets its own schema, named jt_<suite>_<random>, created from
 *   supabase/schema.sql and dropped (by that exact name) when the file finishes. Tables are
 *   truncated before every test. Nothing outside that schema is touched.
 * - The app's db() is pointed at the schema-scoped pool, so repository code runs unchanged.
 */

const SCHEMA_SQL = path.resolve(import.meta.dirname, "../../supabase/schema.sql");
const SCHEMA_NAME = /^jt_[a-z0-9_]{1,40}_[0-9a-f]{8}$/;

export type TestDb = { sql: postgres.Sql; schema: string };

function required() {
  return process.env.REQUIRE_DB_TESTS === "1" || process.env.CI === "true";
}

/** Throws with a clear message if the URL is missing or unsafe; returns it otherwise. */
export function testDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL_TEST?.trim();
  if (!url) return null;
  const appUrl = (globalThis as { __appDatabaseUrl?: string }).__appDatabaseUrl;
  if (appUrl && appUrl.trim() === url) {
    throw new Error("DATABASE_URL_TEST is the same as DATABASE_URL. Point it at a disposable test database.");
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL_TEST is not a valid postgres:// URL.");
  }
  if (/supabase\.(co|com)$/i.test(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `Refusing to run tests against ${host}. Use a local or CI Postgres, or set ALLOW_REMOTE_TEST_DB=1 for a dedicated test project.`,
    );
  }
  return url;
}

function connectOptions(url: string) {
  const local = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  return { prepare: false, max: 2, ssl: local ? false : ("require" as const), onnotice: () => {}, connect_timeout: 10 };
}

/**
 * Like describe(), but backed by a fresh schema. `fn` receives a handle whose `sql` is
 * schema-scoped (valid inside hooks and tests).
 */
export function describeDb(name: string, fn: (db: TestDb) => void) {
  const url = testDatabaseUrl();
  if (!url) {
    if (required()) {
      describe(name, () => {
        it("requires DATABASE_URL_TEST", () => {
          throw new Error("Database tests are required here (CI=true or REQUIRE_DB_TESTS=1) but DATABASE_URL_TEST is not set.");
        });
      });
    } else {
      describe.skip(`${name} (set DATABASE_URL_TEST to run)`, () => fn({} as TestDb));
    }
    return;
  }

  const handle = {} as TestDb;
  describe(name, () => {
    let admin: postgres.Sql | undefined;

    beforeAll(async () => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "db";
      handle.schema = `jt_${slug}_${crypto.randomBytes(4).toString("hex")}`;
      if (!SCHEMA_NAME.test(handle.schema)) throw new Error(`Unsafe test schema name: ${handle.schema}`);
      admin = postgres(url, connectOptions(url));
      try {
        await admin.unsafe(`create schema "${handle.schema}"`);
      } catch (err) {
        await admin.end({ timeout: 1 }).catch(() => {});
        admin = undefined;
        throw new Error(`Cannot reach the test database (DATABASE_URL_TEST): ${(err as Error).message}`);
      }
      handle.sql = postgres(url, { ...connectOptions(url), connection: { search_path: handle.schema } });
      await handle.sql.unsafe(fs.readFileSync(SCHEMA_SQL, "utf8"));
      (globalThis as { __journalSql?: postgres.Sql }).__journalSql = handle.sql;
    });

    afterAll(async () => {
      delete (globalThis as { __journalSql?: postgres.Sql }).__journalSql;
      await handle.sql?.end({ timeout: 5 });
      if (admin) {
        if (handle.schema && SCHEMA_NAME.test(handle.schema)) {
          await admin.unsafe(`drop schema if exists "${handle.schema}" cascade`);
        }
        await admin.end({ timeout: 5 });
      }
    });

    beforeEach(async () => {
      await handle.sql`truncate sessions, trades, users restart identity cascade`;
    });

    fn(handle);
  });
}
