import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  adopt, getStatus, HISTORY_TABLE, loadMigrations, migrate, MigrationError, schemaFingerprint, type Migration,
} from "../../../scripts/lib/migrator.mjs";
import { describeDb, MIGRATIONS_DIR } from "../../test/db";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const LEGACY_V3 = fs.readFileSync(path.join(ROOT, "supabase/legacy/schema.sql"), "utf8");
const LEGACY_V1 = fs.readFileSync(path.join(ROOT, "src/test/fixtures/legacy/v1_1d86173.sql"), "utf8");
const LEGACY_V2 = fs.readFileSync(path.join(ROOT, "src/test/fixtures/legacy/v2_1f49921.sql"), "utf8");
const real = () => loadMigrations(MIGRATIONS_DIR);

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
/** A throwaway migrations directory for synthetic migration sets. */
function migrationDir(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-mig-db-"));
  tmpDirs.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}
const LOG_BASELINE = "create table mig_log (id serial primary key, step text not null);";

async function errorCode(p: Promise<unknown>) {
  const err = await p.then(() => null, (e) => e);
  expect(err, "expected a MigrationError").toBeInstanceOf(MigrationError);
  return (err as MigrationError).code;
}

describeDb(
  "migrations",
  (db) => {
    beforeEach(() => db.reset());

    const history = () =>
      db.sql<{ version: string; name: string; checksum: string; kind: string; applied_at: Date; notes: string | null }[]>`
        select version, name, checksum, kind, applied_at, notes from ${db.sql(HISTORY_TABLE)} order by version`;
    const hasTable = async (name: string) =>
      (await db.sql`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = ${db.schema} and c.relname = ${name}`).length > 0;
    const fingerprint = () => schemaFingerprint(db.sql, db.schema);
    const leftoverBaselineSchemas = async () =>
      Number((await db.sql<{ n: number }[]>`select count(*)::int as n from pg_namespace where nspname like 'mtj_baseline_check_%'`)[0].n);
    /** All application rows, for before/after comparisons. */
    const dataSnapshot = async () => ({
      users: await db.sql`select * from users order by id`,
      sessions: await db.sql`select * from sessions order by token_hash`,
      trades: await db.sql`select * from trades order by id`,
    });
    async function seedLegacyData() {
      const [{ id: alice }] = await db.sql<{ id: number }[]>`
        insert into users (email, name, password_hash, starting_balance) values ('alice@example.com', 'Alice', 'scrypt$aa$bb', 25000) returning id`;
      const [{ id: bob }] = await db.sql<{ id: number }[]>`
        insert into users (email, name, password_hash) values ('bob@example.com', 'Bob', 'scrypt$cc$dd') returning id`;
      await db.sql`insert into sessions (token_hash, user_id, expires_at) values ('h1', ${alice}, now() + interval '1 day'), ('h2', ${bob}, now() + interval '1 day')`;
      await db.sql`insert into trades (user_id, symbol, side, quantity, entry_date, entry_price, exit_date, exit_price, fees, notes)
                   values (${alice}, 'XAUUSD', 'long', 1, '2026-07-01T10:00', 2400, '2026-07-01T11:00', 2405, 7, 'kept')`;
      return { alice, bob };
    }

    describe("fresh database", () => {
      it("migrates from zero to exactly the legacy schema (no drift)", async () => {
        await db.sql.unsafe(LEGACY_V3);
        const legacy = await fingerprint();
        await db.reset();
        expect((await getStatus(db.sql, { migrations: real() })).state).toBe("fresh");
        expect(await migrate(db.sql, { migrations: real() })).toEqual({ applied: ["0001"] });
        expect(await fingerprint()).toEqual(legacy);
        expect(Object.keys(legacy).length).toBeGreaterThan(50);
      });

      it("is safe to run twice: nothing re-applied, history and schema unchanged", async () => {
        await migrate(db.sql, { migrations: real() });
        const [h1, fp1] = [await history(), await fingerprint()];
        expect(await migrate(db.sql, { migrations: real() })).toEqual({ applied: [] });
        expect(await history()).toEqual(h1);
        expect(await fingerprint()).toEqual(fp1);
      });

      it("records version, name, checksum and kind for applied migrations", async () => {
        const migrations = real();
        await migrate(db.sql, { migrations });
        const [row] = await history();
        expect(row).toMatchObject({ version: "0001", name: "baseline", checksum: migrations[0].checksum, kind: "applied", notes: null });
        expect(row.applied_at).toBeInstanceOf(Date);
        const [rls] = await db.sql`select relrowsecurity from pg_class where relname = ${HISTORY_TABLE} and relnamespace = ${db.schema}::regnamespace`;
        expect(rls.relrowsecurity).toBe(true);
      });
    });

    describe("ordering, immutability and failures", () => {
      it("applies pending migrations in version order regardless of file order", async () => {
        const dir = migrationDir({
          "0003_c.sql": "insert into mig_log (step) values ('0003');",
          "0001_baseline.sql": LOG_BASELINE,
          "0002_b.sql": "insert into mig_log (step) values ('0002');",
        });
        expect(await migrate(db.sql, { migrations: loadMigrations(dir) })).toEqual({ applied: ["0001", "0002", "0003"] });
        expect((await db.sql`select step from mig_log order by id`).map((r) => r.step)).toEqual(["0002", "0003"]);
      });

      it("rejects an edited applied migration and applies nothing else", async () => {
        const files = { "0001_baseline.sql": LOG_BASELINE, "0002_b.sql": "insert into mig_log (step) values ('b');" };
        const dir = migrationDir(files);
        await migrate(db.sql, { migrations: loadMigrations(dir) });
        fs.writeFileSync(path.join(dir, "0002_b.sql"), "insert into mig_log (step) values ('B-edited');");
        fs.writeFileSync(path.join(dir, "0003_c.sql"), "insert into mig_log (step) values ('c');");
        expect(await errorCode(migrate(db.sql, { migrations: loadMigrations(dir) }))).toBe("INCONSISTENT_HISTORY");
        expect((await db.sql`select step from mig_log`).map((r) => r.step)).toEqual(["b"]);
        expect((await history()).map((h) => h.version)).toEqual(["0001", "0002"]);
        const status = await getStatus(db.sql, { migrations: loadMigrations(dir) });
        expect(status.entries.map((e) => [e.version, e.status])).toEqual([["0001", "applied"], ["0002", "checksum_mismatch"], ["0003", "pending"]]);
      });

      it("rejects a missing file and an out-of-order migration", async () => {
        const dir = migrationDir({ "0001_baseline.sql": LOG_BASELINE, "0003_c.sql": "select 1;" });
        await migrate(db.sql, { migrations: loadMigrations(dir) });
        fs.writeFileSync(path.join(dir, "0002_b.sql"), "select 2;");
        expect(await errorCode(migrate(db.sql, { migrations: loadMigrations(dir) }))).toBe("INCONSISTENT_HISTORY");
        fs.rmSync(path.join(dir, "0002_b.sql"));
        fs.rmSync(path.join(dir, "0003_c.sql"));
        const err = await migrate(db.sql, { migrations: loadMigrations(dir) }).catch((e) => e);
        expect(err.message).toMatch(/0003_c is recorded as applied but its file is missing/);
        expect((await history()).map((h) => h.version)).toEqual(["0001", "0003"]);
      });

      it("rolls back a failed migration completely and does not record it", async () => {
        const dir = migrationDir({
          "0001_baseline.sql": LOG_BASELINE,
          "0002_bad.sql": "create table half_done (id int);\ninsert into mig_log (step) values ('partial');\nselect * from no_such_table;",
          "0003_after.sql": "insert into mig_log (step) values ('after');",
        });
        const err = await migrate(db.sql, { migrations: loadMigrations(dir) }).catch((e) => e);
        expect(err).toBeInstanceOf(MigrationError);
        expect(err.code).toBe("MIGRATION_FAILED");
        expect(err.message).toMatch(/0002_bad\.sql failed and was rolled back/);
        expect(await hasTable("half_done")).toBe(false);
        expect(await db.sql`select * from mig_log`).toHaveLength(0);
        expect((await history()).map((h) => h.version)).toEqual(["0001"]);
        // Fixing the (never applied) file lets it and the rest apply.
        fs.writeFileSync(path.join(dir, "0002_bad.sql"), "insert into mig_log (step) values ('fixed');");
        expect(await migrate(db.sql, { migrations: loadMigrations(dir) })).toEqual({ applied: ["0002", "0003"] });
      });

      it("a failing first migration leaves the database fresh (no history table)", async () => {
        const dir = migrationDir({ "0001_baseline.sql": "create table t (id int);\nselect broken syntax here;" });
        expect(await errorCode(migrate(db.sql, { migrations: loadMigrations(dir) }))).toBe("MIGRATION_FAILED");
        expect(await hasTable(HISTORY_TABLE)).toBe(false);
        expect(await hasTable("t")).toBe(false);
        expect((await getStatus(db.sql, { migrations: loadMigrations(dir) })).state).toBe("fresh");
      });
    });

    describe("concurrency", () => {
      it("parallel runners on separate connections apply each migration exactly once", async () => {
        const dir = migrationDir({
          "0001_baseline.sql": LOG_BASELINE,
          "0002_slow.sql": "select pg_sleep(0.4);\ninsert into mig_log (step) values ('slow');",
          "0003_next.sql": "insert into mig_log (step) values ('next');",
        });
        const migrations = loadMigrations(dir);
        const runners = [db.connect(), db.connect(), db.connect(), db.connect()];
        const results = await Promise.all(runners.map((c) => migrate(c, { migrations })));
        const appliedByAll = results.flatMap((r) => r.applied).sort();
        expect(appliedByAll).toEqual(["0001", "0002", "0003"]); // each applied by exactly one runner
        expect((await db.sql`select step from mig_log order by id`).map((r) => r.step)).toEqual(["slow", "next"]);
        expect((await history()).map((h) => h.version)).toEqual(["0001", "0002", "0003"]);
      });
    });

    describe("adopting a legacy database", () => {
      it("adopts a current legacy database without touching data; later runs are no-ops", async () => {
        await db.sql.unsafe(LEGACY_V3);
        const { alice } = await seedLegacyData();
        await db.sql`insert into trades (user_id, source, external_id, symbol, side, quantity, multiplier, entry_date, entry_price, exit_date, exit_price, fees, broker_pnl)
                     values (${alice}, 'mt5', 'mt5:1:1', 'EURUSD', 'long', 1, 100000, '2026-07-01T10:00', 1.1, '2026-07-05T10:00', 1.101, -9.5, 109.5)`;
        const before = await dataSnapshot();
        const fpBefore = await fingerprint();

        expect((await getStatus(db.sql, { migrations: real() })).state).toBe("unmanaged");
        expect(await errorCode(migrate(db.sql, { migrations: real() }))).toBe("UNMANAGED_SCHEMA");
        expect(await hasTable(HISTORY_TABLE)).toBe(false);

        const checked = await adopt(db.sql, { migrations: real(), check: true });
        expect(checked).toMatchObject({ adopted: false, report: { compatible: true } });
        expect(await hasTable(HISTORY_TABLE)).toBe(false); // --check writes nothing

        const result = await adopt(db.sql, { migrations: real() });
        expect(result.adopted).toBe(true);
        expect(await history()).toMatchObject([{ version: "0001", name: "baseline", kind: "adopted", checksum: real()[0].checksum }]);
        expect(await dataSnapshot()).toEqual(before);
        expect(await fingerprint()).toEqual(fpBefore);
        expect(await leftoverBaselineSchemas()).toBe(0);

        const status = await getStatus(db.sql, { migrations: real() });
        expect(status).toMatchObject({ state: "managed", upToDate: true, pending: [] });
        expect(await migrate(db.sql, { migrations: real() })).toEqual({ applied: [] });
        expect(await errorCode(adopt(db.sql, { migrations: real() }))).toBe("ALREADY_MANAGED");
        expect(await dataSnapshot()).toEqual(before);
      });

      it("rejects an older (V1) legacy database, then adopts it after the documented legacy upgrade", async () => {
        await db.sql.unsafe(LEGACY_V1);
        await seedLegacyData();
        const before = await dataSnapshot();
        const fpBefore = await fingerprint();
        const err = await adopt(db.sql, { migrations: real() }).catch((e) => e);
        expect(err.code).toBe("INCOMPATIBLE_SCHEMA");
        expect(err.message).toMatch(/missing: column:users\.metaapi_account_id/);
        expect(err.message).toMatch(/supabase\/legacy\/schema\.sql/);
        expect(await fingerprint()).toEqual(fpBefore);
        expect(await hasTable(HISTORY_TABLE)).toBe(false);

        await db.sql.unsafe(LEGACY_V3); // the documented upgrade path for old databases
        expect((await adopt(db.sql, { migrations: real() })).adopted).toBe(true);
        const after = await dataSnapshot();
        expect(after.users.map((u) => [u.id, u.email, u.password_hash, u.starting_balance])).toEqual(
          before.users.map((u) => [u.id, u.email, u.password_hash, u.starting_balance]),
        );
        expect(after.sessions).toEqual(before.sessions);
        expect(after.trades.map((t) => ({ ...t, source: undefined, external_id: undefined, broker_pnl: undefined }))).toEqual(
          before.trades.map((t) => ({ ...t, source: undefined, external_id: undefined, broker_pnl: undefined })),
        );
        expect(after.trades.every((t) => t.source === "manual")).toBe(true);
      });

      it("requires explicit consent for known leftovers of the Expert Advisor schema, and keeps them", async () => {
        await db.sql.unsafe(LEGACY_V2);
        await db.sql.unsafe(LEGACY_V3); // a database that went through both legacy versions
        await seedLegacyData();
        const before = await dataSnapshot();
        const err = await adopt(db.sql, { migrations: real() }).catch((e) => e);
        expect(err.code).toBe("LEGACY_EXTRAS");
        expect(err.message).toMatch(/users_api_key_idx/);
        expect(await hasTable(HISTORY_TABLE)).toBe(false);

        const result = await adopt(db.sql, { migrations: real(), allowLegacyExtras: true });
        expect(result.report.tolerated.sort()).toEqual(["column:users.api_key_hash", "column:users.api_key_hint", "index:users.users_api_key_idx"]);
        expect((await history())[0].notes).toMatch(/api_key_hash/);
        expect(await dataSnapshot()).toEqual(before);
        const [{ n }] = await db.sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns where table_schema = ${db.schema} and column_name = 'api_key_hash'`;
        expect(n).toBe(1); // not removed
      });

      const incompatible: Array<[string, string, RegExp]> = [
        ["a changed column type", "alter table trades alter column fees type numeric", /different: column:trades\.fees/],
        ["an unknown extra column", "alter table trades add column mystery text", /unexpected: column:trades\.mystery/],
        ["a missing index", "drop index trades_user_date_idx", /missing: index:trades\.trades_user_date_idx/],
        ["row-level security disabled", "alter table sessions disable row level security", /different: rls:sessions/],
        ["an added policy", "create policy anyone_reads on users for select using (true)", /unexpected: policy:users\.anyone_reads/],
        ["a missing NOT NULL", "alter table trades alter column symbol drop not null", /different: column:trades\.symbol/],
        ["a dropped table", "drop table sessions", /missing: table:sessions/],
      ];
      it.each(incompatible)("rejects a schema with %s without changing anything", async (_label, change, reason) => {
        await db.sql.unsafe(LEGACY_V3);
        if (!change.startsWith("drop table")) await seedLegacyData();
        await db.sql.unsafe(change);
        const before = await dataSnapshot().catch(() => null);
        const fpBefore = await fingerprint();
        for (const check of [true, false]) {
          const err = await adopt(db.sql, { migrations: real(), check }).catch((e) => e);
          expect(err).toBeInstanceOf(MigrationError);
          expect(err.code).toBe("INCOMPATIBLE_SCHEMA");
          expect(err.message).toMatch(reason);
          expect(err.message).toMatch(/Nothing was changed/);
        }
        expect(await fingerprint()).toEqual(fpBefore);
        expect(await dataSnapshot().catch(() => null)).toEqual(before);
        expect(await hasTable(HISTORY_TABLE)).toBe(false);
        expect(await leftoverBaselineSchemas()).toBe(0);
      });

      it("refuses to adopt an empty or partially created schema", async () => {
        expect(await errorCode(adopt(db.sql, { migrations: real() }))).toBe("NOTHING_TO_ADOPT");
        await db.sql`create table users (id int)`;
        expect(await errorCode(adopt(db.sql, { migrations: real() }))).toBe("INCOMPATIBLE_SCHEMA");
        expect(await errorCode(migrate(db.sql, { migrations: real() }))).toBe("UNMANAGED_SCHEMA");
      });

      it("adoption and migration serialise: concurrent adopt + migrate never double-record", async () => {
        await db.sql.unsafe(LEGACY_V3);
        const [a, b] = [db.connect(), db.connect()];
        const results = await Promise.allSettled([adopt(a, { migrations: real() }), migrate(b, { migrations: real() })]);
        // Either migrate saw the unmanaged schema first (and refused) or ran after adoption (no-op).
        expect(results[0].status).toBe("fulfilled");
        if (results[1].status === "rejected") expect((results[1].reason as MigrationError).code).toBe("UNMANAGED_SCHEMA");
        else expect(results[1].value).toEqual({ applied: [] });
        expect((await history()).map((h) => [h.version, h.kind])).toEqual([["0001", "adopted"]]);
      });
    });

    describe("status", () => {
      const two = (): Migration[] => loadMigrations(migrationDir({ "0001_baseline.sql": LOG_BASELINE, "0002_two.sql": "select 2;" }));

      it("distinguishes fresh, unmanaged, pending, applied, adopted and inconsistent", async () => {
        expect(await getStatus(db.sql, { migrations: two() })).toMatchObject({ state: "fresh", pending: ["0001", "0002"], upToDate: false });

        const partial = loadMigrations(migrationDir({ "0001_baseline.sql": LOG_BASELINE }));
        await migrate(db.sql, { migrations: partial });
        const pending = await getStatus(db.sql, { migrations: two() });
        expect(pending.entries.map((e) => [e.version, e.status])).toEqual([["0001", "applied"], ["0002", "pending"]]);
        expect(pending).toMatchObject({ state: "managed", upToDate: false, problems: [] });

        await migrate(db.sql, { migrations: two() });
        expect(await getStatus(db.sql, { migrations: two() })).toMatchObject({ upToDate: true, pending: [] });

        const renamed = loadMigrations(migrationDir({ "0001_baseline.sql": LOG_BASELINE, "0002_renamed.sql": "select 2;" }));
        const bad = await getStatus(db.sql, { migrations: renamed });
        expect(bad.entries.map((e) => e.status)).toEqual(["applied", "name_mismatch"]);
        expect(bad.upToDate).toBe(false);

        await db.reset();
        await db.sql.unsafe(LEGACY_V3);
        expect((await getStatus(db.sql, { migrations: real() })).state).toBe("unmanaged");
        await adopt(db.sql, { migrations: real() });
        expect((await getStatus(db.sql, { migrations: real() })).entries).toMatchObject([{ version: "0001", status: "adopted" }]);
      });
    });
  },
  { migrate: false },
);
