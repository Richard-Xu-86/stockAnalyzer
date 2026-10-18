import { boolean, customType, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid, bigserial } from "drizzle-orm/pg-core";

/** Mirrors migrations/0001_init.sql, which is the source of truth for DDL. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  snaptradeSub: text("snaptrade_sub").notNull().unique(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  trackingState: text("tracking_state").notNull().default("connected"),
  benchmark: text("benchmark").notNull().default("sp500"),
  currency: text("currency").notNull().default("CAD"),
  syncLeaseUntil: timestamp("sync_lease_until", { withTimezone: true }),
  lastVisitAt: timestamp("last_visit_at", { withTimezone: true }).notNull().defaultNow(),
  historySyncedAt: timestamp("history_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthGrants = pgTable("oauth_grants", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: bytea("access_token_enc").notNull(),
  refreshTokenEnc: bytea("refresh_token_enc").notNull(),
  keyId: text("key_id").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  scope: text("scope").notNull(),
  version: integer("version").notNull().default(1),
  refreshLeaseUntil: timestamp("refresh_lease_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id"),
  institution: text("institution").notNull(),
  name: text("name"),
  rawType: text("raw_type"),
  accountCategory: text("account_category"),
  included: boolean("included").notNull().default(true),
  userExcluded: boolean("user_excluded").notNull().default(false),
  transactionsSyncedThrough: date("transactions_synced_through"),
  nextRequestAt: timestamp("next_request_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable(
  "activities",
  {
    userId: uuid("user_id").notNull(),
    accountId: text("account_id").notNull(),
    activityId: text("activity_id").notNull(),
    type: text("type").notNull(),
    tradeDate: date("trade_date").notNull(),
    amount: numeric("amount"),
    currency: text("currency"),
    units: numeric("units"),
    price: numeric("price"),
    symbol: text("symbol"),
    raw: jsonb("raw").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.activityId] })],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    userId: uuid("user_id").notNull(),
    tradingDate: date("trading_date").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }),
    status: text("status").notNull(),
    transactionsSyncedMin: date("transactions_synced_min"),
    accountIds: text("account_ids").array().notNull(),
    raw: jsonb("raw").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tradingDate] })],
);

export const positionSnapshots = pgTable(
  "position_snapshots",
  {
    userId: uuid("user_id").notNull(),
    tradingDate: date("trading_date").notNull(),
    accountId: text("account_id").notNull(),
    symbolKey: text("symbol_key").notNull(),
    ticker: text("ticker").notNull(),
    kind: text("kind").notNull(),
    units: numeric("units").notNull(),
    price: numeric("price"),
    multiplier: numeric("multiplier").notNull().default("1"),
    currency: text("currency").notNull(),
    costBasis: numeric("cost_basis"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tradingDate, t.accountId, t.symbolKey] })],
);

export const cashSnapshots = pgTable(
  "cash_snapshots",
  {
    userId: uuid("user_id").notNull(),
    tradingDate: date("trading_date").notNull(),
    accountId: text("account_id").notNull(),
    currency: text("currency").notNull(),
    cash: numeric("cash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tradingDate, t.accountId, t.currency] })],
);

export const benchmarkPrices = pgTable(
  "benchmark_prices",
  {
    ticker: text("ticker").notNull(),
    tradingDate: date("trading_date").notNull(),
    price: numeric("price").notNull(),
    currency: text("currency").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.tradingDate] })],
);

export const fxRates = pgTable(
  "fx_rates",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rateDate: date("rate_date").notNull(),
    rate: numeric("rate").notNull(),
    source: text("source").notNull().default("bank_of_canada"),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote, t.rateDate] })],
);

export const snapshotRuns = pgTable("snapshot_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),
  tradingDate: date("trading_date"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  usersOk: integer("users_ok").notNull().default(0),
  usersFailed: integer("users_failed").notNull().default(0),
  detail: jsonb("detail").notNull().default({}),
});

export const schema = { users, oauthGrants, accounts, activities, portfolioSnapshots, positionSnapshots, cashSnapshots, benchmarkPrices, fxRates, snapshotRuns };
