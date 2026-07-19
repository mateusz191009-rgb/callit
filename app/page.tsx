'use client';

import { useEffect, useMemo, useState } from 'react';
import { Inbox, Plus, SearchX } from 'lucide-react';
import Select from '@/components/ui/select';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import CategoryChips from '@/components/markets/CategoryChips';
import EventCard from '@/components/markets/EventCard';
import FeaturedHero from '@/components/markets/FeaturedHero';
import MarketCard from '@/components/markets/MarketCard';
import MarketGrid from '@/components/markets/MarketGrid';
import MarketTicker from '@/components/markets/MarketTicker';
import EmptyState from '@/components/common/EmptyState';
import { useAllMarkets, useCategories, useEvents } from '@/lib/useMarkets';
import { useCallitStore, type HomeTab } from '@/lib/store';
import { categoryLabel, type Market } from '@/lib/types';

type SortKey = 'volume' | 'newest' | 'ending';

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
  const categoryFilter = useCallitStore((s) => s.categoryFilter);
  const setCategoryFilter = useCallitStore((s) => s.setCategoryFilter);
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

    if (categoryFilter !== 'all') {
      list = list.filter((e) => e.category === categoryFilter);
    }

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
    } else {
      // Events have no created date — volume is the sensible default.
      sorted.sort((a, b) => b.volume - a.volume);
    }
    return sorted;
  }, [events, homeTab, categoryFilter, query, sort, categories]);

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
      list = [...list]
        .filter((m) => m.status === 'open')
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 12);
    } else if (homeTab === 'polymarket') {
      list = list.filter((m) => m.source === 'polymarket');
    } else if (homeTab === 'mine') {
      list = list.filter((m) => m.createdBy && userMarkets.some((u) => u.id === m.id));
    }

    if (categoryFilter !== 'all') {
      list = list.filter((m) => m.category === categoryFilter);
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
  }, [markets, events, filteredEvents, homeTab, userMarkets, categoryFilter, query, sort, categories]);

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

      {/* Filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <CategoryChips value={categoryFilter} onChange={setCategoryFilter} />
        </div>
        <Select
          aria-label="Sort markets"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="w-44 shrink-0 [&>select]:h-9 [&>select]:text-xs"
        >
          <option value="volume">Volume</option>
          <option value="newest">Newest</option>
          <option value="ending">Ending soon</option>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs items={TAB_ITEMS} value={homeTab} onChange={setHomeTab} />

      {/* Mixed grid: event cards first, then single markets */}
      {loading ? (
        <MarketGrid markets={[]} loading />
      ) : filteredEvents.length === 0 && filtered.length === 0 ? (
        emptyState
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredEvents.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
          {filtered.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
        </div>
      )}
    </div>
  );
}
