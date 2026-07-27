'use client';

import type { Market } from '@/lib/types';
import Skeleton from '@/components/ui/skeleton';
import MarketCard from './MarketCard';

function SkeletonCard() {
  return (
    // v25.18 — mirrors MarketCard's tightened metrics, so the skeleton and
    // the card it stands in for are the same height.
    <div className="flex h-full flex-col card-surface p-3.5">
      {/* Badges row */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
      {/* Question — two lines */}
      <div className="mb-2.5 min-h-[38px] space-y-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        {/* Probability labels + bar */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-14" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        {/* Quick-buy buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-9 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

export default function MarketGrid({
  markets,
  loading,
  emptyState,
}: {
  markets: Market[];
  loading?: boolean;
  emptyState?: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (markets.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {markets.map((m) => (
        <MarketCard key={m.id} market={m} />
      ))}
    </div>
  );
}
