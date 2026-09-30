// Database migration CLI. Reads DATABASE_URL (npm scripts load .env.local if present).
//
//   npm run db:status                      show applied / pending / problems (read-only)
//   npm run db:migrate                     apply pending migrations (creates a new database)
//   npm run db:adopt -- --check            validate a legacy database for adoption (read-only)
//   npm run db:adopt                       adopt a legacy database, then run db:migrate
//        [--allow-legacy-extras]           ...accepting known unused columns from old versions
//
// Exit codes: 0 ok / up to date, 1 error, 3 pending migrations (status), 4 unmanaged (status).

import path from "node:path";
import postgres from "postgres";
import { MigrationError, adopt, getStatus, loadMigrations, migrate } from "./lib/migrator.mjs";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../supabase/migrations");
const [command = "status", ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f);

function target(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`; // never print credentials
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  if (!["status", "migrate", "adopt"].includes(command)) {
    console.error(`Unknown command "${command}". Use status, migrate or adopt.`);
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env.local or export it first.");
    return 1;
  }
  const migrations = loadMigrations(MIGRATIONS_DIR);
  const local = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : "require", onnotice: () => {} });
  try {
    console.log(`Target: ${target(url)}`);
    if (command === "status") {
      const s = await getStatus(sql, { migrations });
      console.log(`Schema "${s.schema}": ${s.state}${s.state === "unmanaged" ? ` (tables: ${s.appTables.join(", ")})` : ""}`);
      for (const e of s.entries) {
        console.log(`  ${e.version}  ${e.name.padEnd(28)} ${e.status}${e.appliedAt ? `  ${new Date(e.appliedAt).toISOString()}` : ""}`);
      }
      for (const p of s.problems) console.log(`  ! ${p.message}`);
      if (s.problems.length) return 1;
      if (s.state === "unmanaged") {
        console.log("Not managed by migrations yet. Run `npm run db:adopt -- --check`.");
        return 4;
      }
      if (s.pending.length) {
        console.log(`${s.pending.length} pending. Run \`npm run db:migrate\`.`);
        return 3;
      }
      console.log("Up to date.");
      return 0;
    }
    if (command === "migrate") {
      const { applied } = await migrate(sql, { migrations, log: (m) => console.log(`  ${m}`) });
      console.log(applied.length ? `Applied ${applied.length} migration(s).` : "Already up to date. Nothing applied.");
      return 0;
    }
    const check = has("--check");
    const result = await adopt(sql, { migrations, check, allowLegacyExtras: has("--allow-legacy-extras") });
    for (const t of result.report.tolerated) console.log(`  kept legacy leftover: ${t}`);
    for (const t of result.report.unrelatedTables) console.log(`  note: unrelated table left alone: ${t}`);
    if (check) {
      console.log(`Schema "${result.schema}" matches the baseline and can be adopted. Nothing was changed (--check).`);
    } else {
      console.log(`Adopted schema "${result.schema}": baseline recorded as adopted. No tables or data were changed.`);
      console.log("Next: `npm run db:migrate` to apply any newer migrations.");
    }
    return 0;
  } catch (err) {
    if (err instanceof MigrationError) {
      console.error(`Error [${err.code}]: ${err.message}`);
    } else {
      // Connection or unexpected database errors: a readable message, never the URL.
      console.error(`Error: ${err?.code ? `[${err.code}] ` : ""}${err?.message ?? err}`);
    }
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

process.exitCode = await main();
