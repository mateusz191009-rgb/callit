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
  type LucideIcon,
} from 'lucide-react';
import { BaseballIcon, BasketballIcon } from '@/components/icons';
import type { Category, EventGroup, Market, Side } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import { formatMoney, formatPercent, isInPlay, isMarketClosed, shortSideLabel } from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { startNavProgressTo } from '@/lib/navProgress';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import SourceBadge from './SourceBadge';
import Countdown, { LiveBadge } from '@/components/common/Countdown';

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
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
 * Compress an outcome question into a short display name:
 * "Will Real Madrid win the 2026/27 Champions League?" -> "Real Madrid".
 * Fallback only — Gamma's `shortName` (groupItemTitle) wins when present.
 */
function heuristicOutcomeName(question: string): string {
  let s = question.replace(/\?+\s*$/, '').trim();
  s = s.replace(/^will\s+(the\s+)?/i, '');
  const lower = s.toLowerCase();
  for (const sep of [
    ' win ',
    ' be the next ',
    ' be the ',
    ' be ',
    ' become ',
    ' release ',
    ' reach ',
    ' hit ',
    ' play ',
  ]) {
    const i = lower.indexOf(sep);
    if (i > 0) {
      s = s.slice(0, i);
      break;
    }
  }
  return s.trim() || question;
}

/**
 * Short display label for a single outcome market: the event-provided
 * `shortName` when present, otherwise the question heuristic. For a whole
 * displayed set use `outcomeLabels` — it also resolves duplicate labels.
 */
export function shortOutcomeName(market: Market): string {
  return market.shortName?.trim() || heuristicOutcomeName(market.question);
}

/**
 * Labels for a displayed set of outcome markets, keyed by market id.
 * When two outcomes in the set collapse to the same label (e.g. three
 * player-prop markets all reduced to "LeBron James"), those fall back to
 * the full question so the rows stay distinguishable.
 */
export function outcomeLabels(markets: Market[]): Map<string, string> {
  const labels = markets.map(shortOutcomeName);
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const byId = new Map<string, string>();
  markets.forEach((m, i) => {
    byId.set(m.id, (counts.get(labels[i]) ?? 0) > 1 ? m.question : labels[i]);
  });
  return byId;
}

/** Event/market avatar: remote icon when present (with graceful onError
 *  fallback), category squircle otherwise — mirrors MarketIcon. */
export function EventIcon({
  icon,
  category,
  className,
}: {
  icon?: string;
  category: Category;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (icon && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-lg object-cover', className)}
      />
    );
  }
  const Icon = CATEGORY_ICONS[category] ?? Sparkles;
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg bg-green/10 text-green',
        className
      )}
      aria-hidden
    >
      <Icon className="h-[55%] w-[55%]" />
    </span>
  );
}

function OutcomeRow({
  market,
  label,
  onTrade,
}: {
  market: Market;
  label: string;
  onTrade: (marketId: string, side: Side) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tx-sec">
        {label}
      </span>
      <span className="shrink-0 text-[13px] font-bold text-tx tabular-nums">
        {formatPercent(market.yesPrice)}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="yes-tint"
          size="sm"
          className="h-7 rounded-lg px-2.5 text-[11px]"
          onClick={(e) => {
            e.stopPropagation();
            onTrade(market.id, 'yes');
          }}
        >
          {shortSideLabel(market, 'yes')}
        </Button>
        <Button
          variant="no-tint"
          size="sm"
          className="h-7 rounded-lg px-2.5 text-[11px]"
          onClick={(e) => {
            e.stopPropagation();
            onTrade(market.id, 'no');
          }}
        >
          {shortSideLabel(market, 'no')}
        </Button>
      </div>
    </div>
  );
}

/** Polymarket-style multi-outcome event card for the home grid. */
export default function EventCard({ event }: { event: EventGroup }) {
  const router = useRouter();
  const openTradeModal = useCallitStore((s) => s.openTradeModal);

  const href = `/event/${event.id}`;
  // v13 — a GAME leads with its first section (the Moneyline: feed order is
  // section-coherent), not the three highest prices in the whole event,
  // which would interleave unrelated spreads/totals/props rows. Events
  // without sections keep the price-sorted top-3 exactly as before.
  const isGame = Boolean(event.groups && event.groups.length > 0);
  const top = isGame
    ? event.groups![0].markets.slice(0, 3)
    : [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 3);
  const labels = outcomeLabels(top);
  const more = event.markets.length - top.length;
  // v16 — a game's endDate is the KICKOFF: before it, count down to the
  // start; while any outcome is in play, show the LIVE chip instead.
  const gameStart = isGame ? event.markets.find((m) => m.startTime)?.startTime : undefined;
  const live = isGame && event.markets.some((m) => isInPlay(m));

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={() => {
        startNavProgressTo(href);
        router.push(href);
      }}
      className="glow-hover liquid-border flex h-full cursor-pointer flex-col rounded-2xl border border-line bg-surface-2 p-4"
    >
      {/* Head: icon + badges + title */}
      <div className="mb-3 flex items-start gap-2.5">
        <EventIcon icon={event.icon} category={event.category} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{categoryLabel(event.category)}</Badge>
            <SourceBadge source="polymarket" />
          </div>
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="line-clamp-2 text-[15px] font-bold leading-snug text-tx"
          >
            {event.title}
          </Link>
        </div>
      </div>

      {/* Top-3 outcomes */}
      <div className="flex flex-col gap-1.5">
        {top.map((m) => (
          <OutcomeRow
            key={m.id}
            market={m}
            label={labels.get(m.id) ?? m.question}
            onTrade={openTradeModal}
          />
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-3">
        {more > 0 && (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-bold text-tx-mut transition-colors hover:text-tx"
          >
            {/* On a game the hidden rows are spreads/totals/props — "markets"
                is what they are; "outcomes" stays for ranked questions. */}
            {isGame
              ? `+${more} more market${more === 1 ? '' : 's'}`
              : `+${more} more outcome${more === 1 ? '' : 's'}`}
          </Link>
        )}

        {/* Footer: volume + countdown */}
        <div className="flex items-center justify-between text-xs text-tx-mut">
          <span className="tabular-nums">
            {formatMoney(event.volume, { compact: true })} Vol.
          </span>
          {/* The source decides, not endDate: on a game event that date is
              the kickoff, so "Ended" would sit next to working Yes/No
              buttons. The event is open while any outcome still is. */}
          {live ? (
            <LiveBadge />
          ) : (
            <Countdown
              endDate={event.endDate}
              startsAt={gameStart}
              open={event.markets.some((m) => !isMarketClosed(m))}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
