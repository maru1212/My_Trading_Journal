-- 0001 baseline: the schema as created by the legacy supabase/schema.sql at commit
-- 82ebbb6 (see supabase/legacy/schema.sql). Deliberately without IF NOT EXISTS: on a
-- database that already has these tables it fails instead of half-applying. Existing
-- databases are adopted (`npm run db:adopt`), which validates them against this file.
--
-- Applied migrations are immutable. Change the schema with a new NNNN_*.sql file.

create table users (
  id               integer generated always as identity primary key,
  email            text not null,
  name             text not null,
  password_hash    text not null,
  currency         text not null default 'USD',
  starting_balance double precision not null default 0,
  created_at       timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table trades (
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
create index trades_user_date_idx on trades (user_id, entry_date);

-- The app connects as the database owner, which bypasses RLS. Enabling RLS with
-- no policies blocks access through Supabase's public REST API (anon key).
alter table users enable row level security;
alter table sessions enable row level security;
alter table trades enable row level security;

-- MetaTrader 5 sync via MetaApi.
alter table users add column metaapi_account_id text;
alter table users add column mt5_login text;
alter table users add column mt5_server text;
alter table users add column mt5_account text;
alter table users add column mt5_sync_from timestamptz;
alter table users add column mt5_last_sync_at timestamptz;
alter table users add column mt5_last_error text;

alter table trades add column source text not null default 'manual';
alter table trades add column external_id text; -- 'mt5:<login>:<position id>'
alter table trades add column broker_pnl double precision; -- net profit reported by the broker
create unique index trades_external_idx on trades (user_id, external_id);
