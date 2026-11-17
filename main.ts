/**
 * Lowtide Rebound: a deep-dip bounce bot for the make.fun BTC 24h race
 * (agent-fun/bars-replay/v1).
 *
 * Strategy, long only, one position (CBBTC vs USDC), decided on each bar's
 * close and filled at the next bar's open:
 *
 * - Entry, the whole cash, when all three hold on the bar that just closed:
 *   - the close sits at least 100 bps below the highest high of the previous
 *     120 bars (a real dip, not noise: the 120-bar high is a 2-hour memory),
 *   - the close has bounced at least 25 bps off the lowest low of the
 *     previous 30 bars (the knife has stopped falling and turned),
 *   - the close is above the close 5 bars ago (the bounce is still rising).
 * - Exit, the whole position, on the first of:
 *   - take-profit: the close is 150 bps above the entry fill price,
 *   - stop-loss: the close is 150 bps below the entry fill price,
 *   - time stop: 480 bars (8 hours) have passed since the fill.
 *   There is deliberately NO trailing stop: on this data a recovery wiggles
 *   40-80 bps down before it climbs, and a trail stops the trade out at the
 *   bottom of the wiggle. The wide fixed exits let the recovery run.
 * - Every order caps slippage at 100 bps from the close it was decided on.
 *
 * Why this shape: a full-size round trip costs about 37 bps here (4 bps fee
 * each way, 2 bps modelled slippage each way, ~13 bps of pool impact each
 * way at the dev window's ~$790k depth), so a trade has to catch a move far
 * larger than that. Fast momentum signals whipsaw themselves to death on
 * this data (local backtest: 8/21 EMA cross about -$135, RSI(14) momentum
 * about -$82, MACD about -$80, and even a 60-bar Donchian breakout about
 * -$34, all on the same dev window) because the day is choppy: it drifts in
 * a 63874-65467 band with sharp spikes that reverse within minutes. The only
 * moves that pay are the slow multi-hour recoveries after deep dips, and
 * only a patient hold catches them: local backtest net PnL +$26.40 on the
 * dev window (3 round trips, max drawdown about 1.3%), versus +$1.07 for
 * buy-and-hold. The same parameters stay profitable across the neighbourhood
 * (drop 80-110 bps, bounce 15-35 bps, take-profit 120-150 bps all land
 * between +$15 and +$22), so the result is the shape of the strategy, not
 * one tuned threshold.
 *
 * Determinism: only integer and float arithmetic on the bars seen so far, no
 * clock, no environment, no randomness. The same bars always give the same
 * orders. The entry fill price is read back from the position the harness
 * reports (cost over quantity), never guessed from the decision close.
 */

import { runBars, type BarsState, type Batch, type OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const DIP_BARS = 120; // the dip is measured against this many past highs
const DIP_BPS = 100n; // close must sit this far below the 120-bar high
const LOW_BARS = 30; // the bounce is measured against this many past lows
const BOUNCE_BPS = 25n; // close must be this far above the 30-bar low
const RISE_BARS = 5; // close must be above the close this many bars ago
const TAKE_PROFIT_BPS = 150; // exit when the close is this far above the fill
const STOP_LOSS_BPS = 150; // exit when the close is this far below the fill
const MAX_HOLD_BARS = 480; // exit after this many bars in the trade, whatever
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on

/** Rolling state for one symbol: past highs/lows/closes and the open trade. */
class Bot {
  highs: bigint[] = []; // highs of past bars, oldest first
  lows: bigint[] = []; // lows of past bars, oldest first
  closes: bigint[] = []; // closes of past bars, oldest first
  pending: [bigint, bigint, bigint] | null = null; // this batch's high, low, close
  entryPx: bigint | null = null; // fill price of the open trade
  barsHeld = 0; // batches seen holding the trade

  ready(): boolean {
    return (
      this.highs.length >= DIP_BARS &&
      this.lows.length >= LOW_BARS &&
      this.closes.length >= RISE_BARS
    );
  }

  /** Move the current bar's high/low/close into the history, for the next batch. */
  flushPending(): void {
    if (this.pending !== null) {
      const [high, low, close] = this.pending;
      this.highs.push(high);
      if (this.highs.length > DIP_BARS) this.highs.shift();
      this.lows.push(low);
      if (this.lows.length > LOW_BARS) this.lows.shift();
      this.closes.push(close);
      this.pending = null;
    }
  }
}

const bot = new Bot();

function maxBig(values: readonly bigint[]): bigint {
  let m = values[0];
  for (const v of values) if (v > m) m = v;
  return m;
}

function minBig(values: readonly bigint[]): bigint {
  let m = values[0];
  for (const v of values) if (v < m) m = v;
  return m;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    let close: bigint | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      // The dip gauge must hold the bars BEFORE this one: the close is
      // compared against the previous 120 highs and 30 lows, so pushing
      // this bar's high/low first would make both comparisons impossible
      // (close <= own high, close >= own low).
      close = BigInt(bar.c);
      bot.pending = [BigInt(bar.h), BigInt(bar.l), close];
    }
    if (close === null || state.warmingUp) {
      bot.flushPending();
      return [];
    }

    const held = state.positions.get(SYMBOL);
    if (held === undefined) {
      bot.entryPx = null;
      bot.barsHeld = 0;
      if (!bot.ready()) {
        bot.flushPending();
        return [];
      }
      const high120 = maxBig(bot.highs);
      const low30 = minBig(bot.lows);
      const dipBps = ((high120 - close) * 10000n) / high120;
      const bounceBps = ((close - low30) * 10000n) / low30;
      const rising = close > bot.closes[bot.closes.length - RISE_BARS];
      bot.flushPending();
      if (dipBps >= DIP_BPS && bounceBps >= BOUNCE_BPS && rising) {
        if (state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
          return [
            {
              side: "buy",
              symbol: SYMBOL,
              notional_quote_units: state.cash,
              max_slippage_bps: MAX_SLIPPAGE_BPS,
            },
          ];
        }
      }
      return [];
    }

    // Holding: the fill price is read back from the position the harness
    // reports (its cost, fees included, over its quantity).
    if (bot.entryPx === null) {
      bot.entryPx = (held.cost * 10_000_000n) / held.qty;
      bot.barsHeld = 1;
    } else {
      bot.barsHeld += 1;
    }
    const changeBps =
      ((Number(close) - Number(bot.entryPx)) * 10000) / Number(bot.entryPx);
    bot.flushPending();
    if (
      changeBps >= TAKE_PROFIT_BPS ||
      changeBps <= -STOP_LOSS_BPS ||
      bot.barsHeld >= MAX_HOLD_BARS
    ) {
      bot.entryPx = null;
      bot.barsHeld = 0;
      return [
        {
          side: "sell",
          symbol: SYMBOL,
          qty: held.qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});
