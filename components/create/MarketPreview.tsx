'use client';

import { useMemo } from 'react';
import { Droplets } from 'lucide-react';
import type { Category, Market, ResolutionMethod } from '@/lib/types';
import { formatMoney } from '@/lib/format';
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
    /** The seed the form will actually charge — NOT a display default. */
    seed: number;
  };
}) {
  const market: Market = useMemo(() => {
    const now = Date.now();
    const parsed = input.endDate ? new Date(input.endDate).getTime() : NaN;
    const end = Number.isFinite(parsed)
      ? parsed
      : now + 30 * 24 * 60 * 60 * 1000;
    return {
      id: 'preview',
      source: 'callit',
      question: input.question.trim() || 'Your question appears here…',
      description: input.description?.trim() || undefined,
      category: input.category,
      endDate: new Date(end).toISOString(),
      resolution: input.resolution,
      yesPrice: 0.5,
      volume: 0,
      liquidity: input.seed,
      createdAt: new Date(now).toISOString(),
      status: 'open',
      priceHistory: [{ t: now, yes: 0.5 }],
    };
  }, [
    input.question,
    input.description,
    input.category,
    input.endDate,
    input.resolution,
    input.seed,
  ]);

  return (
    <div>
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-tx-mut">
        Live preview
      </div>
      <MarketCard market={market} interactive={false} />
      {/* The live seed, not a hardcoded $500. In cloud mode this amount is
          debited from the creator's balance, so a preview quoting a
          different number was contradicting the charge. */}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-tx-mut">
        <Droplets className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Your market starts at 50¢ with {formatMoney(input.seed)} seed liquidity.
      </p>
    </div>
  );
}
