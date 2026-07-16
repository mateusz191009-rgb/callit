'use client';

/**
 * Category hero for /category/custom AND every admin-created custom
 * category slug — "the idea lab".
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a living lab over the faint green dot field (.idea-field, kept
 * from the previous scene): a central pulsing core — a Brain icon inside
 * breathing rings (.v7bb-core / .v7bb-ring) — with two faint orbit
 * ellipses around it (dashed svg, .v7bb-orbit-line dash drift). Up to 6
 * market tiles (artwork via MarketIcon, Yes-¢ badge) plus decorative
 * dots ride those orbits, actually traveling along them forever via
 * percent left/top keyframes (.v7bb-orbit-a / .v7bb-orbit-b — the same
 * fluid-safe pattern as the football .pitch-ball; an offset-path px path
 * would not scale). Four spoke lines from the core pulse in sequence
 * (.v7bb-spoke) and a few Sparkles glints twinkle (.idea-glint, reused).
 * Ideas orbiting a brain.
 *
 * Each node's phase on its orbit comes from a fixed slot table (negative
 * animation-delay = -phase * duration); the same precomputed coordinates
 * are the node's resting left/top, so under prefers-reduced-motion the
 * scene freezes into a believable static layout. Slot coordinates are
 * hardcoded literals (not runtime trig) so server and client emit
 * byte-identical styles. Per-node jitter comes from hashString(id) —
 * never Math.random. Hover zooms a tile (question via title attr), click
 * opens that market. Falls back to the node passed in `fallback` (the
 * generic floating-tiles hero) when the category has fewer than 3 usable
 * markets.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Brain, Sparkles } from 'lucide-react';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/* ------------------------------------------------------------------ */
/* Orbit layout                                                        */
/* ------------------------------------------------------------------ */

/** Market tiles at most; the remaining orbit slots render as plain dots. */
const MAX_TILES = 6;

/** Orbit ellipse geometry (percent of the scene). MUST stay in sync with
 *  the .v7bb-orbit-a/.v7bb-orbit-b keyframes in globals.css AND the svg
 *  ellipses below — the keyframes route the nodes through 8 points of
 *  exactly these ellipses. */
const CORE = { left: 50, top: 46 };
const ORBITS = [
  { rx: 25, ry: 15, dur: 36, cls: 'v7bb-orbit-a' }, // inner
  { rx: 39, ry: 24, dur: 54, cls: 'v7bb-orbit-b' }, // outer
] as const;

/**
 * Node slots: which orbit each node rides and where on it (phase 0..1,
 * measured like the keyframes: 0 = rightmost point, increasing toward
 * the bottom). left/top are the PRECOMPUTED coordinates of that phase
 * point — hardcoded, not runtime trig, so SSR and client agree exactly.
 * Ordered so early slots (the market tiles) spread across both orbits.
 */
const NODE_SLOTS: { orbit: 0 | 1; phase: number; left: number; top: number }[] = [
  { orbit: 1, phase: 0.94, left: 86.3, top: 37.2 },
  { orbit: 0, phase: 0.12, left: 68.2, top: 56.3 },
  { orbit: 1, phase: 0.55, left: 12.9, top: 38.6 },
  { orbit: 0, phase: 0.62, left: 31.8, top: 35.7 },
  { orbit: 1, phase: 0.2, left: 62.1, top: 68.8 },
  { orbit: 0, phase: 0.86, left: 65.9, top: 34.4 },
  { orbit: 1, phase: 0.38, left: 21.6, top: 62.4 },
  { orbit: 0, phase: 0.38, left: 31.8, top: 56.3 },
];

/** Spoke lines from the core to fixed points on the outer orbit — they
 *  pulse in sequence (staggered delays), reading as synapses firing. */
const SPOKES: { left: number; top: number }[] = [
  { left: 86.7, top: 53.4 },
  { left: 36.7, top: 68.6 },
  { left: 13.3, top: 37.8 },
  { left: 63.3, top: 23.4 },
];

/** Sparkle glints — fixed spots in the gaps between the orbits. */
const GLINTS: { left: number; top: number; size: number; delay: number; tint: string }[] = [
  { left: 18, top: 18, size: 12, delay: 0, tint: 'text-amber' },
  { left: 84, top: 64, size: 10, delay: 1.7, tint: 'text-green' },
  { left: 44, top: 84, size: 14, delay: 3.4, tint: 'text-amber' },
];

interface OrbitNode {
  slot: (typeof NODE_SLOTS)[number];
  /** Negative animation-delay placing the node at its phase (seconds). */
  delay: number;
}

interface TileNode extends OrbitNode {
  market: Market;
}

/** Phase -> negative delay, with a small deterministic extra so nodes on
 *  the same orbit never move in visible lockstep. */
function orbitDelay(slot: (typeof NODE_SLOTS)[number], h: number): number {
  return -(slot.phase * ORBITS[slot.orbit].dur) - ((h >>> 5) % 30) / 10;
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export default function CustomHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const { tiles, dots } = useMemo(() => {
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

    const chosen = pool.slice(0, MAX_TILES);
    const tileNodes: TileNode[] = chosen.map((m, i) => {
      const slot = NODE_SLOTS[i];
      return { market: m, slot, delay: orbitDelay(slot, hashString(m.id)) };
    });

    // Every slot the tiles did not claim becomes a decorative dot, so
    // both orbits stay populated even in a 3-market category.
    const dotNodes: OrbitNode[] = NODE_SLOTS.slice(tileNodes.length).map((slot, i) => ({
      slot,
      delay: orbitDelay(slot, hashString(`idea-dot-${tileNodes.length + i}`)),
    }));

    return { tiles: tileNodes, dots: dotNodes };
  }, [markets, events]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Faint green dot field backdrop */}
      <div aria-hidden className="idea-field absolute inset-0" />

      {/* Lab scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Orbit ellipses + pulsing spokes; non-scaling stroke keeps them
            1px even though the percent viewBox is stretched. */}
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {ORBITS.map((o) => (
            <ellipse
              key={o.cls}
              cx={CORE.left}
              cy={CORE.top}
              rx={o.rx}
              ry={o.ry}
              className="v7bb-orbit-line fill-none stroke-line"
              strokeWidth={1}
              opacity={0.22}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {SPOKES.map((s, i) => (
            <line
              key={`spoke-${i}`}
              x1={CORE.left}
              y1={CORE.top}
              x2={s.left}
              y2={s.top}
              className="v7bb-spoke stroke-green"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: `${i * 1.4}s` }}
            />
          ))}
        </svg>

        {/* Sparkle glints */}
        {GLINTS.map((g) => (
          <Sparkles
            key={`glint-${g.left}-${g.top}`}
            aria-hidden
            className={`idea-glint absolute ${g.tint}`}
            style={{
              left: `${g.left}%`,
              top: `${g.top}%`,
              width: g.size,
              height: g.size,
              animationDelay: `${g.delay}s`,
            }}
          />
        ))}

        {/* The core: breathing rings around a brain */}
        <div
          aria-hidden
          className="absolute"
          style={{ left: `${CORE.left}%`, top: `${CORE.top}%` }}
        >
          <span
            className="v7bb-ring absolute h-24 w-24 rounded-full border border-green/10"
            style={{ ['--v7bb-ring-dur' as string]: '7s', animationDelay: '-1.8s' }}
          />
          <span
            className="v7bb-ring absolute h-16 w-16 rounded-full border border-green/15"
            style={{ ['--v7bb-ring-dur' as string]: '5.4s' }}
          />
          <span className="v7bb-core absolute flex h-11 w-11 items-center justify-center rounded-full bg-green/10 ring-1 ring-green/25">
            <Brain className="h-5 w-5 text-green/80" />
          </span>
        </div>

        {/* Decorative dots riding the orbits */}
        {dots.map((d, i) => (
          <div
            key={`dot-${i}`}
            aria-hidden
            className={`${ORBITS[d.slot.orbit].cls} absolute`}
            style={{
              left: `${d.slot.left}%`,
              top: `${d.slot.top}%`,
              animationDelay: `${d.delay.toFixed(2)}s`,
            }}
          >
            <span
              className="idea-node block h-2 w-2 rounded-full bg-green/50 ring-1 ring-green/20"
              style={{ transform: 'translate(-50%, -50%)' }}
            />
          </div>
        ))}

        {/* Market tiles riding the orbits */}
        {tiles.map((t, i) => (
          <div
            key={t.market.id}
            className={`${ORBITS[t.slot.orbit].cls} absolute`}
            style={{
              left: `${t.slot.left}%`,
              top: `${t.slot.top}%`,
              animationDelay: `${t.delay.toFixed(2)}s`,
            }}
          >
            <div style={{ transform: 'translate(-50%, -50%)' }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.12 }}
                transition={{ delay: 0.06 * i, type: 'spring', stiffness: 260, damping: 22 }}
              >
                <Link
                  href={`/market/${t.market.id}`}
                  title={t.market.question}
                  className="pointer-events-auto flex flex-col items-center gap-1"
                >
                  <MarketIcon
                    icon={t.market.icon}
                    category={t.market.category}
                    className="h-10 w-10 rounded-xl border border-line bg-surface-3 shadow-lg"
                    iconClassName="h-5 w-5"
                  />
                  {/* Yes-price badge */}
                  <span className="whitespace-nowrap rounded-full border border-line bg-surface-3/90 px-2 py-0.5 text-[10px] font-bold text-green tabular-nums">
                    Yes {formatCents(t.market.yesPrice)}
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
