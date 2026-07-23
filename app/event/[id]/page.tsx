'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BarChart3, Clock, LineChart, SearchX } from 'lucide-react';
import type { Market, MarketGroup, Side } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import {
  formatCents,
  formatDate,
  formatMoney,
  formatPercent,
  isInPlay,
  isMarketClosed,
  isSourceResolved,
  shortSideLabel,
  sideLabel,
} from '@/lib/format';
import { useEvents } from '@/lib/useMarkets';
import { useScore } from '@/lib/useScores';
import { useCallitStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import SourceBadge from '@/components/markets/SourceBadge';
import MultiOutcomeChart, { CHART_COLORS } from '@/components/markets/MultiOutcomeChart';
import { EventIcon, outcomeLabels } from '@/components/markets/EventCard';
import { GameHeader, LiveStatsPanel } from '@/components/markets/GameStats';
import TradePanel from '@/components/trading/TradePanel';
import EmptyState from '@/components/common/EmptyState';
import Countdown, { LiveBadge } from '@/components/common/Countdown';

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:space-y-0">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <Skeleton className="h-14 w-14 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-9 w-3/4" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <Skeleton className="h-[340px] w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <div className="space-y-4 self-start">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function OutcomeRow({
  market,
  label,
  color,
  selected,
  onSelect,
  onTrade,
}: {
  market: Market;
  label: string;
  color?: string;
  selected: boolean;
  onSelect: (marketId: string) => void;
  onTrade: (marketId: string, side: Side) => void;
}) {
  const resolved = market.status === 'resolved';
  const outcome = market.resolvedOutcome ?? 'yes';
  // v23.6 — an early-resolved feed outcome (v23.5 keeps it: Wembanyama
  // announced as the 2K27 cover at 100% while the event runs on) SAYS SO
  // instead of showing two dead buttons. Its side is its settled price.
  const sourceResolved = !resolved && isSourceResolved(market);
  const sourceOutcome: Side = market.yesPrice >= 0.5 ? 'yes' : 'no';
  // Page renders only after hydration + poly load, so Date.now() is safe.
  //
  // v7 — the SOURCE decides. `endDate` on a game sub-market is the KICKOFF, so
  // the old date check disabled Yes/No on every row of a match that was being
  // played. `isMarketClosed` mirrors the server's trade gate exactly.
  const tradingClosed = !resolved && isMarketClosed(market);

  const settled = resolved || sourceResolved;
  const settledSide: Side = resolved ? outcome : sourceOutcome;

  // Polymarket-style row: name (+ volume) | big % chance | fixed-width
  // Yes/No column. The fixed column is what makes the list read as a table —
  // every button edge lines up. Below `sm` the buttons drop to their own
  // full-width line so the outcome name never gets crushed.
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Select outcome: ${label}`}
      onClick={() => onSelect(market.id)}
      onKeyDown={(e) => {
        // Ignore keys bubbling up from the nested link/buttons.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(market.id);
        }
      }}
      className={cn(
        'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2.5 rounded-lg px-3 py-3 transition-colors',
        selected ? 'bg-green/[0.06]' : 'hover:bg-surface-3/40'
      )}
    >
      {color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/market/${market.id}`}
          onClick={(e) => e.stopPropagation()}
          className="block truncate text-sm font-bold text-tx transition-colors hover:text-green"
          title={market.question}
        >
          {label}
        </Link>
        {market.volume > 0 && (
          <span className="text-[11px] font-semibold text-tx-mut tabular-nums">
            {formatMoney(market.volume, { compact: true })} Vol.
          </span>
        )}
      </div>
      <span className="shrink-0 text-xl font-black text-tx tabular-nums sm:w-14 sm:text-right">
        {formatPercent(market.yesPrice)}
      </span>
      {settled ? (
        <div className="flex w-full justify-end sm:w-[196px] sm:shrink-0">
          <Badge variant={settledSide === 'yes' ? 'green' : 'sky'}>
            Resolved — {sideLabel(market, settledSide)}
          </Badge>
        </div>
      ) : (
        // Real side names + prices ('Over 90¢' / 'Under 10¢', 'ENG 55¢') —
        // an O/U or spread row is meaningless as bare Yes/No.
        <div className="flex w-full shrink-0 gap-1.5 sm:w-[196px]">
          <Button
            variant="yes-tint"
            size="sm"
            disabled={tradingClosed}
            className="flex-1 overflow-hidden px-1 tabular-nums"
            onClick={(e) => {
              e.stopPropagation();
              onTrade(market.id, 'yes');
            }}
          >
            {shortSideLabel(market, 'yes')} {formatCents(market.yesPrice)}
          </Button>
          <Button
            variant="no-tint"
            size="sm"
            disabled={tradingClosed}
            className="flex-1 overflow-hidden px-1 tabular-nums"
            onClick={(e) => {
              e.stopPropagation();
              onTrade(market.id, 'no');
            }}
          >
            {shortSideLabel(market, 'no')} {formatCents(1 - market.yesPrice)}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => decodeURIComponent(params?.id ?? ''), [params?.id]);

  const { events, loading } = useEvents();
  const openTradeModal = useCallitStore((s) => s.openTradeModal);

  // Direct-trading rail: which outcome the sticky TradePanel shows and
  // which side it opens on (preset by the rows' Yes/No mini buttons).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelSide, setPanelSide] = useState<Side>('yes');
  // v21 — Market | Live stats toggle. `null` = not chosen yet; the default
  // is resolved below (live match -> stats, otherwise the market chart).
  const [view, setView] = useState<'market' | 'stats' | null>(null);

  const event = events.find((e) => e.id === id);
  // v21 — ESPN live score for this game (shared 45s poll; undefined when
  // the game isn't on a scoreboard or hasn't been matched).
  const score = useScore(event?.id);

  if (!event) {
    if (loading) return <DetailSkeleton />;
    return (
      <div className="space-y-6">
        <EmptyState
          icon={SearchX}
          title="Event not found"
          description="This event may have been removed, or the link is wrong."
          actionLabel="Back to markets"
          actionHref="/"
        />
      </div>
    );
  }

  // v6 SECTIONS (v7 — finally wired to the UI). A game event ships ~45
  // sub-markets across Spreads / Totals / Team Totals / …; the feed already
  // labels and groups them, but this page used to ignore `event.groups` and
  // render ONE price-sorted list — Moneyline, spreads and totals interleaved
  // into a flat pile of unrelated Yes/No rows. When `groups` is present we
  // render one section per group IN FEED ORDER (which is section-coherent);
  // price order is meaningless across sections and is what caused the pile.
  // Events without sections (a real multi-outcome question like "World Cup
  // Winner") keep the flat, price-sorted list exactly as before.
  const groups: MarketGroup[] | null =
    event.groups && event.groups.length > 0 ? event.groups : null;

  const outcomes = groups
    ? groups.flatMap((g) => g.markets)
    : [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice);

  // Labels are resolved PER SECTION so `outcomeLabels`' duplicate-collapsing
  // stays scoped to the rows the user compares side by side; the section
  // heading disambiguates the rest ("England (-1.5)" under Spreads).
  const labels = groups
    ? new Map(groups.flatMap((g) => [...outcomeLabels(g.markets)]))
    : outcomeLabels(outcomes);

  // The chart tracks the FIRST section (the headline line — Moneyline when the
  // event has one) rather than the four highest prices in the whole event,
  // which on a game would plot four unrelated bets against each other.
  const charted = (groups ? groups[0].markets : outcomes).slice(0, 4);
  const chartTitle = groups ? `${groups[0].label} probabilities` : 'Outcome probabilities';
  const colorById = new Map(
    charted.map((m, i) => [m.id, CHART_COLORS[i % CHART_COLORS.length]])
  );
  const series = charted.map((m) => ({
    name: labels.get(m.id) ?? m.question,
    color: colorById.get(m.id) as string,
    history: m.priceHistory,
    // Legend chips show the live % next to each name, Polymarket-style.
    current: m.yesPrice,
  }));

  // Sticky-panel outcome — the frontrunner (highest yesPrice), or on a grouped
  // event the first row of the first section. v23.6 — skip rows the source
  // already closed (the kept resolved winner tops the sort at 100%): the
  // panel's default should be something the user can actually trade.
  const selectedOutcome =
    outcomes.find((m) => m.id === selectedId) ??
    outcomes.find((m) => !isMarketClosed(m)) ??
    outcomes[0];
  const selectedLabel = labels.get(selectedOutcome.id) ?? selectedOutcome.question;

  // The event's own end date is the same upstream placeholder/kickoff its
  // markets carry, so ask the markets whether anything is still tradeable.
  const eventOpen = outcomes.some((m) => !isMarketClosed(m));
  // v16 — game events: count down to kickoff pre-start, LIVE while playing.
  const gameStart = groups ? outcomes.find((m) => m.startTime)?.startTime : undefined;
  // v22 — ESPN outranks the heuristic when it has the game ('post' = final
  // whistle, 'pre' = delayed kickoff; both mean NOT live), and the
  // provider's own ended flag (esports) retires the badge the same way.
  const inPlayNow = outcomes.some((m) => isInPlay(m));
  const liveNow = score ? score.state === 'in' && inPlayNow : inPlayNow;
  const gameEnded =
    !liveNow &&
    (score?.state === 'post' || outcomes.some((m) => m.sourceEnded === true));

  // v21 — the Polymarket-style match header + Market|Live stats toggle,
  // games with a known two-team roster only. Default view: the live match
  // opens on its stats, everything else on the market chart.
  const isMatch = Boolean(groups && event.teams && event.teams.length >= 2);
  // v23.2 — the toggle exists only when there is real content behind it
  // (owner: "leere live stats machen keinen sinn" — esports first, then
  // WTA): a goal timeline, a per-period/per-set line score (ESPN innings,
  // gammaScoreOf tennis sets), or a running soccer clock. A bare
  // score-and-status match keeps its numbers in the header alone.
  const hasStatsView =
    isMatch &&
    Boolean(
      score &&
        score.state !== 'pre' &&
        ((score.goals?.length ?? 0) > 0 ||
          (score.home.linescores?.length ?? 0) > 0 ||
          (score.away.linescores?.length ?? 0) > 0 ||
          score.regulation !== undefined)
    );
  const activeView =
    view ?? (hasStatsView && score && score.state === 'in' ? 'stats' : 'market');

  // The right rail only exists on lg+; below that the Yes/No mini buttons
  // keep opening the trade modal exactly as before.
  const isDesktop = () =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

  const handleSelect = (marketId: string) => {
    setSelectedId(marketId);
    setPanelSide('yes');
  };

  const handleTrade = (marketId: string, side: Side) => {
    if (isDesktop()) {
      setSelectedId(marketId);
      setPanelSide(side);
    } else {
      openTradeModal(marketId, side);
    }
  };

  // Polymarket-style meta line — the ONE place volume / end date / size live.
  // Replaces the old stats strip AND the right-rail "Event stats" card, which
  // between them said Volume twice, Ends twice and Markets twice.
  const metaLine = (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-semibold text-tx-mut">
      <span className="tabular-nums">
        {formatMoney(event.volume, { compact: true })} Vol.
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {formatDate(event.endDate)}
      </span>
      <span aria-hidden>·</span>
      <span>
        {outcomes.length} {groups ? 'markets' : 'outcomes'}
      </span>
      <span className="hidden sm:inline" aria-hidden>
        ·
      </span>
      <span className="hidden sm:inline">Chainlink Oracle</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* v22 — back leads UP one level (the event's category hub), not to
          home (owner: "zurück in die kategorie … nicht auf home"). */}
      <Link
        href={`/category/${event.category}`}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-tx-sec transition-colors hover:text-tx"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {categoryLabel(event.category)}
      </Link>

      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:space-y-0">
        {/* Left column */}
        <div className="min-w-0 space-y-6">
          {/* Header — a match renders the flags scoreboard, everything else
              keeps the icon + title block. */}
          {isMatch ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{categoryLabel(event.category)}</Badge>
                <SourceBadge source="polymarket" />
                {liveNow ? (
                  <LiveBadge />
                ) : gameEnded ? (
                  <span className="text-xs font-bold text-tx-mut">Ended</span>
                ) : (
                  <Countdown
                    endDate={event.endDate}
                    startsAt={gameStart}
                    open={eventOpen}
                    className="text-xs text-tx-sec"
                  />
                )}
              </div>
              <h1 className="sr-only">{event.title}</h1>
              <GameHeader event={event} score={score} kickoff={gameStart} />
              {metaLine}
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <EventIcon
                icon={event.icon}
                category={event.category}
                className="h-14 w-14 rounded-xl"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">{categoryLabel(event.category)}</Badge>
                  <SourceBadge source="polymarket" />
                  {liveNow ? (
                    <LiveBadge />
                  ) : gameEnded ? (
                    <span className="text-xs font-bold text-tx-mut">Ended</span>
                  ) : (
                    <Countdown
                      endDate={event.endDate}
                      startsAt={gameStart}
                      open={eventOpen}
                      className="text-xs text-tx-sec"
                    />
                  )}
                </div>
                <h1 className="text-2xl font-black leading-tight tracking-tight text-tx sm:text-3xl">
                  {event.title}
                </h1>
                {metaLine}
              </div>
            </div>
          )}

          {/* v21 — Market | Live stats toggle (matches only) */}
          {hasStatsView && (
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
                <button
                  type="button"
                  onClick={() => setView('market')}
                  aria-pressed={activeView === 'market'}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                    activeView === 'market'
                      ? 'bg-surface-3 text-tx'
                      : 'text-tx-mut hover:text-tx'
                  )}
                >
                  <LineChart className="h-3.5 w-3.5" aria-hidden />
                  Market
                </button>
                <button
                  type="button"
                  onClick={() => setView('stats')}
                  aria-pressed={activeView === 'stats'}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                    activeView === 'stats'
                      ? 'bg-surface-3 text-tx'
                      : 'text-tx-mut hover:text-tx'
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                  Live stats
                </button>
              </div>
            </div>
          )}

          {/* Chart or live stats. The chart sits FLAT on the page — the card
              border around it (and around the list below) is what made the
              old layout feel boxed-in next to Polymarket. */}
          {hasStatsView && activeView === 'stats' ? (
            <LiveStatsPanel score={score} />
          ) : (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="text-xs font-bold uppercase tracking-wide text-tx-mut">
                  {chartTitle}
                </span>
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                  {series.map((s) => (
                    <span
                      key={s.name}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-tx-sec"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                        aria-hidden
                      />
                      <span className="max-w-[140px] truncate">{s.name}</span>
                      <span className="text-tx tabular-nums">
                        {formatPercent(s.current)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <MultiOutcomeChart series={series} height={300} showRange />
            </div>
          )}

          {/* Outcomes — a flat Polymarket-style table: one column header,
              hairline dividers, section labels on games. No per-section card
              chrome — that's what made the old list read as clutter. */}
          <div className="-mx-3">
            <div className="flex items-center gap-x-3 border-b border-line px-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-tx-mut">
              <span className="min-w-0 flex-1">Outcome</span>
              <span className="shrink-0">% Chance</span>
              <div className="hidden w-[196px] sm:block" aria-hidden />
            </div>
            {groups ? (
              <div className="mt-1 space-y-5">
                {groups.map((g) => (
                  <section key={g.id}>
                    <div className="flex items-baseline justify-between gap-3 px-3 pb-1 pt-2">
                      <h2 className="text-xs font-bold uppercase tracking-wide text-tx-sec">
                        {g.label}
                      </h2>
                      <span className="shrink-0 text-[11px] font-bold text-tx-mut tabular-nums">
                        {g.markets.length}
                      </span>
                    </div>
                    <div className="divide-y divide-line/50">
                      {g.markets.map((m) => (
                        <OutcomeRow
                          key={m.id}
                          market={m}
                          label={labels.get(m.id) ?? m.question}
                          color={colorById.get(m.id)}
                          selected={m.id === selectedOutcome.id}
                          onSelect={handleSelect}
                          onTrade={handleTrade}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="mt-1 divide-y divide-line/50">
                {outcomes.map((m) => (
                  <OutcomeRow
                    key={m.id}
                    market={m}
                    label={labels.get(m.id) ?? m.question}
                    color={colorById.get(m.id)}
                    selected={m.id === selectedOutcome.id}
                    onSelect={handleSelect}
                    onTrade={handleTrade}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4 self-start lg:sticky lg:top-20">
          {/* Direct trading — desktop rail only; below lg the outcome rows'
              Yes/No buttons open the trade modal instead */}
          <div className="hidden lg:block">
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
                <h2 className="shrink-0 text-xs font-bold uppercase tracking-wide text-tx-mut">
                  Place your call
                </h2>
                <span
                  className="min-w-0 truncate text-sm font-extrabold text-tx"
                  title={selectedOutcome.question}
                >
                  {selectedLabel}
                </span>
              </div>
              <TradePanel
                key={selectedOutcome.id + panelSide}
                market={selectedOutcome}
                defaultSide={panelSide}
                variant="modal"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
