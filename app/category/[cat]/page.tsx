'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarClock, Inbox, Radio, SearchX } from 'lucide-react';
import type { Category, EventGroup, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import { formatDate, isInPlay, trendingScore } from '@/lib/format';
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
import Select from '@/components/ui/select';
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


/**
 * The Sports hub's rail selection: one of the sports, or one of the two modes
 * that sit above them (see the `sport` state).
 */
type SportsFilter = SportKey | 'live' | 'futures';

/** A game currently being played — the Live mode's test. Flat markets can
 *  never satisfy it: `isInPlay` requires a game sub-market. */
const isLiveEvent = (e: EventGroup): boolean =>
  Boolean(e.groups?.length) && e.markets.some((m) => isInPlay(m));

/** A season-long question rather than a fixture: no game sections. "MLB World
 *  Series Champion 2026" and "F1 Drivers' Champion" are futures; tonight's
 *  match is not. */
const isFuturesEvent = (e: EventGroup): boolean => !e.groups?.length;

/** Sort options on the hubs, mirroring the home page's. */
type SortKey = 'trending' | 'volume' | 'newest' | 'ending';

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

  /**
   * v25.6 — the Sports hub's active chip. 'all' on every other category.
   *
   * v25.20 — widened with two MODES that sit above the sports in the rail,
   * exactly where Polymarket puts theirs: Live (games in play, across every
   * sport) and Futures (the season-long questions — champions, awards,
   * records). It stays ONE select rather than two dimensions, because that is
   * how their rail behaves too and because "Live AND tennis AND futures" is a
   * filter nobody asked for.
   */
  const [sport, setSport] = useState<SportsFilter>('all');
  /** v25.19 — the active sub-category tag on every NON-sport hub. The two
   *  never both apply: the sports rail lists sports, every other rail lists
   *  the provider's topic tags (see the rail below). */
  const [subTag, setSubTag] = useState('all');
  /** v25.20 — same sort control as the home grid, same default. Trending, not
   *  lifetime volume: a hub ordered by accumulated history shows the same
   *  cards in the same order for months. */
  const [sort, setSort] = useState<SortKey>('trending');
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

  /** v25.20 — the two mode rows' counts, over the whole hub like every other
   *  count in the rail. Futures also counts the standalone questions, which
   *  are futures by nature (no fixture behind them). */
  const liveCount = useMemo(
    () => (isSportHub ? hubEvents.filter(isLiveEvent).length : 0),
    [isSportHub, hubEvents]
  );
  const futuresCount = useMemo(
    () =>
      isSportHub ? hubEvents.filter(isFuturesEvent).length + hubFlatMarkets.length : 0,
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

  /**
   * One rail, two sources: sports on the Sports hub, topic tags elsewhere —
   * and NONE on Esports.
   *
   * v25.20 — the esports rail listed CS2 / LoL / Valorant / Dota 2, and so did
   * the game tiles right above it (owner: "die kategorien bei esports sind
   * doppelt nervt bisschen"). They are built from the same tags and filter the
   * same state, so one of them had to go; the tiles win because they also
   * carry the live counts, which is the number an esports browser is scanning
   * for. Dropping the rail also gives the hub its fourth grid column back.
   */
  const railItems = useMemo<SubCategory[]>(() => {
    if (category === 'esports') return [];
    if (isSportHub) {
      // v25.20 — Live and Futures ride above the sports, Polymarket-style, and
      // only when there is something in them: a "Live 0" row is a dead end.
      const modes: SubCategory[] = [];
      if (liveCount > 0) {
        modes.push({ key: 'live', label: 'Live', count: liveCount, icon: Radio });
      }
      if (futuresCount > 0) {
        modes.push({ key: 'futures', label: 'Futures', count: futuresCount, icon: CalendarClock });
      }
      return [
        ...modes,
        ...chips.map((c) => ({
          key: c.key as string,
          label: c.label,
          count: c.count,
          // v25.20 — the same glyph the category bar uses for that sport.
          icon: SPORT_ICONS[c.key],
        })),
      ];
    }
    return subCategories;
  }, [category, isSportHub, chips, subCategories, liveCount, futuresCount]);
  const railActive = isSportHub ? sport : subTag;
  const onRailSelect = (key: string) => {
    if (isSportHub) setSport(key as SportsFilter);
    else setSubTag(key);
  };

  // The feed refreshes every 60s, so the selection can empty out from under
  // the user (the last UFC card of the night settles, a tag rotates off the
  // page). Fall back to All rather than showing an empty grid under a filter
  // that is gone.
  useEffect(() => {
    if (sport === 'all') return;
    // v25.20 — the modes are validated against the rail, which already drops
    // them when their count hits zero (the last live game of the night ends).
    if (!railItems.some((c) => c.key === sport)) setSport('all');
  }, [railItems, sport]);
  useEffect(() => {
    if (subTag !== 'all' && !subCategories.some((c) => c.key === subTag)) setSubTag('all');
  }, [subCategories, subTag]);

  const categoryEvents = useMemo(() => {
    if (isSportHub) {
      if (sport === 'all') return hubEvents;
      if (sport === 'live') return hubEvents.filter(isLiveEvent);
      if (sport === 'futures') return hubEvents.filter(isFuturesEvent);
      return hubEvents.filter(
        (e) => sportOf({ category: e.category, teams: e.teams, text: e.title }) === sport
      );
    }
    return subTag === 'all' ? hubEvents : hubEvents.filter((e) => e.tags?.includes(subTag));
  }, [hubEvents, isSportHub, sport, subTag]);

  const categoryMarkets = useMemo(() => {
    if (isSportHub) {
      if (sport === 'all' || sport === 'futures') return hubFlatMarkets;
      // A standalone question has no fixture, so it is never "live".
      if (sport === 'live') return [];
      return hubFlatMarkets.filter(
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
        volume: e.volume,
        createdAt: e.createdAt,
        endDate: e.endDate,
        resolved: false,
        event: e,
        market: undefined as Market | undefined,
      })),
      ...categoryMarkets.map((m) => ({
        kind: 'market' as const,
        key: `m:${m.id}`,
        trend: trendingScore(m),
        volume: m.volume,
        createdAt: m.createdAt as string | undefined,
        endDate: m.endDate,
        resolved: m.status === 'resolved',
        event: undefined as EventGroup | undefined,
        market: m,
      })),
    ];
    // v25.20 — the hubs get the home grid's sort control. Default trending,
    // not lifetime volume: a hub ordered by accumulated history shows the same
    // cards in the same order for months, whatever is happening today.
    if (sort === 'newest') {
      const t = (x: { createdAt?: string }) =>
        x.createdAt ? new Date(x.createdAt).getTime() : 0;
      items.sort((a, b) => t(b) - t(a));
    } else if (sort === 'ending') {
      const t = (x: { endDate: string; resolved: boolean }) =>
        x.resolved ? Infinity : new Date(x.endDate).getTime();
      items.sort((a, b) => t(a) - t(b));
    } else if (sort === 'volume') {
      items.sort((a, b) => b.volume - a.volume);
    } else {
      items.sort((a, b) => b.trend - a.trend);
    }
    // Open cards first, resolved last (stable sort keeps the order above).
    items.sort((a, b) => Number(a.resolved) - Number(b.resolved));
    return items;
  }, [categoryEvents, categoryMarkets, sort]);

  const totalVolume = useMemo(
    () =>
      categoryMarkets.reduce((s, m) => s + m.volume, 0) +
      categoryEvents.reduce((s, e) => s + e.volume, 0),
    [categoryMarkets, categoryEvents]
  );

  /**
   * v25.18 — the match that leads the hub, when there is one worth leading
   * with (live, or kicking off soon). Null on every non-sport category and on
   * a quiet sports day, and then the page simply starts at the grid.
   *
   * v25.20 — chosen over the WHOLE hub, not the filtered selection (owner:
   * "bei sport den hero einfach die ganze zeit bei dem wichtigsten lassen und
   * egal ob man auf football etc. ist … sonst sieht das komisch aus beim
   * wechseln"). It used to follow the sport chip, so picking Tennis swapped
   * the stage for whatever tennis match happened to be nearest — or, when
   * that sport had no match at all, made the hero vanish mid-browse. The hub's
   * headline event is the hub's headline event; the filter belongs to the
   * grid.
   */
  const heroMatch = useMemo(() => heroMatchOf(hubEvents), [hubEvents]);

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

  // The header and the empty state name what the user actually filtered to,
  // not the hub: "No Tennis markets yet." v25.20 — the topic rail and the game
  // tiles get the same treatment, which is also the only place a tile-filtered
  // esports hub says so (the tiles have no "All" of their own; clicking the
  // active one clears it).
  const hubLabel = categoryLabel(category, allCategories);
  const label =
    isSportHub && sport !== 'all'
      ? // v25.20 — the two modes read as what they are ("Live · Sports"),
        // since "Live" alone would name neither the hub nor a sport.
        sport === 'live' || sport === 'futures'
        ? `${sport === 'live' ? 'Live' : 'Futures'} · ${hubLabel}`
        : SPORT_LABELS[sport]
      : subTag !== 'all'
        ? subTag
        : hubLabel;

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
        // The active rail row's glyph — the sport's, or the mode's.
        icon={railItems.find((c) => c.key === railActive)?.icon}
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

        <div className="min-w-0 space-y-4">
          {/* v25.20 — the hubs get the home page's sort control. It sits over
              the grid, not over the rail, because it orders the grid. */}
          {!loading && gridItems.length > 0 && (
            <div className="flex items-center justify-end">
              <Select
                aria-label="Sort markets"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="w-36 shrink-0 sm:w-44 [&>select]:h-9 [&>select]:text-xs"
              >
                <option value="trending">Trending</option>
                <option value="volume">Total volume</option>
                <option value="newest">Newest</option>
                <option value="ending">Ending soon</option>
              </Select>
            </div>
          )}

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
              resetKey={`${category}|${sport}|${subTag}|${sort}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
