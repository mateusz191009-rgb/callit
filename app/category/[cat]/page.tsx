'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Inbox, SearchX } from 'lucide-react';
import type { Category, EventGroup } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import { formatCents, formatDate, shortSideLabel } from '@/lib/format';
import { useAllMarkets, useCategories, useEvents } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import { hashString } from '@/lib/utils';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import EmptyState from '@/components/common/EmptyState';
import CryptoHero, {
  HeroCopy,
  type CategoryHeroProps,
  type CategoryHeroStats,
} from '@/components/category/CryptoHero';
import EsportsHero from '@/components/category/EsportsHero';
import FootballHero from '@/components/category/FootballHero';
import BasketballHero from '@/components/category/BasketballHero';
import BaseballHero from '@/components/category/BaseballHero';
import PoliticsHero from '@/components/category/PoliticsHero';
import SportsHero from '@/components/category/SportsHero';
import EconomyHero from '@/components/category/EconomyHero';
import TechScienceHero from '@/components/category/TechScienceHero';
import WorldHero from '@/components/category/WorldHero';
import PopCultureHero from '@/components/category/PopCultureHero';
import CustomHero from '@/components/category/CustomHero';
import EventCard, { outcomeLabels } from '@/components/markets/EventCard';
import MarketGrid from '@/components/markets/MarketGrid';
import { MarketIcon } from '@/components/markets/MarketCard';

type CategoryTab = 'markets' | 'events';

const CATEGORY_TABS: TabItem<CategoryTab>[] = [
  { value: 'markets', label: 'Markets' },
  { value: 'events', label: 'Events' },
];


/* ------------------------------------------------------------------ */
/* Floating hero tiles                                                 */
/* ------------------------------------------------------------------ */

interface TileData {
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
 * One floating tile. Everything visual (rotation, size, float duration,
 * phase, dimming, jitter) is derived from hashString(tile.key) so the
 * scatter is deterministic — no Math.random in render, no hydration risk.
 * Layers: absolute wrapper (position) > .float-card (CSS drift) >
 * motion div (base rotation + hover straighten/zoom) > link + icon.
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

/* ------------------------------------------------------------------ */
/* Generic hero (floating tiles)                                       */
/* ------------------------------------------------------------------ */

/**
 * Default category hero: floating artwork tiles with mouse parallax.
 * Every category now gets a themed scene instead (see THEMED_HEROES);
 * this hero is what they all fall back to when their data is sparse
 * (< 3 usable markets), which is why it stays the generic one.
 */
function GenericHero({ tiles, stats }: { tiles: TileData[]; stats: CategoryHeroStats }) {
  const reducedMotion = useReducedMotion();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

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
      className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2"
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

/* ------------------------------------------------------------------ */
/* Themed hero switch                                                  */
/* ------------------------------------------------------------------ */

/**
 * One themed scene per built-in category — every hero takes the same
 * CategoryHeroProps and renders `fallback` (the generic floating-tiles
 * hero) itself when its category has fewer than 3 usable markets.
 *
 * Admin-created custom slugs are not in this map and resolve to
 * CustomHero via the `??` below: its "anything you can imagine" idea
 * network is exactly the right scene for a user-invented category.
 */
const THEMED_HEROES: Record<string, React.ComponentType<CategoryHeroProps>> = {
  politics: PoliticsHero,
  sports: SportsHero,
  football: FootballHero,
  basketball: BasketballHero,
  baseball: BaseballHero,
  esports: EsportsHero,
  crypto: CryptoHero,
  economy: EconomyHero,
  'tech-science': TechScienceHero,
  world: WorldHero,
  'pop-culture': PopCultureHero,
  custom: CustomHero,
};

/* ------------------------------------------------------------------ */
/* Top contenders leaderboard                                          */
/* ------------------------------------------------------------------ */

function TopContenders({ event }: { event: EventGroup }) {
  const openTradeModal = useCallitStore((s) => s.openTradeModal);
  // Bars start at 0 and grow to their probability shortly after mount
  // (setTimeout instead of rAF — it also fires in throttled tabs).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 50);
    return () => clearTimeout(t);
  }, []);

  const top = useMemo(
    () => [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 5),
    [event.markets]
  );
  const labels = outcomeLabels(top);
  const href = `/event/${event.id}`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-2xl border border-line bg-surface-2 p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-bold uppercase tracking-wide text-tx-mut">
            Top contenders
          </h2>
          <Link
            href={href}
            className="mt-1 block truncate text-lg font-black tracking-tight text-tx transition-colors hover:text-green"
          >
            {event.title}
          </Link>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-tx-sec transition-colors hover:text-tx"
        >
          View event
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-col">
        {top.map((m, i) => (
          <div
            key={m.id}
            className="flex items-center gap-3 border-b border-line py-3 first:pt-0 last:border-0 last:pb-0"
          >
            <span className="w-5 shrink-0 text-center text-sm font-black text-tx-mut tabular-nums">
              {i + 1}
            </span>
            <MarketIcon
              icon={m.icon}
              category={m.category}
              className="h-8 w-8 rounded-lg"
              iconClassName="h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/market/${m.id}`}
                  className="truncate text-sm font-bold text-tx transition-colors hover:text-green"
                  title={m.question}
                >
                  {labels.get(m.id) ?? m.question}
                </Link>
                <span className="shrink-0 text-base font-black text-tx tabular-nums">
                  {formatCents(m.yesPrice)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-green transition-[width] duration-700 ease-out motion-reduce:transition-none"
                  style={{ width: grown ? `${Math.round(m.yesPrice * 100)}%` : '0%' }}
                />
              </div>
            </div>
            <Button
              variant="yes-tint"
              size="sm"
              className="h-7 shrink-0 rounded-lg px-2.5 text-[11px]"
              onClick={() => openTradeModal(m.id, 'yes')}
            >
              {shortSideLabel(m, 'yes')}
            </Button>
          </div>
        ))}
      </div>
    </motion.section>
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

  const [tab, setTab] = useState<CategoryTab>('markets');
  // v22 — remembers a manual tab click; only an untouched page may auto-
  // switch (below), a user's explicit choice is never overridden.
  const [tabTouched, setTabTouched] = useState(false);
  // Computed after mount so server and client never disagree on "today".
  const [updated, setUpdated] = useState('');
  useEffect(() => {
    setUpdated(formatDate(new Date().toISOString()));
  }, []);

  // Category hubs share one mounted page — switching categories via the top
  // bar must reset the tab state or Esports would inherit Basketball's.
  useEffect(() => {
    setTab('markets');
    setTabTouched(false);
  }, [category]);

  const categoryEvents = useMemo(
    () =>
      category
        ? events
            .filter((e) => e.category === category)
            .sort((a, b) => b.volume - a.volume)
        : [],
    [events, category]
  );

  /** Category markets, minus outcomes already shown inside an event card. */
  const categoryMarkets = useMemo(() => {
    if (!category) return [];
    const eventIds = new Set(categoryEvents.map((e) => e.id));
    const outcomeIds = new Set(categoryEvents.flatMap((e) => e.markets.map((m) => m.id)));
    const list = markets.filter(
      (m) =>
        m.category === category &&
        !outcomeIds.has(m.id) &&
        !(m.eventId && eventIds.has(m.eventId))
    );
    list.sort((a, b) => b.volume - a.volume);
    // Open markets first, resolved last (stable sort keeps volume order).
    list.sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved'));
    return list;
  }, [markets, categoryEvents, category]);

  // v22 — a hub whose Markets tab is empty but which has events (esports:
  // everything is a match, so it all lives under Events) opens on Events
  // instead of an empty grid (owner: "wenn markets leer sind dann direkt
  // auf events switchen"). Waits for the feed and defers to a manual click.
  useEffect(() => {
    if (loading || tabTouched || tab !== 'markets') return;
    if (categoryMarkets.length === 0 && categoryEvents.length > 0) setTab('events');
  }, [loading, tabTouched, tab, categoryMarkets.length, categoryEvents.length]);

  const totalVolume = useMemo(
    () =>
      categoryMarkets.reduce((s, m) => s + m.volume, 0) +
      categoryEvents.reduce((s, e) => s + e.volume, 0),
    [categoryMarkets, categoryEvents]
  );

  /** Biggest multi-outcome event drives the "Top contenders" panel. */
  const topEvent = useMemo(
    () => categoryEvents.find((e) => e.markets.length >= 2),
    [categoryEvents]
  );

  /** 6-10 hero tiles from the category's artwork (events, outcomes, then
   *  flat markets). Deduped by image; sparse categories repeat their best
   *  items under a suffixed key so the scatter still fills out. */
  const tiles = useMemo(() => {
    if (!category) return [];
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
    for (const e of categoryEvents) {
      push({ key: e.id, icon: e.icon, category: e.category, href: `/event/${e.id}`, label: e.title });
      for (const m of e.markets) {
        push({ key: m.id, icon: m.icon, category: m.category, href: `/event/${e.id}`, label: m.question });
      }
    }
    for (const m of categoryMarkets) {
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
  }, [category, categoryEvents, categoryMarkets]);

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

  const label = categoryLabel(category, allCategories);

  const heroStats: CategoryHeroStats = {
    label,
    updated,
    marketCount: categoryMarkets.length,
    eventCount: categoryEvents.length,
    volume: totalVolume,
    loading,
  };
  const genericHero = <GenericHero tiles={tiles} stats={heroStats} />;
  // Built-ins get their own scene; custom slugs land on CustomHero.
  const Hero = THEMED_HEROES[category] ?? CustomHero;

  return (
    <div className="space-y-6">
      {/* Hero — every category has a themed scene; each one renders the
          generic floating-tiles hero itself when its data is sparse */}
      <Hero
        markets={categoryMarkets}
        events={categoryEvents}
        stats={heroStats}
        fallback={genericHero}
      />


      {/* Top contenders — the category's biggest multi-outcome event */}
      {!loading && topEvent && <TopContenders event={topEvent} />}
      {loading && <Skeleton className="h-56 w-full rounded-2xl" />}

      {/* Markets / Events */}
      <Tabs
        items={CATEGORY_TABS}
        value={tab}
        onChange={(t) => {
          setTabTouched(true);
          setTab(t);
        }}
      />

      {tab === 'markets' ? (
        <MarketGrid
          markets={categoryMarkets}
          loading={loading}
          emptyState={
            <EmptyState
              icon={Inbox}
              title={`No ${label} markets yet.`}
              description="New markets in this category will show up here."
              actionLabel="Browse all markets"
              actionHref="/"
            />
          }
        />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : categoryEvents.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={`No ${label} events yet.`}
          description="Multi-outcome events in this category will show up here."
          actionLabel="Browse all markets"
          actionHref="/"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categoryEvents.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
