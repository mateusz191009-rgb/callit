'use client';

/**
 * Category hero for /category/economy — "THE TERMINAL" (v23.7, replaces
 * the v7b trading floor).
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a Bloomberg-style dashboard on the neutral blueprint grid
 * (.economy-grid), stacked as three rows:
 *
 * - QUOTE TILES: the category's top-3 markets as terminal cells — label,
 *   big Yes-percent, and a hash-seeded mini sparkline whose LAST point is
 *   the real price (green when it closed up over the walk, sky when
 *   down). Hover zooms, click opens the market.
 * - INDEX PANEL: a midpoint-smoothed line through 12 hash-seeded closes
 *   (from real market ids — never Math.random, SSR and client agree),
 *   reusing the v7b comet trick: dim underlay path + bright traveling
 *   segment (.v7b-index-comet) + pulsing head (.v7b-index-head).
 * - TICKER BAND: the top markets on the shared marquee (duplicated copy
 *   + .ticker-dup, pause on hover via .ticker-track), each a real link —
 *   label, percent, and ▲/▼ for which side leads.
 *
 * Falls back to the node passed in `fallback` when the category has
 * fewer than 3 usable markets.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatPercent } from '@/lib/format';
import { cn, hashString } from '@/lib/utils';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/** Closes in the index line (one per seed market, cycled). */
const INDEX_POINTS = 12;
/** Quote tiles in the top row. */
const TILE_COUNT = 3;
/** Markets in the ticker band. */
const TICKER_COUNT = 10;

/** Sparkline geometry (viewBox units). */
const SPARK_W = 44;
const SPARK_H = 16;
const SPARK_STEPS = 8;

interface Tile {
  market: Market;
  label: string;
  /** Polyline points for the mini sparkline. */
  points: string;
  /** Walk closed up → green, down → sky. */
  up: boolean;
}

export default function EconomyHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  /** Flat category markets first (economy is mostly binary CPI/Fed/GDP
   *  markets), then event outcomes. Deduped by id. */
  const pool = useMemo<Market[]>(() => {
    const out: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      out.push(m);
    };
    markets.forEach(add);
    events.forEach((e) => e.markets.forEach(add));
    return out;
  }, [markets, events]);

  const tiles = useMemo<Tile[]>(() => {
    const top = pool.slice(0, TILE_COUNT);
    const labels = outcomeLabels(top);
    return top.map((m) => {
      // Hash-seeded walk whose final point is the REAL price, so the
      // spark "arrives" at the number beside it (high yes = high line).
      const pts: string[] = [];
      let first = 0;
      let last = 0;
      for (let i = 0; i <= SPARK_STEPS; i++) {
        const x = (i / SPARK_STEPS) * SPARK_W;
        const y =
          i === SPARK_STEPS
            ? SPARK_H - 1.5 - m.yesPrice * (SPARK_H - 3)
            : 2 + (hashString(`${m.id}:spark:${i}`) % 100) / 100 * (SPARK_H - 4);
        if (i === 0) first = y;
        last = y;
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return {
        market: m,
        label: labels.get(m.id) ?? m.question,
        points: pts.join(' '),
        up: last <= first, // smaller y = higher close
      };
    });
  }, [pool]);

  /** Index line through hash-seeded closes, midpoint-smoothed — same
   *  geometry trick as the old floor, now inside the chart panel. */
  const index = useMemo(() => {
    if (pool.length === 0) return null;
    const pts = Array.from({ length: INDEX_POINTS }, (_, i) => {
      const src = pool[i % pool.length];
      const h = hashString(`${src.id}:index:${i}`);
      return {
        x: (i / (INDEX_POINTS - 1)) * 100,
        y: 82 - (h % 62), // closes at y 20-82
      };
    });
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    const head = pts[pts.length - 1];
    d += ` L ${head.x.toFixed(2)} ${head.y.toFixed(2)}`;
    return { d, head };
  }, [pool]);

  const ticker = useMemo(() => {
    const top = pool.slice(0, TICKER_COUNT);
    const labels = outcomeLabels(top);
    return top.map((m) => ({
      market: m,
      label: labels.get(m.id) ?? m.question,
      up: m.yesPrice >= 0.5,
    }));
  }, [pool]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (pool.length < 3 || !index) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Neutral blueprint grid backdrop */}
      <div aria-hidden className="economy-grid absolute inset-0" />

      {/* Terminal dashboard — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        <div className="absolute inset-x-5 inset-y-4 flex flex-col gap-2">
          {/* Quote tiles */}
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((t, i) => (
              <motion.div
                key={t.market.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.3, ease: 'easeOut' }}
              >
                <Link
                  href={`/market/${t.market.id}`}
                  title={t.market.question}
                  className="pointer-events-auto flex flex-col gap-1 rounded-lg border border-line bg-surface-3/70 px-2 py-1.5 shadow-lg transition-[transform,border-color] hover:scale-[1.05] hover:border-green/40"
                >
                  <span className="truncate text-[8px] font-bold uppercase tracking-wider text-tx-mut">
                    {t.label}
                  </span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="text-sm font-black text-tx tabular-nums">
                      {formatPercent(t.market.yesPrice)}
                    </span>
                    <svg
                      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                      className="h-4 w-11 shrink-0"
                      aria-hidden
                    >
                      <polyline
                        points={t.points}
                        fill="none"
                        className={t.up ? 'stroke-green' : 'stroke-sky'}
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        opacity={0.8}
                      />
                    </svg>
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Index panel: dim underlay + traveling comet + pulsing head */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.35 }}
            className="relative min-h-[64px] flex-1 overflow-hidden rounded-lg border border-line bg-surface-3/50 shadow-lg"
          >
            <div className="flex items-center justify-between px-2 pt-1.5">
              <span className="text-[8px] font-black uppercase tracking-[0.16em] text-tx-mut">
                Economy Index
              </span>
              <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-green">
                <span aria-hidden className="h-1 w-1 rounded-full bg-green motion-safe:animate-pulse" />
                Live
              </span>
            </div>
            <div aria-hidden className="absolute inset-x-2 bottom-2 top-6">
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path
                  d={index.d}
                  fill="none"
                  className="stroke-green"
                  strokeWidth={1}
                  opacity={0.12}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={index.d}
                  fill="none"
                  pathLength={1000}
                  className="v7b-index-comet stroke-green"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  opacity={0.55}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span
                className="v7b-index-head absolute h-1.5 w-1.5 rounded-full bg-green"
                style={{ left: `${index.head.x}%`, top: `${index.head.y}%` }}
              />
            </div>
          </motion.div>

          {/* Ticker band — real links, marquee pauses on hover/focus */}
          <div className="ticker-track pointer-events-auto overflow-hidden rounded-lg border border-line bg-ink/60">
            <div
              className="animate-marquee flex w-max items-center"
              style={{ animationDuration: '30s' }}
            >
              {[false, true].map((dup) => (
                <div
                  key={dup ? 'dup' : 'run'}
                  aria-hidden={dup || undefined}
                  className={cn('flex items-center', dup && 'ticker-dup')}
                >
                  {ticker.map((t) => (
                    <Link
                      key={`${dup ? 'd' : 'r'}:${t.market.id}`}
                      href={`/market/${t.market.id}`}
                      title={t.market.question}
                      tabIndex={dup ? -1 : undefined}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold transition-colors hover:text-green"
                    >
                      <span className="max-w-[96px] truncate uppercase tracking-wide text-tx-sec">
                        {t.label}
                      </span>
                      <span
                        className={cn('shrink-0 tabular-nums', t.up ? 'text-green' : 'text-sky')}
                      >
                        {formatPercent(t.market.yesPrice)} {t.up ? '▲' : '▼'}
                      </span>
                      <span aria-hidden className="ml-1 h-0.5 w-0.5 rounded-full bg-line-strong" />
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
