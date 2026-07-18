'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { EventGroup, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import { formatCents, formatMoney, isInPlay, isMarketClosed, shortSideLabel } from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Button, { buttonClasses } from '@/components/ui/button';
import Countdown, { LiveBadge } from '@/components/common/Countdown';
import MultiOutcomeChart, { CHART_COLORS } from './MultiOutcomeChart';
import ProbabilityGauge from './ProbabilityGauge';
import { EventIcon, outcomeLabels } from './EventCard';

function SlideControls({
  onPrev,
  onNext,
}: {
  onPrev: () => void;
  onNext: () => void;
}) {
  const cls =
    'grid h-7 w-7 place-items-center rounded-lg border border-line bg-surface-3/70 ' +
    'text-tx-sec transition-colors hover:border-line-strong hover:text-tx';
  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-1">
      <button type="button" aria-label="Previous" onClick={onPrev} className={cls}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" aria-label="Next" onClick={onNext} className={cls}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function Dots({
  count,
  active,
  onSelect,
}: {
  count: number;
  active: number;
  onSelect: (i: number) => void;
}) {
  if (count < 2) return null;
  return (
    <div className="mt-4 flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Go to slide ${i + 1}`}
          aria-current={i === active}
          onClick={() => onSelect(i)}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i === active ? 'w-6 bg-green' : 'w-3 bg-line hover:bg-line-strong'
          )}
        />
      ))}
    </div>
  );
}

function FeaturedEventSlide({ event }: { event: EventGroup }) {
  const openTradeModal = useCallitStore((s) => s.openTradeModal);
  const outcomes = [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 4);
  const labels = outcomeLabels(outcomes);
  const series = outcomes.map((m, i) => ({
    name: labels.get(m.id) ?? m.question,
    color: CHART_COLORS[i % CHART_COLORS.length],
    history: m.priceHistory,
  }));

  return (
    <motion.div
      key={event.id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-1 flex-col"
    >
      {/* Head */}
      <div className="mb-4 flex items-start gap-3 pr-16">
        <EventIcon icon={event.icon} category={event.category} className="h-11 w-11" />
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{categoryLabel(event.category)}</Badge>
            <Badge variant="green">Featured</Badge>
          </div>
          <Link
            href={`/event/${event.id}`}
            className="line-clamp-2 text-2xl font-black leading-tight tracking-tight text-tx transition-colors hover:text-green"
          >
            {event.title}
          </Link>
        </div>
      </div>

      {/* Legend rows */}
      <div className="mb-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {outcomes.map((m, i) => (
          <div key={m.id} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tx-sec">
              {labels.get(m.id) ?? m.question}
            </span>
            <span className="shrink-0 text-[13px] font-bold text-tx tabular-nums">
              {formatCents(m.yesPrice)}
            </span>
            <Button
              variant="yes-tint"
              size="sm"
              className="h-6 rounded-md px-2 text-[10px]"
              onClick={() => openTradeModal(m.id, 'yes')}
            >
              {shortSideLabel(m, 'yes')}
            </Button>
          </div>
        ))}
      </div>

      <MultiOutcomeChart series={series} height={220} />

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tx-mut">
        <span className="tabular-nums">
          {formatMoney(event.volume, { compact: true })} Vol.
        </span>
        {/* Open while any outcome is still open — the source decides, not
            the (kickoff/placeholder) endDate. v16: games count down to the
            kickoff pre-start and show LIVE while playing. */}
        {event.groups && event.markets.some((m) => isInPlay(m)) ? (
          <LiveBadge />
        ) : (
          <Countdown
            endDate={event.endDate}
            startsAt={event.groups ? event.markets.find((m) => m.startTime)?.startTime : undefined}
            open={event.markets.some((m) => !isMarketClosed(m))}
          />
        )}
        <Link
          href={`/event/${event.id}`}
          className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-green transition-colors hover:text-tx"
        >
          Trade event
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </motion.div>
  );
}

/** Fallback slide when no events are available — a top binary market. */
function FeaturedMarketSlide({ market }: { market: Market }) {
  const openTradeModal = useCallitStore((s) => s.openTradeModal);

  return (
    <motion.div
      key={market.id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="flex flex-1 flex-col"
    >
      <div className="mb-4 flex items-start gap-3 pr-16">
        <EventIcon icon={market.icon} category={market.category} className="h-11 w-11" />
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{categoryLabel(market.category)}</Badge>
            <Badge variant="green">Featured</Badge>
          </div>
          <Link
            href={`/market/${market.id}`}
            className="line-clamp-2 text-2xl font-black leading-tight tracking-tight text-tx transition-colors hover:text-green"
          >
            {market.question}
          </Link>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 sm:flex-row">
        <ProbabilityGauge
          value={market.yesPrice}
          size={148}
          label={`${shortSideLabel(market, 'yes')} probability`}
        />
        <div className="grid w-full gap-2 sm:max-w-xs">
          <Button
            variant="yes-tint"
            size="lg"
            className="w-full font-extrabold tabular-nums"
            onClick={() => openTradeModal(market.id, 'yes')}
          >
            {shortSideLabel(market, 'yes')} {formatCents(market.yesPrice)}
          </Button>
          <Button
            variant="no-tint"
            size="lg"
            className="w-full font-extrabold tabular-nums"
            onClick={() => openTradeModal(market.id, 'no')}
          >
            {shortSideLabel(market, 'no')} {formatCents(1 - market.yesPrice)}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tx-mut">
        <span className="tabular-nums">
          {formatMoney(market.volume, { compact: true })} Vol.
        </span>
        {isInPlay(market) ? (
          <LiveBadge />
        ) : (
          <Countdown
            endDate={market.endDate}
            startsAt={market.groupId ? market.startTime : undefined}
            open={!isMarketClosed(market)}
          />
        )}
        <Link
          href={`/market/${market.id}`}
          className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-green transition-colors hover:text-tx"
        >
          Trade market
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </motion.div>
  );
}

/**
 * Polymarket-style home hero: auto-rotating featured event (multi-line
 * outcome chart) on the left, brand card + trending list on the right.
 */
export default function FeaturedHero({
  events,
  markets,
}: {
  events: EventGroup[];
  markets: Market[];
}) {
  const featuredEvents = useMemo(
    () => [...events].sort((a, b) => b.volume - a.volume).slice(0, 5),
    [events]
  );
  const trending = useMemo(
    () =>
      markets
        .filter((m) => m.status === 'open')
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 5),
    [markets]
  );

  const eventsMode = featuredEvents.length > 0;
  const count = eventsMode ? featuredEvents.length : trending.length;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const active = count > 0 ? index % count : 0;

  useEffect(() => {
    if (paused || count < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), 8000);
    return () => clearInterval(id);
  }, [paused, count]);

  const prev = () => setIndex((i) => (i - 1 + count) % count);
  const next = () => setIndex((i) => (i + 1) % count);

  return (
    // grid-cols-1 gives the mobile track a 0 minimum so the recharts SVG
    // can't lock the column to its intrinsic width and clip the viewport.
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Featured panel */}
      <section
        aria-label="Featured events"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="hero-glow relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-2 p-5 sm:p-6"
      >
        {count > 1 && <SlideControls onPrev={prev} onNext={next} />}

        {count === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-tx-mut">
            No markets available yet.
          </div>
        ) : eventsMode ? (
          <FeaturedEventSlide event={featuredEvents[active]} />
        ) : (
          <FeaturedMarketSlide market={trending[active]} />
        )}

        <Dots count={count} active={active} onSelect={setIndex} />
      </section>

      {/* Right rail */}
      <div className="flex flex-col gap-4">
        {/* Brand card */}
        <div className="hero-glow rounded-2xl border border-line bg-surface-2 p-5">
          <h1 className="text-[26px] font-black leading-[1.1] tracking-tight text-tx">
            Make the call.
            <br />
            Make the <span className="text-green">market</span>.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-tx-sec">
            Trade real-world events — or launch your own market in seconds. No
            permission needed.
          </p>
          <Link
            href="/create"
            className={buttonClasses('primary', 'md', 'glow-green mt-4 w-full')}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Create a market
          </Link>
        </div>

        {/* Trending list */}
        <div className="flex-1 rounded-2xl border border-line bg-surface-2 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-tx-mut">
            Trending now
          </h2>
          <div className="mt-3 space-y-1">
            {trending.map((m, i) => (
              <Link
                key={m.id}
                href={`/market/${m.id}`}
                className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-3"
              >
                <span className="w-4 shrink-0 text-center text-xs font-black text-tx-mut tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tx-sec">
                  {m.question}
                </span>
                <span className="shrink-0 text-xs font-bold text-green tabular-nums">
                  {shortSideLabel(m, 'yes')} {formatCents(m.yesPrice)}
                </span>
              </Link>
            ))}
            {trending.length === 0 && (
              <p className="text-sm text-tx-mut">No markets yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
