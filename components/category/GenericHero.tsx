'use client';

/**
 * The generic category hero — floating artwork tiles with mouse parallax.
 *
 * v25.18 — MOVED HERE, out of app/category/[cat]/page.tsx.
 *
 * The hub route no longer mounts a hero at all: it leads with the compact
 * CategoryHeader instead, because the themed scenes plus the Top-contenders
 * panel put ~680px of chrome above the first card (owner, comparing to
 * Polymarket: "vielleicht not too much siehe polymarket die haben nicht so auf
 * falende heroes etc"). Nothing was deleted — every themed scene still lives in
 * this folder, and this file is the `fallback` they all render when their own
 * data is too sparse, so re-mounting one stays a one-line change (see
 * components/category/heroes.ts).
 *
 * Everything visual (rotation, size, float duration, phase, dimming, jitter) is
 * derived from hashString(tile.key), so the scatter is deterministic — no
 * Math.random in render, no hydration mismatch.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import type { Category, EventGroup, Market } from '@/lib/types';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { HeroCopy, type CategoryHeroStats } from './CryptoHero';

export interface TileData {
  key: string;
  icon?: string;
  category: Category;
  href: string;
  label: string;
}

/** Designed scatter slots across the hero's right half (percent of the
 *  tile layer). Index-assigned; per-tile jitter comes from the id hash. */
const TILE_SLOTS: { left: number; top: number }[] = [
  { left: 8, top: 14 },
  { left: 40, top: 6 },
  { left: 70, top: 16 },
  { left: 22, top: 42 },
  { left: 54, top: 36 },
  { left: 78, top: 54 },
  { left: 8, top: 66 },
  { left: 38, top: 62 },
  { left: 64, top: 72 },
  { left: 88, top: 34 },
];

const TILE_SIZES = ['h-14 w-14', 'h-16 w-16', 'h-[72px] w-[72px]', 'h-20 w-20'];

/**
 * One floating tile. Layers: absolute wrapper (position) > .float-card (CSS
 * drift) > motion div (base rotation + hover straighten/zoom) > link + icon.
 */
function FloatingTile({ tile, index }: { tile: TileData; index: number }) {
  const h = hashString(tile.key);
  const slot = TILE_SLOTS[index % TILE_SLOTS.length];
  const left = slot.left + ((h % 9) - 4); // ±4% jitter
  const top = slot.top + (((h >>> 4) % 9) - 4);
  const rotate = ((h >>> 8) % 41) - 20; // -20..20deg
  const size = TILE_SIZES[(h >>> 12) % TILE_SIZES.length];
  const dimmed = (h >>> 16) % 3 === 0; // roughly a third recede
  const duration = 6 + ((h >>> 20) % 5); // 6-10s
  const delay = -(((h >>> 24) % 60) / 10); // negative delay staggers phase

  return (
    <div
      className="absolute"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        opacity: dimmed ? 0.4 : 0.95,
        zIndex: dimmed ? 1 : 2,
      }}
    >
      <div
        className="float-card"
        style={{ ['--float-dur' as string]: `${duration}s`, animationDelay: `${delay}s` }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ rotate }}
          whileHover={{ scale: 1.15, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <Link
            href={tile.href}
            aria-label={tile.label}
            title={tile.label}
            className="pointer-events-auto block"
          >
            <MarketIcon
              icon={tile.icon}
              category={tile.category}
              className={`${size} rounded-xl border border-line bg-surface-3 shadow-lg`}
              iconClassName="h-6 w-6"
            />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

/** 6-10 hero tiles from the category's artwork (events, outcomes, then flat
 *  markets). Deduped by image; sparse categories repeat their best items under
 *  a suffixed key so the scatter still fills out. */
export function heroTiles(events: EventGroup[], markets: Market[]): TileData[] {
  const seenKeys = new Set<string>();
  const seenIcons = new Set<string>();
  const out: TileData[] = [];
  const push = (t: TileData) => {
    if (out.length >= 10 || seenKeys.has(t.key)) return;
    if (t.icon) {
      if (seenIcons.has(t.icon)) return;
      seenIcons.add(t.icon);
    }
    seenKeys.add(t.key);
    out.push(t);
  };
  for (const e of events) {
    push({ key: e.id, icon: e.icon, category: e.category, href: `/event/${e.id}`, label: e.title });
    for (const m of e.markets) {
      push({ key: m.id, icon: m.icon, category: m.category, href: `/event/${e.id}`, label: m.question });
    }
  }
  for (const m of markets) {
    push({ key: m.id, icon: m.icon, category: m.category, href: `/market/${m.id}`, label: m.question });
  }
  // Tiles with real artwork float to the front of the scatter.
  out.sort((a, b) => Number(Boolean(b.icon)) - Number(Boolean(a.icon)));
  if (out.length > 0 && out.length < 6) {
    const base = [...out];
    let n = 0;
    while (out.length < 6) {
      const src = base[n % base.length];
      out.push({ ...src, key: `${src.key}~${n}` });
      n++;
    }
  }
  return out;
}

export default function GenericHero({
  markets,
  events,
  stats,
}: {
  markets: Market[];
  events: EventGroup[];
  stats: CategoryHeroStats;
}) {
  const reducedMotion = useReducedMotion();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const tiles = useMemo(() => heroTiles(events, markets), [events, markets]);

  return (
    <section
      onMouseMove={(e) => {
        if (reducedMotion) return;
        const r = e.currentTarget.getBoundingClientRect();
        setParallax({
          x: ((e.clientX - r.left) / r.width - 0.5) * 14,
          y: ((e.clientY - r.top) / r.height - 0.5) * 10,
        });
      }}
      onMouseLeave={() => setParallax({ x: 0, y: 0 })}
      className="hero-glow relative min-h-[220px] overflow-hidden card-surface"
    >
      {/* Floating artwork layer — hidden below sm, subtle mouse parallax */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block"
        style={{
          transform: `translate3d(${-parallax.x}px, ${-parallax.y}px, 0)`,
          transition: 'transform 0.3s ease-out',
        }}
      >
        {tiles.map((t, i) => (
          <FloatingTile key={t.key} tile={t} index={i} />
        ))}
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
