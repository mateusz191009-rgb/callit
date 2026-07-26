'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Inbox, SearchX } from 'lucide-react';
import type { Category, EventGroup, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import { formatDate, trendingScore } from '@/lib/format';
import {
  SPORT_HUB,
  SPORT_HUB_CATEGORIES,
  SPORT_LABELS,
  sportChips,
  sportOf,
  type SportKey,
} from '@/lib/sports';
import { useAllMarkets, useCategories, useEvents } from '@/lib/useMarkets';
import { cn } from '@/lib/utils';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import type { CategoryHeroStats } from '@/components/category/CryptoHero';
import CategoryHeader from '@/components/category/CategoryHeader';
import LiveMatchHero, { heroMatchOf } from '@/components/category/LiveMatchHero';
import { SPORT_ICONS } from '@/components/layout/CategoryBar';
import MixedGrid from '@/components/markets/MixedGrid';

/**
 * v25.18 — THE HUB LEADS WITH ITS MARKETS.
 *
 * What used to sit above this grid: a themed animated scene (~280px) and a
 * "Top contenders" leaderboard (~350px) whose subject was the very event whose
 * card rendered two rows below it. Together with the bars that is ~790px of
 * chrome, so a 1080p screen showed no tradeable card at all, where Polymarket
 * shows nine (owner: "unsere kategorie seiten vielleicht not too much siehe
 * polymarket die haben nicht so auf falende heroes etc").
 *
 * Now: a ~64px CategoryHeader, then — only when the hub actually has a live or
 * imminent match — the LiveMatchHero, which is the one hero that is content
 * rather than decoration. Every themed scene is preserved and re-mountable;
 * see components/category/heroes.ts and components/category/GenericHero.tsx.
 */


/* ------------------------------------------------------------------ */
/* Sport chips                                                         */
/* ------------------------------------------------------------------ */

/**
 * v25.7 — one sport chip: glyph, label, count.
 *
 * The icon is the same one the category bar uses for that sport (SPORT_ICONS
 * sits next to CATEGORY_ICONS for exactly that reason), so Football reads
 * identically here and in the nav even though it no longer has a tab.
 */
function SportChip({
  chip,
  active,
  onSelect,
}: {
  chip: { key: SportKey; label: string; count: number };
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = SPORT_ICONS[chip.key];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-bold transition-colors',
        active
          ? 'border-green bg-green/15 text-green'
          : 'border-line bg-surface-2 text-tx-sec hover:border-line-strong hover:text-tx'
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {chip.label}
      <span className="tabular-nums opacity-60">{chip.count}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CategoryHubPage() {
  const params = useParams<{ cat: string }>();
  const raw = decodeURIComponent(params?.cat ?? '');
  // Valid categories: built-ins + admin-created customs (useCategories).
  const allCategories = useCategories();
  const category: Category | null = allCategories.some((c) => c.value === raw)
    ? raw
    : null;

  const { markets, loading: marketsLoading } = useAllMarkets();
  const { events, loading: eventsLoading } = useEvents();
  const loading = marketsLoading || eventsLoading;

  /** v25.6 — the Sports hub's active chip. 'all' on every other category. */
  const [sport, setSport] = useState<SportKey>('all');
  // Computed after mount so server and client never disagree on "today".
  const [updated, setUpdated] = useState('');
  useEffect(() => {
    setUpdated(formatDate(new Date().toISOString()));
  }, []);

  // Category hubs share one mounted page — switching categories via the top
  // bar must reset the view state or Esports would inherit Basketball's.
  // (The grid's own card cap resets on `resetKey`, category + sport chip.)
  useEffect(() => {
    setSport('all');
  }, [category]);

  // v25.6 — THE SPORTS HUB. `/category/sports` shows every sport (Football,
  // Basketball, Baseball too), narrowed by the chips below; every other
  // category keeps matching itself exactly. The per-sport routes still
  // resolve — this only changes what the hub route COLLECTS.
  const isSportHub = category === SPORT_HUB;
  const hubCategories = useMemo<readonly string[]>(
    () => (isSportHub ? SPORT_HUB_CATEGORIES : category ? [category] : []),
    [isSportHub, category]
  );

  const hubEvents = useMemo(
    () =>
      category
        ? events
            .filter((e) => hubCategories.includes(e.category))
            .sort((a, b) => b.volume - a.volume)
        : [],
    [events, hubCategories, category]
  );

  /**
   * TRULY flat hub markets — no parent event in the feed. These join the
   * events in ONE mixed grid below (v25.16); an event's outcomes stay
   * inside its card, exactly like Polymarket.
   *
   * (v25.14 briefly exploded every non-game event into individual outcome
   * cards for a separate Markets tab — 1098 "markets" in the sports hub —
   * and the owner's verdict was the right one: "unübersichtlich und zu
   * viel". The gauge card still renders every flat question; the ladder
   * questions live in their event card, one slot each.)
   */
  const hubFlatMarkets = useMemo(() => {
    if (!category) return [];
    const eventIds = new Set(hubEvents.map((e) => e.id));
    const outcomeIds = new Set(hubEvents.flatMap((e) => e.markets.map((m) => m.id)));
    const list = markets.filter(
      (m) =>
        hubCategories.includes(m.category) &&
        !outcomeIds.has(m.id) &&
        !(m.eventId && eventIds.has(m.eventId))
    );
    list.sort((a, b) => b.volume - a.volume);
    return list;
  }, [markets, hubEvents, hubCategories, category]);

  // Counted over the WHOLE hub, never over the current selection — a chip
  // that renumbered itself the moment you clicked it would be useless.
  const chips = useMemo(
    () =>
      isSportHub
        ? sportChips([
            ...hubEvents.map((e) => ({ category: e.category, teams: e.teams, text: e.title })),
            // Flat-only on purpose: a chip counts events + standalone
            // questions. Counting every outcome row would turn "UFC 15"
            // into "UFC 150" the moment the tab learned to show them.
            ...hubFlatMarkets.map((m) => ({ category: m.category, text: m.question })),
          ])
        : [],
    [isSportHub, hubEvents, hubFlatMarkets]
  );

  // The feed refreshes every 60s, so the selected sport can empty out from
  // under the user (the last UFC card of the night settles). Fall back to
  // All rather than showing an empty grid under a chip that is gone.
  useEffect(() => {
    if (sport !== 'all' && !chips.some((c) => c.key === sport)) setSport('all');
  }, [chips, sport]);

  const categoryEvents = useMemo(
    () =>
      sport === 'all'
        ? hubEvents
        : hubEvents.filter(
            (e) => sportOf({ category: e.category, teams: e.teams, text: e.title }) === sport
          ),
    [hubEvents, sport]
  );

  const categoryMarkets = useMemo(
    () =>
      sport === 'all'
        ? hubFlatMarkets
        : hubFlatMarkets.filter((m) => sportOf({ category: m.category, text: m.question }) === sport),
    [hubFlatMarkets, sport]
  );

  /**
   * v25.16 — ONE grid, Polymarket-style: events and flat markets side by
   * side, volume-sorted across both kinds, resolved cards last. No tab
   * split — an item is a card, whatever its shape (a multi-outcome list,
   * a matchup, a gauge binary), and the user-facing word for all of them
   * is simply "markets".
   */
  const gridItems = useMemo(() => {
    const items = [
      ...categoryEvents.map((e) => ({
        kind: 'event' as const,
        key: `e:${e.id}`,
        trend: trendingScore(e),
        resolved: false,
        event: e,
        market: undefined as Market | undefined,
      })),
      ...categoryMarkets.map((m) => ({
        kind: 'market' as const,
        key: `m:${m.id}`,
        trend: trendingScore(m),
        resolved: m.status === 'resolved',
        event: undefined as EventGroup | undefined,
        market: m,
      })),
    ];
    // v25.18 — trending, not lifetime volume, same as the home grid: a hub
    // ordered by accumulated history shows the same cards in the same order
    // for months, whatever is actually happening in that category today.
    items.sort((a, b) => b.trend - a.trend);
    // Open cards first, resolved last (stable sort keeps trending order).
    items.sort((a, b) => Number(a.resolved) - Number(b.resolved));
    return items;
  }, [categoryEvents, categoryMarkets]);

  const totalVolume = useMemo(
    () =>
      categoryMarkets.reduce((s, m) => s + m.volume, 0) +
      categoryEvents.reduce((s, e) => s + e.volume, 0),
    [categoryMarkets, categoryEvents]
  );

  /** v25.18 — the match that leads the hub, when there is one worth leading
   *  with (live, or kicking off soon). Null on every non-sport category and on
   *  a quiet sports day, and then the page simply starts at the grid. */
  const heroMatch = useMemo(() => heroMatchOf(categoryEvents), [categoryEvents]);

  if (!category) {
    return (
      <EmptyState
        icon={SearchX}
        title="Category not found"
        description="This category does not exist. Pick one from the top navigation or head back home."
        actionLabel="Back to home"
        actionHref="/"
      />
    );
  }

  // Empty states and hero read the SELECTED sport, so "No Tennis markets
  // yet." names what the user actually filtered to, not the hub.
  const label =
    isSportHub && sport !== 'all'
      ? SPORT_LABELS[sport]
      : categoryLabel(category, allCategories);

  const heroStats: CategoryHeroStats = {
    label,
    updated,
    // v25.12 — every TRADEABLE market, not just the flat ones ("MARKETS 0"
    // over $375M of volume read as an outage). v25.16: categoryMarkets is
    // flat-only again, so all event outcomes join the count on top.
    marketCount:
      categoryMarkets.length + categoryEvents.reduce((s, e) => s + e.markets.length, 0),
    eventCount: categoryEvents.length,
    volume: totalVolume,
    loading,
  };
  return (
    <div className="space-y-5">
      {/* v25.18 — one compact row instead of the themed scene. The scenes are
          kept and re-mountable: components/category/heroes.ts. */}
      <CategoryHeader
        category={category}
        icon={isSportHub && sport !== 'all' ? SPORT_ICONS[sport] : undefined}
        stats={heroStats}
      />

      {/* v25.6 — sport chips. Rendered ONLY where they earn their space:
          the hub, and only once the feed has produced more than one sport
          to switch between (sportChips returns < 2 entries otherwise). */}
      {isSportHub && chips.length > 1 && (
        <div
          role="group"
          aria-label="Filter by sport"
          className="flex flex-wrap items-center gap-2"
        >
          {chips.map((c) => (
            <SportChip
              key={c.key}
              chip={c}
              active={sport === c.key}
              onSelect={() => setSport(c.key)}
            />
          ))}
        </div>
      )}

      {/* v25.18 — the one hero left, and only when the hub has a match worth
          leading with. On every other category (and a quiet sports day) this
          renders nothing and the grid starts right under the header. */}
      {!loading && heroMatch && <LiveMatchHero event={heroMatch} />}

      {/* v25.16 — ONE mixed grid, top GRID_PAGE cards by volume, the rest
          behind "Show more markets". No Markets/Events tabs any more.
          v25.17 — the grid, the cap and the reveal animation live in
          MixedGrid, shared with the home page. */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            // v25.18 — the tightened cards are ~205px, not ~245px.
            <Skeleton key={i} className="h-52 w-full rounded-2xl" />
          ))}
        </div>
      ) : gridItems.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={`No ${label} markets yet.`}
          description="New markets in this category will show up here."
          actionLabel="Browse all markets"
          actionHref="/"
        />
      ) : (
        <MixedGrid items={gridItems} resetKey={`${category}|${sport}`} />
      )}
    </div>
  );
}
