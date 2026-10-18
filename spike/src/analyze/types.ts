import { z } from "zod";

/**
 * Permissive schemas: the spike's job is to discover shapes, so unknown fields pass
 * through and every field we read is optional/nullable. Strictness comes in step 4.
 */
const Num = z.union([z.number(), z.string()]).nullish();
const Currency = z.looseObject({ code: z.string().nullish() }).nullish();
const Symbol = z
  .looseObject({
    id: z.string().nullish(),
    symbol: z.string().nullish(),
    currency: Currency,
  })
  .nullish();

export const ActivitySchema = z.looseObject({
  id: z.string().nullish(),
  type: z.string().nullish(),
  trade_date: z.string().nullish(),
  settlement_date: z.string().nullish(),
  amount: Num,
  units: Num,
  price: Num,
  fee: Num,
  fx_rate: Num,
  currency: Currency,
  symbol: Symbol,
  option_symbol: z.unknown().nullish(),
  external_reference_id: z.string().nullish(),
  description: z.string().nullish(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const AccountSchema = z.looseObject({
  id: z.string(),
  connectionId: z.string().nullish(),
  institution_name: z.string().nullish(),
  raw_type: z.string().nullish(),
  account_category: z.string().nullish(),
  institution_account_id: z.string().nullish(),
  sync_status: z
    .looseObject({
      transactions: z
        .looseObject({
          initial_sync_completed: z.boolean().nullish(),
          last_successful_sync: z.string().nullish(),
          first_transaction_date: z.string().nullish(),
        })
        .nullish(),
      holdings: z.looseObject({ initial_sync_completed: z.boolean().nullish(), last_successful_sync: z.string().nullish() }).nullish(),
    })
    .nullish(),
});
export type Account = z.infer<typeof AccountSchema>;

/** One scenario's collected data, already parsed. */
export interface ScenarioData {
  scenario: string;
  accounts: Account[];
  activitiesByAccount: Map<string, Activity[]>;
  rawActivities: unknown[]; // unparsed, for field-presence checks
  rawAccounts: unknown[];
  calls: CallRow[];
  rateLimitProbe: CallRow[] | undefined;
  refreshProbe: { rotated: boolean; idTokenPresent: boolean } | undefined;
}

export const CallRowSchema = z.object({
  path: z.string(),
  query: z.record(z.string(), z.string()),
  status: z.number(),
  attempts: z.number(),
  rateLimitHeaders: z.record(z.string(), z.string()),
  otherHeaderNames: z.array(z.string()),
});
export type CallRow = z.infer<typeof CallRowSchema>;

/** A Bank of Canada observation series: date → rate (CAD per 1 unit of the foreign currency). */
export type RateSeries = Map<string, string>;
