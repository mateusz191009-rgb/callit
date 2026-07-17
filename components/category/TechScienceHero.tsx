'use client';

/**
 * Category hero for /category/tech-science — "MISSION CONTROL".
 *
 * Same hero shell as the other themed category heroes (rounded-2xl
 * border-line bg-surface-2 + hero-glow, HeroCopy on the left) with an
 * orbital tracking display on the right half:
 *
 * - BACKDROP: the neutral blueprint grid (.economy-grid) — reads as an
 *   engineering drawing.
 * - ORBITS: two concentric dashed rings with a satellite dot each,
 *   orbiting via plain CSS animate-spin on a wrapper (the dot sits at
 *   the wrapper's top edge, so rotating the wrapper orbits the dot — no
 *   new keyframes). The rings counter-rotate at different periods.
 * - CIRCUIT TRACES: right-angled SVG traces with a traveling pulse each,
 *   reusing the .v7b-index-comet dash animation from the economy hero,
 *   ending in small terminal pads.
 * - CONSOLE CHIPS: up to 3 floating chips (market label + Yes price) on
 *   the shared .float-card drift; hover zooms, click opens the market.
 *
 * Everything visual is seeded from REAL market ids via hashString (never
 * Math.random — SSR and client must agree). Falls back to the generic
 * floating-tiles hero (`fallback`) when the category has fewer than 3
 * usable markets.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

const MAX_CHIPS = 3;

/** Chip CENTER positions (percent of the scene; jitter from the id hash).
 *  Kept left/low so they clear the orbit assembly pinned top-right. */
const CHIP_SLOTS: { left: number; top: number }[] = [
  { left: 20, top: 20 },
  { left: 14, top: 50 },
  { left: 26, top: 78 },
];

/** Right-angled circuit traces in the scene's 100x100 viewBox — drawn
 *  bottom-left toward the orbit assembly, like harness runs on a board. */
const TRACES: string[] = [
  'M 2 92 H 30 V 64 H 52',
  'M 2 78 H 20 V 40 H 44 V 30',
  'M 10 98 V 84 H 40 V 74 H 62',
];

interface Chip {
  market: Market;
  label: string;
  left: number;
  top: number;
  dur: number;
  delay: number;
}

export default function TechScienceHero({
  markets,
  events,
  stats,
  fallback,
}: CategoryHeroProps) {
  /** Flat markets first, then event outcomes, deduped by id. */
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

  const chips = useMemo<Chip[]>(() => {
    const top = pool.slice(0, MAX_CHIPS);
    const labels = outcomeLabels(top);
    return top.map((m, i) => {
      const h = hashString(`${m.id}:console`);
      const slot = CHIP_SLOTS[i % CHIP_SLOTS.length];
      return {
        market: m,
        label: labels.get(m.id) ?? m.question,
        left: slot.left + ((h % 7) - 3), // ±3% jitter
        top: slot.top + (((h >>> 3) % 7) - 3),
        dur: 7 + ((h >>> 6) % 4), // 7-10s drift
        delay: -(((h >>> 10) % 60) / 10),
      };
    });
  }, [pool]);

  /** Stagger the trace pulses from real ids so the board never syncs up. */
  const traceDelays = useMemo(() => {
    if (pool.length === 0) return TRACES.map(() => 0);
    return TRACES.map((_, i) => {
      const src = pool[i % pool.length];
      return -(((hashString(`${src.id}:trace:${i}`) % 70) / 10)); // -0..-6.9s
    });
  }, [pool]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (pool.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Engineering-drawing grid backdrop (shared with the economy hero) */}
      <div aria-hidden className="economy-grid absolute inset-0" />

      {/* Mission-control scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Circuit traces with traveling pulses */}
        <div aria-hidden className="absolute inset-0">
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {TRACES.map((d, i) => (
              <g key={d}>
                <path
                  d={d}
                  fill="none"
                  className="stroke-line-strong"
                  strokeWidth={1}
                  opacity={0.6}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={d}
                  fill="none"
                  pathLength={1000}
                  className="v7b-index-comet stroke-green"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  opacity={0.5}
                  vectorEffect="non-scaling-stroke"
                  style={{ animationDelay: `${traceDelays[i]}s` }}
                />
              </g>
            ))}
            {/* Terminal pads at each trace end */}
            <circle cx={52} cy={64} r={1.6} className="fill-green" opacity={0.7} />
            <circle cx={44} cy={30} r={1.6} className="fill-green" opacity={0.7} />
            <circle cx={62} cy={74} r={1.6} className="fill-green" opacity={0.7} />
          </svg>
        </div>

        {/* Orbit assembly, pinned top-right */}
        <div aria-hidden className="absolute right-8 top-1/2 h-40 w-40 -translate-y-1/2">
          {/* Planet core */}
          <span className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green/25 ring-2 ring-green/60" />
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green" />

          {/* Inner ring + satellite (orbits by rotating the wrapper) */}
          <svg viewBox="0 0 100 100" className="absolute inset-[22px] h-[calc(100%-44px)] w-[calc(100%-44px)]">
            <circle cx={50} cy={50} r={48} fill="none" className="stroke-line-strong" strokeWidth={1.5} strokeDasharray="2 6" />
          </svg>
          <div
            className="absolute inset-[22px] motion-safe:animate-spin"
            style={{ animationDuration: '14s' }}
          >
            <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky shadow-lg" />
          </div>

          {/* Outer ring + satellite, counter-rotating, slower */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            <circle cx={50} cy={50} r={49} fill="none" className="stroke-line" strokeWidth={1} strokeDasharray="1 7" />
          </svg>
          <div
            className="absolute inset-0 motion-safe:animate-spin"
            style={{ animationDuration: '26s', animationDirection: 'reverse' }}
          >
            <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green shadow-lg" />
          </div>
        </div>

        {/* Floating console chips */}
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
                  className="pointer-events-auto flex max-w-[132px] items-center gap-1.5 rounded-md border border-green/30 bg-surface/95 px-2 py-1 text-[10px] font-bold shadow-lg"
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
