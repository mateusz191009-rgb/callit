'use client';

/**
 * Game tiles under the esports hero (v25.19).
 *
 * Owner: "zusätzlich die verschiedenen spiel kategorien lol cs etc." —
 * Polymarket's row of artwork tiles (CS2 · 7 live, LoL · 1 live, Valorant …)
 * that sits between their match hero and their game list.
 *
 * Ours are built from the same tags that fill the sub-category rail, so a tile
 * and a rail row mean exactly the same filter — clicking either lands on the
 * same set of cards. What the tiles add over the rail is the LIVE COUNT, which
 * is the number an esports browser is actually scanning for.
 *
 * No artwork: we have no rights to a CS2 or LoL key image and are not going to
 * hotlink one. Each tile gets the game's own colour instead — recognisable at
 * a glance, and honest about being ours.
 */

import { motion } from 'framer-motion';
import type { EventGroup } from '@/lib/types';
import { isInPlay } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Tag label (as Gamma spells it) -> display name and colour. The keys are
 * verified live against the `esports` tag pull: "counter strike 2",
 * "league of legends", "Valorant", "Dota 2".
 *
 * A game missing from this map still gets a tile — it just wears the neutral
 * gradient, which is better than being invisible.
 */
const GAME_STYLES: Record<string, { label: string; from: string; to: string }> = {
  'counter strike 2': { label: 'CS2', from: '#F5A524', to: '#C2410C' },
  'league of legends': { label: 'LoL', from: '#3B82F6', to: '#1E3A8A' },
  valorant: { label: 'Valorant', from: '#FF4655', to: '#7F1D1D' },
  'dota 2': { label: 'Dota 2', from: '#EF4444', to: '#7C2D12' },
  overwatch: { label: 'Overwatch', from: '#FB923C', to: '#9A3412' },
  'rocket league': { label: 'Rocket League', from: '#38BDF8', to: '#075985' },
  'mobile legends': { label: 'Mobile Legends', from: '#A78BFA', to: '#4C1D95' },
  'honor of kings': { label: 'Honor of Kings', from: '#FBBF24', to: '#92400E' },
  'rainbow six': { label: 'Rainbow Six', from: '#94A3B8', to: '#334155' },
  'call of duty': { label: 'Call of Duty', from: '#84CC16', to: '#3F6212' },
  'starcraft ii': { label: 'StarCraft II', from: '#60A5FA', to: '#1E40AF' },
};

export interface GameTile {
  /** The tag label — the same key the sub-category rail filters on. */
  key: string;
  label: string;
  count: number;
  live: number;
  from: string;
  to: string;
}

/** Tiles a hub shows before the row stops being scannable. */
const MAX_TILES = 8;

/** Build the tiles from the hub's events: one per game tag, live count first,
 *  then card count. Games with a single card are dropped — a tile that filters
 *  to one card is a link, not a category. */
export function buildGameTiles(events: EventGroup[]): GameTile[] {
  const byGame = new Map<string, { count: number; live: number }>();
  for (const e of events) {
    const live = e.markets.some((m) => isInPlay(m));
    for (const tag of e.tags ?? []) {
      const key = tag.toLowerCase();
      if (!(key in GAME_STYLES)) continue;
      const row = byGame.get(tag) ?? { count: 0, live: 0 };
      row.count++;
      if (live) row.live++;
      byGame.set(tag, row);
    }
  }
  return [...byGame.entries()]
    .filter(([, v]) => v.count > 1)
    .map(([tag, v]) => {
      const style = GAME_STYLES[tag.toLowerCase()];
      return {
        key: tag,
        label: style?.label ?? tag,
        count: v.count,
        live: v.live,
        from: style?.from ?? '#334155',
        to: style?.to ?? '#0F172A',
      };
    })
    .sort((a, b) => b.live - a.live || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_TILES);
}

export default function GameTiles({
  tiles,
  active,
  onSelect,
}: {
  tiles: GameTile[];
  /** The rail's current selection, so tile and rail stay one control. */
  active: string;
  onSelect: (key: string) => void;
}) {
  if (tiles.length < 2) return null;

  return (
    <div
      role="group"
      aria-label="Filter by game"
      className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tiles.map((t) => (
        <motion.button
          key={t.key}
          type="button"
          whileHover={{ y: -2 }}
          aria-pressed={active === t.key}
          // Clicking the active tile clears the filter, so a tile row can undo
          // itself without the user hunting for "All" in the rail.
          onClick={() => onSelect(active === t.key ? 'all' : t.key)}
          className={cn(
            'relative flex h-[76px] w-[132px] shrink-0 flex-col justify-end overflow-hidden rounded-xl border p-2.5 text-left transition-colors',
            active === t.key ? 'border-green' : 'border-line hover:border-line-strong'
          )}
          style={{ backgroundImage: `linear-gradient(140deg, ${t.from}, ${t.to})` }}
        >
          {/* Scrim: the labels must stay readable over a bright game colour. */}
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent"
          />
          {t.live > 0 && (
            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-black text-white">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-70 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
              </span>
              {t.live} live
            </span>
          )}
          <span className="relative text-sm font-black text-white drop-shadow">
            {t.label}
          </span>
          <span className="relative text-[10px] font-bold text-white/75 tabular-nums">
            {t.count} market{t.count === 1 ? '' : 's'}
          </span>
        </motion.button>
      ))}
    </div>
  );
}
