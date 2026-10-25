# Spike findings: O1–O6

Generated 2026-10-18T17:54:59.253Z from `raw/`. Scenarios: wealthsimple-real.

Fill in every **Decision** line by hand after reading the evidence; the generator never decides.

## O1. Endpoints and fields on the OAuth path

### wealthsimple-real: endpoints

| Endpoint | Statuses | Max attempts | Rate-limit headers seen |
| --- | --- | --- | --- |
| /accounts | 200 | 1 | none |
| /authorizations | 200 | 1 | none |
| /authorizations/{id}/accounts | 200 | 1 | none |
| /accounts/{id}/positions | 410 | 1 | x-ratelimit-account-limit, x-ratelimit-account-remaining, x-ratelimit-account-reset |
| /accounts/{id}/balances | 200 | 1 | x-ratelimit-account-limit, x-ratelimit-account-remaining, x-ratelimit-account-reset |
| /accounts/{id}/activities | 200 | 1 | x-ratelimit-account-limit, x-ratelimit-account-remaining, x-ratelimit-account-reset |

### Activity fields (all scenarios)

| Field | Records | Missing key | Null | Types seen |
| --- | --- | --- | --- | --- |
| `id` | 1382 | 0 | 0 | string |
| `type` | 1382 | 0 | 0 | string |
| `trade_date` | 1382 | 0 | 0 | string |
| `settlement_date` | 1382 | 0 | 0 | string |
| `amount` | 1382 | 0 | 0 | number |
| `units` | 1382 | 0 | 0 | number |
| `price` | 1382 | 0 | 0 | number |
| `fee` | 1382 | 0 | 0 | number |
| `fx_rate` | 1382 | 0 | 1382 | - |
| `currency.code` | 1382 | 0 | 0 | string |
| `symbol.symbol` | 1382 | 39 | 0 | string |
| `symbol.currency.code` | 1382 | 39 | 0 | string |
| `external_reference_id` | 1382 | 0 | 1382 | - |
| `option_symbol` | 1382 | 0 | 520 | object |
| `description` | 1382 | 0 | 0 | string |

### Account fields (all scenarios)

| Field | Records | Missing key | Null | Types seen |
| --- | --- | --- | --- | --- |
| `id` | 14 | 0 | 0 | string |
| `institution_name` | 14 | 0 | 0 | string |
| `raw_type` | 14 | 0 | 0 | string |
| `account_category` | 14 | 0 | 0 | string |
| `institution_account_id` | 14 | 0 | 14 | - |
| `sync_status.transactions.first_transaction_date` | 14 | 0 | 6 | string |
| `sync_status.transactions.last_successful_sync` | 14 | 0 | 0 | string |
| `sync_status.transactions.initial_sync_completed` | 14 | 0 | 0 | boolean |
| `sync_status.holdings.last_successful_sync` | 14 | 0 | 0 | string |

**Decision:** _paths confirmed / changed; fields that are strings not numbers; anything absent._

## O2. Where commissions live

| Placement | Trades |
| --- | --- |
| fee_in_amount | 0 |
| fee_not_in_amount | 0 |
| no_fee | 1238 |
| unexplained | 8 |
| incomplete | 0 |

Trades with a linked FEE row: 0. Trades with both a non-zero `fee` and a linked FEE row: 0.

| Activity | Type | fee | amount + units×price | Placement |
| --- | --- | --- | --- | --- |
| id-0047 | BUY | 0 | -3.22 | unexplained |
| id-1663 | SELL | 0 | -0.02 | unexplained |
| id-1714 | BUY | 0 | 0.04 | unexplained |
| id-1775 | BUY | 0 | 0.02 | unexplained |
| id-1797 | BUY | 0 | 0.0119 | unexplained |
| id-1885 | SELL | 0 | -0.05 | unexplained |
| id-1981 | BUY | 0 | 0.02 | unexplained |
| id-2012 | BUY | 0 | 0.02 | unexplained |

**Decision:** _C1 reads `fee`; C2 applies / never seen; double-count guard needed or not. Sandbox is one simulated broker: real-broker behaviour stays open._

## O3. Bank of Canada rates

| Series | HTTP | Observations | First | Last | Weekday gaps | Weekend obs. |
| --- | --- | --- | --- | --- | --- | --- |
| FXEURCAD | 200 | 80 | 2026-06-22 | 2026-10-16 | 2026-07-01, 2026-08-03, 2026-09-07, 2026-09-30, 2026-10-12 | 0 |
| FXGBPCAD | 200 | 80 | 2026-06-22 | 2026-10-16 | 2026-07-01, 2026-08-03, 2026-09-07, 2026-09-30, 2026-10-12 | 0 |
| FXUSDCAD | 200 | 80 | 2026-06-22 | 2026-10-16 | 2026-07-01, 2026-08-03, 2026-09-07, 2026-09-30, 2026-10-12 | 0 |

**Decision:** _URL format confirmed; terms of use (attribution? limits?); prior-business-day rule holds; fallback source named._

## O4. `fx_rate` presence and direction

No activity in the collected data has `fx_rate` set. **Not verifiable from this data**: check FUNDS_CONVERSION activities (separate FX rows) and rely on the golden portfolio for rule C3.

**Decision:** _orientation; whether the 5% threshold is right._

## O5. `raw_type` values

| Institution | raw_type | account_category | Maps to | Accounts |
| --- | --- | --- | --- | --- |
| Wealthsimple Trade | CARD | LOC | unknown | 1 |
| Wealthsimple Trade | CRYPTO | INVESTMENT | unknown | 2 |
| Wealthsimple Trade | FHSA | INVESTMENT | unknown | 1 |
| Wealthsimple Trade | MSB | DEPOSIT | unknown | 8 |
| Wealthsimple Trade | PERSONAL | INVESTMENT | unknown | 1 |
| Wealthsimple Trade | TFSA | INVESTMENT | tfsa | 1 |

**Decision:** _seed lookup table; reply from support@snaptrade.com on TFSA/RRSP strings._

## O6. What the collected data covers

### wealthsimple-real

14 accounts, 1382 activities, currencies CAD, USD, dates 2024-11-10 to 2026-10-12.

| Type | Count |
| --- | --- |
| BUY | 746 |
| CONTRIBUTION | 2 |
| CORPORATE_ACTION | 10 |
| DIVIDEND | 17 |
| FUNDS_CONVERSION | 14 |
| INTEREST | 43 |
| INTERNAL_CASH_TRANSFER_IN | 8 |
| INTERNAL_CASH_TRANSFER_OUT | 3 |
| OPTIONEXPIRATION | 36 |
| REFERRAL | 1 |
| REIMBURSEMENT | 1 |
| SELL | 500 |
| TRANSFER | 1 |

| Account | first_transaction_date | initial_sync_completed | last_successful_sync |
| --- | --- | --- | --- |
| id-0001 | - | true | 2026-10-16 |
| id-0004 | - | true | 2026-10-16 |
| id-0005 | 2026-07-02 | true | 2026-10-16 |
| id-0007 | 2026-05-04 | true | 2026-10-16 |
| id-0009 | 2026-05-29 | true | 2026-10-16 |
| id-0011 | 2026-06-08 | true | 2026-10-16 |
| id-0013 | 2024-12-04 | true | 2026-10-16 |
| id-0015 | - | true | 2026-10-16 |
| id-0016 | - | true | 2026-10-16 |
| id-0018 | 2026-05-18 | true | 2026-10-16 |
| id-0020 | 2024-11-12 | true | 2026-10-16 |
| id-0022 | - | true | 2026-10-16 |
| id-0023 | - | true | 2026-10-16 |
| id-0025 | 2024-11-10 | true | 2026-10-16 |

### Golden-portfolio edge cases

| Case | What | Covered by collected data |
| --- | --- | --- |
| C1 | Trade with commission in `fee` | no: golden portfolio only |
| C2 | FEE row linked to a trade by external_reference_id | no: golden portfolio only |
| C3 | Trade with `fx_rate` set | no: golden portfolio only |
| C3-weekend | FX trade dated on a weekend | no: golden portfolio only |
| C4 | TAX linked to a DIVIDEND | no: golden portfolio only |
| C5 | TAX with no linked dividend | no: golden portfolio only |
| C6 | FEE with no symbol | no: golden portfolio only |
| C7 | FEE with a symbol | no: golden portfolio only |
| C8 | Negative INTEREST (margin) | no: golden portfolio only |
| C9-option | Option activity | yes |
| C9-unknown | Type outside the documented list | yes |
| multi-ccy | More than one currency | yes |
| registered | Account whose raw_type looks like TFSA or RRSP | yes |
| dedupe | Same institution_account_id under two connections | no: golden portfolio only |

**Decision:** _which tests may rely on recorded Sandbox fixtures; whether dates drift day to day (re-pull and diff)._

