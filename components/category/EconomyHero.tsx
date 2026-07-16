'use client';

/**
 * Category hero for /category/economy — "TRADING FLOOR AT NIGHT".
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a night-time trading floor layered as a scene:
 *
 * - BACKDROP: the neutral blueprint grid (.economy-grid) plus a dimmed
 *   skyline silhouette built from 11 CSS candlesticks (wick + body,
 *   heights from hashString of real market ids — never Math.random, so
 *   SSR and client agree). Candles grow from the baseline on mount with
 *   a staggered transition, green when they close above the previous
 *   candle and sky when below.
 * - MIDGROUND: a live-drawing index line — an SVG path through the
 *   candle closes (midpoint-smoothed quadratics). A dim underlay path
 *   shows the full route while a bright comet segment travels it
 *   forever (stroke-dasharray/dashoffset over pathLength=1000:
 *   .v7b-index-comet), the same trick as the crypto constellation's
 *   dash drift. A pulsing dot marks the head of the index (the last
 *   close, .v7b-index-head).
 * - FOREGROUND: 3 floating "terminal chips" (market shortName + ¢,
 *   tabular-nums with a blinking cursor block, thin green border) on
 *   the shared .float-card drift, plus the signature RATE DIAL: a small
 *   SVG gauge in an instrument card whose needle (and green arc fill)
 *   eases from 0 to the frontrunner market's yes% shortly after mount
 *   (CSS transitions: .v7b-dial-arc / .v7b-dial-needle).
 *
 * Hover zooms a chip (question via title attr), click opens the market;
 * the dial links to the frontrunner. Falls back to the node passed in
 * `fallback` (the generic floating-tiles hero) when the category has
 * fewer than 3 usable markets.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { cn, hashString } from '@/lib/utils';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/** Candles in the skyline (spec range 8-12). */
const CANDLE_COUNT = 11;
/** Floating terminal chips over the floor. */
const MAX_CHIPS = 3;

/** Chip CENTER positions in percent of the scene (jitter added per chip
 *  from the market-id hash). Kept left/high so they clear the rate dial
 *  pinned to the top-right corner even at the sm column width (283px). */
const CHIP_SLOTS: { left: number; top: number }[] = [
  { left: 20, top: 12 },
  { left: 34, top: 30 },
  { left: 24, top: 48 },
];

/** Gauge tick marks at 0/25/50/75/100% — precomputed endpoints in the
 *  dial's 100x58 viewBox (angle over the semicircle, radius 43->48). */
const DIAL_TICKS = [0, 0.25, 0.5, 0.75, 1].map((p) => {
  const angle = Math.PI * (1 - p);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x1: 50 + 43 * cos,
    y1: 52 - 43 * sin,
    x2: 50 + 48 * cos,
    y2: 52 - 48 * sin,
  };
});

interface Candle {
  key: string;
  /** Body height in percent of the skyline strip. */
  body: number;
  /** Wick height in percent, stacked directly above the body. */
  wick: number;
  /** Closed up vs. the previous candle — drives the green/sky color. */
  up: boolean;
  /** Growth stagger in ms. */
  delay: number;
}

interface Chip {
  market: Market;
  label: string;
  left: number;
  top: number;
  dur: number;
  delay: number;
}

export default function EconomyHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  // Candles grow and the dial needle swings shortly after mount
  // (setTimeout instead of rAF — it also fires in throttled tabs).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 50);
    return () => clearTimeout(t);
  }, []);

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

  const candles = useMemo<Candle[]>(() => {
    if (pool.length === 0) return [];
    const out: Candle[] = [];
    let prevClose = 0;
    for (let i = 0; i < CANDLE_COUNT; i++) {
      // Cycle the pool so the skyline is seeded by REAL market ids — the
      // scene changes with the category's data but never per render.
      const src = pool[i % pool.length];
      const h = hashString(`${src.id}:candle:${i}`);
      const body = 16 + (h % 46); // 16-61% of the strip
      const wick = 3 + ((h >>> 6) % 8); // 3-10%
      const close = body + wick;
      out.push({
        key: `${src.id}:${i}`,
        body,
        wick,
        up: i === 0 ? true : close >= prevClose,
        delay: i * 55 + ((h >>> 11) % 40),
      });
      prevClose = close;
    }
    return out;
  }, [pool]);

  const chips = useMemo<Chip[]>(() => {
    const top = pool.slice(0, MAX_CHIPS);
    const labels = outcomeLabels(top);
    return top.map((m, i) => {
      const h = hashString(`${m.id}:chip`);
      const slot = CHIP_SLOTS[i % CHIP_SLOTS.length];
      return {
        market: m,
        label: labels.get(m.id) ?? m.question,
        left: slot.left + ((h % 7) - 3), // ±3% jitter
        top: slot.top + (((h >>> 3) % 7) - 3),
        dur: 7 + ((h >>> 6) % 4), // 7-10s drift
        delay: -(((h >>> 10) % 60) / 10), // negative delay staggers phase
      };
    });
  }, [pool]);

  /** Index line through the candle closes, midpoint-smoothed. Percent
   *  coordinates of its own band (viewBox 0-100, stretched). */
  const index = useMemo(() => {
    if (candles.length < 2) return null;
    const pts = candles.map((c, i) => ({
      x: (i / (candles.length - 1)) * 100,
      y: 90 - (c.body + c.wick), // closes 19-71 -> y 71-19
    }));
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    const head = pts[pts.length - 1];
    d += ` L ${head.x.toFixed(2)} ${head.y.toFixed(2)}`;
    return { d, head };
  }, [candles]);

  // Frontrunner for the rate dial: the category's top-volume market.
  const dial = pool[0];
  const dialLabels = useMemo(
    () => (dial ? outcomeLabels([dial]) : new Map<string, string>()),
    [dial]
  );
  const dialPct = dial ? Math.round(dial.yesPrice * 100) : 0;

  // Sparse category — hand back to the generic floating-tiles hero.
  if (pool.length < 3 || !index) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Neutral blueprint grid backdrop */}
      <div aria-hidden className="economy-grid absolute inset-0" />

      {/* Trading floor scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Skyline silhouette: dimmed candlesticks against the night */}
        <div aria-hidden className="absolute inset-x-6 bottom-5 top-[42%]">
          <div className="flex h-full items-stretch justify-center gap-1.5">
            {candles.map((c) => (
              <div key={c.key} className="flex w-2.5 flex-col justify-end">
                <span
                  className={cn(
                    'mx-auto w-px transition-[height] duration-700 ease-out motion-reduce:transition-none',
                    c.up ? 'bg-green/40' : 'bg-sky/40'
                  )}
                  style={{ height: grown ? `${c.wick}%` : '0%', transitionDelay: `${c.delay}ms` }}
                />
                <span
                  className={cn(
                    'w-full rounded-sm transition-[height] duration-700 ease-out motion-reduce:transition-none',
                    c.up ? 'bg-green/55' : 'bg-sky/55'
                  )}
                  style={{ height: grown ? `${c.body}%` : '0%', transitionDelay: `${c.delay}ms` }}
                />
              </div>
            ))}
          </div>
          {/* Trading-floor baseline */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-line-strong" />
        </div>

        {/* Live-drawing index line: dim underlay + traveling comet + head */}
        <div aria-hidden className="absolute inset-x-6 bottom-12 top-8">
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
          {/* Pulsing head of the index (percent coords match the viewBox) */}
          <span
            className="v7b-index-head absolute h-1.5 w-1.5 rounded-full bg-green"
            style={{ left: `${index.head.x}%`, top: `${index.head.y}%` }}
          />
        </div>

        {/* Rate dial — needle eases to the frontrunner's yes% on mount */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3, ease: 'easeOut' }}
          className="absolute right-4 top-4 z-10"
        >
          <Link
            href={`/market/${dial.id}`}
            title={dial.question}
            className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-xl border border-line bg-surface-3/85 px-2.5 pb-1.5 pt-2 shadow-lg"
          >
            <svg viewBox="0 0 100 58" className="h-10 w-[72px]" aria-hidden>
              {/* Track + green fill arc (fill transitions via CSS) */}
              <path
                d="M 10 52 A 40 40 0 0 1 90 52"
                fill="none"
                className="stroke-line"
                strokeWidth={5}
                strokeLinecap="round"
              />
              <path
                d="M 10 52 A 40 40 0 0 1 90 52"
                fill="none"
                pathLength={100}
                className="v7b-dial-arc stroke-green"
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={`${grown ? dialPct : 0} 100`}
                opacity={0.85}
              />
              {DIAL_TICKS.map((t, i) => (
                <line
                  key={i}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  className="stroke-line"
                  strokeWidth={1.5}
                />
              ))}
              {/* Needle (CSS transition on the group's transform) */}
              <g
                className="v7b-dial-needle"
                style={{
                  transform: `rotate(${grown ? dialPct * 1.8 - 90 : -90}deg)`,
                  transformOrigin: '50px 52px',
                }}
              >
                <line
                  x1={50}
                  y1={52}
                  x2={50}
                  y2={20}
                  className="stroke-tx"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
              <circle cx={50} cy={52} r={3.5} className="fill-tx" />
            </svg>
            <span className="text-[10px] font-black text-green tabular-nums">
              Yes {formatCents(dial.yesPrice)}
            </span>
            <span className="max-w-[76px] truncate text-[8px] font-bold uppercase tracking-wider text-tx-mut">
              {dialLabels.get(dial.id) ?? dial.question}
            </span>
          </Link>
        </motion.div>

        {/* Floating terminal chips */}
        {chips.map((c, i) => (
          <div
            key={c.market.id}
            className="absolute z-10"
            style={{ left: `${c.left}%`, top: `${c.top}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div
              className="float-card"
              style={{ ['--float-dur' as string]: `${c.dur}s`, animationDelay: `${c.delay}s` }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.1 }}
                transition={{ delay: 0.08 * i, type: 'spring', stiffness: 260, damping: 22 }}
              >
                <Link
                  href={`/market/${c.market.id}`}
                  title={c.market.question}
                  className="pointer-events-auto flex max-w-[124px] items-center gap-1.5 rounded-md border border-green/30 bg-surface/95 px-2 py-1 text-[10px] font-bold shadow-lg"
                >
                  <span className="truncate uppercase tracking-wide text-tx-sec">{c.label}</span>
                  <span className="shrink-0 text-green tabular-nums">
                    {formatCents(c.market.yesPrice)}
                  </span>
                  <span aria-hidden className="h-2.5 w-1 shrink-0 bg-green/70 motion-safe:animate-pulse" />
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
