import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checksum, findProblems, loadMigrations, MigrationError } from "../../../scripts/lib/migrator.mjs";

const dirs: string[] = [];
function dirWith(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-mig-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MigrationError);
    return (e as MigrationError).code;
  }
  throw new Error("expected a MigrationError");
};

describe("loadMigrations", () => {
  it("loads the real migrations directory", () => {
    const m = loadMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
    expect(m[0]).toMatchObject({ version: "0001", name: "baseline", filename: "0001_baseline.sql" });
    expect(m[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sorts by version and ignores non-SQL files", () => {
    const dir = dirWith({ "0003_c.sql": "select 3;", "0001_baseline.sql": "select 1;", "0002_b.sql": "select 2;", "README.md": "notes" });
    expect(loadMigrations(dir).map((m) => m.version)).toEqual(["0001", "0002", "0003"]);
  });

  it.each([
    ["duplicate versions", { "0001_baseline.sql": "select 1;", "0002_a.sql": "select 1;", "0002_b.sql": "select 1;" }, "DUPLICATE_VERSION"],
    ["bad filename", { "0001_baseline.sql": "select 1;", "2_add.sql": "select 1;" }, "BAD_FILENAME"],
    ["dash in name", { "0001_baseline.sql": "select 1;", "0002-add-things.sql": "select 1;" }, "BAD_FILENAME"],
    ["uppercase name", { "0001_Baseline.sql": "select 1;" }, "BAD_FILENAME"],
    ["empty file", { "0001_baseline.sql": "select 1;", "0002_empty.sql": "  \n" }, "EMPTY_MIGRATION"],
    ["explicit transaction", { "0001_baseline.sql": "begin;\ncreate table x (id int);\ncommit;" }, "TRANSACTION_CONTROL"],
    ["concurrently", { "0001_baseline.sql": "select 1;", "0002_idx.sql": "create index concurrently i on t (a);" }, "NON_TRANSACTIONAL"],
    ["no baseline first", { "0002_later.sql": "select 1;" }, "NO_BASELINE"],
  ])("rejects %s", (_n, files, expected) => {
    expect(code(() => loadMigrations(dirWith(files)))).toBe(expected);
  });

  it("does not mistake words in comments for transaction control", () => {
    const dir = dirWith({ "0001_baseline.sql": "-- begin; the story\ncreate table x (id int); /* commit; */" });
    expect(loadMigrations(dir)).toHaveLength(1);
  });

  it("fails when the directory is missing", () => {
    expect(code(() => loadMigrations("/nonexistent/migrations"))).toBe("NO_MIGRATIONS_DIR");
  });
});

describe("checksum", () => {
  it("is stable across line endings but changes with content", () => {
    expect(checksum("a;\nb;\n")).toBe(checksum("a;\r\nb;\r\n"));
    expect(checksum("a;\nb;\n")).not.toBe(checksum("a;\nb; "));
  });
});

describe("findProblems", () => {
  const files = [
    { version: "0001", name: "baseline", filename: "0001_baseline.sql", sql: "x", checksum: "a".repeat(64) },
    { version: "0002", name: "two", filename: "0002_two.sql", sql: "y", checksum: "b".repeat(64) },
    { version: "0003", name: "three", filename: "0003_three.sql", sql: "z", checksum: "c".repeat(64) },
  ];
  it("accepts consistent history with pending tail", () => {
    expect(findProblems([{ version: "0001", name: "baseline", checksum: "a".repeat(64) }], files)).toEqual([]);
  });
  it("reports checksum, name, missing and out-of-order problems", () => {
    const problems = findProblems(
      [
        { version: "0001", name: "baseline", checksum: "f".repeat(64) },
        { version: "0003", name: "renamed", checksum: "c".repeat(64) },
        { version: "0004", name: "gone", checksum: "d".repeat(64) },
      ],
      files,
    );
    expect(problems.map((p) => [p.version, p.status])).toEqual([
      ["0001", "checksum_mismatch"],
      ["0003", "name_mismatch"],
      ["0004", "missing_file"],
      ["0002", "out_of_order"],
    ]);
  });
});
