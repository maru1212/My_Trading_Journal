// Versioned PostgreSQL migrations for My Trading Journal.
//
// - Migrations are plain SQL files in supabase/migrations named NNNN_snake_case.sql.
// - History lives in `schema_migrations` in the target schema (public in production).
// - Each migration runs in its own transaction holding a per-schema advisory lock, so
//   concurrent runners serialise and nothing is applied twice. Transaction-scoped locks
//   also work through Supabase's transaction pooler.
// - Before doing anything the history is checked against the files: edited (checksum),
//   renamed, missing, or out-of-order migrations are errors, never silently skipped.
// - `adopt` brings a database created by the legacy supabase/schema.sql under management
//   after verifying its catalog matches the baseline migration exactly.
//
// Plain ESM + JSDoc so `node scripts/migrate.mjs` needs no build step; types for the
// TypeScript tests are in migrator.d.mts.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HISTORY_TABLE = "schema_migrations";
export const BASELINE_VERSION = "0001";
/** Tables created by the baseline; their presence without history means "unmanaged". */
export const APP_TABLES = ["users", "sessions", "trades"];
const FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const LOCK_NAMESPACE = "my_trading_journal.migrations:";

/**
 * Objects the Expert Advisor version of the legacy schema (commit 1f49921) created and the
 * current code no longer uses. Adoption tolerates exactly these, and only when asked.
 */
export const KNOWN_LEGACY_EXTRAS = {
  "column:users.api_key_hash": "text|null|default=|identity=|generated=",
  "column:users.api_key_hint": "text|null|default=|identity=|generated=",
  "index:users.users_api_key_idx": "CREATE UNIQUE INDEX users_api_key_idx ON users USING btree (api_key_hash)",
};

export class MigrationError extends Error {
  /** @param {string} code @param {string} message @param {unknown} [details] */
  constructor(code, message, details) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.details = details;
  }
}

/** Line endings are normalised so a CRLF checkout doesn't look like an edited migration. */
export function checksum(sqlText) {
  return crypto.createHash("sha256").update(sqlText.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Reads and validates migration files. Non-.sql files (e.g. README.md) are ignored; any
 * .sql file that doesn't follow the naming rule is an error rather than silently skipped.
 * @param {string} dir
 */
export function loadMigrations(dir) {
  if (!fs.existsSync(dir)) throw new MigrationError("NO_MIGRATIONS_DIR", `Migrations directory not found: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".sql")).sort();
  /** @type {Map<string, string>} */
  const seen = new Map();
  const migrations = files.map((filename) => {
    const m = FILE_PATTERN.exec(filename);
    if (!m) {
      throw new MigrationError("BAD_FILENAME", `Invalid migration filename "${filename}". Use NNNN_snake_case.sql, e.g. 0002_add_accounts.sql.`);
    }
    const [, version, name] = m;
    if (seen.has(version)) {
      throw new MigrationError("DUPLICATE_VERSION", `Duplicate migration version ${version}: ${seen.get(version)} and ${filename}.`);
    }
    seen.set(version, filename);
    const sqlText = fs.readFileSync(path.join(dir, filename), "utf8");
    if (!sqlText.trim()) throw new MigrationError("EMPTY_MIGRATION", `Migration ${filename} is empty.`);
    // The runner wraps every migration in a transaction; these would break that guarantee.
    const stripped = sqlText.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/^\s*(begin|commit|rollback|start\s+transaction|end)\s*(transaction|work)?\s*;/im.test(stripped)) {
      throw new MigrationError("TRANSACTION_CONTROL", `Migration ${filename} contains BEGIN/COMMIT/ROLLBACK. The runner wraps each migration in a transaction.`);
    }
    if (/\bconcurrently\b/i.test(stripped)) {
      throw new MigrationError("NON_TRANSACTIONAL", `Migration ${filename} uses CONCURRENTLY, which cannot run inside a transaction. Not supported.`);
    }
    return { version, name, filename, sql: sqlText, checksum: checksum(sqlText) };
  });
  if (migrations.length && migrations[0].version !== BASELINE_VERSION) {
    throw new MigrationError("NO_BASELINE", `The first migration must be ${BASELINE_VERSION}_baseline.sql (found ${migrations[0].filename}).`);
  }
  return migrations;
}

// --- database helpers -------------------------------------------------------------------

async function currentSchema(sql) {
  const [{ schema }] = await sql`select current_schema() as schema`;
  if (!schema) throw new MigrationError("NO_SCHEMA", "No current schema (check search_path).");
  return schema;
}

async function historyExists(sql) {
  const [{ exists }] = await sql`
    select exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = current_schema() and c.relname = ${HISTORY_TABLE} and c.relkind = 'r'
    ) as exists`;
  return exists;
}

async function presentAppTables(sql) {
  const rows = await sql`
    select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = current_schema() and c.relkind in ('r', 'p') and c.relname = any(${APP_TABLES})
     order by 1`;
  return rows.map((r) => r.name);
}

async function readHistory(sql) {
  return sql`
    select version, name, checksum, kind, applied_at, execution_ms, notes
      from ${sql(HISTORY_TABLE)} order by version`;
}

async function createHistoryTable(sql) {
  await sql.unsafe(`
    create table if not exists ${HISTORY_TABLE} (
      version      text primary key check (version ~ '^[0-9]{4}$'),
      name         text not null,
      checksum     text not null check (checksum ~ '^[0-9a-f]{64}$'),
      kind         text not null check (kind in ('applied', 'adopted')),
      applied_at   timestamptz not null default now(),
      execution_ms integer,
      notes        text
    );
    -- Keep it out of Supabase's public REST API like the other tables.
    alter table ${HISTORY_TABLE} enable row level security;
  `);
}

/** Serialises runners on this schema until the surrounding transaction ends. */
async function lock(tx) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${LOCK_NAMESPACE} || current_schema(), 0))`;
}

/**
 * Compares recorded history with the files and returns every inconsistency.
 * @param {Array<{version:string,name:string,checksum:string}>} history
 * @param {ReturnType<typeof loadMigrations>} migrations
 */
export function findProblems(history, migrations) {
  const files = new Map(migrations.map((m) => [m.version, m]));
  const applied = new Set(history.map((h) => h.version));
  const problems = [];
  for (const h of history) {
    const file = files.get(h.version);
    if (!file) {
      problems.push({ version: h.version, status: "missing_file", message: `Migration ${h.version}_${h.name} is recorded as applied but its file is missing.` });
    } else if (file.checksum !== h.checksum) {
      problems.push({ version: h.version, status: "checksum_mismatch", message: `Migration ${file.filename} was edited after it was applied (checksum mismatch). Applied migrations are immutable: revert the file and add a new migration instead.` });
    } else if (file.name !== h.name) {
      problems.push({ version: h.version, status: "name_mismatch", message: `Migration ${h.version} was renamed from "${h.name}" to "${file.name}" after it was applied.` });
    }
  }
  const maxApplied = history.length ? history[history.length - 1].version : null;
  for (const m of migrations) {
    if (!applied.has(m.version) && maxApplied && m.version < maxApplied) {
      problems.push({ version: m.version, status: "out_of_order", message: `Migration ${m.filename} is older than the latest applied migration ${maxApplied} but was never applied. Renumber it after ${maxApplied}.` });
    }
  }
  return problems;
}

function problemError(problems) {
  return new MigrationError("INCONSISTENT_HISTORY", `Migration history is inconsistent:\n - ${problems.map((p) => p.message).join("\n - ")}`, problems);
}

// --- status -------------------------------------------------------------------------------

/**
 * Read-only. state: "fresh" (nothing yet), "unmanaged" (app tables but no history: adopt
 * first), "managed" (history present).
 * @param {import("postgres").Sql} sql
 * @param {{ migrations: ReturnType<typeof loadMigrations> }} opts
 */
export async function getStatus(sql, { migrations }) {
  const schema = await currentSchema(sql);
  const hasHistory = await historyExists(sql);
  const tables = await presentAppTables(sql);
  const history = hasHistory ? await readHistory(sql) : [];
  const state = hasHistory ? "managed" : tables.length ? "unmanaged" : "fresh";
  const problems = findProblems(history, migrations);
  const byVersion = new Map(history.map((h) => [h.version, h]));
  const problemByVersion = new Map(problems.map((p) => [p.version, p]));
  const versions = [...new Set([...migrations.map((m) => m.version), ...history.map((h) => h.version)])].sort();
  const entries = versions.map((version) => {
    const file = migrations.find((m) => m.version === version);
    const h = byVersion.get(version);
    const problem = problemByVersion.get(version);
    return {
      version,
      name: file?.name ?? h?.name ?? "?",
      status: problem ? problem.status : h ? h.kind : "pending",
      appliedAt: h?.applied_at ?? null,
    };
  });
  return {
    schema,
    state,
    appTables: tables,
    entries,
    problems,
    pending: entries.filter((e) => e.status === "pending").map((e) => e.version),
    upToDate: state === "managed" && problems.length === 0 && entries.every((e) => e.status === "applied" || e.status === "adopted"),
  };
}

// --- migrate ------------------------------------------------------------------------------

/**
 * Applies pending migrations in order, one transaction each. Safe to run repeatedly and
 * concurrently. Refuses to touch an unmanaged (legacy) schema: adopt it first.
 * @param {import("postgres").Sql} sql
 * @param {{ migrations: ReturnType<typeof loadMigrations>, log?: (msg: string) => void }} opts
 */
export async function migrate(sql, { migrations, log = () => {} }) {
  const applied = [];
  for (;;) {
    const step = await sql.begin(async (tx) => {
      await lock(tx);
      if (!(await historyExists(tx))) {
        const tables = await presentAppTables(tx);
        if (tables.length) {
          throw new MigrationError(
            "UNMANAGED_SCHEMA",
            `Schema "${await currentSchema(tx)}" already has application tables (${tables.join(", ")}) but no migration history. ` +
              `It was probably created with the legacy supabase/schema.sql. Run \`npm run db:adopt -- --check\`, then \`npm run db:adopt\`. Nothing was changed.`,
          );
        }
        await createHistoryTable(tx);
      }
      const history = await readHistory(tx);
      const problems = findProblems(history, migrations);
      if (problems.length) throw problemError(problems);
      const done = new Set(history.map((h) => h.version));
      const next = migrations.find((m) => !done.has(m.version));
      if (!next) return null;

      const started = Date.now();
      try {
        await tx.unsafe(next.sql);
      } catch (err) {
        throw new MigrationError("MIGRATION_FAILED", `Migration ${next.filename} failed and was rolled back: ${err.message}`, { version: next.version, cause: err });
      }
      await tx`
        insert into ${tx(HISTORY_TABLE)} (version, name, checksum, kind, execution_ms)
        values (${next.version}, ${next.name}, ${next.checksum}, 'applied', ${Date.now() - started})`;
      return next;
    });
    if (!step) break;
    log(`applied ${step.filename}`);
    applied.push(step.version);
  }
  return { applied };
}

// --- schema fingerprint & adoption ------------------------------------------------------------

function stripSchema(def, schema) {
  const quoted = `"${schema.replace(/"/g, '""')}".`;
  return def.split(quoted).join("").split(`${schema}.`).join("");
}

/**
 * Catalog fingerprint of the tables in `schema`: columns (type, nullability, default,
 * identity), constraints, indexes, row-level security, policies and user triggers.
 * Column order is deliberately ignored (ALTER-added columns land at the end).
 * @param {import("postgres").Sql} sql
 * @param {string} schema
 * @returns {Promise<Record<string, string>>}
 */
export async function schemaFingerprint(sql, schema) {
  /** @type {Record<string, string>} */
  const fp = {};
  const tables = await sql`
    select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as force
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${schema} and c.relkind in ('r', 'p') and c.relname <> ${HISTORY_TABLE}`;
  for (const r of tables) {
    fp[`table:${r.t}`] = "table";
    fp[`rls:${r.t}`] = `enabled=${r.rls},forced=${r.force}`;
  }
  const columns = await sql`
    select c.relname as t, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as notnull, a.attidentity as identity, a.attgenerated as generated,
           pg_get_expr(d.adbin, d.adrelid) as def
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = ${schema} and c.relkind in ('r', 'p') and c.relname <> ${HISTORY_TABLE}
       and a.attnum > 0 and not a.attisdropped`;
  for (const r of columns) {
    fp[`column:${r.t}.${r.col}`] =
      `${r.type}|${r.notnull ? "notnull" : "null"}|default=${stripSchema(r.def ?? "", schema)}|identity=${r.identity}|generated=${r.generated}`;
  }
  const constraints = await sql`
    select c.relname as t, con.conname as name, con.contype as type, pg_get_constraintdef(con.oid) as def
      from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${schema} and c.relname <> ${HISTORY_TABLE}`;
  for (const r of constraints) fp[`constraint:${r.t}.${r.name}`] = `${r.type}|${stripSchema(r.def, schema)}`;
  const indexes = await sql`
    select t.relname as t, i.relname as name, pg_get_indexdef(i.oid) as def
      from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = ${schema} and t.relname <> ${HISTORY_TABLE}`;
  for (const r of indexes) fp[`index:${r.t}.${r.name}`] = stripSchema(r.def, schema);
  const policies = await sql`
    select tablename as t, policyname as name, cmd, permissive, roles::text as roles, qual, with_check
      from pg_policies where schemaname = ${schema}`;
  for (const r of policies) fp[`policy:${r.t}.${r.name}`] = JSON.stringify([r.cmd, r.permissive, r.roles, r.qual, r.with_check]);
  const triggers = await sql`
    select c.relname as t, tg.tgname as name, pg_get_triggerdef(tg.oid) as def
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${schema} and not tg.tgisinternal`;
  for (const r of triggers) fp[`trigger:${r.t}.${r.name}`] = stripSchema(r.def, schema);
  return fp;
}

/**
 * Differences between the expected (baseline) and actual fingerprints, restricted to the
 * tables the baseline defines. Other tables in the schema are reported but don't block.
 */
export function compareFingerprints(expected, actual) {
  const managed = new Set(Object.keys(expected).filter((k) => k.startsWith("table:")).map((k) => k.slice(6)));
  const tableOf = (key) => key.split(":")[1].split(".")[0];
  const missing = [], changed = [], extra = [], tolerated = [], unrelatedTables = [];
  for (const [key, def] of Object.entries(expected)) {
    if (!(key in actual)) missing.push(key);
    else if (actual[key] !== def) changed.push({ key, expected: def, actual: actual[key] });
  }
  for (const [key, def] of Object.entries(actual)) {
    if (key in expected) continue;
    if (!managed.has(tableOf(key))) {
      if (key.startsWith("table:")) unrelatedTables.push(tableOf(key));
      continue;
    }
    if (KNOWN_LEGACY_EXTRAS[key] === def) tolerated.push(key);
    else extra.push({ key, actual: def });
  }
  return { missing, changed, extra, tolerated, unrelatedTables, compatible: !missing.length && !changed.length && !extra.length };
}

/** Fingerprint of the baseline migration, built in a throwaway schema that is rolled back. */
async function baselineFingerprint(tx, baseline) {
  const [{ path: originalPath }] = await tx`select current_setting('search_path') as path`;
  const temp = `mtj_baseline_check_${crypto.randomBytes(4).toString("hex")}`;
  const fp = await tx.savepoint(async (sp) => {
    await sp.unsafe(`create schema "${temp}"`);
    await sp.unsafe(`set local search_path to "${temp}"`);
    await sp.unsafe(baseline.sql);
    const result = await schemaFingerprint(sp, temp);
    // Throwing rolls the savepoint back, removing the temporary schema entirely.
    throw Object.assign(new Error("rollback baseline check"), { fingerprint: result });
  }).catch((err) => {
    if (err && err.fingerprint) return err.fingerprint;
    throw new MigrationError("BASELINE_CHECK_FAILED", `Could not build the baseline for comparison: ${err.message}`, err);
  });
  await tx.unsafe(`set local search_path to ${originalPath}`);
  return fp;
}

function describeReport(report) {
  const lines = [];
  for (const k of report.missing) lines.push(`missing: ${k}`);
  for (const c of report.changed) lines.push(`different: ${c.key}\n      expected ${c.expected}\n      actual   ${c.actual}`);
  for (const e of report.extra) lines.push(`unexpected: ${e.key} = ${e.actual}`);
  for (const t of report.tolerated) lines.push(`known legacy leftover: ${t}`);
  return lines.join("\n  ");
}

/**
 * Brings a database created by the legacy supabase/schema.sql under migration management.
 * Validates the live schema against the baseline and records the baseline as `adopted`
 * (not `applied`) without running it. With `check: true` only validates. Never changes
 * application tables or data; on any doubt it throws and nothing is written.
 * @param {import("postgres").Sql} sql
 * @param {{ migrations: ReturnType<typeof loadMigrations>, check?: boolean, allowLegacyExtras?: boolean }} opts
 */
export async function adopt(sql, { migrations, check = false, allowLegacyExtras = false }) {
  const baseline = migrations.find((m) => m.version === BASELINE_VERSION);
  if (!baseline) throw new MigrationError("NO_BASELINE", `No ${BASELINE_VERSION}_baseline.sql migration found.`);
  const outcome = await sql.begin(async (tx) => {
    await lock(tx);
    const schema = await currentSchema(tx);
    if (await historyExists(tx)) {
      const history = await readHistory(tx);
      throw new MigrationError(
        "ALREADY_MANAGED",
        history.length
          ? `Schema "${schema}" is already managed (${history.length} migration(s) recorded). Use \`npm run db:migrate\`.`
          : `Schema "${schema}" has an empty ${HISTORY_TABLE} table. Inspect it manually before adopting.`,
      );
    }
    const tables = await presentAppTables(tx);
    if (!tables.length) {
      throw new MigrationError("NOTHING_TO_ADOPT", `Schema "${schema}" has no application tables. For a new database run \`npm run db:migrate\`.`);
    }
    const expected = await baselineFingerprint(tx, baseline);
    const actual = await schemaFingerprint(tx, schema);
    const report = compareFingerprints(expected, actual);
    if (!report.compatible) {
      throw new MigrationError(
        "INCOMPATIBLE_SCHEMA",
        `Schema "${schema}" does not match the baseline, so it was not adopted. Nothing was changed.\n  ${describeReport(report)}\n` +
          `If it was created by an older version of supabase/schema.sql, review supabase/legacy/schema.sql (additive only), apply it, then run adopt again. ` +
          `Otherwise reconcile the differences manually. See README → Database migrations.`,
        report,
      );
    }
    if (report.tolerated.length && !allowLegacyExtras) {
      throw new MigrationError(
        "LEGACY_EXTRAS",
        `Schema "${schema}" matches the baseline plus leftovers from an older legacy schema:\n  ${describeReport(report)}\n` +
          `They are unused and harmless. Re-run with --allow-legacy-extras to adopt and keep them (they are not removed). Nothing was changed.`,
        report,
      );
    }
    if (check) return { adopted: false, report, schema };
    await createHistoryTable(tx);
    const notes = report.tolerated.length ? `adopted with known legacy leftovers: ${report.tolerated.join(", ")}` : "adopted legacy schema.sql database";
    await tx`
      insert into ${tx(HISTORY_TABLE)} (version, name, checksum, kind, notes)
      values (${baseline.version}, ${baseline.name}, ${baseline.checksum}, 'adopted', ${notes})`;
    return { adopted: true, report, schema };
  });
  return outcome;
}
