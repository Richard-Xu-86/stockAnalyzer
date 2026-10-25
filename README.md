# Versus

**Did you beat the market today?** Versus connects to a brokerage account through SnapTrade (OAuth, read-only), records the portfolio after every weekday close, and compares your day with the S&P 500 or the TSX, in Canadian or US dollars. Over time it builds a trend: cumulative return on the same days as the market, how much of the market's up and down days you catch, and how sensitive you are to it.

- **Live demo with a sample portfolio:** `/demo` (no sign-in; invented holdings, real maths)
- **Your own account:** "Connect with SnapTrade" on the home page

## Contents
1. [What it does](#what-it-does)
2. [Run it locally](#run-it-locally)
3. [Deploy (Vercel + Neon)](#deploy-vercel--neon)
4. [How it works](#how-it-works)
5. [The maths](#the-maths)
6. [Decisions and trade-offs](#decisions-and-trade-offs)
7. [Testing](#testing)
8. [Security and privacy](#security-and-privacy)
9. [Scaling and operations](#scaling-and-operations)
10. [How we got here: the spike](#how-we-got-here-the-spike)
11. [Feedback for SnapTrade](#feedback-for-snaptrade)
12. [Frontend rules](#frontend-rules)
13. [Known limitations](#known-limitations)
14. [AI usage](#ai-usage)

## What it does

| On the page | Where it comes from |
|---|---|
| **Today**: your return, the market's, and the difference in points, with a ✓/✗ mark | Two close snapshots, deposits and withdrawals removed |
| **What moved you**: top holdings, currency moves, trades and cash, in points that add up to your return | Price effect and currency effect per holding |
| **Since you started tracking**: cumulative you vs market, chart and table | Daily returns compounded over the *same* days for both |
| **How you move with the market**: up/down capture, beta, days you beat it | Last 30 comparable days, from 10 days on, "early estimate" under 60 |
| **Recent days**: with notes for provisional days, missed runs and days left out | Each day's status and reason |
| **Before you started tracking**: net deposits by month and currency, buy and sell counts | Full activity history, available from day one |

**S&P 500 / TSX** and **CAD / USD** buttons recalculate every number. They are plain form submissions, so they work without JavaScript.

**Tracking states** are shown honestly: first snapshot pending, one snapshot so far, importing history, needs sign-in, last run failed, provisional day, partial coverage.

**Retention**: on disconnect the user chooses *keep my history* or *delete everything*. Tracking pauses after 90 days without a visit; all data is deleted after 12 months without one.

## Run it locally

Requirements: Node 20+, a Postgres database (a free Neon branch works), and a SnapTrade OAuth app.

```bash
npm ci
cp .env.example .env.local       # then fill it in (below)
npm run keygen                   # prints SESSION_SECRET, TOKEN_KEYS, TOKEN_KEY_ID, CRON_SECRET
npm run db:migrate               # applies migrations/*.sql to DATABASE_URL
npm run dev                      # http://127.0.0.1:3000
```

- **Demo only:** `/demo` needs no database or SnapTrade credentials beyond the variables being present.
- **OAuth locally:** register `http://127.0.0.1:3000/auth/callback` as a redirect URI on the SnapTrade OAuth app. Use `127.0.0.1`, not `localhost`, so the cookie and the redirect match.
- **Run a snapshot by hand:** `curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/snapshot`. Outside the close window (16:00 ET until the next 09:30 ET open) it skips on purpose.

| Variable | What it is |
|---|---|
| `SNAPTRADE_OAUTH_CLIENT_ID` / `_SECRET` | The **OAuth app's** credentials (not the API key pair). The secret is server-only. |
| `SNAPTRADE_REDIRECT_URI` | Must exactly match a redirect URI on the OAuth app |
| `SNAPTRADE_ISSUER`, `SNAPTRADE_API_BASE` | Default `https://api.snaptrade.com` |
| `DATABASE_URL` | Neon **pooled** connection string |
| `SESSION_SECRET` | 32+ chars; encrypts session cookies |
| `TOKEN_KEYS`, `TOKEN_KEY_ID` | `id:base64key[,id2:key2]`; AES-256-GCM keys for tokens at rest, and which one encrypts new rows |
| `CRON_SECRET` | Vercel sends it as a Bearer token to the cron routes |
| `BOC_API_BASE` | Default Bank of Canada Valet API |

## Deploy (Vercel + Neon)

1. Create a Neon project; copy the **pooled** connection string.
2. `DATABASE_URL=... npm run db:migrate`
3. Import the repo into Vercel (Hobby is enough); the app is at the repository root, so leave Root Directory empty. Set the variables above in Project Settings → Environment Variables, using `npm run keygen` for the generated ones.
4. On the SnapTrade OAuth app, add `https://<your-domain>/auth/callback` as a redirect URI and set `SNAPTRADE_REDIRECT_URI` to it.
5. Deploy. `vercel.json` registers the three crons (times are UTC):

| Cron | Schedule | Job |
|---|---|---|
| `/api/cron/snapshot` | `5 21 * * 1-5` | FX, both benchmarks, every active user's snapshot, then any benchmark still missing |
| `/api/cron/retry` | `5 22 * * 1-5` | Users without a good close yet (none, or stale) and missing benchmarks |
| `/api/cron/retention` | `30 23 * * *` | Deletes users with no visit in 12 months |

21:05 UTC is 4:05 PM EST / 5:05 PM EDT. Vercel Hobby may start a cron anywhere within its hour, so the snapshot always runs between about 4:05 and 6:05 PM Eastern: after the close, and as close to it as possible (the benchmark is SnapTrade's last trade, which can drift after hours). A test checks this for both summer and winter.

6. Check `/api/health`: database reachable, and when the last run finished.

## How it works

```
Browser ──► /auth/login ──► SnapTrade consent ──► /auth/callback
                                                     │ verify state, PKCE, ID token (JWKS)
                                                     │ encrypt + store tokens, session cookie
                                                     ▼
                                     after(): first sync (day-one history)
Vercel Cron (weekdays after close)
   └► /api/cron/snapshot ─► per user: accounts → activities → positions/all + balances
                          ─► one /quotes call for SPY and XIC.TO
                          ─► Bank of Canada USD/CAD
                          ─► Postgres (normalized rows + raw JSON)
/dashboard ─► load snapshots, activities, FX, benchmarks ─► pure engine ─► server-rendered page
```

| Layer | Files |
|---|---|
| Routes | `app/auth/*`, `app/api/*`, `app/dashboard`, `app/demo` |
| Daily job | `src/services/snapshot.ts` (per-user lease, close window, idempotent writes) |
| SnapTrade client | `src/lib/snaptrade/client.ts` (schemas, retries, refresh-once, pacing) |
| OAuth | `src/lib/oauth/oauth.ts`, `grants.ts` (encrypted grants, refresh lease) |
| Engine (pure) | `src/domain/flows.ts`, `returns.ts`, `metrics.ts`, `history.ts` |
| Page | `src/services/dashboard.ts` (model), `src/ui/*` (components, SVG chart) |

**Why snapshot-forward?** SnapTrade, like the brokers behind it, returns *current* holdings only: there is no portfolio value for last Tuesday. Versus therefore starts recording on the day you connect. Activities do go back years, so the day-one panel shows deposits and trading history immediately instead of an empty page.

## The maths

**Daily return** (time-weighted, flows at the end of the day):

```
r = (V_end − F) / V_start − 1
```

- `V` = every holding priced by the broker at that close (units × price × contract multiplier, converted at that day's FX) + cash + money in transit between accounts. A holding bought or sold during the day counts at the end where it exists, so a trade moves value between cash and holdings without creating a return.
- `F` = external flows that day: contributions, withdrawals, referral bonuses, reimbursements, unmatched transfers, and any transfer leg whose other account isn't being compared that day (e.g. money moved into a newly linked account).
- Only accounts present in **both** snapshots count, so a newly linked account is never a gain.

Worked example (in `test/returns.test.ts`): 2,100 → 2,600 with a 500 deposit gives `(2600 − 500)/2100 − 1 = 0%`. The deposit is not a gain.

| Case | Handling |
|---|---|
| Transfer between your accounts | OUT matched to IN (same amount, within 7 days); in between it counts as "in transit". Unmatched transfers are treated as money leaving or arriving. |
| Missed run | The next day spans the gap; the benchmark spans the same dates; the row says "covers N trading days". |
| Missing benchmark close | The days on either side are combined into one comparison, from the last saved price before the gap to the first after it; nothing is estimated. A gap on the very first day can't be anchored and is counted as left out. |
| Trade (buy or sell) | Valued at each end where the holding exists; no return is created. A purchase the broker hasn't priced yet excludes the day. |
| Activity not yet synced | Day marked **provisional** until the broker reports transactions through that date (checked on every page load, in New York time); activities are re-read from 3 days before the last good snapshot. |
| Holding with no price | Left out of both ends if the rest covers at least 90% of the portfolio (coverage shown, measured with the holding's real size); otherwise the day is excluded. |
| Asset transferred in with no cash value | Day excluded rather than counted as a gain. |
| Portfolio under $100 | Excluded; percentages are noise. |
| Stock split | Units × price is unchanged; no special case needed (tested). |
| Options | Valued with the contract multiplier (100 by default). |
| Stale broker data (`as_of` before the close) | Snapshot stored as stale and never used as a close. |

**Benchmark:** SPY (S&P 500) and XIC.TO (TSX), captured from SnapTrade quotes after each close. These are ETFs, so their fees are included, which is a fair comparison for an investor.

**Currency:** USD/CAD from the Bank of Canada, looking back up to 5 days for holidays (no rate means the day is excluded, never guessed). The **currency effect** is split out per holding, so "the US dollar fell" is visible instead of buried inside your return.

**Drivers:** each holding's price effect `units × ΔP × FX_start / V_start` plus currency effect `units × P_end × ΔFX / V_start`; the remainder (trades, dividends, interest) closes the sum, and the lines add up exactly to `r` (tested).

**Pattern metrics** (last 30 comparable days, shown from 10, labelled "early estimate" under 60):
- Up capture = your mean return on market-up days ÷ market's mean on those days (down capture likewise)
- Beta = cov(r, b) / var(b)
- Days you beat it = share of days with r > b
- Cumulative return compounds both sides over the **same** days only

All money maths uses `decimal.js` at 40 digits; floats appear only at the display edge.

## Decisions and trade-offs

| Decision | Why | What we give up |
|---|---|---|
| Broker prices + SnapTrade quotes, no market-data vendor | Free market-data tiers forbid display or are too small (see [`docs/MARKET_DATA_FINDINGS.md`](docs/MARKET_DATA_FINDINGS.md)). Everything comes from one licensed source. | No backfill and no intraday view. `BenchmarkSource` is the seam to swap in a vendor later. |
| Snapshot after the close only | A noon price stored as a "close" would make every comparison wrong | A sign-in during market hours shows history only until that evening |
| Recompute from stored rows on every page view | One row per trading day is small; a maths fix applies to all history at once | A little CPU per request; cached if needed at scale |
| Next.js route handlers on Vercel + Neon Postgres | One deployable unit, a public URL, secret kept server-side | Serverless: no shared memory, so leases and pacing live in Postgres rows |
| Leases in rows, not advisory locks | Neon's pooled connection (PgBouncer, transaction mode) drops session state | Slightly more SQL |
| Raw JSON stored next to normalized rows | History can't be refetched; a parsing bug can be fixed by reprocessing | Storage (small) |
| Server-rendered SVG chart, no chart library | No client JavaScript, works everywhere, fast | Hand-written axes |
| Exclude a day instead of estimating | A wrong number is worse than a missing one | Some gaps in the trend, each with a stated reason |
| Weekday snapshots only, both exchanges' holidays known | Fewer API calls; holiday-aware benchmark spans | The calendar must be extended yearly (the job logs an error if it isn't) |

**What would change our mind:** a licensed historical price feed (enables backfill from activities), SnapTrade webhooks for transaction sync (replaces the overlap re-read), or a user base big enough that per-account pacing dominates (move to a queue).

## Testing

```bash
npm test          # 88 tests, fully offline, about 25 seconds
npm run typecheck
npm run build
```

- **Offline guarantee:** `test/setup.ts` replaces `fetch` and fails any request to a non-local host. Every test injects its own fake.
- **Hand-computed fixtures** (`test/returns.test.ts`): deposits, withdrawals, missed runs, provisional days, CAD/USD with currency effects, Canadian holidays, transfers in transit, new accounts, coverage, options, splits. Each expected value is worked out in comments.
- **Properties** (`test/metrics.test.ts`, fast-check): a deposit never changes the return; cumulative = product of daily returns.
- **The real job against a real Postgres** (`test/snapshot-job.test.ts`): PGlite runs the same migrations in-process; a fake SnapTrade + Bank of Canada server scripts token rotation, dead grants, 429/5xx, stale data and leases. Covers idempotency, the close window, refresh-once, the retry run, the 90-day pause and 12-month deletion.
- **Security** (`test/security.test.ts`): AES-GCM tamper detection and key rotation, the RFC 7636 PKCE vector, ID-token signature, issuer, audience, expiry and nonce checks, retry policy, paging, and log redaction.
- **Dashboard** (`test/dashboard.test.ts`): the demo through every benchmark/currency combination, driver lines summing to the return, CSRF origin check, cron auth.

Bugs the tests caught during the build:
- A token-endpoint 503 would have logged users out.
- Benchmarks were captured before any accounts were stored, which lost day one's market close.
- The URL builder dropped any path prefix on the API base.

Bugs found by running it on a real account for a week, then by an independent code review, each fixed with a regression test that reproduces the exact scenario:
- Days stayed **provisional forever**: the flag was frozen at snapshot time, when the broker is a day behind. Now re-evaluated on every page load.
- A first snapshot taken by a sign-in (not the daily job) had **no benchmark price**, so the first comparison was missing. Every recorded close now saves that day's benchmark prices.
- **Buying a new holding read as −5%** (and selling one out as +5%) on a day with no price moves: each end only counted holdings priced on both days. Each end is now valued on its own.
- **Moving money into a newly linked account read as −50%**, and in-transit money from it as a gain: transfers now become flows when only one side is being compared.
- One missing benchmark price **silently dropped two days** from the totals. They're now combined into one comparison (see the maths).
- One broken or removed account failed the whole user every day; the retry run skipped stale snapshots; a sign-in before the open could overwrite a good close; sync times were read as UTC dates.

## Security and privacy

- **Secrets:** the client secret is used only server-side (HTTP Basic on the token call) and is never sent to the browser or put in a URL. Environment variables are validated by name; errors never print values.
- **OAuth:** authorization code + PKCE S256, `state` and `nonce` in a 10-minute encrypted cookie, used once. ID token verified against JWKS (RS256, iss, aud, exp, nonce); email trusted only if `email_verified`. Scope is `openid email read`: no trading.
- **Tokens at rest:** access and refresh tokens are AES-256-GCM encrypted with a key id, so keys can rotate without re-encrypting everything.
- **Rotating refresh tokens:** one instance refreshes under a row lease; the others wait for the new version. A 401 triggers at most one refresh per run, so one bad account can't burn the grant (a spike lesson).
- **Transient vs dead grants:** only a 400/401 from the token endpoint means "sign in again". Outages are retried.
- **Disconnect:** revokes the refresh token at SnapTrade, then deletes our copy, keeping or deleting the history as chosen.
- **Web:** form POSTs check the Origin header and use SameSite=Lax cookies; CSP, `frame-ancestors 'none'`, nosniff, `Referrer-Policy: same-origin` (keeps codes out of Referer); personal routes send `Cache-Control: private, no-store`.
- **Logs:** structured JSON; keys containing token, secret, code, amount, price, value, balance, units or cash are redacted; account ids are stripped from paths.

## Scaling and operations

- **Rate limits:** SnapTrade allows 10 requests/min per account. Pacing reserves a slot atomically in Postgres (8/min) so it holds across serverless instances. 429s honour `Retry-After`, with jittered exponential backoff otherwise.
- **Time budget:** the daily run stops starting new users after 240 s; the retry run an hour later finishes the rest. Per-user leases stop two runs from fighting.
- **Cost per user per day:** roughly 2 calls per investment account (positions/all, balances), plus activities, plus 1 shared quotes call. At about 3 accounts, that's under 10 calls.
- **Beyond Hobby:** with thousands of users the job becomes a queue (one message per user, a worker per message). The per-user function is already the unit of work, so it moves as-is.
- **Observability:** `snapshot_runs` records every run; `/api/health` exposes the last one. Schema drift in a SnapTrade response is logged with field paths (no values) and fails that user, not the run.
- **Test app limit:** a SnapTrade test app allows 5 connected users. Production needs the app promoted.

## How we got here: the spike

Before any product code, a throwaway spike tested our assumptions against a real Wealthsimple account. The code isn't included; its findings are in [`docs/FINDINGS.md`](docs/FINDINGS.md) and [`docs/MARKET_DATA_FINDINGS.md`](docs/MARKET_DATA_FINDINGS.md), and the original design notes in [`docs/DESIGN.md`](docs/DESIGN.md).

- **First idea, a hidden-cost audit:** dropped. Wealthsimple reports `fee: 0` on every trade and no FX rate on conversions, so costs can't be measured from this data.
- **Market data:** the free tiers of Tiingo, Twelve Data, EODHD, Alpha Vantage and Massive either forbid displaying their prices or allow too few calls. This led to the snapshot-forward design built on broker prices and SnapTrade quotes.
- **API facts found:**
  - `/positions` returns 410; use `/positions/all`.
  - Option positions carry a contract multiplier.
  - Deposit and card accounts reject investment endpoints with 401; skip them by category.
  - Activities lag about a day.
  - Bank of Canada FX has gaps on Canadian holidays.

## Feedback for SnapTrade

- **Historical account values:** even a daily balance history would remove the cold start that shapes this whole design.
- **Rate-limit headers:** OAuth apps get no customer-level headers, and the per-user limit has none either. Headers would let clients pace precisely instead of conservatively.
- **401 on an unsupported account:** a deposit account answers investment endpoints with 401, the same as an expired token. A 403 or a typed error would stop clients from refreshing a healthy grant.
- **Activities:** `fee` and `fx_rate` are always 0/null for Wealthsimple, and a conversion records only the received leg. A field saying "not reported by this broker" would be clearer than 0.
- **Quotes for benchmark ETFs:** this already works well; a documented "last close" field would make it explicit which price is returned.

## Frontend rules

The look is "an auditor's markup on a plain statement" (tokens in `app/globals.css`).
- Red is only for a loss or for being behind the market. Never decoration.
- Blue is only for things you can press.
- Meaning is never carried by colour alone: every figure has a sign (real minus `−`), and the verdict has a ✓/✗ mark and words.
- Tabular figures for all numbers; numbers are right-aligned in tables; percentage-point differences say "pts".
- Tables for tabular data, not cards. Wide tables scroll inside their box; the page never scrolls sideways (checked at 375 px).
- One bold element: the day's difference with a double underline.
- No client JavaScript for core features; the toggles are forms.
- Sentence case, plain words, no all-caps labels; estimates are labelled as estimates.

## Known limitations

- **Scale:** the daily job processes users one at a time, spacing calls 7.5 s apart per account to respect SnapTrade's limit, within a 240 s budget. That's roughly 4–8 users per run (with the retry). The fix is a queue with one job per user; the per-user function is already the unit of work.
- **Close-price fidelity:** the benchmark close is SnapTrade's `last_trade_price` at 4:05–6:05 PM Eastern, not the official closing print, and the quote has no "previous close" field. A broker serving delayed quotes could show pre-close prices. In winter the Bank of Canada rate (published around 4:30 PM) can be a day old until the retry run fetches it.
- **Transaction completeness:** activity types Versus doesn't recognise are ignored; deposits the broker backdates more than 3 days before the last good snapshot aren't fetched; an account linked later has no history from before it was connected; "provisional" uses the date of the broker's last sync, not its time.
- **Rare races:** a token renewal failing while another process waits for it can mark a user as needing to sign in; the per-user lock isn't owner-checked on release; a sync already running can undo "disconnect, keep history".
- **Web hardening:** the production CSP allows inline scripts; sessions are stateless 30-day cookies, so a copied cookie stays valid until it expires.
- **Scope:** CAD and USD only (other currencies exclude the day); validated against one broker (Wealthsimple); a SnapTrade test app allows 5 connected users.

## AI usage

Built with Claude as a pair: research on SnapTrade's API and market-data licensing, the design doc, the spike scripts, code and tests, and an independent review pass whose findings are listed under Testing. Every number in the tests was worked out by hand in comments; the spike findings came from running against a real account. Decisions, the product pivot and review were mine.
