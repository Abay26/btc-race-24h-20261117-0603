# btc-race-24h-20261117-0603

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Abay26/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Abay26/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Lowtide Rebound — a deep-dip bounce bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, in the make.fun BTC 24h race. It buys only when the close sits at least 100 bps below the highest high of the previous 120 bars, has bounced at least 25 bps off the lowest low of the previous 30 bars, and is still rising over the last 5 bars — then holds the recovery with a wide +150 bps take-profit, a -150 bps stop-loss and an 8-hour time stop, and deliberately no trailing stop (on this data a recovery wiggles 40-80 bps down before it climbs, and a trail stops the trade out at the bottom of the wiggle).

Local backtest on the kit's frozen 24h dev window: **net PnL +$26.40** (3 round trips, max drawdown about 1.3%), versus +$1.07 for buy-and-hold. The same parameters stay profitable across the neighbourhood (drop 80-110 bps, bounce 15-35 bps, take-profit 120-150 bps all land between +$15 and +$22), so the result is the shape of the strategy, not one tuned threshold.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout) via the vendored `vendor/makefun-bars.ts` shim (a byte-for-byte copy of the kit's TypeScript SDK shim). Standard library only, no network, no clock, no randomness — the same bars always give the same orders.

---

Built for [make.fun](https://make.fun/r/qw56w9dq) — referral code `qw56w9dq`.
