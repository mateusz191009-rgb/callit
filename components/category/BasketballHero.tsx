'use client';

/**
 * Category hero for /category/basketball — the "half-court view" (v12).
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half renders a stylized half-court seen from above (amber-tinted
 * hardwood with baseline, backboard + rim, the painted key with its
 * free-throw circle and the three-point arc) where the category's top-6
 * outcome tiles (team artwork from the event markets, favorite in the
 * paint) stand in a lineup around the arc, gently bobbing via the shared
 * .float-card drift. Hover zooms a tile (question via title attr), click
 * opens that outcome's market page. Falls back to the node passed in
 * `fallback` (the generic floating-tiles hero) when the category has
 * fewer than 3 usable outcomes. All values derive from hashString(...) —
 * never Math.random — so server and client render the same scene.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/**
 * Tile CENTER positions in percent of the court — a lineup attacking the
 * rim (top). Index 0 (the biggest event's favorite) posts up in the paint.
 */
const FORMATION: { left: number; top: number }[] = [
  { left: 50, top: 34 }, // center, in the paint
  { left: 14, top: 22 }, // left corner three
  { left: 86, top: 22 }, // right corner three
  { left: 26, top: 56 }, // left wing
  { left: 74, top: 56 }, // right wing
  { left: 50, top: 78 }, // top of the key
];

interface PlacedTile {
  market: Market;
  label: string;
  left: number;
  top: number;
  dur: number;
  delay: number;
}

export default function BasketballHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useMemo<PlacedTile[]>(() => {
    // Top-6 outcomes: the biggest event's favorites first (events arrive
    // volume-sorted, outcomes yesPrice-sorted), then further events, then
    // flat category markets if the lineup is still short. Deduped by id.
    const chosen: Market[] = [];
    const seen = new Set<string>();
    for (const e of events) {
      const sorted = [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice);
      for (const m of sorted) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        chosen.push(m);
        if (chosen.length >= 6) break;
      }
      if (chosen.length >= 6) break;
    }
    if (chosen.length < 6) {
      for (const m of markets) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        chosen.push(m);
        if (chosen.length >= 6) break;
      }
    }

    const labels = outcomeLabels(chosen);
    return chosen.map((m, i) => {
      const h = hashString(m.id);
      const slot = FORMATION[i % FORMATION.length];
      return {
        market: m,
        label: labels.get(m.id) ?? m.question,
        left: slot.left + ((h % 5) - 2), // ±2% jitter
        top: slot.top + (((h >>> 3) % 5) - 2),
        dur: 6 + ((h >>> 6) % 5), // 6-10s bob
        delay: -(((h >>> 10) % 60) / 10), // negative delay staggers phase
      };
    });
  }, [events, markets]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Half-court scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        <div className="absolute inset-x-5 inset-y-4 overflow-hidden rounded-2xl border border-amber/20 bg-amber/10">
          {/* Three-point arc — half-ellipse hanging from the baseline */}
          <div
            aria-hidden
            className="absolute left-1/2 top-0 h-[62%] w-[78%] -translate-x-1/2 rounded-b-full border border-t-0 border-amber/25"
          />
          {/* The paint (key) with its free-throw circle */}
          <div
            aria-hidden
            className="absolute left-1/2 top-0 h-[38%] w-16 -translate-x-1/2 rounded-b-md border border-t-0 border-amber/25"
          />
          <div
            aria-hidden
            className="absolute left-1/2 top-[38%] h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber/25"
          />
          {/* Backboard + rim */}
          <span
            aria-hidden
            className="absolute left-1/2 top-[3%] h-0.5 w-10 -translate-x-1/2 rounded-full bg-amber/50"
          />
          <span
            aria-hidden
            className="absolute left-1/2 top-[6%] h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-amber/60"
          />
          {/* Half-court line + center circle along the bottom edge */}
          <div aria-hidden className="absolute bottom-0 left-0 right-0 border-t border-amber/25" />
          <div
            aria-hidden
            className="absolute bottom-0 left-1/2 h-8 w-16 -translate-x-1/2 rounded-t-full border border-b-0 border-amber/25"
          />

          {/* Lineup tiles */}
          {tiles.map((t, i) => (
            <div
              key={t.market.id}
              className="absolute"
              style={{
                left: `${t.left}%`,
                top: `${t.top}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                className="float-card"
                style={{ ['--float-dur' as string]: `${t.dur}s`, animationDelay: `${t.delay}s` }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.1 }}
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
                      className="h-10 w-10 rounded-full shadow-lg"
                      iconClassName="h-5 w-5"
                    />
                    {/* Outcome name + Yes-price badge */}
                    <span className="flex max-w-[92px] items-center gap-1 rounded-full border border-line bg-surface-3/90 px-2 py-0.5 text-[10px] font-bold">
                      <span className="truncate text-tx-sec">{t.label}</span>
                      <span className="shrink-0 text-green tabular-nums">
                        {formatCents(t.market.yesPrice)}
                      </span>
                    </span>
                  </Link>
                </motion.div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
