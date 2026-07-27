'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { EventGroup, Market } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import {
  formatCents,
  formatMoney,
  formatNoCents,
  formatPercent,
  isInPlay,
  isMarketClosed,
  isNewListing,
  shortSideLabel,
  trendingScore,
} from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { avatarClass } from '@/lib/useActivity';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import { mockCommentsFor } from '@/components/social/MarketChat';
import Countdown, { LiveBadge } from '@/components/common/Countdown';
import { CHART_COLORS } from './chartTokens';
import ProbabilityGauge from './ProbabilityGauge';
import { EventIcon, outcomeLabels } from './EventCard';

/**
 * Lazy: this component is rendered by the home page, and a static import
 * put recharts (~90-110 KB gzipped, plus its d3 dependencies) into the
 * first-load JS of the LCP route. The palette comes from `./chartTokens`
 * instead of from the chart module, so importing it costs nothing.
 *
 * v25.26 — via EventOutcomeChart, which draws the source's real history and
 * keeps the same dynamic import behind it (and reserves the height, so
 * nothing shifts when the chunk lands).
 */
const EventOutcomeChart = dynamic(() => import('./EventOutcomeChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[210px] w-full rounded-xl" />,
});

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
  const outcomes = [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 4);
  const labels = outcomeLabels(outcomes);
  const series = outcomes.map((m, i) => ({
    name: labels.get(m.id) ?? m.question,
    color: CHART_COLORS[i % CHART_COLORS.length],
    history: m.priceHistory,
  }));

  // v24.2 — Polymarket-style comment teaser under the outcome list: the
  // frontrunner market's thread (same deterministic seeds as its market
  // page, plus anything really posted there). v24.3: the WHOLE thread —
  // the teaser is now a credits-roll ticker, not a newest-two snapshot.
  const topId = outcomes[0]?.id ?? '';
  const posted = useCallitStore((s) => s.chat[topId]);
  const comments = useMemo(
    () => [
      ...mockCommentsFor(topId).map((c) => ({
        id: c.id,
        author: c.author,
        text: c.text,
      })),
      ...(posted ?? []),
    ],
    [topId, posted]
  );

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
            {/* v24.3 — fresh listings get the Polymarket-style New badge.
                Never on games: a match is always "listed" days before
                kickoff, so the badge would be permanent noise there. */}
            {!event.groups?.length && isNewListing(event.createdAt) && (
              <Badge variant="sky">
                <Sparkles className="h-3 w-3" aria-hidden />
                New
              </Badge>
            )}
          </div>
          <Link
            href={`/event/${event.id}`}
            className="line-clamp-2 text-2xl font-black leading-tight tracking-tight text-tx transition-colors hover:text-tx"
          >
            {event.title}
          </Link>
        </div>
      </div>

      {/* Polymarket-style body: ranked outcomes with big % on the left,
          the multi-line chart (legend chips + live %) on the right. */}
      <div className="grid flex-1 items-center gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <div className="divide-y divide-line/60">
            {outcomes.map((m, i) => (
              <Link
                key={m.id}
                href={`/market/${m.id}`}
                className="group flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-tx-sec transition-colors group-hover:text-tx">
                  {labels.get(m.id) ?? m.question}
                </span>
                <span className="shrink-0 text-xl font-black text-tx tabular-nums">
                  {formatPercent(m.yesPrice)}
                </span>
              </Link>
            ))}
          </div>

          {/* Comment ticker — the frontrunner's thread rolls slowly upward
              and fades out at the top, Polymarket-style (v24.3). The track
              holds the list twice and translates up by exactly one copy,
              so the loop is seamless; pure CSS, so it costs no timers and
              can't contend with the odds poll. Hover pauses + brightens.
              The full thread (and the composer) lives on the market page. */}
          {comments.length > 0 && (
            <Link
              href={`/market/${topId}`}
              className="group mt-3 block border-t border-line/60 pt-2.5"
            >
              <div className="hero-chat-mask h-[84px] overflow-hidden">
                <div
                  className="hero-chat-track"
                  style={{ '--chat-dur': `${comments.length * 3.5}s` } as React.CSSProperties}
                >
                  {[0, 1].map((copy) => (
                    <div key={copy} aria-hidden={copy === 1}>
                      {comments.map((c) => (
                        <div
                          key={`${copy}-${c.id}`}
                          className="flex h-7 items-center gap-2 opacity-70 transition-opacity group-hover:opacity-100"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'flex h-5 w-5 shrink-0 select-none items-center justify-center rounded-full text-nano font-bold uppercase leading-none',
                              avatarClass(c.author)
                            )}
                          >
                            {c.author.charAt(0)}
                          </span>
                          <span className="shrink-0 text-xs font-bold text-tx">
                            {c.author}
                          </span>
                          <span className="min-w-0 truncate text-xs text-tx-sec">
                            {c.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </Link>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            {series.map((s, i) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1.5 text-micro font-semibold text-tx-sec"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="max-w-[120px] truncate">{s.name}</span>
                <span className="text-tx tabular-nums">
                  {formatPercent(outcomes[i].yesPrice)}
                </span>
              </span>
            ))}
          </div>
          {/* v25.26 — the source's own history, same as the event page it
              links to. Only the active slide is mounted, so this is one
              request per rotation, served from the 60s cache after the
              first. */}
          <EventOutcomeChart
            series={series}
            ids={outcomes.map((m) => m.id)}
            height={210}
          />
        </div>
      </div>

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
            className="line-clamp-2 text-2xl font-black leading-tight tracking-tight text-tx transition-colors hover:text-tx"
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
            className="w-full font-bold tabular-nums"
            onClick={() => openTradeModal(market.id, 'yes')}
          >
            {shortSideLabel(market, 'yes')} {formatCents(market.yesPrice)}
          </Button>
          <Button
            variant="no-tint"
            size="lg"
            className="w-full font-bold tabular-nums"
            onClick={() => openTradeModal(market.id, 'no')}
          >
            {shortSideLabel(market, 'no')} {formatNoCents(market.yesPrice)}
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
 * Can this event still be traded — i.e. is it worth a hero slot at all?
 *
 * Two different "over"s, and both disqualify: the SOURCE closed the market
 * (`isMarketClosed`), or the source says the match itself is done
 * (`sourceEnded`) while the market waits on its result. The second is the one
 * that matters here — a series ends minutes before Polymarket closes its
 * book, and that window is exactly when the event's 24h volume peaks.
 */
function tradeable(event: EventGroup): boolean {
  return event.markets.some((m) => m.sourceEnded !== true && !isMarketClosed(m));
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
  /**
   * v25.19 — THE HERO IS THE TRENDING LIST'S HEAD.
   *
   * v25.18 ranked these by Gamma's `featured` flag first. That flag is real
   * editorial signal, but it made the panel disagree with the very grid under
   * it and with the rail beside it — the owner's point: "dieses hero element
   * auf home muss auch zu trending passen". One ranking now drives all three,
   * and `featured` survives only as the tie-break between two events trading
   * at the same rate.
   *
   * (What this replaced in v25.18 is still worth remembering: sorting by
   * LIFETIME volume pinned the 2028 Democratic primary, the 2028 Republican
   * primary and the 2028 presidential winner to the hero for months, on
   * $0.2-0.6M of daily trading each.)
   */
  const featuredEvents = useMemo(
    () =>
      [...events]
        .sort(
          (a, b) =>
            // v25.22 — A FINISHED GAME IS NEVER THE FRONT PAGE. 24h volume
            // peaks exactly when a match ENDS, so the ranking below kept
            // handing the hero events whose result was already known: at the
            // time of writing, the top four by `volume24hr` across the whole
            // feed were four esports series carrying `ended: true`. Nothing
            // was wrong with the score — the panel was simply advertising
            // matches nobody can trade any more. Tradeability is now the
            // first key; among tradeable events the trending order is
            // untouched.
            Number(tradeable(b)) - Number(tradeable(a)) ||
            trendingScore(b) - trendingScore(a) ||
            Number(Boolean(b.featured)) - Number(Boolean(a.featured))
        )
        .slice(0, 5),
    [events]
  );

  /**
   * The rail — trending too, and COMPLEMENTARY to the hero.
   *
   * Two bugs the owner's screenshot caught. First, it drew from `markets`
   * alone, and since v25.18 that array holds only standalone binaries: the
   * things actually topping the trending list are events, so the rail could
   * not show a single one of them. Now it ranks events and markets together,
   * exactly like the grid. Second, it showed the same question twice ("Strait
   * of Hormuz traffic returns to normal by August 31" / "…by September 30"),
   * which truncate to the identical string — near-duplicates are collapsed
   * below.
   *
   * The five events already rotating in the hero are excluded: a rail that
   * repeats the panel next to it is half a rail.
   */
  const trending = useMemo(() => {
    const inHero = new Set(featuredEvents.map((e) => e.id));
    const items = [
      ...events
        .filter((e) => !inHero.has(e.id))
        .map((e) => {
          const top = [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice)[0];
          return top
            ? {
                key: e.id,
                href: `/event/${e.id}`,
                title: e.title,
                market: top,
                score: trendingScore(e),
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
      ...markets
        .filter((m) => m.status === 'open')
        .map((m) => ({
          key: m.id,
          href: `/market/${m.id}`,
          title: m.question,
          market: m,
          score: trendingScore(m),
        })),
    ].sort((a, b) => b.score - a.score);

    // Collapse rows whose titles are identical for as far as the rail can
    // show them. Comparing the first six significant words is deliberately
    // coarser than the visible truncation, so a pair that WOULD read as
    // duplicated is dropped before it can.
    const seen = new Set<string>();
    const out: typeof items = [];
    for (const it of items) {
      const key = it.title
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6)
        .join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      // v25.30 — 10 rows, not 5. The rail is `flex-1`, so it stretches to
      // the hero's ~458px whatever it holds; five rows ended ~230px up and
      // left half the card visibly empty (owner: "diese eine lücke füllen").
      // Ten rows fill the panel with the densest content on the page.
      if (out.length === 10) break;
    }
    return out;
  }, [events, markets, featuredEvents]);

  const eventsMode = featuredEvents.length > 0;
  const count = eventsMode ? featuredEvents.length : trending.length;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const active = count > 0 ? index % count : 0;

  // Auto-rotation is motion the user did not ask for, so it honours the OS
  // setting — the framer MotionConfig covers the transitions but not the
  // timer that drives them.
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (paused || reduceMotion || count < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), 8000);
    return () => clearInterval(id);
  }, [paused, reduceMotion, count]);

  const prev = () => setIndex((i) => (i - 1 + count) % count);
  const next = () => setIndex((i) => (i + 1) % count);

  return (
    // grid-cols-1 gives the mobile track a 0 minimum so the recharts SVG
    // can't lock the column to its intrinsic width and clip the viewport.
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Featured panel */}
      <section
        aria-label="Featured events"
        // Focus pauses it too: a keyboard user tabbing through the slide's
        // links should not have the slide change under them.
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="hero-glow relative flex flex-col overflow-hidden card-surface p-5 sm:p-6"
      >
        {count > 1 && <SlideControls onPrev={prev} onNext={next} />}

        {count === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-tx-mut">
            No markets available yet.
          </div>
        ) : eventsMode ? (
          <FeaturedEventSlide event={featuredEvents[active]} />
        ) : (
          // No events at all (mock fallback / a book of nothing but binaries):
          // the panel falls back to the hottest single market.
          <FeaturedMarketSlide market={trending[active].market} />
        )}

        <Dots count={count} active={active} onSelect={setIndex} />
      </section>

      {/* Right rail */}
      <div className="flex flex-col gap-4">
        {/* Trending list */}
        <div className="flex flex-1 flex-col card-surface p-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-tx-mut">
            Trending now
          </h2>
          {/* justify-between: the rows OWN the panel's height, whatever
              the hero column measures — no more residual sliver at the
              bottom when the slide beside it runs a line taller. */}
          <div className="mt-3 flex flex-1 flex-col justify-between">
            {trending.map((t, i) => (
              <Link
                key={t.key}
                href={t.href}
                className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-3"
              >
                <span className="w-4 shrink-0 text-center text-xs font-bold text-tx-mut tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-mini font-semibold text-tx-sec">
                  {t.title}
                </span>
                <span className="shrink-0 text-xs font-bold text-green tabular-nums">
                  {shortSideLabel(t.market, 'yes')} {formatCents(t.market.yesPrice)}
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
