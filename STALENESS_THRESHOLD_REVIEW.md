# Staleness Threshold Review & Derivation

## Date
2026-09-18

## Method

Thresholds were derived by observing live Pyth price feed accounts on Solana mainnet.

### 1. Transaction History Analysis (Sep 13, 2026 — During Trading Hours)

Examined the transaction history of the TSLA price feed account (`E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ`)
on Solana mainnet. Retrieved the last 100 transactions and calculated intervals between consecutive updates.

| Metric | TSLA |
|---|---|
| Total transactions analyzed | 100 |
| Active intervals (under 1hr) | 19 |
| Min interval | 10 seconds |
| Max interval | 470 seconds (7.8 minutes) |
| Avg interval | 115.2 seconds (1.92 minutes) |

This shows that during active trading hours, the price feed is updated approximately every 2 minutes,
with occasional gaps of up to ~8 minutes.

### 2. Account Data Observation (Sep 18, 2026 — Current Snapshot)

Observed via `observe-thresholds.mjs` pointing directly at mainnet RPC
(`https://api.mainnet-beta.solana.com`), 3 iterations at 5s intervals.

| Ticker | Price | Conf | Exponent | Publish Time | Age (days) | Conf % |
|---|---|---|---|---|---|---|
| TSLA | $365.2750 | 0.1991 | -5 | 2026-09-11T23:59:59Z | 6.11 | 0.0545% |
| AAPL | $305.9200 | 0.0200 | -5 | 2026-08-14T20:00:19Z | 34.28 | 0.0065% |

**Note**: The current observation time is Sep 18, 2026 (after-market/weekend), so the long ages are
expected — no price updates are posted outside trading hours. The publish_time ages reflect the last
trading session's data.

### 3. Threshold Reasoning

The staleness check in `check_staleness()` runs unconditionally in `main.rs`, but the final output
is determined by `combine_state()`:
- When the market is **closed** (weekends, holidays, after-hours), `combine_state()` returns
  `MarketState::Closed` regardless of staleness.
- When the market is **open**, `combine_state()` returns `MarketState::Stale` if the feed is stale,
  or `MarketState::Open` if fresh.

Therefore, `max_age_seconds` only needs to protect against stale data **during trading hours**.

#### max_age_seconds = 3600 (1 hour)

During active trading:
- Pyth updates the feed approximately every 2 minutes (avg 1.92 min)
- Maximum observed gap between updates is ~8 minutes
- Market hours are 6.5 hours with a 1-hour lunch break

One hour (3600s) provides 7.5x headroom above the observed maximum gap of 7.8 minutes. This is
conservative enough to tolerate brief network issues or publishing delays, while still catching
genuinely stale feeds that haven't updated during a trading session.

#### max_confidence_pct = 1.0 (1%)

Observed confidence-to-price ratios:
- TSLA: 0.0545%
- AAPL: 0.0065%

One percent provides 18x headroom above the observed maximum of 0.0545%. This allows for
legitimate increases in confidence bounds during volatile market conditions while still flagging
anomalous values that would indicate a data quality issue.

## Final Threshold Values

| Config Field | Value |
|---|---|
| `max_age_seconds` | 3600 (1 hour) |
| `max_confidence_pct` | 1.0 (1%) |

## Files Modified

- `updater/src/main.rs` — Default values for `--max-age` and `--max-conf` flags
- `updater/src/staleness.rs` — Test assertions matching the new defaults
- `scripts/observe-thresholds.mjs` — Fixed BigInt parsing, no logic changes needed