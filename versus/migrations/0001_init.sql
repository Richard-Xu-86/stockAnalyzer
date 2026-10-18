-- Versus schema. All money is NUMERIC; unique keys make every write idempotent.

create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  snaptrade_sub       text not null unique,
  email               text,
  email_verified      boolean not null default false,
  tracking_state      text not null default 'connected'
                      check (tracking_state in ('connected','day_zero','tracking','needs_signin','broken','stopped')),
  benchmark           text not null default 'sp500' check (benchmark in ('sp500','tsx')),
  currency            text not null default 'CAD' check (currency in ('CAD','USD')),
  sync_lease_until    timestamptz,
  last_visit_at       timestamptz not null default now(),
  history_synced_at   timestamptz,
  created_at          timestamptz not null default now()
);

create table if not exists oauth_grants (
  user_id              uuid primary key references users(id) on delete cascade,
  access_token_enc     bytea not null,
  refresh_token_enc    bytea not null,
  key_id               text not null,
  access_expires_at    timestamptz not null,
  scope                text not null,
  version              integer not null default 1,
  refresh_lease_until  timestamptz,
  updated_at           timestamptz not null default now()
);

create table if not exists accounts (
  id                          text primary key,          -- SnapTrade account id
  user_id                     uuid not null references users(id) on delete cascade,
  connection_id               text,
  institution                 text not null,
  name                        text,
  raw_type                    text,
  account_category            text,
  included                    boolean not null default true,
  user_excluded               boolean not null default false,
  transactions_synced_through date,
  next_request_at             timestamptz,
  updated_at                  timestamptz not null default now()
);
create index if not exists accounts_user_idx on accounts(user_id);

create table if not exists activities (
  user_id        uuid not null references users(id) on delete cascade,
  account_id     text not null references accounts(id) on delete cascade,
  activity_id    text not null,
  type           text not null,
  trade_date     date not null,
  amount         numeric(24,8),
  currency       char(3),
  units          numeric(24,8),
  price          numeric(24,8),
  symbol         text,
  raw            jsonb not null,
  primary key (account_id, activity_id)
);
create index if not exists activities_user_date_idx on activities(user_id, account_id, trade_date);

create table if not exists portfolio_snapshots (
  user_id                 uuid not null references users(id) on delete cascade,
  trading_date            date not null,
  captured_at             timestamptz not null,
  as_of                   timestamptz,
  status                  text not null check (status in ('ok','stale','failed')),
  transactions_synced_min date,
  account_ids             text[] not null,
  raw                     jsonb not null,                -- positions and balances as returned, for rebuilding
  primary key (user_id, trading_date)
);

create table if not exists position_snapshots (
  user_id       uuid not null references users(id) on delete cascade,
  trading_date  date not null,
  account_id    text not null,
  symbol_key    text not null,
  ticker        text not null,
  kind          text not null,
  units         numeric(24,8) not null,
  price         numeric(24,8),
  multiplier    numeric(12,4) not null default 1,
  currency      char(3) not null,
  cost_basis    numeric(24,8),
  primary key (user_id, trading_date, account_id, symbol_key)
);

create table if not exists cash_snapshots (
  user_id       uuid not null references users(id) on delete cascade,
  trading_date  date not null,
  account_id    text not null,
  currency      char(3) not null,
  cash          numeric(24,8) not null,
  primary key (user_id, trading_date, account_id, currency)
);

-- Shared tables: public reference data, no personal information.
create table if not exists benchmark_prices (
  ticker        text not null,
  trading_date  date not null,
  price         numeric(24,8) not null,
  currency      char(3) not null,
  captured_at   timestamptz not null,
  source        text not null,
  primary key (ticker, trading_date)
);

create table if not exists fx_rates (
  base          char(3) not null,
  quote         char(3) not null,
  rate_date     date not null,
  rate          numeric(24,10) not null,
  source        text not null default 'bank_of_canada',
  primary key (base, quote, rate_date)
);

create table if not exists snapshot_runs (
  id            bigserial primary key,
  kind          text not null,
  trading_date  date,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  users_ok      integer not null default 0,
  users_failed  integer not null default 0,
  detail        jsonb not null default '{}'::jsonb
);
