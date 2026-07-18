'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Market, MarketGroup } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { useEvents } from '@/lib/useMarkets';
import { outcomeLabels } from './EventCard';

/** Keep the card scannable — the event page carries the full list. */
const MAX_SECTIONS = 3;
const MAX_ROWS_PER_SECTION = 4;

/**
 * v13 — "More from this game" (owner: "wenn es ein spiel gibt so details
 * wie player props oder ähnliches direkt darunter listen").
 *
 * On a market that belongs to an event (a game sub-market or one outcome
 * of a multi-outcome question), list the event's OTHER markets right on
 * the detail page, Polymarket-style: grouped by section (Moneyline /
 * Spreads / Totals / props) when the event ships sections, the top
 * outcomes otherwise. Renders nothing for standalone markets — the parent
 * event is the only data source, no extra fetch.
 */
export default function RelatedMarkets({ market }: { market: Market }) {
  const { events } = useEvents();
  const event = market.eventId ? events.find((e) => e.id === market.eventId) : undefined;
  if (!event) return null;

  // Sections minus the market being viewed; empty sections disappear.
  const sections: MarketGroup[] = (
    event.groups && event.groups.length > 0
      ? event.groups
      : [
          {
            id: `${event.id}-outcomes`,
            label: 'Other outcomes',
            markets: [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice),
          },
        ]
  )
    .map((g) => ({ ...g, markets: g.markets.filter((m) => m.id !== market.id) }))
    .filter((g) => g.markets.length > 0)
    .slice(0, MAX_SECTIONS);

  if (sections.length === 0) return null;

  const hiddenCount =
    event.markets.length - 1 - sections.reduce(
      (n, g) => n + Math.min(g.markets.length, MAX_ROWS_PER_SECTION),
      0
    );

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-tx">More from this event</h2>
          <Link
            href={`/event/${event.id}`}
            className="mt-0.5 block truncate text-xs font-bold text-tx-mut transition-colors hover:text-tx"
            title={event.title}
          >
            {event.title}
          </Link>
        </div>
        <Link
          href={`/event/${event.id}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-tx-sec transition-colors hover:text-tx"
        >
          View event
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="mt-3 space-y-4">
        {sections.map((g) => {
          const rows = g.markets.slice(0, MAX_ROWS_PER_SECTION);
          const labels = outcomeLabels(rows);
          return (
            <div key={g.id}>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
                {g.label}
              </h3>
              <div className="mt-1.5 divide-y divide-line/60">
                {rows.map((m) => (
                  <Link
                    key={m.id}
                    href={`/market/${m.id}`}
                    title={m.question}
                    className="flex items-center gap-3 py-2 transition-colors hover:bg-surface-3/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-tx-sec">
                      {labels.get(m.id) ?? m.question}
                    </span>
                    <span className="shrink-0 text-sm font-black text-tx tabular-nums">
                      {formatCents(m.yesPrice)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <Link
          href={`/event/${event.id}`}
          className="mt-3 block text-xs font-bold text-tx-mut transition-colors hover:text-tx"
        >
          +{hiddenCount} more market{hiddenCount === 1 ? '' : 's'} on the event page
        </Link>
      )}
    </div>
  );
}
