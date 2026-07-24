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
  Gamepad2,
  Landmark,
  Sparkles,
  TrendingUp,
  Trophy,
  Volleyball,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BaseballIcon, BasketballIcon } from '@/components/icons';
import type { Category, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import {
  formatCents,
  formatMoney,
  isInPlay,
  isMarketClosed,
  isSourceResolved,
  shortSideLabel,
  sideLabel,
} from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { useCategories } from '@/lib/useMarkets';
import { startNavProgressTo } from '@/lib/navProgress';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import ProbabilityGauge from './ProbabilityGauge';
import SourceBadge from './SourceBadge';
import Countdown, { LiveBadge } from '@/components/common/Countdown';
import TradePulse from '@/components/social/TradePulse';

/** Topical fallback icon per category — shared by cards, ticker and detail. */
export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  politics: Landmark,
  sports: Trophy,
  football: Volleyball,
  basketball: BasketballIcon,
  baseball: BaseballIcon,
  esports: Gamepad2,
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
        if (interactive) {
          startNavProgressTo(href);
          router.push(href);
        }
      }}
      className={cn(
        'spotlight-card flex h-full flex-col rounded-2xl border border-line bg-surface-2 p-4 hover:border-line-strong',
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

      {/* Question + gauge — v24.6 Polymarket-style binary head: the question
          keeps the left column (real link for a11y; two-line min height keeps
          grids aligned), the semicircle gauge answers it at a glance on the
          right. Resolved cards drop the gauge — the outcome badge below is
          the answer, and a leftover 46% arc would contradict it. */}
      <div className="mb-3 flex items-start gap-3">
        {interactive ? (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="line-clamp-2 min-h-[42px] min-w-0 flex-1 text-[15px] font-bold leading-snug text-tx"
          >
            {market.question}
          </Link>
        ) : (
          <h3 className="line-clamp-2 min-h-[42px] min-w-0 flex-1 text-[15px] font-bold leading-snug text-tx">
            {market.question}
          </h3>
        )}
        {!resolved && (
          <ProbabilityGauge
            variant="semi"
            size={60}
            value={market.yesPrice}
            // Real side name when the market has one ('Over'); the shortened
            // form keeps long team names from crowding the gauge.
            label={shortSideLabel(market, 'yes')}
          />
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        {resolved ? (
          <Badge
            variant={outcome === 'yes' ? 'green' : 'sky'}
            className="flex w-full justify-center py-2 text-xs"
          >
            Resolved — {sideLabel(market, outcome)} won
          </Badge>
        ) : ended && isSourceResolved(market) ? (
          // v23.6 — the source already decided this one (an early-resolved
          // event outcome, v23.5): name the side instead of "awaiting".
          <Badge
            variant={market.yesPrice >= 0.5 ? 'green' : 'sky'}
            className="flex w-full justify-center py-2 text-xs"
          >
            Resolved — {sideLabel(market, market.yesPrice >= 0.5 ? 'yes' : 'no')}
          </Badge>
        ) : ended ? (
          // No `&& !inPlay` guard needed any more: `isInPlay` is false whenever
          // the market is closed, so a live game can never reach this branch.
          <Badge variant="neutral" className="flex w-full justify-center py-2 text-xs">
            Closed — awaiting resolution
          </Badge>
        ) : (
          // v24.6 — chunkier Polymarket-style quick-buy buttons (md, not sm):
          // with the probability bar gone they carry the whole action row.
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="yes-tint"
              size="md"
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
              size="md"
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
            <LiveBadge />
          ) : (
            // v16 — `startsAt` only for game sub-markets (`groupId` is set
            // exclusively by real game events): their endDate is the KICKOFF,
            // so pre-start the chip must read "Starts in", not "Ends in".
            <Countdown
              endDate={market.endDate}
              startsAt={market.groupId ? market.startTime : undefined}
              open={!resolved && !closed}
            />
          )}
        </div>
      </div>

      {/* Fake live activity chip (bottom-right, purely visual) */}
      <TradePulse marketId={market.id} compact />
    </motion.div>
  );
}
