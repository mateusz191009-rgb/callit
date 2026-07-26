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
import SubCategoryRail, {
  buildSubCategories,
  type SubCategory,
} from '@/components/category/SubCategoryRail';
import GameTiles, { buildGameTiles } from '@/components/category/GameTiles';
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
  /** v25.19 — the active sub-category tag on every NON-sport hub. The two
   *  never both apply: the sports rail lists sports, every other rail lists
   *  the provider's topic tags (see the rail below). */
  const [subTag, setSubTag] = useState('all');
  // Computed after mount so server and client never disagree on "today".
  const [updated, setUpdated] = useState('');
  useEffect(() => {
    setUpdated(formatDate(new Date().toISOString()));
  }, []);

  // Category hubs share one mounted page — switching categories via the top
  // bar must reset the view state or Esports would inherit Basketball's.
  // (The grid's own card cap resets on `resetKey`, category + rail selection.)
  useEffect(() => {
    setSport('all');
    setSubTag('all');
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

  /**
   * v25.19 — the sub-category rail on every NON-sport hub, built from the
   * provider's own topic tags (Trump, Iran, Midterms, league of legends …).
   * Counted over the whole hub, like the sport chips, and over CARDS: one per
   * event, one per standalone market.
   */
  const subCategories = useMemo(
    () =>
      isSportHub
        ? []
        : buildSubCategories(
            [...hubEvents, ...hubFlatMarkets],
            hubEvents.length + hubFlatMarkets.length
          ),
    [isSportHub, hubEvents, hubFlatMarkets]
  );

  /** One rail, two sources: sports on the Sports hub, topic tags elsewhere. */
  const railItems = useMemo<SubCategory[]>(
    () =>
      isSportHub
        ? chips.map((c) => ({ key: c.key as string, label: c.label, count: c.count }))
        : subCategories,
    [isSportHub, chips, subCategories]
  );
  const railActive = isSportHub ? sport : subTag;
  const onRailSelect = (key: string) => {
    if (isSportHub) setSport(key as SportKey);
    else setSubTag(key);
  };

  // The feed refreshes every 60s, so the selection can empty out from under
  // the user (the last UFC card of the night settles, a tag rotates off the
  // page). Fall back to All rather than showing an empty grid under a filter
  // that is gone.
  useEffect(() => {
    if (sport !== 'all' && !chips.some((c) => c.key === sport)) setSport('all');
  }, [chips, sport]);
  useEffect(() => {
    if (subTag !== 'all' && !subCategories.some((c) => c.key === subTag)) setSubTag('all');
  }, [subCategories, subTag]);

  const categoryEvents = useMemo(() => {
    if (isSportHub) {
      return sport === 'all'
        ? hubEvents
        : hubEvents.filter(
            (e) => sportOf({ category: e.category, teams: e.teams, text: e.title }) === sport
          );
    }
    return subTag === 'all' ? hubEvents : hubEvents.filter((e) => e.tags?.includes(subTag));
  }, [hubEvents, isSportHub, sport, subTag]);

  const categoryMarkets = useMemo(() => {
    if (isSportHub) {
      return sport === 'all'
        ? hubFlatMarkets
        : hubFlatMarkets.filter(
            (m) => sportOf({ category: m.category, text: m.question }) === sport
          );
    }
    return subTag === 'all'
      ? hubFlatMarkets
      : hubFlatMarkets.filter((m) => m.tags?.includes(subTag));
  }, [hubFlatMarkets, isSportHub, sport, subTag]);

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

  /** v25.19 — the game tiles (CS2 / LoL / Valorant …). Built over the WHOLE
   *  hub, not the current selection, so picking a game doesn't collapse the
   *  row you picked it from. */
  const gameTiles = useMemo(
    () => (category === 'esports' ? buildGameTiles(hubEvents) : []),
    [category, hubEvents]
  );

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

      {/* v25.18 — the one hero left, and only when the hub has a match worth
          leading with. On every other category (and a quiet sports day) this
          renders nothing and the grid starts right under the header. */}
      {!loading && heroMatch && <LiveMatchHero event={heroMatch} />}

      {/* v25.19 — the game tiles, under the hero, esports only. They filter
          the SAME state as the sub-category rail, so a tile and its rail row
          are one control with two faces. */}
      {!loading && gameTiles.length > 1 && (
        <GameTiles tiles={gameTiles} active={subTag} onSelect={setSubTag} />
      )}

      {/* v25.19 — rail + grid, Polymarket's two-column hub. The rail collapses
          to a chip strip below lg, which is where the sport chips used to sit,
          so nothing is lost on a phone. The grid column carries min-w-0 or a
          wide card would push the whole row sideways. */}
      <div
        className={cn(
          railItems.length > 1 && 'lg:grid lg:grid-cols-[184px_minmax(0,1fr)] lg:gap-6'
        )}
      >
        {railItems.length > 1 && (
          <div className="mb-4 lg:mb-0">
            <SubCategoryRail
              items={railItems}
              active={railActive}
              onSelect={onRailSelect}
            />
          </div>
        )}

        <div className="min-w-0 space-y-5">
          {/* v25.16 — ONE mixed grid, top GRID_PAGE cards by trending score,
              the rest behind "Show more markets". No Markets/Events tabs any
              more. v25.17 — the grid, the cap and the reveal animation live in
              MixedGrid, shared with the home page. */}
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                // v25.18 — the tightened cards are ~185px, not ~245px.
                <Skeleton key={i} className="h-48 w-full rounded-2xl" />
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
            <MixedGrid
              items={gridItems}
              // One column narrower than the home grid: the rail took ~208px
              // off the row, and four cards in what's left would squeeze the
              // team names and the buy pair.
              columns={railItems.length > 1 ? 'hub' : 'full'}
              resetKey={`${category}|${sport}|${subTag}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
