'use client';

/**
 * Category hero for /category/crypto — the "price constellation".
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half swaps the floating tiles for slowly drifting coin orbs (BTC/ETH/
 * SOL/BNB/USDT/USDC brand monograms, colors from lib/wallets.ts) joined
 * by faint dashed constellation lines over a subtle green grid. Each orb
 * is deterministically paired with one of the category's top markets and
 * badges that market's current Yes price; hover zooms the orb (question
 * via title attr), click opens the market. Falls back to the node passed
 * in `fallback` (the generic floating-tiles hero) when the category has
 * fewer than 3 usable markets.
 *
 * Also exports the shared left-hand copy block (`HeroCopy`) and its
 * stats shape (`CategoryHeroStats`), reused by FootballHero and the
 * generic hero in app/category/[cat]/page.tsx.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { DepositCurrency, EventGroup, Market } from '@/lib/types';
import { formatCents, formatMoney } from '@/lib/format';
import { walletFor } from '@/lib/wallets';
import { cn, hashString } from '@/lib/utils';
import StatChip from '@/components/common/StatChip';

/* ------------------------------------------------------------------ */
/* Shared hero pieces                                                  */
/* ------------------------------------------------------------------ */

export interface CategoryHeroStats {
  /** Category display label (the hero H1). */
  label: string;
  /** Preformatted "Updated" date ('' until mounted — renders as em dash). */
  updated: string;
  marketCount: number;
  eventCount: number;
  /** Total category volume in USD. */
  volume: number;
  loading: boolean;
}

export interface CategoryHeroProps {
  /** Category markets, volume-sorted (event outcomes excluded). */
  markets: Market[];
  /** Category events, volume-sorted. */
  events: EventGroup[];
  stats: CategoryHeroStats;
  /** Rendered instead of the themed hero when data is too sparse (<3 items). */
  fallback: React.ReactNode;
}

/** Left column: title, subtitle, updated stamp and stat chips — identical
 *  across the generic and themed category heroes. */
export function HeroCopy({ stats }: { stats: CategoryHeroStats }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="relative z-10 flex min-h-[220px] flex-col justify-center gap-5 p-5 sm:max-w-[58%] sm:p-8"
    >
      <div>
        <h1 className="text-4xl font-black tracking-tight text-tx sm:text-5xl">
          {stats.label}
        </h1>
        <p className="mt-2 text-sm font-semibold text-tx-sec">Live forecasts and odds</p>
        <p className="mt-1 text-xs text-tx-mut tabular-nums">
          Updated: {stats.updated || '—'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatChip label="Markets" value={stats.loading ? '—' : stats.marketCount} />
        <StatChip label="Events" value={stats.loading ? '—' : stats.eventCount} />
        <StatChip
          label="Volume"
          value={stats.loading ? '—' : formatMoney(stats.volume, { compact: true })}
        />
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Coin monograms — mirrors components/layout/Footer.tsx              */
/* ------------------------------------------------------------------ */

/**
 * Hand-drawn currency monograms: simple white glyphs rendered on
 * brand-colored circles. Duplicated from the footer's "We accept" row
 * (Footer.tsx keeps its own copy — neither file may import the other's
 * assigned scope).
 */
const MONOGRAMS: Record<DepositCurrency, React.ReactNode> = {
  // ₿-style B: bold B with serif ticks poking out top and bottom.
  BTC: (
    <g fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5.6v12.8" />
      <path d="M9 5.6h4.3a2.6 2.6 0 0 1 0 5.2H9" />
      <path d="M9 10.8h5a2.8 2.8 0 0 1 0 5.6H9" />
      <path d="M10.7 3.4v2.2M13.3 3.4v2.2M10.7 18.4v2.2M13.3 18.4v2.2" />
    </g>
  ),
  // Ether diamond with the midline split.
  ETH: (
    <g fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.2 17.4 12 12 20.8 6.6 12 12 3.2Z" />
      <path d="M6.6 12h10.8" />
    </g>
  ),
  // Tether T.
  USDT: <path fill="#FFFFFF" d="M6 5.5h12v3.2h-4.4v9.8h-3.2V8.7H6z" />,
  // Dollar sign: S-curve with the vertical bar ends.
  USDC: (
    <g fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round">
      <path d="M15.6 8.4c-.6-1.2-1.9-1.9-3.6-1.9-2.1 0-3.6 1-3.6 2.7 0 1.6 1.4 2.3 3.6 2.8 2.2.5 3.6 1.2 3.6 2.8 0 1.7-1.5 2.7-3.6 2.7-1.7 0-3-.7-3.6-1.9" />
      <path d="M12 4.2v2.3M12 17.5v2.3" />
    </g>
  ),
  // BNB diamond with a solid diamond core.
  BNB: (
    <g>
      <path
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M12 6.8 17.2 12 12 17.2 6.8 12 12 6.8Z"
      />
      <path fill="#FFFFFF" d="M12 10.6 13.4 12 12 13.4 10.6 12 12 10.6Z" />
    </g>
  ),
  // Solana: three slanted bars, middle one mirrored.
  SOL: (
    <g fill="#FFFFFF">
      <path d="M8.1 5.8h9.6l-2.3 2.7H5.8z" />
      <path d="M5.8 10.6h9.6l2.3 2.7H8.1z" />
      <path d="M8.1 15.5h9.6l-2.3 2.7H5.8z" />
    </g>
  ),
};

/* ------------------------------------------------------------------ */
/* Constellation layout                                                */
/* ------------------------------------------------------------------ */

/** Majors first — orbs are dropped from the END when markets run short. */
const ORB_ORDER: DepositCurrency[] = ['BTC', 'ETH', 'SOL', 'BNB', 'USDT', 'USDC'];

/** Deterministic coin -> market pairing: a market whose question mentions
 *  the coin claims its orb; leftovers fill by top-volume order. */
const COIN_KEYWORDS: Record<DepositCurrency, RegExp> = {
  BTC: /bitcoin|\bbtc\b/i,
  ETH: /ethereum|\beth\b/i,
  SOL: /solana|\bsol\b/i,
  BNB: /\bbnb\b|binance/i,
  USDT: /tether|\busdt\b/i,
  USDC: /\busdc\b|usd coin|stablecoin/i,
};

/** Orb CENTER positions in percent of the scene layer (jitter is added
 *  per orb from the market-id hash). */
const ORB_SLOTS: { left: number; top: number }[] = [
  { left: 18, top: 32 },
  { left: 46, top: 20 },
  { left: 78, top: 30 },
  { left: 28, top: 68 },
  { left: 60, top: 54 },
  { left: 84, top: 78 },
];

const ORB_SIZES = ['h-10 w-10', 'h-11 w-11', 'h-12 w-12'];

/** Slot-index pairs joined by constellation lines (filtered to the orbs
 *  that actually rendered). */
const LINE_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 4],
  [1, 4],
  [4, 5],
  [2, 4],
];

interface Orb {
  currency: DepositCurrency;
  market: Market;
  color: string;
  coinLabel: string;
  left: number;
  top: number;
  size: string;
  dur: number;
  delay: number;
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export default function CryptoHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const orbs = useMemo<Orb[]>(() => {
    // Candidate pool: flat category markets (already top-volume-sorted by
    // the page), then event outcome markets. Deduped by id.
    const pool: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        pool.push(m);
      }
    };
    markets.forEach(add);
    events.forEach((e) => e.markets.forEach(add));

    // Keyword pass first (BTC orb gets a Bitcoin question when one
    // exists), then fill the still-empty orbs with the remaining top
    // markets in order. Fully deterministic — no randomness.
    const used = new Set<string>();
    const paired = ORB_ORDER.map((currency) => {
      const match = pool.find(
        (p) => !used.has(p.id) && COIN_KEYWORDS[currency].test(p.question)
      );
      if (match) used.add(match.id);
      return { currency, market: match as Market | undefined };
    });
    const rest = pool.filter((p) => !used.has(p.id));
    let ri = 0;
    for (const p of paired) {
      if (!p.market && ri < rest.length) p.market = rest[ri++];
    }

    return paired
      .filter((p): p is { currency: DepositCurrency; market: Market } => Boolean(p.market))
      .map((p, i) => {
        const h = hashString(`${p.currency}:${p.market.id}`);
        const slot = ORB_SLOTS[i % ORB_SLOTS.length];
        const wallet = walletFor(p.currency);
        return {
          currency: p.currency,
          market: p.market,
          color: wallet.color,
          coinLabel: wallet.label,
          left: slot.left + ((h % 7) - 3), // ±3% jitter
          top: slot.top + (((h >>> 3) % 7) - 3),
          size: ORB_SIZES[(h >>> 6) % ORB_SIZES.length],
          dur: 6 + ((h >>> 9) % 5), // 6-10s drift
          delay: -(((h >>> 13) % 60) / 10), // negative delay staggers phase
        };
      });
  }, [markets, events]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (orbs.length < 3) return <>{fallback}</>;

  const lines = LINE_PAIRS.filter(([a, b]) => a < orbs.length && b < orbs.length);

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Faint green grid backdrop */}
      <div aria-hidden className="crypto-grid absolute inset-0" />

      {/* Constellation scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Lines connect orb centers; non-scaling stroke keeps them 1px
            even though the percent viewBox is stretched. */}
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {lines.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={orbs[a].left}
              y1={orbs[a].top}
              x2={orbs[b].left}
              y2={orbs[b].top}
              className="constellation-line stroke-line"
              strokeWidth={1}
              opacity={0.15}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {orbs.map((orb, i) => (
          <div
            key={orb.market.id}
            className="absolute"
            style={{
              left: `${orb.left}%`,
              top: `${orb.top}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="float-card"
              style={{ ['--float-dur' as string]: `${orb.dur}s`, animationDelay: `${orb.delay}s` }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.12 }}
                transition={{ delay: 0.05 * i, type: 'spring', stiffness: 260, damping: 22 }}
              >
                <Link
                  href={`/market/${orb.market.id}`}
                  title={orb.market.question}
                  className="pointer-events-auto flex flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      'flex items-center justify-center rounded-full shadow-lg ring-1 ring-white/10',
                      orb.size
                    )}
                    style={{ backgroundColor: orb.color }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-[58%] w-[58%]"
                      aria-hidden="true"
                    >
                      {MONOGRAMS[orb.currency]}
                    </svg>
                    <span className="sr-only">{orb.coinLabel}</span>
                  </span>
                  {/* Live-ish Yes-price badge */}
                  <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface-3/90 px-2 py-0.5 text-[10px] font-bold text-green tabular-nums">
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
                    </span>
                    Yes {formatCents(orb.market.yesPrice)}
                  </span>
                </Link>
              </motion.div>
            </div>
          </div>
        ))}
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
