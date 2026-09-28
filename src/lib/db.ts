import "server-only";
import postgres from "postgres";

const globalForDb = globalThis as unknown as { __journalSql?: postgres.Sql };

/**
 * Shared Postgres pool, created on first use so builds don't need DATABASE_URL.
 * Reused across hot reloads in development and warm serverless invocations.
 */
export function db(): postgres.Sql {
  if (globalForDb.__journalSql) return globalForDb.__journalSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See README → Setup.");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  globalForDb.__journalSql = postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    // Serverless functions each hold their own pool; keep it small.
    max: process.env.VERCEL ? 1 : 5,
    idle_timeout: 20,
    ssl: local ? false : "require",
  });
  return globalForDb.__journalSql;
}
