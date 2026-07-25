'use client';

import { useEffect, useMemo, useState } from 'react';
import { Inbox, Plus, SearchX } from 'lucide-react';
import Select from '@/components/ui/select';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import EventCard from '@/components/markets/EventCard';
import FeaturedHero from '@/components/markets/FeaturedHero';
import MarketCard from '@/components/markets/MarketCard';
import MarketGrid from '@/components/markets/MarketGrid';
import MarketTicker from '@/components/markets/MarketTicker';
import EmptyState from '@/components/common/EmptyState';
import { useAllMarkets, useCategories, useEvents } from '@/lib/useMarkets';
import Button from '@/components/ui/button';
import { useCallitStore, type HomeTab } from '@/lib/store';
import { categoryLabel, type EventGroup, type Market } from '@/lib/types';

type SortKey = 'volume' | 'newest' | 'ending';

/** Cards the mixed grid shows per "Show more markets" click (v25.16). */
const GRID_PAGE = 20;

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
      <div className="rounded-2xl border border-line bg-surface-2 p-5 sm:p-6">
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
  const { markets, loading } = useAllMarkets();
  const { events } = useEvents();
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const homeTab = useCallitStore((s) => s.homeTab);
  const setHomeTab = useCallitStore((s) => s.setHomeTab);
  const searchQuery = useCallitStore((s) => s.searchQuery);
  const query = useDebounced(searchQuery, 250);
  const [sort, setSort] = useState<SortKey>('volume');
  // Built-ins + custom categories so search also matches custom labels.
  const categories = useCategories();

  const tickerMarkets = useMemo(
    () =>
      markets
        .filter((m) => m.status === 'open')
        .sort((a, b) => b.volume - a.volume)
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
    } else {
      sorted.sort((a, b) => b.volume - a.volume);
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
    if (sort === 'volume') {
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
    } else {
      items.sort((a, b) => b.volume - a.volume);
    }
    // Open cards first, resolved last (stable sort keeps prior order).
    items.sort((a, b) => Number(a.resolved) - Number(b.resolved));
    return items;
  }, [filteredEvents, filtered, sort]);

  /** How many cards the grid shows; every filter change starts at the top. */
  const [shown, setShown] = useState(GRID_PAGE);
  useEffect(() => {
    setShown(GRID_PAGE);
  }, [homeTab, query, sort]);

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
      {/* Featured hero */}
      {loading ? (
        <HeroSkeleton />
      ) : (
        <FeaturedHero events={events} markets={markets} />
      )}

      {/* Ticker */}
      <MarketTicker markets={tickerMarkets} />

      {/* Tabs + sort. v24.5 — the category chip row is gone: the sticky
          CategoryBar right above already navigates the same categories on
          every breakpoint, so the chips were a second, redundant filter. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Tabs items={TAB_ITEMS} value={homeTab} onChange={setHomeTab} />
        </div>
        <Select
          aria-label="Sort markets"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="w-36 shrink-0 sm:w-44 [&>select]:h-9 [&>select]:text-xs"
        >
          <option value="volume">Volume</option>
          <option value="newest">Newest</option>
          <option value="ending">Ending soon</option>
        </Select>
      </div>

      {/* v25.16 — ONE mixed grid, Polymarket-style: events and flat
          markets INTERLEAVED by the active sort (they used to render as
          two blocks, all events first — so on Trending the events buried
          every flat market four screens deep). Top GRID_PAGE cards, the
          rest behind "Show more markets". */}
      {loading ? (
        <MarketGrid markets={[]} loading />
      ) : gridItems.length === 0 ? (
        emptyState
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {gridItems.slice(0, shown).map((item) =>
              item.kind === 'event' ? (
                <EventCard key={item.key} event={item.event!} />
              ) : (
                <MarketCard key={item.key} market={item.market!} />
              )
            )}
          </div>
          {gridItems.length > shown && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="md"
                onClick={() => setShown((n) => n + GRID_PAGE)}
              >
                Show more markets
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
