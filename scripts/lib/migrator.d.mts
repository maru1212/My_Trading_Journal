import type postgres from "postgres";

export interface Migration {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}
export type MigrationStatus = "applied" | "adopted" | "pending" | "missing_file" | "checksum_mismatch" | "name_mismatch" | "out_of_order";
export interface Problem { version: string; status: MigrationStatus; message: string }
export interface Status {
  schema: string;
  state: "fresh" | "unmanaged" | "managed";
  appTables: string[];
  entries: Array<{ version: string; name: string; status: MigrationStatus; appliedAt: Date | null }>;
  problems: Problem[];
  pending: string[];
  upToDate: boolean;
}
export interface AdoptionReport {
  missing: string[];
  changed: Array<{ key: string; expected: string; actual: string }>;
  extra: Array<{ key: string; actual: string }>;
  tolerated: string[];
  unrelatedTables: string[];
  compatible: boolean;
}

export const HISTORY_TABLE: string;
export const BASELINE_VERSION: string;
export const APP_TABLES: string[];
export const KNOWN_LEGACY_EXTRAS: Record<string, string>;
export class MigrationError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown);
}
export function checksum(sqlText: string): string;
export function loadMigrations(dir: string): Migration[];
export function findProblems(history: Array<{ version: string; name: string; checksum: string }>, migrations: Migration[]): Problem[];
export function getStatus(sql: postgres.Sql, opts: { migrations: Migration[] }): Promise<Status>;
export function migrate(sql: postgres.Sql, opts: { migrations: Migration[]; log?: (msg: string) => void }): Promise<{ applied: string[] }>;
export function schemaFingerprint(sql: postgres.Sql, schema: string): Promise<Record<string, string>>;
export function compareFingerprints(expected: Record<string, string>, actual: Record<string, string>): AdoptionReport;
export function adopt(
  sql: postgres.Sql,
  opts: { migrations: Migration[]; check?: boolean; allowLegacyExtras?: boolean },
): Promise<{ adopted: boolean; report: AdoptionReport; schema: string }>;
