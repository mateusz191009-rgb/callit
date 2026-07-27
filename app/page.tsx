'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Inbox, Plus, SearchX } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import Select from '@/components/ui/select';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import FeaturedHero from '@/components/markets/FeaturedHero';
import MarketGrid from '@/components/markets/MarketGrid';
import MixedGrid from '@/components/markets/MixedGrid';
import MarketTicker from '@/components/markets/MarketTicker';
import EmptyState from '@/components/common/EmptyState';
import { useAllMarkets, useCategories, useEvents } from '@/lib/useMarkets';
import { useCallitStore, type HomeTab } from '@/lib/store';
import { trendingScore } from '@/lib/format';
import { categoryLabel, type EventGroup, type Market } from '@/lib/types';

/** v25.18 — 'trending' (24h volume) is its own key and the DEFAULT. 'volume'
 *  stays as LIFETIME volume, which is a real thing a user might want to sort
 *  by — it just isn't what a front page means by "trending". */
type SortKey = 'trending' | 'volume' | 'newest' | 'ending';

const TAB_ITEMS: TabItem<HomeTab>[] = [
  { value: 'all', label: 'All' },
  { value: 'trending', label: 'Trending' },
  { value: 'polymarket', label: 'Global' },
  { value: 'mine', label: 'My markets' },
];

/** Small debounce hook for the global search query. */
function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function HeroSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card-surface p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-7 w-3/4" />
          </div>
        </div>
        <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
        <Skeleton className="mt-4 h-[220px] w-full" />
        <div className="mt-4 flex items-center justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="min-h-[180px] w-full flex-1 rounded-2xl" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { markets, loading, error: feedError } = useAllMarkets();
  const { events } = useEvents();
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const homeTab = useCallitStore((s) => s.homeTab);
  const setHomeTab = useCallitStore((s) => s.setHomeTab);
  const searchQuery = useCallitStore((s) => s.searchQuery);
  const query = useDebounced(searchQuery, 250);
  const [sort, setSort] = useState<SortKey>('trending');
  // Built-ins + custom categories so search also matches custom labels.
  const categories = useCategories();

  // v25.18 — the ticker is a "what's moving" strip, so it ranks by 24h
  // volume. On lifetime volume it showed the same three 2028 primaries every
  // day for weeks.
  const tickerMarkets = useMemo(
    () =>
      markets
        .filter((m) => m.status === 'open')
        .sort((a, b) => trendingScore(b) - trendingScore(a))
        .slice(0, 5),
    [markets]
  );

  /** Multi-outcome events shown as EventCards (never on "My markets"). */
  const filteredEvents = useMemo(() => {
    if (homeTab === 'mine') return [];
    let list = events;

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          categoryLabel(e.category, categories).toLowerCase().includes(q) ||
          e.markets.some((m) => m.question.toLowerCase().includes(q))
      );
    }

    const sorted = [...list];
    if (sort === 'ending') {
      sorted.sort(
        (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
      );
    } else if (sort === 'newest') {
      // v24.5 — events carry the provider's listing time since v24.3;
      // before that this fell back to volume, which is why the "Newest"
      // option visibly did nothing (event cards lead the grid). Events
      // without a createdAt (Kalshi) sort last.
      const t = (e: { createdAt?: string }) =>
        e.createdAt ? new Date(e.createdAt).getTime() : 0;
      sorted.sort((a, b) => t(b) - t(a));
    } else if (sort === 'volume') {
      sorted.sort((a, b) => b.volume - a.volume);
    } else {
      sorted.sort((a, b) => trendingScore(b) - trendingScore(a));
    }
    return sorted;
  }, [events, homeTab, query, sort, categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: Market[] = markets;

    if (q) {
      // Event outcome markets are searchable even though their event card
      // owns the grid slot while browsing.
      const seen = new Set(markets.map((m) => m.id));
      const outcomes = events
        .flatMap((e) => e.markets)
        .filter((m) => !seen.has(m.id));
      list = [...markets, ...outcomes];
    } else if (homeTab !== 'mine') {
      // Don't repeat markets that already appear inside a displayed event.
      // v20: also on the Global tab — it renders the same event cards, so
      // their outcomes rendering AGAIN as loose cards was pure duplication.
      const shownEventIds = new Set(filteredEvents.map((e) => e.id));
      const shownOutcomeIds = new Set(
        filteredEvents.flatMap((e) => e.markets.map((m) => m.id))
      );
      list = list.filter(
        (m) =>
          !shownOutcomeIds.has(m.id) &&
          !(m.eventId && shownEventIds.has(m.eventId))
      );
    }

    if (homeTab === 'trending') {
      // v25.16 — no more flat top-12 cap here: the unified grid below caps
      // the MIX at GRID_PAGE cards, so flat markets compete with events on
      // volume instead of being quota'd separately.
      list = [...list].filter((m) => m.status === 'open');
    } else if (homeTab === 'polymarket') {
      list = list.filter((m) => m.source === 'polymarket');
    } else if (homeTab === 'mine') {
      list = list.filter((m) => m.createdBy && userMarkets.some((u) => u.id === m.id));
    }

    if (q) {
      list = list.filter(
        (m) =>
          m.question.toLowerCase().includes(q) ||
          categoryLabel(m.category, categories).toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    if (sort === 'trending') {
      sorted.sort((a, b) => trendingScore(b) - trendingScore(a));
    } else if (sort === 'volume') {
      sorted.sort((a, b) => b.volume - a.volume);
    } else if (sort === 'newest') {
      sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else {
      // Resolved markets sort as "never ending" here; the final stable
      // sort below moves them to the end either way.
      const endTime = (m: (typeof sorted)[number]) =>
        m.status === 'resolved' ? Infinity : new Date(m.endDate).getTime();
      sorted.sort((a, b) => endTime(a) - endTime(b));
    }

    // Open markets first, resolved last (stable sort keeps prior order).
    sorted.sort(
      (a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved')
    );
    return sorted;
  }, [markets, events, filteredEvents, homeTab, userMarkets, query, sort, categories]);

  /**
   * v25.16 — events and flat markets INTERLEAVED by the active sort into
   * one item list. Each source list arrives internally sorted by the same
   * key; merging and re-sorting with one comparator keeps the order total
   * across kinds, so a $92M event and a $3M gauge market compete for the
   * same grid slot instead of living in separate blocks.
   */
  const gridItems = useMemo(() => {
    const items = [
      ...filteredEvents.map((e) => ({
        kind: 'event' as const,
        key: `e:${e.id}`,
        volume: e.volume,
        trend: trendingScore(e),
        createdAt: e.createdAt,
        endDate: e.endDate,
        resolved: false,
        event: e as EventGroup | undefined,
        market: undefined as Market | undefined,
      })),
      ...filtered.map((m) => ({
        kind: 'market' as const,
        key: `m:${m.id}`,
        volume: m.volume,
        trend: trendingScore(m),
        createdAt: m.createdAt as string | undefined,
        endDate: m.endDate,
        resolved: m.status === 'resolved',
        event: undefined as EventGroup | undefined,
        market: m as Market | undefined,
      })),
    ];
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
      // v25.18 — the default. Events and flat markets compete on the SAME
      // trending score, so a binary that traded $1M today can outrank a $671M
      // election that traded $200k.
      items.sort((a, b) => b.trend - a.trend);
    }
    // Open cards first, resolved last (stable sort keeps prior order).
    items.sort((a, b) => Number(a.resolved) - Number(b.resolved));
    return items;
  }, [filteredEvents, filtered, sort]);

  const emptyState =
    homeTab === 'mine' ? (
      <EmptyState
        icon={Plus}
        title="You haven't launched a market yet."
        actionLabel="Create your first market"
        actionHref="/create"
      />
    ) : query.trim() ? (
      <EmptyState
        icon={SearchX}
        title={`No markets found for "${query.trim()}"`}
        description="Try a different search or category."
      />
    ) : (
      <EmptyState icon={Inbox} title="No markets match these filters." />
    );

  return (
    <div className="space-y-6">
      {/* v25.24 — the masthead, and it lives HERE rather than inside
          FeaturedHero.

          The site's only h1 used to sit in the hero's right rail, so below
          `lg` it landed roughly a screen down — a first-time visitor met a
          featured event before anything said what this site is — and the
          largest text on the page was a market title, not a heading. Moving
          it into the hero fixed the position but not the timing: the hero
          only renders once the feed lands, so the sentence explaining the
          product waited on a network round-trip and never appeared in the
          server HTML at all. Above the loading branch, it is simply always
          there. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-tx sm:text-4xl">
            Make the call. Make the <span className="text-green">market</span>.
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-tx-sec">
            Trade real-world events — or launch your own market in seconds. No
            permission needed.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/create"
            className={buttonClasses('primary', 'md', 'glow-green whitespace-nowrap')}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Create a market
          </Link>
          <Link href="/about" className={buttonClasses('outline', 'md', 'whitespace-nowrap')}>
            How it works
          </Link>
        </div>
      </div>

      {/* Featured hero */}
      {loading ? (
        <HeroSkeleton />
      ) : (
        <FeaturedHero events={events} markets={markets} />
      )}

      {/* A dead feed used to be indistinguishable from an empty one: the
          fetch failed silently and the user was left on a skeleton or a
          grid that reads as "there are no markets". A banner rather than a
          full EmptyState — the last good payload is still on screen and
          still worth showing, it is just not fresh. */}
      {feedError && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber/40 bg-amber/10 px-3.5 py-2.5"
        >
          <span className="text-mini font-bold text-amber">Live odds are not updating</span>
          <span className="min-w-0 flex-1 text-mini text-tx-sec">
            Our data feed dropped out — the prices below may be out of date.
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-lg border border-amber/50 px-2.5 py-1 text-xs font-bold text-amber transition-colors hover:bg-amber/15"
          >
            Retry
          </button>
        </div>
      )}

      {/* Ticker */}
      <MarketTicker markets={tickerMarkets} />

      {/* Tabs + sort. v24.5 — the category chip row is gone: the sticky
          CategoryBar right above already navigates the same categories on
          every breakpoint, so the chips were a second, redundant filter. */}
      {/* v25.24 — pinned under the CategoryBar (64px topbar + 49px bar).
          These controls used to scroll away on the first flick, so five rows
          down you could no longer tell whether you were looking at Trending
          or Ending soon, and switching meant scrolling back to the top. The
          count comes with them: "how much is there" is the other thing the
          strip should answer. */}
      <div className="sticky top-[113px] z-20 -mx-4 flex items-center justify-between gap-3 border-b border-line/60 bg-ink/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Tabs items={TAB_ITEMS} value={homeTab} onChange={setHomeTab} />
        </div>
        {!loading && gridItems.length > 0 && (
          <span className="hidden shrink-0 text-micro font-bold tabular-nums text-tx-mut sm:inline">
            {gridItems.length} {gridItems.length === 1 ? 'market' : 'markets'}
          </span>
        )}
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

      {/* v25.16 — ONE mixed grid, Polymarket-style: events and flat
          markets INTERLEAVED by the active sort (they used to render as
          two blocks, all events first — so on Trending the events buried
          every flat market four screens deep). Top GRID_PAGE cards, the
          rest behind "Show more markets" (v25.17: MixedGrid owns the cap,
          the button and the reveal animation for both surfaces). */}
      {loading ? (
        <MarketGrid markets={[]} loading />
      ) : gridItems.length === 0 ? (
        emptyState
      ) : (
        <MixedGrid items={gridItems} resetKey={`${homeTab}|${sort}|${query}`} />
      )}
    </div>
  );
}
