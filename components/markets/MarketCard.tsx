'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Bitcoin,
  Clapperboard,
  Cpu,
  Earth,
  Landmark,
  Sparkles,
  TrendingUp,
  Trophy,
  Volleyball,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Category, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import {
  formatCents,
  formatMoney,
  isInPlay,
  isMarketClosed,
  shortSideLabel,
  sideLabel,
} from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { useCategories } from '@/lib/useMarkets';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import ProbabilityBar from './ProbabilityBar';
import SourceBadge from './SourceBadge';
import Countdown from '@/components/common/Countdown';
import TradePulse from '@/components/social/TradePulse';

/** Topical fallback icon per category — shared by cards, ticker and detail. */
export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  politics: Landmark,
  sports: Trophy,
  football: Volleyball,
  crypto: Bitcoin,
  economy: TrendingUp,
  'tech-science': Cpu,
  world: Earth,
  'pop-culture': Clapperboard,
  custom: Sparkles,
};

/**
 * Market image with graceful fallback: renders `icon` as an <img>; on load
 * error (or when no icon is set) falls back to the category icon in a
 * green-tinted squircle. Size/rounding come from `className`.
 */
export function MarketIcon({
  icon,
  category,
  className,
  iconClassName,
}: {
  icon?: string;
  category: Category;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  // Custom category slugs have no dedicated icon — fall back to Sparkles.
  const Icon = (CATEGORY_ICONS as Record<string, LucideIcon>)[category] ?? Sparkles;

  if (icon && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('shrink-0 border border-line object-cover', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center bg-green/10',
        className
      )}
      aria-hidden
    >
      <Icon className={cn('text-green', iconClassName ?? 'h-4 w-4')} />
    </div>
  );
}

export default function MarketCard({
  market,
  interactive = true,
  className,
}: {
  market: Market;
  interactive?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const openTradeModal = useCallitStore((s) => s.openTradeModal);
  // Built-ins + custom categories so custom slugs resolve to their label.
  const categories = useCategories();

  const href = `/market/${market.id}`;
  const resolved = market.status === 'resolved';
  const outcome = market.resolvedOutcome ?? 'yes';
  // Cards only render after hydration, so Date.now() is SSR-safe here.
  //
  // v7 — the SOURCE decides, not `endDate`. On a feed market that date is the
  // kickoff (a live match read as "Ended") or a stale placeholder (an open
  // market read as "Closed — awaiting resolution"). `isMarketClosed` is the
  // same predicate the server's trade gate uses, so the buttons this card
  // shows are exactly the trades `place_trade` will accept.
  const closed = isMarketClosed(market);
  const ended = !resolved && closed;
  // The LIVE badge only — trading is gated by `closed` above, never by this.
  const inPlay = isInPlay(market);

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={() => {
        if (interactive) router.push(href);
      }}
      className={cn(
        'glow-hover liquid-border relative flex h-full flex-col rounded-2xl border border-line bg-surface-2 p-4',
        interactive && 'cursor-pointer',
        className
      )}
    >
      {/* Head: topical icon + category + source */}
      <div className="mb-3 flex items-center gap-2.5">
        <MarketIcon
          icon={market.icon}
          category={market.category}
          className="h-9 w-9 rounded-lg"
          iconClassName="h-[18px] w-[18px]"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="neutral">{categoryLabel(market.category, categories)}</Badge>
          <SourceBadge source={market.source} />
        </div>
      </div>

      {/* Question — real link for a11y; two-line min height keeps grids aligned */}
      {interactive ? (
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="mb-3 line-clamp-2 min-h-[42px] text-[15px] font-bold leading-snug text-tx"
        >
          {market.question}
        </Link>
      ) : (
        <h3 className="mb-3 line-clamp-2 min-h-[42px] text-[15px] font-bold leading-snug text-tx">
          {market.question}
        </h3>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <ProbabilityBar
          yesPrice={market.yesPrice}
          showLabels
          // Real side names when the market has them ('Over 90¢'); the
          // shortened form keeps long team names from crowding the card.
          yesLabel={shortSideLabel(market, 'yes')}
          noLabel={shortSideLabel(market, 'no')}
        />

        {resolved ? (
          <Badge
            variant={outcome === 'yes' ? 'green' : 'sky'}
            className="flex w-full justify-center py-2 text-xs"
          >
            Resolved — {sideLabel(market, outcome)} won
          </Badge>
        ) : ended ? (
          // No `&& !inPlay` guard needed any more: `isInPlay` is false whenever
          // the market is closed, so a live game can never reach this branch.
          <Badge variant="neutral" className="flex w-full justify-center py-2 text-xs">
            Closed — awaiting resolution
          </Badge>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="yes-tint"
              size="sm"
              disabled={!interactive}
              className="font-extrabold tabular-nums"
              onClick={(e) => {
                e.stopPropagation();
                openTradeModal(market.id, 'yes');
              }}
            >
              {shortSideLabel(market, 'yes')} {formatCents(market.yesPrice)}
            </Button>
            <Button
              variant="no-tint"
              size="sm"
              disabled={!interactive}
              className="font-extrabold tabular-nums"
              onClick={(e) => {
                e.stopPropagation();
                openTradeModal(market.id, 'no');
              }}
            >
              {shortSideLabel(market, 'no')} {formatCents(1 - market.yesPrice)}
            </Button>
          </div>
        )}

        {/* Footer: volume + countdown (LIVE indicator while in-play) */}
        <div className="flex items-center justify-between text-xs text-tx-mut">
          <span className="tabular-nums">
            {formatMoney(market.volume, { compact: true })} Vol.
          </span>
          {inPlay ? (
            <span className="inline-flex items-center gap-1.5 font-bold text-green">
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
              </span>
              LIVE
            </span>
          ) : (
            <Countdown endDate={market.endDate} open={!resolved && !closed} />
          )}
        </div>
      </div>

      {/* Fake live activity chip (bottom-right, purely visual) */}
      <TradePulse marketId={market.id} compact />
    </motion.div>
  );
}
