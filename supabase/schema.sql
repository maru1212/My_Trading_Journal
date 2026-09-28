-- TradeLog schema. Run once in the Supabase SQL editor (or `npm run db:setup`).
-- Safe to re-run.

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
