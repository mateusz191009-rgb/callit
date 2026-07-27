'use client';

import type { Market } from '@/lib/types';
import Skeleton from '@/components/ui/skeleton';
import MarketCard from './MarketCard';

/**
 * v25.24 — rebuilt from MarketCard's actual shell.
 *
 * It had drifted two redesigns behind: it still drew the badge row that
 * v25.19 removed and the probability label pair + 1.5px bar that v24.6
 * replaced with the gauge, and it drew no icon and no gauge at all. So the
 * thing standing in for the card no longer resembled the card, and content
 * arriving reshuffled the grid.
 *
 * Mirrors, block for block: 32px icon + two-line question + 52px gauge in
 * the head, then the quick-buy pair and the footer.
 */
function SkeletonCard() {
  return (
    <div className="flex h-full flex-col card-surface p-3.5">
      {/* Head: icon | question (2 lines) | gauge */}
      <div className="mb-2.5 flex items-start gap-2">
        <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
        <div className="min-h-[38px] min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-[52px] w-[52px] shrink-0 rounded-lg" />
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        {/* Quick-buy pair */}
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-9 w-full rounded-xl coarse:h-11" />
          <Skeleton className="h-9 w-full rounded-xl coarse:h-11" />
        </div>
        {/* Footer: volume + countdown */}
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
      // Same gap as the loaded grid below (it was 3 vs 4), and the same
      // count the feed actually renders — 8 skeletons handing over to 20
      // cards was a visible jump on its own.
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => (
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
