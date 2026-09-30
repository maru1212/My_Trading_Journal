-- FROZEN LEGACY SCHEMA (from commit 82ebbb6). Do not edit and do not use for new databases.
--
-- Before T4 the schema was managed by re-running this file. It is kept only to bring an
-- older, unmanaged database (created by an earlier version of this file) up to the state
-- that `npm run db:adopt` accepts. It is additive and idempotent: IF NOT EXISTS everywhere,
-- nothing is dropped. After adoption, never run it again: every change goes through
-- supabase/migrations. A test (migrations.db.test.ts) checks that this file and the
-- migrations produce the same schema.

create table if not exists users (
  id               integer generated always as identity primary key,
  email            text not null,
  name             text not null,
  password_hash    text not null,
  currency         text not null default 'USD',
  starting_balance double precision not null default 0,
  created_at       timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists sessions (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists trades (
  id          integer generated always as identity primary key,
  user_id     integer not null references users(id) on delete cascade,
  symbol      text not null,
  asset_class text not null default 'stock',
  side        text not null check (side in ('long', 'short')),
  quantity    double precision not null,
  multiplier  double precision not null default 1,
  entry_date  text not null, -- 'YYYY-MM-DDTHH:mm', trader's local time
  entry_price double precision not null,
  exit_date   text,
  exit_price  double precision,
  stop_loss   double precision,
  take_profit double precision,
  fees        double precision not null default 0,
  setup       text,
  tags        text,
  notes       text,
  rating      integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists trades_user_date_idx on trades (user_id, entry_date);

-- The app connects as the database owner, which bypasses RLS. Enabling RLS with
-- no policies blocks access through Supabase's public REST API (anon key).
alter table users enable row level security;
alter table sessions enable row level security;
alter table trades enable row level security;

-- MetaTrader 5 sync via MetaApi (added later; safe to run on an existing database).
alter table users add column if not exists metaapi_account_id text;
alter table users add column if not exists mt5_login text;
alter table users add column if not exists mt5_server text;
alter table users add column if not exists mt5_account text;
alter table users add column if not exists mt5_sync_from timestamptz;
alter table users add column if not exists mt5_last_sync_at timestamptz;
alter table users add column if not exists mt5_last_error text;

alter table trades add column if not exists source text not null default 'manual';
alter table trades add column if not exists external_id text; -- 'mt5:<login>:<position id>'
alter table trades add column if not exists broker_pnl double precision; -- net profit reported by the broker
create unique index if not exists trades_external_idx on trades (user_id, external_id);
