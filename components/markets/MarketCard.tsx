'use client';

import { memo, useState } from 'react';
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
  formatNoCents,
  isInPlay,
  isMarketClosed,
  isNewListing,
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
import ShareButton from '@/components/share/ShareButton';
import { marketUrl } from '@/lib/share';
import ProbabilityGauge from './ProbabilityGauge';
// v25.19 — SourceBadge no longer sits on the card: the footer says "Community"
// for the rare case that carries meaning. It is still used by the detail pages.
import Countdown, { LiveBadge } from '@/components/common/Countdown';
import SideFlow from '@/components/trading/SideFlow';

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

function MarketCard({
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
        // v25.18 — TIGHTER CARD. Owner, comparing to Polymarket: "bei denen
        // sind die karten bisschen kleiner sieht cleaner aus". Every number
        // in this file that used to be one step larger (p-4, 36px icon,
        // 15px question, 60px gauge, h-10 buttons, 12px footer) came down
        // one step; nothing was removed. ~210px -> ~185px per card, and the
        // grid gap went 16 -> 12, so a desktop row costs ~30px less.
        // EventCard moved by the same amounts — the two kinds share a grid
        // row (which stretches to the tallest card in it), so tightening
        // only one of them would have bought nothing.
        'spotlight-card flex h-full flex-col card-surface p-3.5 hover:border-line-strong',
        interactive && 'cursor-pointer',
        className
      )}
    >
      {/* v25.19 — icon, question and gauge in ONE head block, no badge row.
          Polymarket's binary card is exactly this: artwork, question, gauge,
          then the buy pair (owner: "deren karten sind doch nochmal kompakter
          … siehst du den abstand den die nicht haben"). Category and source
          moved to the footer, where they cost no vertical space at all. */}
      <div className="mb-2.5 flex items-start gap-2">
        <MarketIcon
          icon={market.icon}
          category={market.category}
          className="h-8 w-8 rounded-lg"
          iconClassName="h-4 w-4"
        />
        {interactive ? (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="line-clamp-2 min-h-[38px] min-w-0 flex-1 text-sm font-bold leading-snug text-tx"
          >
            {/* v25.17 — a freshly listed FLAT market wore no New badge at
                all; inline, so the rare case costs no line. Never on a game
                sub-market, "listed" days before kickoff (`groupId` marks
                one). */}
            {!market.groupId && isNewListing(market.createdAt) && (
              <Badge variant="sky" className="mr-1.5 align-[2px]">
                <Sparkles className="h-3 w-3" aria-hidden />
                New
              </Badge>
            )}
            {market.question}
          </Link>
        ) : (
          <h3 className="line-clamp-2 min-h-[38px] min-w-0 flex-1 text-sm font-bold leading-snug text-tx">
            {market.question}
          </h3>
        )}
        {!resolved && (
          <ProbabilityGauge
            variant="semi"
            size={52}
            value={market.yesPrice}
            // Real side name when the market has one ('Over'); the shortened
            // form keeps long team names from crowding the gauge.
            label={shortSideLabel(market, 'yes')}
          />
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2.5">
        {resolved && market.voided ? (
          // v25.17 — a voided market has no winner to name. Saying "Yes won"
          // here (the old `resolvedOutcome ?? 'yes'` default) would invent a
          // result for an event that never happened.
          <Badge variant="amber" className="flex w-full justify-center py-1.5 text-micro">
            Cancelled — stakes refunded
          </Badge>
        ) : resolved ? (
          <Badge
            variant={outcome === 'yes' ? 'green' : 'sky'}
            className="flex w-full justify-center py-1.5 text-micro"
          >
            Resolved — {sideLabel(market, outcome)} won
          </Badge>
        ) : ended && isSourceResolved(market) ? (
          // v23.6 — the source already decided this one (an early-resolved
          // event outcome, v23.5): name the side instead of "awaiting".
          <Badge
            variant={market.yesPrice >= 0.5 ? 'green' : 'sky'}
            className="flex w-full justify-center py-1.5 text-micro"
          >
            Resolved — {sideLabel(market, market.yesPrice >= 0.5 ? 'yes' : 'no')}
          </Badge>
        ) : ended ? (
          // No `&& !inPlay` guard needed any more: `isInPlay` is false whenever
          // the market is closed, so a live game can never reach this branch.
          <Badge variant="neutral" className="flex w-full justify-center py-1.5 text-micro">
            Closed — awaiting resolution
          </Badge>
        ) : (
          // v24.6 — Polymarket-style quick-buy pair: with the probability bar
          // gone they carry the whole action row. v25.18 — h-9 rather than the
          // md h-10. They still dominate the card's lower half (Polymarket's
          // own Ja/Nein pair is the same height); 40px of button under a
          // 38px question was what made the card read tall.
          //
          // v25.37 — `relative` anchors the order flow, which OVERLAYS the
          // space above this pair rather than reserving a row: the stack can
          // be 40px tall and fade out at its top edge without the card
          // growing (owner: "es sollte sich nur so stacken und dann wie bei
          // polymarket ausfaden").
          <div className="relative">
            <SideFlow marketId={market.id} />
            <div className="grid grid-cols-2 gap-2">
            <Button
              variant="yes-tint"
              size="sm"
              disabled={!interactive}
              className="h-9 coarse:h-11 font-bold tabular-nums"
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
              className="h-9 coarse:h-11 font-bold tabular-nums"
              onClick={(e) => {
                e.stopPropagation();
                openTradeModal(market.id, 'no');
              }}
            >
              {shortSideLabel(market, 'no')} {formatNoCents(market.yesPrice)}
            </Button>
            </div>
          </div>
        )}

        {/* Footer: volume + category + countdown (LIVE while in-play) */}
        <div className="flex items-center justify-between gap-2 text-micro text-tx-mut">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 tabular-nums">
              {formatMoney(market.volume, { compact: true })} Vol.
            </span>
            {/* v25.19 — where the badge row used to be. Community markets say
                so, because that IS information; "Global" on a feed market is a
                constant and says nothing. */}
            <span className="min-w-0 truncate">
              · {market.source === 'callit' ? 'Community' : categoryLabel(market.category, categories)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {/* v25.40 — copy this market's link without opening it. The footer
                is the only place on a card this fits: the head block is icon +
                question + gauge with no slack, and an overlay in the corner
                would land on the gauge. `interactive` gates it because a
                non-interactive card is a preview (the create form's), and its
                market may not exist yet. */}
            {interactive && (
              <ShareButton
                url={marketUrl(market.id)}
                title={market.question}
                text={market.question}
                label="Copy market link"
                copiedMessage="Market link copied."
              />
            )}
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
          </span>
        </div>
      </div>

    </motion.div>
  );
}

/**
 * Memoised on purpose. A grid renders 20+ of these, and the 60s odds beat
 * re-runs the page's filters and sorts; without this, every card re-rendered
 * on every tick even when its own market object was untouched. Pairs with
 * `mapStable` in the store, which is what keeps `market` referentially
 * stable when nothing moved — one without the other buys nothing.
 */
export default memo(MarketCard);
