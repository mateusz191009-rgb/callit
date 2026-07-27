'use client';

import { useMemo } from 'react';
import { Droplets } from 'lucide-react';
import type { Category, EventGroup, Market, ResolutionMethod } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import EventCard from '@/components/markets/EventCard';
import MarketCard from '@/components/markets/MarketCard';

export default function MarketPreview({
  input,
}: {
  input: {
    question: string;
    description?: string;
    category: Category;
    endDate: string;
    resolution: ResolutionMethod;
    /** The seed the form will actually charge — NOT a display default.
     *  In multi-outcome mode this is the seed PER OUTCOME. */
    seed: number;
    /** v25.28 — the uploaded image, as a data URL while the form is open. */
    icon?: string;
    /** v25.28 — set on a multi-outcome event; the card then previews the
     *  EVENT, which is a different card entirely. Names are pre-trimmed by
     *  the form; empty rows are dropped here so the preview follows typing. */
    outcomes?: string[];
  };
}) {
  const now = useMemo(() => Date.now(), []);
  const endDate = useMemo(() => {
    const parsed = input.endDate ? new Date(input.endDate).getTime() : NaN;
    return new Date(
      Number.isFinite(parsed) ? parsed : now + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
  }, [input.endDate, now]);

  const names = useMemo(
    () => (input.outcomes ?? []).map((o) => o.trim()).filter(Boolean),
    [input.outcomes]
  );
  const isEvent = input.outcomes !== undefined;

  const market: Market = useMemo(
    () => ({
      id: 'preview',
      source: 'callit',
      question: input.question.trim() || 'Your question appears here…',
      description: input.description?.trim() || undefined,
      category: input.category,
      endDate,
      resolution: input.resolution,
      yesPrice: 0.5,
      volume: 0,
      liquidity: input.seed,
      createdAt: new Date(now).toISOString(),
      status: 'open',
      priceHistory: [{ t: now, yes: 0.5 }],
      icon: input.icon,
    }),
    [
      input.question,
      input.description,
      input.category,
      input.resolution,
      input.seed,
      input.icon,
      endDate,
      now,
    ]
  );

  /** The same shape create_event_rpc will insert: one binary market per
   *  outcome, each opening at 1/N so the card adds up to 100%. */
  const event: EventGroup = useMemo(() => {
    const price = names.length > 0 ? Math.min(0.98, Math.max(0.02, 1 / names.length)) : 0.5;
    return {
      id: 'preview-event',
      title: input.question.trim() || 'Your question appears here…',
      icon: input.icon,
      category: input.category,
      endDate,
      volume: 0,
      createdAt: new Date(now).toISOString(),
      markets: names.map((name, i) => ({
        id: `preview-o${i + 1}`,
        source: 'callit',
        question: `${input.question.trim()} — ${name}`,
        category: input.category,
        endDate,
        resolution: input.resolution,
        yesPrice: price,
        volume: 0,
        liquidity: input.seed,
        createdAt: new Date(now).toISOString(),
        status: 'open',
        priceHistory: [{ t: now, yes: price }],
        icon: input.icon,
        shortName: name,
        eventId: 'preview-event',
        eventTitle: input.question.trim(),
      })),
    };
  }, [names, input.question, input.category, input.resolution, input.seed, input.icon, endDate, now]);

  const total = isEvent ? input.seed * Math.max(names.length, 1) : input.seed;

  return (
    <div>
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-tx-mut">
        Live preview
      </div>
      {isEvent ? (
        names.length >= 2 ? (
          // EventCard has no `interactive` prop — its Yes/No buttons open the
          // trade modal, and a preview's outcomes are not tradeable ids.
          <div className="pointer-events-none">
            <EventCard event={event} />
          </div>
        ) : (
          <div className="card-surface grid h-40 place-items-center p-5 text-center text-xs text-tx-mut">
            Name at least two outcomes to preview the event card.
          </div>
        )
      ) : (
        <MarketCard market={market} interactive={false} />
      )}
      {/* The live seed, not a hardcoded $500. In cloud mode this amount is
          debited from the creator's balance, so a preview quoting a
          different number was contradicting the charge. */}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-tx-mut">
        <Droplets className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {isEvent ? (
          <span>
            Each outcome starts at {names.length >= 2 ? Math.round(100 / names.length) : 50}%
            with {formatMoney(input.seed)} of its own liquidity —{' '}
            {formatMoney(total)} in total.
          </span>
        ) : (
          <span>
            Your market starts at 50¢ with {formatMoney(input.seed)} seed liquidity.
          </span>
        )}
      </p>
    </div>
  );
}
