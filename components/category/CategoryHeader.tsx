'use client';

/**
 * The category hub header (v25.18) — one row, ~64px.
 *
 * WHAT IT REPLACES: a 280px animated scene plus, below it, a 350px
 * "Top contenders" leaderboard whose content was the same event whose card sat
 * two rows further down. Measured on the World hub, that put ~680px between the
 * category bar and the first market card, so nothing tradeable was visible on a
 * 1080p screen. Polymarket spends ~48px here and shows nine cards in the same
 * space (owner: "einfach an denen immer orientieren").
 *
 * The stats stay, because they are the one thing in the old hero that answered
 * a real question ("is there anything in here?") — just as one small row
 * instead of three chips. The themed scenes are parked, not gone: see
 * components/category/heroes.ts.
 */

import { motion } from 'framer-motion';
import { Sparkles, type LucideIcon } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { CATEGORY_ICONS } from '@/components/layout/CategoryBar';
import type { CategoryHeroStats } from './CryptoHero';

export default function CategoryHeader({
  category,
  icon,
  stats,
}: {
  /** Category value — picks the glyph when `icon` isn't given. */
  category: string;
  /** Explicit glyph, so the Sports hub can show the ACTIVE sport's icon
   *  (SPORT_ICONS) rather than the hub's generic trophy. */
  icon?: LucideIcon;
  stats: CategoryHeroStats;
}) {
  const Icon: LucideIcon =
    icon ?? (CATEGORY_ICONS as Record<string, LucideIcon>)[category] ?? Sparkles;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-green/10 text-green"
          aria-hidden
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black tracking-tight text-tx sm:text-[28px]">
            {stats.label}
          </h1>
          <p className="text-micro font-semibold text-tx-mut">
            Live forecasts and odds
            {/* '' until mounted, so server and client never disagree on
                "today" (the parent computes it in an effect). */}
            {stats.updated && (
              <span className="tabular-nums"> · Updated {stats.updated}</span>
            )}
          </p>
        </div>
      </div>

      <dl className="flex shrink-0 items-center gap-x-4 text-micro font-semibold uppercase tracking-wide text-tx-mut">
        <div className="flex items-baseline gap-1.5">
          <dd className="text-sm font-bold tabular-nums text-tx">
            {stats.loading ? '—' : stats.marketCount}
          </dd>
          <dt>Markets</dt>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dd className="text-sm font-bold tabular-nums text-tx">
            {stats.loading ? '—' : stats.eventCount}
          </dd>
          <dt>Events</dt>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dd className="text-sm font-bold tabular-nums text-tx">
            {stats.loading ? '—' : formatMoney(stats.volume, { compact: true })}
          </dd>
          <dt>Volume</dt>
        </div>
      </dl>
    </motion.section>
  );
}
