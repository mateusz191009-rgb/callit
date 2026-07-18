'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventGroup, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import { formatCents, shortSideLabel } from '@/lib/format';
import { useAllMarkets, useCategories, useEvents } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import { startNavProgressTo } from '@/lib/navProgress';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Skeleton from '@/components/ui/skeleton';
import { MarketIcon } from '@/components/markets/MarketCard';
import { EventIcon, shortOutcomeName } from '@/components/markets/EventCard';

const DEBOUNCE_MS = 200;
const MAX_EVENTS = 4;
const MAX_MARKETS = 8;

export interface SearchOverlayProps {
  /** Render while the topbar search input is focused AND has >= 2 chars. */
  open: boolean;
  /** Raw (undebounced) store searchQuery — debounced internally (200ms). */
  query: string;
  /** The topbar search input — the overlay drives keyboard from it. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Close + blur the input (Esc, or after navigating). */
  onClose: () => void;
}

/** Small local debounce so results lag typing by ~200ms, not per-key. */
function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** First case-insensitive occurrence of `query` in `text`, emphasized. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-bold text-green">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

/** Highest-probability outcome of an event (feed order is not trusted —
 *  overrides can reshuffle prices after merge). */
function topOutcome(event: EventGroup): Market | undefined {
  return event.markets.reduce<Market | undefined>(
    (best, m) => (!best || m.yesPrice > best.yesPrice ? m : best),
    undefined
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-tx-mut">
      {children}
    </div>
  );
}

/**
 * Polymarket-style search dropdown anchored under the topbar input.
 * Purely additive: the store `searchQuery` keeps live-filtering the home
 * grid — this overlay is a faster jump-to-result layer on top.
 *
 * Keyboard: ArrowUp/Down move the selection, Enter opens it, Esc closes
 * and blurs. Mouse: hover selects, click opens. On navigate the query is
 * cleared and the overlay closes.
 *
 * Mobile (< sm): the panel goes full-width fixed under the topbar.
 */
export default function SearchOverlay({
  open,
  query,
  inputRef,
  onClose,
}: SearchOverlayProps) {
  const router = useRouter();
  const setSearchQuery = useCallitStore((s) => s.setSearchQuery);
  const { markets, loading: marketsLoading } = useAllMarkets();
  const { events, loading: eventsLoading } = useEvents();
  const categories = useCategories();

  const debounced = useDebounced(query, DEBOUNCE_MS);
  const q = debounced.trim().toLowerCase();
  // The overlay opens on the LIVE query (>= 2 chars) but results follow the
  // debounced one — until it catches up, show a brief searching state.
  const ready = q.length >= 2;
  const searching = marketsLoading || eventsLoading || !ready;

  const matchedEvents = useMemo<EventGroup[]>(() => {
    if (!ready) return [];
    return events
      .filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          categoryLabel(e.category, categories).toLowerCase().includes(q) ||
          e.markets.some((m) => m.question.toLowerCase().includes(q))
      )
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_EVENTS);
  }, [ready, q, events, categories]);

  const matchedMarkets = useMemo<Market[]>(() => {
    if (!ready) return [];
    // Event outcome markets are searchable here too (like the home grid),
    // deduped against the flat list.
    const seen = new Set(markets.map((m) => m.id));
    const pool = [
      ...markets,
      ...events.flatMap((e) => e.markets).filter((m) => !seen.has(m.id)),
    ];
    return pool
      .filter(
        (m) =>
          m.question.toLowerCase().includes(q) ||
          categoryLabel(m.category, categories).toLowerCase().includes(q)
      )
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_MARKETS);
  }, [ready, q, markets, events, categories]);

  /** Flat keyboard order: events first, then markets. */
  const itemHrefs = useMemo(
    () => [
      ...matchedEvents.map((e) => `/event/${e.id}`),
      ...matchedMarkets.map((m) => `/market/${m.id}`),
    ],
    [matchedEvents, matchedMarkets]
  );

  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [q]);
  const sel = itemHrefs.length > 0 ? Math.min(selected, itemHrefs.length - 1) : -1;

  const listRef = useRef<HTMLDivElement>(null);

  // Refs so the (single) native key listener never sees stale values.
  const hrefsRef = useRef(itemHrefs);
  hrefsRef.current = itemHrefs;
  const selRef = useRef(sel);
  selRef.current = sel;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const navigate = (href: string) => {
    setSearchQuery('');
    onCloseRef.current();
    startNavProgressTo(href);
    router.push(href);
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Drive the selection from the topbar input's keyboard while open.
  // Native listener on the input element: it runs before React's root
  // handlers, so preventDefault stops the caret jump on ArrowUp/Down.
  useEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const count = hrefsRef.current.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (count > 0) setSelected((i) => (Math.min(i, count - 1) + 1) % count);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (count > 0) setSelected((i) => (Math.min(i, count - 1) - 1 + count) % count);
      } else if (e.key === 'Enter') {
        const href = hrefsRef.current[selRef.current];
        if (href) {
          e.preventDefault();
          navigateRef.current(href);
        }
      } else if (e.key === 'Escape') {
        onCloseRef.current();
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [open, inputRef]);

  // Keep the keyboard selection scrolled into view.
  useEffect(() => {
    if (!open || sel < 0) return;
    listRef.current
      ?.querySelector(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [sel, open]);

  if (!open) return null;

  const highlight = debounced.trim();
  const marketOffset = matchedEvents.length;
  const empty = !searching && itemHrefs.length === 0;

  return (
    <div
      onMouseDown={(e) => {
        // Keep focus in the input so clicks land before any blur closes
        // the overlay — but let scrollbar drags (which target the list
        // container itself) through untouched.
        if (e.target !== listRef.current) e.preventDefault();
      }}
      className={cn(
        'search-pop fixed inset-x-2 top-[72px] z-50 flex max-h-[60vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-2xl',
        'sm:absolute sm:inset-x-0 sm:top-full sm:mt-2 sm:w-full sm:max-w-xl'
      )}
    >
      <div
        ref={listRef}
        role="listbox"
        aria-label="Search results"
        className="min-h-0 flex-1 overflow-y-auto py-1.5"
      >
        {searching ? (
          <div className="space-y-2.5 px-3.5 py-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <Skeleton className="h-4 min-w-0 flex-1" />
                <Skeleton className="h-4 w-12 shrink-0" />
              </div>
            ))}
          </div>
        ) : empty ? (
          <p className="px-3.5 py-6 text-center text-sm text-tx-mut">
            {`No results for "${highlight}"`}
          </p>
        ) : (
          <>
            {matchedEvents.length > 0 && (
              <>
                <GroupLabel>Events</GroupLabel>
                {matchedEvents.map((event, i) => {
                  const active = sel === i;
                  const top = topOutcome(event);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-idx={i}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => navigate(`/event/${event.id}`)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors',
                        active && 'bg-surface-3'
                      )}
                    >
                      <EventIcon
                        icon={event.icon}
                        category={event.category}
                        className="h-8 w-8"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-tx">
                          <Highlight text={event.title} query={highlight} />
                        </span>
                        {top && (
                          <span className="block truncate text-[11px] text-tx-mut">
                            {shortOutcomeName(top)}
                            {' · '}
                            <span className="font-bold text-green tabular-nums">
                              {formatCents(top.yesPrice)}
                            </span>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {matchedMarkets.length > 0 && (
              <>
                <GroupLabel>Markets</GroupLabel>
                {matchedMarkets.map((m, i) => {
                  const idx = marketOffset + i;
                  const active = sel === idx;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-idx={idx}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => navigate(`/market/${m.id}`)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors',
                        active && 'bg-surface-3'
                      )}
                    >
                      <MarketIcon
                        icon={m.icon}
                        category={m.category}
                        className="h-8 w-8 rounded-lg"
                        iconClassName="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-tx line-clamp-1">
                        <Highlight text={m.question} query={highlight} />
                      </span>
                      <span className="shrink-0 text-xs font-bold text-green tabular-nums">
                        {shortSideLabel(m, 'yes')} {formatCents(m.yesPrice)}
                      </span>
                      <Badge variant="neutral" className="shrink-0">
                        {categoryLabel(m.category, categories)}
                      </Badge>
                    </button>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="shrink-0 border-t border-line px-3.5 py-2 text-xs text-tx-mut">
        Press Enter to open · Esc to close
      </div>
    </div>
  );
}
