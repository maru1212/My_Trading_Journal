// Applies supabase/schema.sql to DATABASE_URL. Usage: npm run db:setup
import fs from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local or export it first.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : "require", onnotice: () => {} });
try {
  await sql.unsafe(fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
  console.log("Database schema is up to date.");
} catch (e) {
  console.error("Schema setup failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
