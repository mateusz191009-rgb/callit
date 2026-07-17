'use client';

/**
 * Category hero for /category/world — "SITUATION ROOM".
 *
 * Same hero shell as the other themed category heroes (rounded-2xl
 * border-line bg-surface-2 + hero-glow, HeroCopy on the left) with a
 * war-room globe on the right half:
 *
 * - BACKDROP: the neutral blueprint grid (.economy-grid, shared with the
 *   economy hero) — reads as a map table.
 * - GLOBE: an SVG wireframe globe (outer circle + meridian ellipses +
 *   latitude lines) inside a slowly rotating dashed orbit ring (plain
 *   CSS animate-spin with a long duration — no new keyframes needed).
 *   A conic-gradient RADAR SWEEP spins inside the globe's circular mask,
 *   the classic situation-room read.
 * - HOTSPOTS: pulsing dots scattered on the globe, seeded from REAL
 *   market ids via hashString (never Math.random — SSR and client must
 *   agree). Decorative only.
 * - DISPATCH CHIPS: up to 3 floating chips (market label + Yes price) on
 *   the shared .float-card drift; hover zooms, click opens the market.
 *
 * Falls back to the generic floating-tiles hero (`fallback`) when the
 * category has fewer than 3 usable markets.
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
const HOTSPOT_COUNT = 5;

/** Chip CENTER positions (percent of the scene; jitter from the id hash).
 *  Kept toward the left edge so they clear the globe pinned right. */
const CHIP_SLOTS: { left: number; top: number }[] = [
  { left: 22, top: 16 },
  { left: 16, top: 46 },
  { left: 28, top: 74 },
];

/** Hotspot slots INSIDE the globe (percent of the globe box), roughly on
 *  the landmass band so they read as places, not noise. */
const HOTSPOT_SLOTS: { left: number; top: number }[] = [
  { left: 30, top: 34 },
  { left: 56, top: 26 },
  { left: 68, top: 48 },
  { left: 42, top: 58 },
  { left: 58, top: 70 },
];

interface Chip {
  market: Market;
  label: string;
  left: number;
  top: number;
  dur: number;
  delay: number;
}

export default function WorldHero({ markets, events, stats, fallback }: CategoryHeroProps) {
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
      const h = hashString(`${m.id}:dispatch`);
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

  /** Decorative hotspots, seeded from real ids so the scene is stable. */
  const hotspots = useMemo(() => {
    if (pool.length === 0) return [];
    return Array.from({ length: HOTSPOT_COUNT }, (_, i) => {
      const src = pool[i % pool.length];
      const h = hashString(`${src.id}:hotspot:${i}`);
      const slot = HOTSPOT_SLOTS[i % HOTSPOT_SLOTS.length];
      return {
        key: `${src.id}:${i}`,
        left: slot.left + ((h % 9) - 4),
        top: slot.top + (((h >>> 4) % 9) - 4),
        delay: ((h >>> 8) % 30) / 10, // 0-2.9s ping stagger
      };
    });
  }, [pool]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (pool.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Map-table blueprint grid backdrop (shared with the economy hero) */}
      <div aria-hidden className="economy-grid absolute inset-0" />

      {/* Situation-room scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Globe assembly, pinned to the right */}
        <div
          aria-hidden
          className="absolute right-6 top-1/2 h-44 w-44 -translate-y-1/2"
        >
          {/* Rotating dashed orbit ring */}
          <svg
            viewBox="0 0 200 200"
            className="absolute inset-[-14px] h-[calc(100%+28px)] w-[calc(100%+28px)] motion-safe:animate-spin"
            style={{ animationDuration: '48s' }}
          >
            <circle
              cx={100}
              cy={100}
              r={96}
              fill="none"
              className="stroke-line-strong"
              strokeWidth={1}
              strokeDasharray="3 9"
            />
          </svg>

          {/* Globe: circular mask for the sweep + the wireframe on top */}
          <div className="absolute inset-0 overflow-hidden rounded-full">
            {/* Radar sweep — a spinning conic gradient inside the mask */}
            <div
              className="absolute inset-0 motion-safe:animate-spin"
              style={{
                animationDuration: '7s',
                // Brand green #00E17E from tailwind.config.ts.
                background:
                  'conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(0,225,126,0.14) 350deg, rgba(0,225,126,0.3) 360deg)',
              }}
            />
          </div>
          <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
            {/* Sphere outline */}
            <circle cx={100} cy={100} r={98} fill="none" className="stroke-line-strong" strokeWidth={1.5} />
            {/* Meridians */}
            <ellipse cx={100} cy={100} rx={44} ry={98} fill="none" className="stroke-line" strokeWidth={1} opacity={0.8} />
            <ellipse cx={100} cy={100} rx={78} ry={98} fill="none" className="stroke-line" strokeWidth={1} opacity={0.5} />
            <line x1={100} y1={2} x2={100} y2={198} className="stroke-line" strokeWidth={1} opacity={0.8} />
            {/* Latitudes */}
            <line x1={2} y1={100} x2={198} y2={100} className="stroke-line" strokeWidth={1} opacity={0.8} />
            <ellipse cx={100} cy={56} rx={81} ry={12} fill="none" className="stroke-line" strokeWidth={1} opacity={0.45} />
            <ellipse cx={100} cy={144} rx={81} ry={12} fill="none" className="stroke-line" strokeWidth={1} opacity={0.45} />
          </svg>

          {/* Pulsing hotspots */}
          {hotspots.map((s) => (
            <span
              key={s.key}
              className="absolute h-2 w-2"
              style={{ left: `${s.left}%`, top: `${s.top}%` }}
            >
              <span
                className="absolute inset-0 rounded-full bg-green/60 motion-safe:animate-ping"
                style={{ animationDelay: `${s.delay}s`, animationDuration: '2.6s' }}
              />
              <span className="absolute inset-[3px] rounded-full bg-green" />
            </span>
          ))}
        </div>

        {/* Floating dispatch chips */}
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
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-green motion-safe:animate-pulse"
                  />
                  <span className="truncate uppercase tracking-wide text-tx-sec">{c.label}</span>
                  <span className="shrink-0 text-green tabular-nums">
                    {formatCents(c.market.yesPrice)}
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
