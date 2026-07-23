'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, SearchX } from 'lucide-react';
import Badge from '@/components/ui/badge';
import Skeleton from '@/components/ui/skeleton';
import SourceBadge from '@/components/markets/SourceBadge';
import { MarketIcon } from '@/components/markets/MarketCard';
import RelatedMarkets from '@/components/markets/RelatedMarkets';
import ResolutionInfo from '@/components/markets/ResolutionInfo';
import VotePanel from '@/components/markets/VotePanel';
import MarketChat from '@/components/social/MarketChat';
import TradePulse from '@/components/social/TradePulse';
import EmptyState from '@/components/common/EmptyState';
import CreatorLink from '@/components/profile/CreatorLink';
import Countdown, { LiveBadge } from '@/components/common/Countdown';
import TradePanel from '@/components/trading/TradePanel';
import PriceChart from '@/components/trading/PriceChart';
import { useCategories, useMarket } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import {
  formatCents,
  formatDate,
  formatMoney,
  isInPlay,
  isMarketClosed,
  sideLabel,
} from '@/lib/format';
import { categoryLabel, type ResolutionMethod } from '@/lib/types';
import { cn } from '@/lib/utils';

const RESOLUTION_LABEL: Record<ResolutionMethod, string> = {
  oracle: 'Chainlink Oracle',
  community: 'Community vote',
  manual: 'Manual',
};

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:space-y-0">
        <div className="space-y-6">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-[280px] w-full rounded-2xl" />
        </div>
        <div className="space-y-4 self-start">
          <Skeleton className="h-[380px] w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => decodeURIComponent(params?.id ?? ''), [params?.id]);

  const market = useMarket(id);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  // Built-ins + custom categories so custom slugs resolve to their label.
  const categories = useCategories();

  if (!market) {
    if (!hydrated || !polyLoaded) return <DetailSkeleton />;
    return (
      <div className="space-y-6">
        <EmptyState
          icon={SearchX}
          title="Market not found"
          description="This market may have been removed, or the link is wrong."
          actionLabel="Back to markets"
          actionHref="/"
        />
      </div>
    );
  }

  const resolvedYes = market.resolvedOutcome === 'yes';
  const noPrice = 1 - market.yesPrice;
  // Real side names when the market has them ('Over'/'Under', team names) —
  // literal Yes/No otherwise. First side stays green, second stays sky.
  const yesName = sideLabel(market, 'yes');
  const noName = sideLabel(market, 'no');

  return (
    <div className="space-y-6">
      {/* v22 — back leads UP one level: an event outcome returns to its
          event page, a standalone market to its category hub — never to
          home (owner: "zurück in die kategorie … nicht auf home"). */}
      <Link
        href={market.eventId ? `/event/${market.eventId}` : `/category/${market.category}`}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-tx-sec transition-colors hover:text-tx"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {market.eventId ? 'Event' : categoryLabel(market.category, categories)}
      </Link>

      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:space-y-0">
        {/* Left column */}
        <div className="min-w-0 space-y-6">
          {/* Header */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{categoryLabel(market.category, categories)}</Badge>
              <SourceBadge source={market.source} />
              {market.status === 'resolved' ? (
                <Badge variant={resolvedYes ? 'green' : 'sky'}>
                  Resolved — {resolvedYes ? yesName : noName}
                </Badge>
              ) : (
                // v7 — `open` is REQUIRED for anything whose `endDate` we do
                // not own. A feed market regularly sits past its upstream
                // `endDate` while still trading (that date is the kickoff);
                // without this the chip read "Ended" directly above a working
                // TradePanel. Community markets resolve to the same `Ends in
                // …`/`Ended` as before, since `isMarketClosed` IS `endDate <=
                // now` for them. v16: LIVE while in play, "Starts in" before
                // a game sub-market's kickoff (groupId marks a real game).
                isInPlay(market) ? (
                  <LiveBadge />
                ) : (
                  <Countdown
                    endDate={market.endDate}
                    startsAt={market.groupId ? market.startTime : undefined}
                    open={!isMarketClosed(market)}
                  />
                )
              )}
            </div>
            <div className="flex items-start gap-3">
              <MarketIcon
                icon={market.icon}
                category={market.category}
                className="mt-0.5 h-12 w-12 rounded-xl"
                iconClassName="h-6 w-6"
              />
              <h1 className="min-w-0 text-2xl font-black leading-tight tracking-tight text-tx sm:text-3xl">
                {market.question}
              </h1>
            </div>

            {/* Polymarket-style meta line — replaces the old stats-chip card
                AND the right-rail "Market stats" card, which repeated the
                same volume/liquidity numbers a second time. */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-semibold text-tx-mut">
              <span className="tabular-nums">
                {formatMoney(market.volume, { compact: true })} Vol.
              </span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {formatMoney(market.liquidity, { compact: true })} Liquidity
              </span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {formatDate(market.endDate)}
              </span>
              <span className="hidden sm:inline" aria-hidden>
                ·
              </span>
              <span className="hidden sm:inline">
                {RESOLUTION_LABEL[market.resolution]}
              </span>
              {market.createdBy && (
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden>·</span>
                  {/* v8: censored display, but clickable through to the
                      creator's PUBLIC profile (/u/<username>) in cloud mode. */}
                  by <CreatorLink createdBy={market.createdBy} />
                </span>
              )}
            </div>
          </div>

          {/* Price strip */}
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <motion.span
              key={`yes-${market.yesPrice}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl font-black tabular-nums text-green"
            >
              {yesName} {formatCents(market.yesPrice)}
            </motion.span>
            <motion.span
              key={`no-${market.yesPrice}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl font-black tabular-nums text-sky"
            >
              {noName} {formatCents(noPrice)}
            </motion.span>
          </div>

          {/* Resolved banner */}
          {market.status === 'resolved' && (
            <div
              className={cn(
                'rounded-xl border p-3 text-sm font-bold',
                resolvedYes
                  ? 'border-green/40 bg-green/10 text-green'
                  : 'border-sky/40 bg-sky/10 text-sky'
              )}
            >
              This market resolved {(resolvedYes ? yesName : noName).toUpperCase()} —
              winning shares paid $1.00.
            </div>
          )}

          {/* Chart + fake live activity */}
          <div className="relative">
            <PriceChart history={market.priceHistory} yesName={yesName} />
            <TradePulse marketId={market.id} />
          </div>

          {/* v13 — the parent event's other markets (game props, spreads,
              totals, sibling outcomes), Polymarket-style. Renders nothing
              for standalone markets. */}
          <RelatedMarkets market={market} />

          {/* Description */}
          {market.description && (
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <h2 className="text-sm font-bold text-tx">About this market</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-tx-sec">
                {market.description}
              </p>
            </div>
          )}

          {/* Community resolution ballot (renders only for ended, unresolved
              community-vote markets) */}
          <VotePanel market={market} />

          {/* Discussion */}
          <MarketChat marketId={market.id} />
        </div>

        {/* Right column */}
        <div className="space-y-4 self-start lg:sticky lg:top-20">
          <TradePanel market={market} />
          <ResolutionInfo market={market} />
        </div>
      </div>
    </div>
  );
}
