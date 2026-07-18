'use client';

/**
 * Category hero for /category/baseball — the "diamond view" (v12).
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half renders a stylized ballpark seen from above (green outfield with
 * the outfield fence arc, a rotated-square infield diamond with the three
 * bases + home plate and the pitcher's mound in the middle) where the
 * category's top-6 outcome tiles (team artwork from the event markets,
 * favorite batting at home plate) take the fielding positions, gently
 * bobbing via the shared .float-card drift. Hover zooms a tile (question
 * via title attr), click opens that outcome's market page. Falls back to
 * the node passed in `fallback` (the generic floating-tiles hero) when
 * the category has fewer than 3 usable outcomes. All values derive from
 * hashString(...) — never Math.random — so server and client render the
 * same scene.
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
 * Tile CENTER positions in percent of the field — home plate at the
 * bottom, second base at the top (the classic broadcast angle). Index 0
 * (the biggest event's favorite) bats at home plate.
 */
const FORMATION: { left: number; top: number }[] = [
  { left: 50, top: 84 }, // home plate (batter)
  { left: 50, top: 56 }, // pitcher's mound
  { left: 77, top: 48 }, // first base
  { left: 50, top: 26 }, // second base
  { left: 23, top: 48 }, // third base
  { left: 82, top: 14 }, // right field
];

interface PlacedTile {
  market: Market;
  label: string;
  left: number;
  top: number;
  dur: number;
  delay: number;
}

export default function BaseballHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useMemo<PlacedTile[]>(() => {
    // Top-6 outcomes: the biggest event's favorites first (events arrive
    // volume-sorted, outcomes yesPrice-sorted), then further events, then
    // flat category markets if the field is still short. Deduped by id.
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
      {/* Ballpark scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        <div className="absolute inset-x-5 inset-y-4 overflow-hidden rounded-2xl border border-green/15 bg-green/10">
          {/* Outfield fence — arc across the top of the park */}
          <div
            aria-hidden
            className="absolute -top-6 left-1/2 h-24 w-[130%] -translate-x-1/2 rounded-b-[100%] border-b border-green/20"
          />
          {/* Infield diamond — rotated square, amber like the dirt */}
          <div
            aria-hidden
            className="absolute left-1/2 top-[55%] h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-sm border border-amber/30 bg-amber/10"
          />
          {/* Bases + home plate on the diamond's corners */}
          <span aria-hidden className="absolute left-1/2 top-[84%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-amber/60" />
          <span aria-hidden className="absolute left-[77%] top-[55%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-amber/60" />
          <span aria-hidden className="absolute left-1/2 top-[26%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-amber/60" />
          <span aria-hidden className="absolute left-[23%] top-[55%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-amber/60" />
          {/* Pitcher's mound */}
          <span
            aria-hidden
            className="absolute left-1/2 top-[55%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber/40 bg-amber/20"
          />

          {/* Fielding-position tiles */}
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
