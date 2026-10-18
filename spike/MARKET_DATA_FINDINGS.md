# Market-data spike: can we build "you vs the market"?

Status: done. Provider research and live SnapTrade probe complete (2026-10-18).

## What the feature needs

1. Your portfolio's value at each market close, including options.
2. The S&P 500 and TSX Composite daily moves, switchable with two buttons.
3. Deposits and withdrawals, so they are not counted as gains (time-weighted return).

SnapTrade gives (3) via activities. It has no supported endpoint for (1) history or (2):
the only historical-value endpoint is marked experimental and the docs say not to build on it.

## Your portfolio (from the first spike, counts only)

- 1,246 trades: 408 stock/ETF, **838 options (67%)** across 125 underlyings.
- 94 stock/ETF symbols: about 69 US-listed, 17 TSX, 3 CSE, 1 NEO, 1 OTC, 3 crypto.
- Trades from 2024-11-27 to 2026-10-12.

Consequence: any approach that cannot value options misses two-thirds of the activity.

## Third-party providers (free tiers)

| Provider | Free limits | Display to other people allowed? | Notes |
| --- | --- | --- | --- |
| Tiingo | 50/hour, 1,000/day, 500 symbols/month | **No**: "Internal Use Only… may not display or share the data" | Business plan $50/mo is still internal use |
| Alpha Vantage | 25 requests/day | Not stated; historical index data needs a "personal use" entitlement | Too few calls for 94 symbols |
| EODHD | 20 calls/day, 1 year of history | Listed under personal plans | Cheapest paid EOD plan $19.99/mo, also personal |
| Twelve Data | ~8/min, 800/day | **No**: "Internal non-display usage" | TSX coverage on free not stated |
| Massive (formerly Polygon) | 5/min, 2 years | Individual use; business pricing separate | Options/indices on free not confirmed |

**Finding:** no free tier we found allows showing market data to other people in a public app.
Historical option prices are not free anywhere we checked. Index levels (S&P, TSX) are licensed
by their index owners; ETF prices (SPY, XIU/XIC) are a common, simpler proxy.

## Option on the table: SnapTrade-only, snapshot-based

- **Portfolio value:** a daily job after market close reads `/positions/all` and `/balances`.
  The broker prices the positions, so no third-party data is needed (option pricing: pending probe).
- **Benchmarks:** read SPY (S&P 500 proxy) and XIU.TO or XIC.TO (TSX proxy) once a day via
  `/accounts/{id}/quotes`. Caveat: SnapTrade says this endpoint "is not a substitute for a market
  data provider" and warns against frequent polling. Two tickers once a day is minimal, but worth
  confirming with SnapTrade.
- **Trade-off:** history starts the day a user connects. Real users see "tracking since <date>";
  the demo uses sample history.

## Live probe results (2026-10-18, Wealthsimple, OAuth path)

| Question | Result |
| --- | --- |
| `/positions/all` works | Yes, HTTP 200 for FHSA, personal and TFSA accounts |
| Positions are priced by the broker | Yes: every position has `price`, `units`, `cost_basis`, `currency` (decimal strings) and `instrument.kind` |
| Freshness is stated | Yes: top-level `data_freshness.as_of`, which matched the request time (fetched live, not a stale cache) |
| Option positions are priced | **Not verified**: no open option positions at the time of the probe |
| `/quotes` works for benchmarks | Yes, HTTP 200 for SPY, XIC.TO and XIU.TO, each with `last_trade_price` |
| Quotes carry a timestamp | **No**: we must record our own snapshot time; quotes may be delayed by the broker |

## Decision

**Feasible with SnapTrade data only, as daily snapshots going forward.**

- Portfolio value at each snapshot = sum of `units × price` (× contract multiplier for options) plus cash
  balances, stamped with `data_freshness.as_of`.
- Benchmarks: SPY for the S&P 500 button, XIC.TO for the TSX button (XIC tracks the broad
  TSX Composite; XIU tracks the TSX 60). Each benchmark's daily return comes from consecutive snapshots.
- Daily return is cash-flow adjusted (time-weighted) using deposits and withdrawals from activities.
- No third-party market data, so no display-licensing problem.
- History starts when a user connects; the demo uses sample history.

## Open items

1. Verify option positions are priced: re-run the probe while holding an open option.
2. Snapshot timing: run after both markets close (16:00 ET) and confirm on a weekday that prices
   have moved since the previous snapshot.
3. Confirm with SnapTrade that one `/quotes` call per day for two benchmark tickers is acceptable,
   given their note that it "is not a substitute for a market data provider".
4. Benchmark proxies are price-only ETFs: their dividends are not included. State this on screen.
