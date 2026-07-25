'use client';

/**
 * v25.8 — the shared half of a themed category hero: pick the tiles, place
 * them on a formation, render one.
 *
 * FootballHero / BasketballHero / BaseballHero (v12) each carry their own
 * copy of this — same top-6 selection, same jitter maths, same 40-line tile
 * markup. Three more scenes would have made six copies, so the new ones
 * (Tennis, UFC, Cricket) share this instead. The originals are deliberately
 * left alone: they work, they are on the live path, and rewriting them buys
 * nothing today. If a fourth scene ever needs a change here, move them over
 * then.
 *
 * Everything positional derives from hashString(...) — never Math.random —
 * so the server and the client render the same scene.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { EventGroup, Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { outcomeLabels } from '@/components/markets/EventCard';

/**
 * A slot on the scene, in percent of the field.
 *
 * SPACING IS NOT FREE, and it is the thing to get right when adding a
 * scene. The field is the hero's right 48% minus insets — about 390×198 CSS
 * pixels at a typical desktop width — while one tile is roughly 136px wide
 * (icon, name, price badge) and 55px tall. That allows two comfortable
 * columns and two rows: FOUR tiles. The v12 scenes each place six, which is
 * why their outer tiles overlap and clip their own labels; the scenes built
 * on this module place four in a diamond instead, so the field art stays
 * readable underneath. Verified by rendering, not by arithmetic alone.
 */
export interface Slot {
  left: number;
  top: number;
}

export interface PlacedTile {
  market: Market;
  label: string;
  left: number;
  top: number;
  /** Seconds per bob cycle. */
  dur: number;
  /** Negative, so tiles start mid-cycle instead of in lockstep. */
  delay: number;
}

/**
 * Top-N outcomes for a scene: the biggest event's favourites first (events
 * arrive volume-sorted and their outcomes get price-sorted here), then the
 * next event, then flat category markets if the formation is still short.
 * Deduped by market id.
 *
 * Returns [] when there is nothing to show; the caller decides what counts
 * as too sparse (every scene so far: fewer than 3 tiles -> generic hero).
 */
export function useSceneTiles(
  events: EventGroup[],
  markets: Market[],
  formation: readonly Slot[]
): PlacedTile[] {
  return useMemo(() => {
    const chosen: Market[] = [];
    const seen = new Set<string>();
    const want = formation.length;

    for (const e of events) {
      const sorted = [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice);
      for (const m of sorted) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        chosen.push(m);
        if (chosen.length >= want) break;
      }
      if (chosen.length >= want) break;
    }
    if (chosen.length < want) {
      for (const m of markets) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        chosen.push(m);
        if (chosen.length >= want) break;
      }
    }

    const labels = outcomeLabels(chosen);
    return chosen.map((m, i) => {
      const h = hashString(m.id);
      const slot = formation[i % formation.length];
      return {
        market: m,
        label: labels.get(m.id) ?? m.question,
        left: slot.left + ((h % 5) - 2), // ±2% jitter
        top: slot.top + (((h >>> 3) % 5) - 2),
        dur: 6 + ((h >>> 6) % 5), // 6-10s bob
        delay: -(((h >>> 10) % 60) / 10),
      };
    });
  }, [events, markets, formation]);
}

/**
 * One placed tile: artwork, outcome name, Yes price — drifting on the
 * shared `.float-card` animation, springing in on mount, zooming on hover,
 * linking to its market.
 *
 * Byte-for-byte the markup the v12 scenes use, so a Tennis tile and a
 * Baseball tile are the same object on two different fields.
 */
export function SceneTile({ tile, index }: { tile: PlacedTile; index: number }) {
  return (
    <div
      className="absolute"
      style={{ left: `${tile.left}%`, top: `${tile.top}%`, transform: 'translate(-50%, -50%)' }}
    >
      <div
        className="float-card"
        style={{ ['--float-dur' as string]: `${tile.dur}s`, animationDelay: `${tile.delay}s` }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.1 }}
          transition={{ delay: 0.06 * index, type: 'spring', stiffness: 260, damping: 22 }}
        >
          <Link
            href={`/market/${tile.market.id}`}
            title={tile.market.question}
            className="pointer-events-auto flex flex-col items-center gap-1"
          >
            <MarketIcon
              icon={tile.market.icon}
              category={tile.market.category}
              className="h-10 w-10 rounded-full shadow-lg"
              iconClassName="h-5 w-5"
            />
            <span className="flex max-w-[92px] items-center gap-1 rounded-full border border-line bg-surface-3/90 px-2 py-0.5 text-[10px] font-bold">
              <span className="truncate text-tx-sec">{tile.label}</span>
              <span className="shrink-0 text-green tabular-nums">
                {formatCents(tile.market.yesPrice)}
              </span>
            </span>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

/** The scene shell every themed hero shares: glow, border, and the right
 *  48% reserved for the field (hidden below sm, where the copy takes over). */
export function SceneShell({
  children,
  fieldClassName,
}: {
  children: React.ReactNode;
  /** Extra classes for the field itself (background tint, pattern). */
  fieldClassName?: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
      <div
        className={`absolute inset-x-5 inset-y-4 overflow-hidden rounded-2xl border ${
          fieldClassName ?? 'border-green/15 bg-green/10'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
