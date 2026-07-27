'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { ArrowLeft, Clock, SearchX } from 'lucide-react';
import Badge from '@/components/ui/badge';
import Skeleton from '@/components/ui/skeleton';
import SourceBadge from '@/components/markets/SourceBadge';
import ShareButton from '@/components/share/ShareButton';
import { marketUrl } from '@/lib/share';
import { MarketIcon } from '@/components/markets/MarketCard';
import RelatedMarkets from '@/components/markets/RelatedMarkets';
import ResolutionInfo from '@/components/markets/ResolutionInfo';
import VotePanel from '@/components/markets/VotePanel';
import MarketChat from '@/components/social/MarketChat';
import EmptyState from '@/components/common/EmptyState';
import CreatorLink from '@/components/profile/CreatorLink';
import Countdown, { LiveBadge } from '@/components/common/Countdown';
import TradePanel from '@/components/trading/TradePanel';

/** Lazy — recharts is ~90-110 KB gzipped and the chart is below the trade
 *  panel on every breakpoint. Placeholder matches the chart's own height so
 *  the page does not shift when it lands. */
const PriceChart = dynamic(() => import('@/components/trading/PriceChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[340px] w-full rounded-2xl" />,
});
import { useCategories, useMarket } from '@/lib/useMarkets';
import { usePinned } from '@/lib/usePinned';
import { useYesHistories } from '@/lib/useHistory';
import { useCallitStore } from '@/lib/store';
import {
  formatCents,
  formatDate,
  formatMoney,
  formatNoCents,
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

/**
 * The interactive half of the market page.
 *
 * `id` arrives as a prop from the server component in page.tsx rather than
 * from `useParams`, which is what lets that file stay a server component
 * and export `generateMetadata` — see there.
 */
export default function MarketDetail({ id }: { id: string }) {

  const market = useMarket(id);
  /** Drives the hairline under the pinned header — paint only; see
   *  lib/usePinned for why this one cannot lag. */
  const [pinRef, pinned] = usePinned();
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);
  // Built-ins + custom categories so custom slugs resolve to their label.
  const categories = useCategories();
  /**
   * v25.20 — the resolution rules, fetched for THIS market only.
   *
   * They stopped riding along in the feed (4.5 MB of text no card renders, see
   * toWirePayload). A market that already carries its own — every community
   * market, and the mock fallback — never fetches. A failure is silent: the
   * block simply doesn't render, exactly as it doesn't for a market that has
   * no description upstream either.
   */
  /**
   * v25.26 — the REAL chart for this market, when the source has one.
   *
   * `market.priceHistory` on a feed row is a seeded random walk (see
   * generatePriceHistory); this is Polymarket's own hourly series, fetched for
   * the one market being looked at. Keyed on `id` alone, so it runs before the
   * not-found early return like every other hook here.
   */
  // A community market's history is its own fills — real already, and nothing
  // upstream to ask about it.
  const wantsSourceHistory = !market || market.source !== 'callit';
  const { histories, ready: historyReady } = useYesHistories(
    wantsSourceHistory ? [id] : []
  );
  const realHistory = histories[id];

  /** The series the chart draws. Memoized (and above the not-found return,
   *  where hooks have to live): a fresh array on every render would re-run
   *  recharts' entrance animation each time the page re-renders for an
   *  unrelated reason — a chat message, the 60s odds beat. */
  const chartHistory = useMemo(() => {
    if (!market) return [];
    // The CLOB series ends at its last hourly close; the live quote is
    // appended so the line reaches the price printed above it.
    return realHistory
      ? [...realHistory, { t: Date.now(), yes: market.yesPrice }]
      : market.priceHistory;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realHistory, market?.priceHistory, market?.yesPrice]);

  const [fetchedDescription, setFetchedDescription] = useState<string | null>(null);
  const needsDescription = Boolean(market && !market.description && market.source === 'polymarket');
  useEffect(() => {
    if (!needsDescription) return;
    let alive = true;
    fetch(`/api/market-info?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { description?: string | null } | null) => {
        if (alive && data?.description) setFetchedDescription(data.description);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, needsDescription]);

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

  const description = market.description ?? fetchedDescription ?? undefined;
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

      {/* flex+order below lg, grid above. The grid used to collapse to
          source order on a phone, which put the trade panel AFTER the
          chart, related markets, description, the vote panel and the whole
          chat thread — roughly five screens below the fold, on the one
          action the page exists for. The rules card travels with it. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        {/* Left column. NOT the space-y container itself: the sticky pill
            wrapper is zero-height and must not eat a space-y gap. */}
        <div className="relative order-2 min-w-0 lg:order-1">
          {/* Pin sentinel: the column's own top edge. Absolute so no
              space-y margin can push it, and it must live on the TALL
              column — a short wrapper would end the sticky at its own
              bottom edge. */}
          <div ref={pinRef} aria-hidden className="absolute inset-x-0 top-0 h-px" />
          <div className="space-y-6">
          {/* Header — the pin (v25.33/34), read off the owner's screen
              recording: the title renders at ONE size and simply sticks.
              The v25.30 morph shrank a big headline at the pin moment — a
              layout jolt on every scroll-past ("ultra unclean"). PM never
              morphs: compact from the start, pinned under the chrome,
              content sliding beneath.

              Two things make the pin read as intentional rather than as a
              clipping accident, and NEITHER touches layout:

              1. A 20px ink-to-transparent gradient hangs below the bar, so
                 content scrolling under it DISSOLVES instead of being cut at
                 a hard line. Pure CSS, no state; invisible at rest because it
                 hangs in the 24px space-y gap over the page's own ink.
              2. A hairline whose COLOUR fades in on pin (200ms). The border
                 is always 1px, so nothing reflows — the lesson from v25.30,
                 which animated font-size and jolted the whole column. */}
            <div
              className={cn(
                'sticky top-[113px] z-30 -mx-4 flex items-center gap-3 bg-ink px-4 py-2.5 sm:-mx-6 sm:px-6',
                // NOT `relative` here: cn() is tailwind-merge, `relative` and
                // `sticky` are one group, and merge kept the last one — which
                // silently deleted the sticky and un-pinned the header. A
                // sticky box is already positioned, so the pseudo-element
                // anchors to it either way.
                'after:pointer-events-none after:absolute after:inset-x-0',
                'after:top-full after:h-5 after:bg-gradient-to-b after:from-ink after:to-transparent',
                'border-b transition-colors duration-200',
                pinned ? 'border-line' : 'border-transparent'
              )}
            >
              <MarketIcon
                icon={market.icon}
                category={market.category}
                className="h-9 w-9 shrink-0 rounded-lg"
                iconClassName="h-5 w-5"
              />
              <h1 className="line-clamp-2 min-w-0 flex-1 text-xl font-bold leading-snug tracking-tight text-tx sm:text-2xl">
                {market.question}
              </h1>
              {/* v25.40 — share sits IN the pinned header, so it stays reachable
                  while the page is scrolled to the chart or the order ticket. */}
              <ShareButton
                variant="icon"
                url={marketUrl(market.id)}
                title={market.question}
                text={market.question}
                label="Copy market link"
                copiedMessage="Market link copied."
                className="mt-0.5"
              />
            </div>

          {/* Badges + meta — normal flow, scroll away under the pin.
              !mt-1 OVERRIDES the page's 24px space-y step (a plain -mt-*
              loses to `.space-y-6 > * ~ *` on specificity): these
              belong TO the title above them, not to the next section
              (owner: "der abstand zwischen dem titel, icon und den
              kategorie badges ist viel zu gross"). */}
          <div className="!mt-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{categoryLabel(market.category, categories)}</Badge>
              <SourceBadge source={market.source} />
              {market.status === 'resolved' && market.voided ? (
                <Badge variant="amber">Cancelled</Badge>
              ) : market.status === 'resolved' ? (
                <Badge variant={resolvedYes ? 'green' : 'sky'}>
                  Resolved — {resolvedYes ? yesName : noName}
                </Badge>
              ) : (
                // v7 — `open` is REQUIRED for anything whose `endDate` we do
                // not own. A feed market regularly sits past its upstream
                // `endDate` while still trading (that date is the kickoff);
                // without this the chip read "Ended" directly above a working
                // TradePanel. v16: LIVE while in play, "Starts in" before a
                // game sub-market's kickoff (groupId marks a real game).
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
            {/* Polymarket-style meta line — the ONE place volume/liquidity/
                dates live (the old stats cards repeated them twice). */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-mini font-semibold text-tx-mut">
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
                  {/* v8: censored display, clickable to the public profile. */}
                  by <CreatorLink createdBy={market.createdBy} />
                </span>
              )}
            </div>
          </div>

          {/* Price strip. Plain spans — these used to be motion.spans keyed
              on the price, so both numbers faded and slid on every 60s odds
              beat. A price that animates on every poll is noise. */}
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <span className="text-3xl font-black tabular-nums text-green">
              {yesName} {formatCents(market.yesPrice)}
            </span>
            <span className="text-3xl font-black tabular-nums text-sky">
              {noName} {formatNoCents(market.yesPrice)}
            </span>
          </div>

          {/* Resolved banner. v25.17 — a VOID gets its own line: there is no
              winning side to name, and every stake went back to the buyer at
              what they paid, not at $1.00 a share. */}
          {market.status === 'resolved' && market.voided ? (
            <div className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm font-bold text-amber">
              This market was cancelled by the source — it never had a result.
              Every stake has been refunded in full.
            </div>
          ) : market.status === 'resolved' ? (
            <div
              className={cn(
                'rounded-xl border p-3 text-sm font-bold',
                resolvedYes
                  ? 'border-green/40 bg-surface-3 text-tx-sec'
                  : 'border-sky/40 bg-sky/10 text-sky'
              )}
            >
              This market resolved {(resolvedYes ? yesName : noName).toUpperCase()} —
              winning shares paid $1.00.
            </div>
          ) : null}

          {/* Chart. The source's series ends at its last hourly close, so the
              live quote is appended — otherwise the line stops short of the
              price printed right above it.

              v25.36 — the fake activity chip that used to float over this
              plot is GONE (owner: "unten links auf dem chart bei der ansicht
              auch nicht"). Invented flow over the one genuine data
              visualisation on the page was the worst place it could sit. */}
          <div>
            <PriceChart
              history={chartHistory}
              yesName={yesName}
              noName={noName}
              loading={!historyReady}
              illustrative={historyReady && !realHistory && market.source !== 'callit'}
            />
          </div>

          {/* v13 — the parent event's other markets (game props, spreads,
              totals, sibling outcomes), Polymarket-style. Renders nothing
              for standalone markets. */}
          <RelatedMarkets market={market} />

          {/* Description. v25.20 — a feed market's rules arrive here from
              /api/market-info rather than in the list payload (they were 4.5 MB
              of it and no card shows one); community markets carry their own
              text and need no fetch. */}
          {description && (
            <div className="card-surface p-5">
              <h2 className="text-sm font-bold text-tx">About this market</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-tx-sec">
                {description}
              </p>
            </div>
          )}

          {/* Community resolution ballot (renders only for ended, unresolved
              community-vote markets) */}
          <VotePanel market={market} />

          {/* Discussion */}
          <MarketChat marketId={market.id} />
          </div>
        </div>

        {/* Right column. `self-start` is lg-ONLY on purpose: it means
            align-self:start, and below lg this container is a COLUMN flex —
            where the cross axis is horizontal, so the rail stopped
            stretching to the page and sized itself shrink-to-fit instead.
            Any wide min-content inside it (see AmountInput's `size`) then
            became the column's width and hung off the side of the phone.
            Above lg the parent is the grid again and start-alignment is
            what keeps the rail from stretching to the left column's
            height. */}
        <div className="order-1 space-y-4 lg:order-2 lg:sticky lg:top-[121px] lg:self-start">
          <TradePanel market={market} />
          <ResolutionInfo market={market} />
        </div>
      </div>
    </div>
  );
}
