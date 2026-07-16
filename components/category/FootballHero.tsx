'use client';

/**
 * Category hero for /category/football — the "pitch view".
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half renders a stylized vertical pitch (green/10 field with halfway
 * line, center circle and penalty boxes) where the category's top-6
 * event outcome tiles (flag artwork from the event markets, favorite up
 * front as the striker) stand in a 1-2-2-1 formation, gently bobbing via
 * the shared .float-card drift. A small ball travels between the
 * formation positions (.pitch-ball keyframes in globals.css — hidden
 * under prefers-reduced-motion). Hover zooms a tile (question via title
 * attr), click opens that outcome's market page. Falls back to the node
 * passed in `fallback` (the generic floating-tiles hero) when the
 * category has fewer than 3 usable outcomes.
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
 * Tile CENTER positions in percent of the pitch — a 1-2-2-1 formation
 * attacking upward. Index 0 (the biggest event's favorite) leads the
 * line as the striker. MUST stay in sync with the .pitch-ball keyframes
 * in globals.css, which route the ball through these base positions.
 */
const FORMATION: { left: number; top: number }[] = [
  { left: 50, top: 18 }, // striker
  { left: 24, top: 36 }, // left wing
  { left: 76, top: 36 }, // right wing
  { left: 34, top: 62 }, // left mid
  { left: 66, top: 62 }, // right mid
  { left: 50, top: 84 }, // anchor
];

interface PlacedTile {
  market: Market;
  label: string;
  left: number;
  top: number;
  dur: number;
  delay: number;
}

export default function FootballHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useMemo<PlacedTile[]>(() => {
    // Top-6 outcomes: the biggest event's favorites first (events arrive
    // volume-sorted, outcomes yesPrice-sorted), then further events, then
    // flat category markets if the pitch is still short. Deduped by id.
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
      {/* Pitch scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        <div className="pitch-stripes absolute inset-x-5 inset-y-4 rounded-2xl border border-green/15 bg-green/10">
          {/* Markings: halfway line, center circle, penalty boxes */}
          <div aria-hidden className="absolute left-0 right-0 top-1/2 border-t border-green/15" />
          <div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-green/15"
          />
          <div
            aria-hidden
            className="absolute left-1/2 top-0 h-9 w-24 -translate-x-1/2 rounded-b-xl border border-t-0 border-green/15"
          />
          <div
            aria-hidden
            className="absolute bottom-0 left-1/2 h-9 w-24 -translate-x-1/2 rounded-t-xl border border-b-0 border-green/15"
          />

          {/* Match ball — travels between formation positions (CSS keyframes) */}
          <span aria-hidden className="pitch-ball absolute h-2 w-2 rounded-full bg-white/80" />

          {/* Formation tiles */}
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
