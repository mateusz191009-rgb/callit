'use client';

/**
 * Sub-categories inside a category (v25.19) — Polymarket's left column.
 *
 * Owner: "können wir ausserdem wie links bei denen unterkategorien in
 * kategorien machen also so wie die haben". Theirs lists Trump 272, Midterms
 * 556, Globale Wahlen 166 … down the left of the Politics page, and MLB 126,
 * UFC 12, Fußball … down the left of Sport. Ours is built from the same
 * material: the provider's own topic tags, which every event carries and which
 * lib/polymarket.ts already filters down to the useful ones (`subTagsOf`).
 *
 * Two shapes, one component: a real rail on lg+, a horizontal chip strip below
 * that. The chip strip is where the sport chips used to be, so the Sports hub
 * loses nothing by switching over.
 *
 * COUNTS ARE OVER THE WHOLE HUB, never over the current selection — a filter
 * that renumbers itself the moment you click it is useless.
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SubCategory {
  /** Stable key. 'all' is the reset row. */
  key: string;
  label: string;
  count: number;
  /**
   * v25.20 — row glyph (owner: "die icons wie bei poly an der linken kategorie
   * bar waren nice").
   *
   * Only the SPORTS rail sets it, which is also the only rail Polymarket puts
   * icons on — their Politics column is labels and counts alone. That is the
   * right split rather than a limitation: a sport has an unambiguous glyph,
   * where "Geopolitics" or "Tweet Markets" would get whatever generic shape we
   * invented for it, and an icon that means nothing is worse than none.
   */
  icon?: LucideIcon;
}

/**
 * Rows the rail shows before it stops. Polymarket's runs long enough to
 * scroll; ours caps because our book is a fraction of theirs and a rail of
 * twenty one-event tags is a list of noise, not a filter.
 */
export const RAIL_MAX = 14;

/** A tag needs this many cards to earn a row. One-off tags would otherwise
 *  fill the rail with entries that filter the grid down to a single card. */
export const RAIL_MIN_COUNT = 2;

/**
 * Build the rail from anything that carries tags. `label` on the reset row is
 * the hub's own name, so the top entry reads "All" with the hub's total.
 */
export function buildSubCategories(
  items: { tags?: string[] }[],
  totalCards: number
): SubCategory[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    for (const t of it.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const rows = [...counts.entries()]
    .filter(([, n]) => n >= RAIL_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, RAIL_MAX)
    .map(([label, count]) => ({ key: label, label, count }));

  // A rail with nothing to switch between is not a rail.
  if (rows.length === 0) return [];
  return [{ key: 'all', label: 'All', count: totalCards }, ...rows];
}

export default function SubCategoryRail({
  items,
  active,
  onSelect,
}: {
  items: SubCategory[];
  active: string;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <>
      {/* Rail — lg and up */}
      <nav
        aria-label="Sub-categories"
        className="hidden shrink-0 flex-col gap-0.5 lg:flex"
      >
        {items.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={active === c.key}
            onClick={() => onSelect(c.key)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-bold transition-colors',
              active === c.key
                ? 'bg-surface-3 text-tx'
                : 'text-tx-sec hover:bg-surface-3/60 hover:text-tx'
            )}
          >
            {c.icon && (
              <c.icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  active === c.key ? 'text-green' : 'text-tx-mut'
                )}
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            <span className="shrink-0 text-[11px] font-bold tabular-nums text-tx-mut">
              {c.count}
            </span>
          </button>
        ))}
      </nav>

      {/* Chip strip — below lg. Same data, same state. */}
      <div
        role="group"
        aria-label="Sub-categories"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={active === c.key}
            onClick={() => onSelect(c.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors',
              active === c.key
                ? 'border-green bg-green/15 text-green'
                : 'border-line bg-surface-2 text-tx-sec hover:border-line-strong hover:text-tx'
            )}
          >
            {c.icon && <c.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {c.label}
            <span className="tabular-nums opacity-60">{c.count}</span>
          </button>
        ))}
      </div>
    </>
  );
}
