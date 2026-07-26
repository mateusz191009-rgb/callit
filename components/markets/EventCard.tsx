'use client';

import { useState, type CSSProperties } from 'react';
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
import type { Category, EventGroup, EventTeam, Market, Side } from '@/lib/types';
import { categoryLabel } from '@/lib/types';
import {
  formatMoney,
  formatPercent,
  isInPlay,
  isMarketClosed,
  isNewListing,
  isSourceResolved,
  liveDetailOf,
  shortSideLabel,
  sideLabel,
} from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { useScore } from '@/lib/useScores';
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

/* ------------------------------------------------------------------ */
/* v24.6 — head-to-head matchup cards (Polymarket-style card variety)   */
/* ------------------------------------------------------------------ */

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The card-worthy matchup of a game event: the MATCH moneyline (the market
 * whose question IS the event title — map/game winners carry "- Map 1
 * Winner" suffixes and never match) plus the two teams mapped onto its
 * yes/no sides. Null for anything that should keep the outcome-list card:
 * non-games, games without a team roster, three-way markets without side
 * labels, and closed moneylines (the list shows Resolved chips properly).
 */
function matchupOf(event: EventGroup): {
  ml: Market;
  yes: EventTeam;
  no: EventTeam;
} | null {
  const teams = event.teams ?? [];
  if (!event.groups?.length || teams.length < 2) return null;
  const title = normTitle(event.title);
  const ml = event.markets.find(
    (m) => m.yesLabel && m.noLabel && normTitle(m.question) === title
  );
  if (!ml || isMarketClosed(ml)) return null;
  const byLabel = (label: string) =>
    teams.find((t) => {
      const a = normTitle(t.name);
      const b = normTitle(label);
      return a === b || a.includes(b) || b.includes(a);
    });
  const yes = byLabel(ml.yesLabel!) ?? teams[0];
  const no = byLabel(ml.noLabel!) ?? teams.find((t) => t !== yes) ?? teams[1];
  if (yes === no) return null;
  return { ml, yes, no };
}

function hexRgb(hex?: string): [number, number, number] | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Polymarket-style team-tinted button paint from the team's accent color:
 * translucent fill + border, text lifted toward white so a dark team color
 * (#06039b) stays readable on the card surface, plus the stronger `-hi`
 * trio the button switches to on hover.
 *
 * These ship as custom properties consumed by `.team-btn`, NOT as inline
 * background/border/color — an inline paint outranks every stylesheet
 * hover rule, which is exactly why these buttons used to sit dead under
 * the cursor. Undefined when the team ships no usable color; the caller
 * falls back to the yes/no tints, which hover on their own.
 */
function teamTint(color?: string): CSSProperties | undefined {
  const rgb = hexRgb(color);
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  const lift = (amount: number) =>
    rgb.map((c) => Math.round(c + (255 - c) * amount)).join(', ');
  // The `-hi` pair lifts the color 25% toward white before raising the
  // alpha: a dark crest color at a higher alpha would DARKEN the button on
  // hover — a hole, not a highlight. Lifting first makes hover brighten for
  // navy (#06039b) and yellow (#FFFF00) alike.
  return {
    ['--team-fill' as string]: `rgba(${r}, ${g}, ${b}, 0.16)`,
    ['--team-fill-hi' as string]: `rgba(${lift(0.25)}, 0.3)`,
    ['--team-edge' as string]: `rgba(${r}, ${g}, ${b}, 0.45)`,
    ['--team-edge-hi' as string]: `rgba(${lift(0.25)}, 0.8)`,
    ['--team-text' as string]: `rgb(${lift(0.6)})`,
    ['--team-text-hi' as string]: `rgb(${lift(0.82)})`,
  };
}

/**
 * Hover paint for a matchup team row, handed to `.matchup-row` as custom
 * properties: a whisper of the team's own color where the neutral hover
 * surface would sit. Softer than the buy buttons' tint on purpose — the row
 * only opens the event page. The color is lifted 30% toward white first: a
 * dark crest color (#06039b) tinted straight would read as a hole in the
 * card, not a highlight. Undefined when the team ships no usable color; the
 * CSS fallbacks (surface-3 / line-strong) take over.
 */
function teamRowTint(color?: string): CSSProperties | undefined {
  const rgb = hexRgb(color);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * 0.3));
  return {
    ['--row-fill' as string]: `rgba(${r}, ${g}, ${b}, 0.14)`,
    ['--row-edge' as string]: `rgba(${r}, ${g}, ${b}, 0.42)`,
  };
}

/** Team crest with graceful fallback to a two-letter monogram chip. */
function TeamLogo({ team, className }: { team: EventTeam; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (team.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.logo}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-md object-contain', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-md bg-surface-3 text-[10px] font-black text-tx-sec',
        className
      )}
      aria-hidden
    >
      {(team.abbreviation ?? team.name).slice(0, 2).toUpperCase()}
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
      {isSourceResolved(market) ? (
        // v23.6 — an early-resolved outcome (the announced 2K27 cover at
        // 100%) says so where its Yes/No buttons would sit.
        <Badge
          variant={market.yesPrice >= 0.5 ? 'green' : 'sky'}
          className="h-7 shrink-0 rounded-lg px-2.5"
        >
          Resolved
        </Badge>
      ) : (
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
      )}
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
  // v24.6 — a two-team game with an open match moneyline renders as a
  // HEAD-TO-HEAD card (team rows + team-tinted buttons, Polymarket-style)
  // instead of the generic outcome list. Everything else keeps the list.
  const matchup = isGame ? matchupOf(event) : null;
  // v25.18 — TWO rows, not three. Owner, pointing at Polymarket's grid: "bei
  // multioutcomes nur 2 zeilen da sind siehe poly einfach an denen immer
  // orientieren". Their "Fed-Entscheidung im Juli?" card shows exactly two
  // outcomes and the rest behind the count, which is also what makes their
  // cards shorter than ours were: the third row is the one that pushed a
  // multi-outcome card past the height of a binary one, so the grid never
  // settled into an even rhythm.
  const ROWS = 2;
  const top = matchup
    ? [matchup.ml]
    : isGame
      ? event.groups![0].markets.slice(0, ROWS)
      : [...event.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, ROWS);
  const labels = outcomeLabels(top);
  const more = event.markets.length - top.length;
  // v16 — a game's endDate is the KICKOFF: before it, count down to the
  // start; while any outcome is in play, show the LIVE chip instead.
  const gameStart = isGame ? event.markets.find((m) => m.startTime)?.startTime : undefined;
  const inPlay = isGame && event.markets.some((m) => isInPlay(m));
  // v21 — ESPN live score (shared 45s poll; undefined off the scoreboard).
  const score = useScore(isGame ? event.id : undefined);
  // v22 — when ESPN has the game its state outranks the in-play heuristic:
  // 'post' kills a lingering LIVE (final whistle inside the 12h window),
  // 'pre' a premature one (delayed kickoff).
  const live = score ? score.state === 'in' && inPlay : inPlay;
  // Ended per the provider (esports carries the flag; no ESPN score to
  // show an FT line for) — say so instead of counting down to a date the
  // match no longer owns.
  const ended =
    isGame && !live && score?.state !== 'post' && event.markets.some((m) => m.sourceEnded === true);

  // Which scoreboard column a matchup row reads from. `teams` is home-first
  // (parseTeams sorts it), so the index fallback matches GameHeader's.
  const teamSide = (t: EventTeam): 'home' | 'away' =>
    t.side ?? ((event.teams ?? []).indexOf(t) === 0 ? 'home' : 'away');

  // v25.3 — a matchup card prints the score PER TEAM beside the crests, so
  // the footer must not repeat it ("2 G2 … 1 KOI" + "Final 2–1"). There the
  // footer keeps only the state — LIVE (+ period) or the source's final
  // label. Outcome-list game cards have no team rows and keep the full
  // ticker, which is the only place their score shows up.
  const rowsShowScore = Boolean(matchup && score && score.state !== 'pre');
  const liveDetail = score?.state === 'in' ? liveDetailOf(score) : undefined;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={() => {
        startNavProgressTo(href);
        router.push(href);
      }}
      // v25.18 — same one-step-down pass as MarketCard (p-4 -> p-3.5, 36px
      // avatars -> 32px, 15px text -> 14px, h-10 buttons -> h-9). The two
      // card kinds share a grid row: if only one of them tightened, the
      // mixed grid would look ragged instead of cleaner.
      className="spotlight-card flex h-full cursor-pointer flex-col rounded-2xl border border-line bg-surface-2 p-3.5 hover:border-line-strong"
    >
      {matchup ? (
        <>
          {/* Matchup head: badges only — the team rows below ARE the title,
              which stays for screen readers. */}
          <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{categoryLabel(event.category)}</Badge>
            <SourceBadge source="polymarket" />
          </div>
          <Link href={href} onClick={(e) => e.stopPropagation()} className="sr-only">
            {event.title}
          </Link>

          {/* Team rows: series score (once live) + crest + name + price.
              v25.3 — the rows are NOT buy targets: a click falls through to
              the card and opens the event page (chart + all markets), which
              is what the price readout invites. They still hover in the
              team's own color and lift the crest, so the card's biggest
              surface reads as live rather than as a static table. The
              -mx-1.5 lets the tint bleed past the text edge without
              shifting the rows' alignment with the head and footer. */}
          <div className="flex flex-1 flex-col justify-center gap-2">
            {[
              { team: matchup.yes, price: matchup.ml.yesPrice },
              { team: matchup.no, price: 1 - matchup.ml.yesPrice },
            ].map(({ team, price }) => {
              const s =
                score && score.state !== 'pre' ? score[teamSide(team)].score : undefined;
              // v25.14 — a scoreless sport (UFC) never prints its 1/0 as a
              // scoreline; the winner wears a W, the loser an empty column
              // so both rows keep their alignment.
              const other = teamSide(team) === 'home' ? 'away' : 'home';
              const won =
                score?.scoreless && s !== undefined && s > score[other].score;
              return (
                <div
                  key={team.name}
                  style={teamRowTint(team.color)}
                  className="matchup-row -mx-1.5 flex items-center gap-2 rounded-xl px-1.5 py-1"
                >
                  {s !== undefined && (
                    <span
                      className={
                        score?.scoreless
                          ? 'w-4 shrink-0 text-center text-xs font-black text-green'
                          : 'w-4 shrink-0 text-center text-sm font-black text-tx tabular-nums'
                      }
                    >
                      {score?.scoreless ? (won ? 'W' : '') : s}
                    </span>
                  )}
                  <TeamLogo team={team} className="matchup-crest h-7 w-7" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-tx">
                    {team.name}
                  </span>
                  <span className="shrink-0 text-sm font-black text-tx tabular-nums">
                    {formatPercent(price)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Team-named quick-buy buttons, tinted with the team colors.
              v25.3 — THESE are the interactive pair: the fill deepens, the
              edge goes near-solid team color and the label brightens on
              hover (see .team-btn). Teams without a color keep the yes/no
              tints, which already hover. */}
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {[
              { team: matchup.yes, side: 'yes' as Side },
              { team: matchup.no, side: 'no' as Side },
            ].map(({ team, side }) => {
              const tint = teamTint(team.color);
              return (
                <Button
                  key={side}
                  variant={tint ? 'team-tint' : side === 'yes' ? 'yes-tint' : 'no-tint'}
                  size="sm"
                  style={tint}
                  className="h-9 min-w-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    openTradeModal(matchup.ml.id, side);
                  }}
                >
                  <span className="truncate">{sideLabel(matchup.ml, side)}</span>
                </Button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Head: icon + badges + title */}
          <div className="mb-2.5 flex items-start gap-2">
            <EventIcon icon={event.icon} category={event.category} className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="neutral">{categoryLabel(event.category)}</Badge>
                <SourceBadge source="polymarket" />
                {/* v24.3 — freshly listed event. Never on games: a match is
                    always "listed" days before kickoff (see isNewListing). */}
                {!isGame && isNewListing(event.createdAt) && (
                  <Badge variant="sky">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    New
                  </Badge>
                )}
              </div>
              <Link
                href={href}
                onClick={(e) => e.stopPropagation()}
                className="line-clamp-2 text-sm font-bold leading-snug text-tx"
              >
                {event.title}
              </Link>
            </div>
          </div>

          {/* Top-3 outcomes */}
          <div className="flex flex-col gap-1">
            {top.map((m) => (
              <OutcomeRow
                key={m.id}
                market={m}
                label={labels.get(m.id) ?? m.question}
                onTrade={openTradeModal}
              />
            ))}
          </div>
        </>
      )}

      <div className="mt-auto flex flex-col gap-1.5 pt-2.5">
        {more > 0 && (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] font-bold text-tx-mut transition-colors hover:text-tx"
          >
            {/* On a game the hidden rows are spreads/totals/props — "markets"
                is what they are; "outcomes" stays for ranked questions. */}
            {isGame
              ? `+${more} more market${more === 1 ? '' : 's'}`
              : `+${more} more outcome${more === 1 ? '' : 's'}`}
          </Link>
        )}

        {/* Footer: volume + countdown */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-tx-mut">
          <span className="shrink-0 tabular-nums">
            {formatMoney(event.volume, { compact: true })} Vol.
            {/* v24.6 — matchup cards say which game/league this is; the
                title (which used to) is sr-only there. */}
            {matchup?.yes.league && (
              <span className="uppercase"> · {matchup.yes.league}</span>
            )}
          </span>
          {/* The source decides, not endDate: on a game event that date is
              the kickoff, so "Ended" would sit next to working Yes/No
              buttons. The event is open while any outcome still is.
              v21 — the live ticker: score + clock while playing, the final
              score once the game is over. min-w-0 + truncate: a long ticker
              ("2–1 Bo3 · Map 2") must shorten on a phone card, never poke
              out of it. */}
          {live ? (
            <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
              <LiveBadge className="shrink-0" />
              {rowsShowScore
                ? liveDetail && <span className="truncate text-tx-mut">{liveDetail}</span>
                : score &&
                  score.state !== 'pre' && (
                    <span className="truncate font-bold text-tx tabular-nums">
                      {score.home.score}–{score.away.score}
                      {liveDetail && <span className="ml-1 text-tx-mut">{liveDetail}</span>}
                    </span>
                  )}
            </span>
          ) : score?.state === 'post' ? (
            <span className="min-w-0 truncate font-bold text-tx-mut tabular-nums">
              {/* The source's own final label: "FT" (soccer), "Final"
                  (MLB/NBA), the method (UFC: "Submission"). The numbers
                  follow it only when no team row already carries them —
                  and never for a scoreless sport, whose 1/0 encodes the
                  winner, not a result anyone should read as a scoreline. */}
              {score.detail || 'FT'}
              {!rowsShowScore && !score.scoreless && ` ${score.home.score}–${score.away.score}`}
            </span>
          ) : ended ? (
            <span className="font-bold text-tx-mut">Ended</span>
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
