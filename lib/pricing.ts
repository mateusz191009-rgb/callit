import type { Market, Side } from './types';
import { clampPrice } from './utils';

/* ------------------------------------------------------------------ */
/* v6 — the FPMM quote (mirrors supabase/schema.sql place_trade)        */
/* ------------------------------------------------------------------ */

/**
 * A market's Fixed-Product Market Maker reserves (share counts, not
 * dollars). Invariant: `yesReserve * noReserve = k` across a trade and
 * `price(yes) = noReserve / (yesReserve + noReserve)`.
 *
 * These are NOT on the `Market` type: the v6 contract's type list adds
 * `provider`/`feeBps`/`seed`/… but no reserves, so a market object only
 * carries them when something attached them at runtime (lib/cloud.ts's
 * `mapMarket` does, from the DB row). `PoolMarket` is the structural
 * widening that lets this module read them without touching lib/types.ts.
 */
export interface PoolReserves {
  yesReserve: number;
  noReserve: number;
}

/** A `Market` that may carry its live FPMM reserves (see `PoolReserves`). */
export type PoolMarket = Market & Partial<PoolReserves>;

export interface BuyPreview {
  /** Trading fee taken off the stake before it reaches the pool (USD). */
  fee: number;
  /** Shares the fill returns. */
  shares: number;
  /** AVERAGE fill price — `(amount - fee) / shares`, NOT the tick. */
  avgPrice: number;
  /** Every winning share pays $1. */
  payout: number;
  /** Return on the GROSS stake (the fee is part of what you paid). */
  returnPct: number;
  /** The market's yes price after this fill walks the curve. */
  priceAfter: number;
  /** How much worse `avgPrice` is than the quoted tick, in percent. */
  slippagePct: number;
}

export interface PreviewBuyOptions {
  /** Overrides `market.feeBps`. The server charges the market's OWN fee,
   *  locked in at creation — not the current global config. */
  feeBps?: number;
  /** The pool to quote against. Pass the live reserves (see
   *  `fetchMarketPool` in lib/cloud.ts) whenever you have them: they are
   *  what `place_trade` actually fills from. */
  pool?: PoolReserves;
}

/** Fee a market falls back to when nothing else says otherwise (2%). */
export const DEFAULT_FEE_BPS = 200;

/** What the platform funds a Global market with on its first trade, when
 *  `platform_settings.global_seed` has not been read yet. */
export const DEFAULT_GLOBAL_SEED = 25;

/** The SQL clamps pool prices to this band — at 0 or 1 a reserve
 *  collapses to zero and the invariant divides by zero on the next trade. */
const MIN_POOL_PRICE = 0.02;
const MAX_POOL_PRICE = 0.98;

/** Mirrors Postgres `round(x, 2)` / `round(x, 6)` for positive values. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function clampPoolPrice(p: number): number {
  return Math.min(MAX_POOL_PRICE, Math.max(MIN_POOL_PRICE, p));
}

/**
 * Reconstruct a pool of size `liquidity` opening at `yesPrice` — the same
 * shape `seed_market_pool()` writes:
 *
 *     yesReserve = F * min(1, (1-p)/p)
 *     noReserve  = F * min(1, p/(1-p))
 *
 * This is EXACT at the moment a pool is seeded (and `liquidity` tracks
 * `collateral` exactly in v6). It is an APPROXIMATION once the pool has
 * been traded: `k` cannot be recovered from (collateral, price) alone, and
 * the reconstruction reads deeper than the real curve — i.e. it
 * UNDERSTATES slippage. Prefer real reserves; this is the fallback for
 * local mode and for feed markets whose pool we cannot read.
 */
export function syntheticPool(
  liquidity: number,
  yesPrice: number
): PoolReserves | null {
  const f = Number(liquidity);
  if (!Number.isFinite(f) || f <= 0) return null;
  const p = clampPoolPrice(Number.isFinite(yesPrice) ? yesPrice : 0.5);
  return {
    yesReserve: round6(f * Math.min(1, (1 - p) / p)),
    noReserve: round6(f * Math.min(1, p / (1 - p))),
  };
}

/** The pool to quote a market against: its real reserves when it carries
 *  them, else a synthetic one derived from `liquidity` + `yesPrice`. */
function poolOf(m: Market): PoolReserves | null {
  const pm = m as PoolMarket;
  const y = Number(pm.yesReserve);
  const n = Number(pm.noReserve);
  if (Number.isFinite(y) && Number.isFinite(n) && y > 0 && n > 0) {
    return { yesReserve: y, noReserve: n };
  }
  return syntheticPool(m.liquidity, m.yesPrice);
}

/**
 * THE buy quote (v6). Mirrors `place_trade` in supabase/schema.sql step
 * for step, so the panel shows what the server will actually do:
 *
 *   1. take the fee off the stake (`fee = amount * fee_bps / 10000`),
 *   2. mint `net` complete sets — every dollar becomes 1 yes + 1 no share
 *      backed by $1 of collateral, so BOTH reserves grow by `net`,
 *   3. remove the bought side's shares from its own reserve so that
 *      `yesReserve * noReserve = k` is preserved.
 *
 * The trader therefore walks the curve and pays a real, WORSENING average
 * price — `avgPrice` is the fill average, not the tick the market shows.
 * That gap is the slippage, and it is the whole point: v5 filled the entire
 * order at the pre-trade tick, which is how a $10,000 buy used to take
 * every share at 50¢.
 *
 * The server's numbers still win. This is a preview: it is exact when
 * quoted against real reserves (`opts.pool`, or reserves attached to the
 * market), and approximate when it has to fall back to a synthetic pool.
 */
export function previewBuy(
  m: Market,
  side: Side,
  amount: number,
  opts?: PreviewBuyOptions
): BuyPreview {
  // The quoted tick — what the Yes/No buttons show.
  const quote = side === 'yes' ? m.yesPrice : 1 - m.yesPrice;
  const feeBps = opts?.feeBps ?? m.feeBps ?? DEFAULT_FEE_BPS;
  const pool = opts?.pool ?? poolOf(m);

  const idle: BuyPreview = {
    fee: 0,
    shares: 0,
    avgPrice: quote,
    payout: 0,
    returnPct: 0,
    priceAfter: m.yesPrice,
    slippagePct: 0,
  };

  const gross = round2(amount);
  if (!(gross > 0) || !pool) return idle;

  const fee = round2((gross * feeBps) / 10000);
  const net = round2(gross - fee);
  if (!(net > 0)) return idle;

  // Mint `net` complete sets into both reserves…
  const k = pool.yesReserve * pool.noReserve;
  let y = pool.yesReserve + net;
  let n = pool.noReserve + net;

  // …then take the bought side out so that (new yes) * (new no) = k.
  let shares: number;
  if (side === 'yes') {
    shares = round6(y - k / n);
    y -= shares;
  } else {
    shares = round6(n - k / y);
    n -= shares;
  }
  if (!Number.isFinite(shares) || shares <= 0) return idle;

  const avgPrice = round6(net / shares);
  const priceAfter = clampPoolPrice(round6(n / (y + n)));
  const payout = shares; // each winning share pays $1
  // Return is measured against the GROSS stake — the fee is money the
  // trader paid, so hiding it here would re-introduce a lying preview.
  const returnPct = ((payout - gross) / gross) * 100;
  const slippagePct = quote > 0 ? ((avgPrice - quote) / quote) * 100 : 0;

  return { fee, shares, avgPrice, payout, returnPct, priceAfter, slippagePct };
}

/* ------------------------------------------------------------------ */
/* LEGACY — local-demo-only path (no Supabase configured)              */
/* ------------------------------------------------------------------ */

/**
 * LEGACY / LOCAL MODE ONLY — do NOT use this to predict a fill.
 *
 * This is the pre-v6 pricing: it fills the ENTIRE order at the pre-trade
 * tick and then nudges the price with a cosmetic `impact` term. It does
 * NOT mirror the server any more (v6's `place_trade` walks an FPMM curve —
 * a different function entirely), and the shares it mints are backed by
 * nothing. It survives only to keep the no-Supabase demo mode working.
 *
 * Quote with `previewBuy()` instead.
 */
export function applyTrade(m: Market, side: Side, amount: number) {
  const price = side === 'yes' ? m.yesPrice : 1 - m.yesPrice;
  const shares = amount / price;
  const impact = amount / (m.liquidity + amount); // 0..1
  const delta = impact * 0.9 * (side === 'yes' ? 1 - m.yesPrice : -m.yesPrice);
  const yesPrice = clampPrice(m.yesPrice + delta);
  return {
    shares,
    yesPrice,
    volume: m.volume + amount,
    liquidity: m.liquidity + amount * 0.5,
  };
}

/**
 * LEGACY / LOCAL MODE ONLY — mirror of `applyTrade`, and UI-dead.
 *
 * There is no `sell_rpc`: selling is disabled everywhere per the v4
 * buy-only rule, and `store.sell()` returns null in cloud mode. Kept for a
 * future re-introduction, which would need a server counterpart first.
 */
export function applySell(m: Market, side: Side, shares: number) {
  const price = side === 'yes' ? m.yesPrice : 1 - m.yesPrice;
  const proceeds = shares * price;
  const impact = proceeds / (m.liquidity + proceeds); // 0..1
  const delta = impact * 0.9 * (side === 'yes' ? -m.yesPrice : 1 - m.yesPrice);
  const yesPrice = clampPrice(m.yesPrice + delta);
  return {
    proceeds,
    yesPrice,
    volume: m.volume + proceeds,
    liquidity: m.liquidity,
  };
}

/**
 * LEGACY / LOCAL MODE ONLY — the flat-tick preview that matched the old
 * `applyTrade`. It shows no fee and no slippage, so it OVERSTATES what a
 * trade returns on any real (v6) market. `previewBuy()` replaced it in the
 * trade panel; this stays only for the local demo path.
 */
export function previewTrade(m: Market, side: Side, amount: number) {
  const price = side === 'yes' ? m.yesPrice : 1 - m.yesPrice;
  const shares = amount > 0 ? amount / price : 0;
  const payout = shares * 1; // each winning share pays $1
  const returnPct = amount > 0 ? ((payout - amount) / amount) * 100 : 0;
  return { price, shares, payout, returnPct };
}
