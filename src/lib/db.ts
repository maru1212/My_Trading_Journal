import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "journal.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  starting_balance REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'stock',
  side        TEXT NOT NULL CHECK (side IN ('long', 'short')),
  quantity    REAL NOT NULL,
  multiplier  REAL NOT NULL DEFAULT 1,
  entry_date  TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_date   TEXT,
  exit_price  REAL,
  stop_loss   REAL,
  take_profit REAL,
  fees        REAL NOT NULL DEFAULT 0,
  setup       TEXT,
  tags        TEXT,
  notes       TEXT,
  rating      INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_user_date ON trades(user_id, entry_date);
`;

function open() {
  if (DB_PATH !== ":memory:") {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// Reuse one connection across hot reloads in development.
const globalForDb = globalThis as unknown as { __journalDb?: Database.Database };
export const db = globalForDb.__journalDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__journalDb = db;
