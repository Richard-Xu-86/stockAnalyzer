import { z } from "zod";

/**
 * Response shapes we rely on, confirmed by the spike against a real Wealthsimple account.
 * Objects are loose (unknown fields pass through) but every field we read is validated.
 */
const DecimalLike = z.union([z.string(), z.number()]).transform((v) => String(v));
const Currency = z.looseObject({ code: z.string() });

export const AccountSchema = z.looseObject({
  id: z.string(),
  brokerage_authorization: z.string().nullish(),
  institution_name: z.string(),
  name: z.string().nullish(),
  raw_type: z.string().nullish(),
  account_category: z.string().nullish(),
  sync_status: z
    .looseObject({
      transactions: z.looseObject({ last_successful_sync: z.string().nullish(), initial_sync_completed: z.boolean().nullish() }).nullish(),
    })
    .nullish(),
});
export const AccountListSchema = z.array(AccountSchema);
export type SnapAccount = z.infer<typeof AccountSchema>;

export const PositionSchema = z.looseObject({
  instrument: z.looseObject({
    kind: z.string(),
    id: z.string().nullish(),
    symbol: z.string().nullish(),
    ticker: z.string().nullish(),
    currency: z.string().nullish(),
    multiplier: DecimalLike.nullish(),
  }),
  units: DecimalLike,
  price: DecimalLike.nullish(),
  cost_basis: DecimalLike.nullish(),
  currency: z.string().nullish(),
});
export const PositionsAllSchema = z.looseObject({
  data_freshness: z.looseObject({ as_of: z.string().nullish() }).nullish(),
  results: z.array(PositionSchema),
});
export type SnapPosition = z.infer<typeof PositionSchema>;

export const BalanceSchema = z.looseObject({
  currency: Currency.nullish(),
  cash: z.number().nullish(),
});
export const BalanceListSchema = z.array(BalanceSchema);

export const ActivitySchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  trade_date: z.string().nullish(),
  settlement_date: z.string().nullish(),
  amount: z.number().nullish(),
  units: z.number().nullish(),
  price: z.number().nullish(),
  currency: Currency.nullish(),
  symbol: z.looseObject({ symbol: z.string().nullish() }).nullish(),
});
export const ActivityPageSchema = z.looseObject({
  data: z.array(ActivitySchema),
  pagination: z.looseObject({ total: z.number().nullish() }).nullish(),
});
export type SnapActivity = z.infer<typeof ActivitySchema>;

export const QuoteListSchema = z.array(
  z.looseObject({
    symbol: z.looseObject({ symbol: z.string(), currency: Currency.nullish() }),
    last_trade_price: z.number().nullish(),
  }),
);
