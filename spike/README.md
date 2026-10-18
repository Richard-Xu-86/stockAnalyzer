# Spike: verify O1–O6 against the SnapTrade Sandbox

Build step 1 of the Hidden Cost Audit. Throwaway tooling that answers the design doc's open items with evidence before any product code. Read-only, Bearer-token only, scope `openid email read`.

**Timebox: 1 day.** Exit when every **Decision** line in `FINDINGS.md` is filled in and the design doc's open-items table is updated.

## Run it (on your machine; needs network)

```bash
npm install
cp .env.example .env            # paste the Test OAuth app's client_id and client_secret
npm test                        # offline checks of the analysers (35 tests)

# Per Sandbox scenario (one SnapTrade Personal test user each):
SPIKE_SCENARIO=self-directed npm run login      # opens the consent flow, stores tokens locally
SPIKE_SCENARIO=self-directed npm run collect    # pulls and scrubs every endpoint into raw/self-directed/
SPIKE_SCENARIO=self-directed npm run probe:refresh
SPIKE_SCENARIO=self-directed npm run probe:ratelimit   # deliberately triggers a 429 on one account

npm run boc                     # Bank of Canada FXUSDCAD/FXEURCAD/FXGBPCAD, last 120 days
npm run analyze                 # offline: raw/ → FINDINGS.md
npm run revoke                  # wrap-up: revoke, prove the refresh token is dead, delete .tokens.json
```

Repeat `login` → `collect` for `cash-only` and `no-transactions` users. `analyze` reads every scenario under `raw/`.

## What each open item gets

| Item | Evidence collected | Analyser |
| --- | --- | --- |
| O1 endpoints and fields | Status, attempts and rate-limit headers for every call; `/accounts` vs `/authorizations/{id}/accounts`; activity paging, `type` and date filters; a real 429 | `o1-fields.ts`: field presence (missing / null / type), endpoint table, rate-limit sequence |
| O2 commissions | Every BUY/SELL with `fee`, `amount`, `units`, `price`, reference IDs | `o2-commissions.ts`: residual = amount + units × price → fee inside amount, outside, none, or unexplained; linked FEE rows; double-count risk |
| O3 BoC rates | Raw Valet responses | `o3-boc.ts`: parse, weekday gaps (holidays), weekend observations, prior-business-day lookup |
| O4 `fx_rate` | Activities with `fx_rate` | `o4-fx.ts`: compare rate and 1/rate with BoC, orientation, 5% threshold, substitution flag |
| O5 `raw_type` | Every account's `raw_type`, `account_category` | `o5-account-types.ts`: seed lookup table to TFSA / RRSP / taxable / unknown |
| O6 Sandbox coverage | All of the above | `o6-coverage.ts`: counts by type, currencies, date range, sync status, and which golden-portfolio edge cases Sandbox can stand in for |

## Safety

- The client secret and tokens stay in `.env` and `.tokens.json`, both gitignored, written owner-only. Tokens are never printed or logged.
- Responses are scrubbed before they touch disk: IDs become stable pseudonyms (joins still work), account names, numbers and emails are redacted, long digit runs are masked. Money, dates and types are kept because they are what we measure.
- `raw/` is gitignored anyway. Read `FINDINGS.md` before committing it.
- Requests to one account are paced to 8 per minute, except in `probe:ratelimit`, which bursts 12 on purpose.
- Refresh tokens rotate: every refresh writes the new token atomically before anything else. The spike never re-uses an old refresh token, because reuse can revoke the whole grant.

## Not covered by the spike

- Real-broker behaviour: Sandbox is one simulated broker, so O2 and O4 answers are provisional until checked against a real account.
- The Valet URL format and response shape are assumptions this spike confirms; `parseValet` fails loudly if the shape differs.
- ID-token verification (signature, `aud`, `nonce`) is product code for step 3; the spike only records whether one was returned.
