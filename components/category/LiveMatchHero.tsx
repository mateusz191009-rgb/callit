'use client';

/**
 * THE MATCH HERO (v25.18) — the one hero the hubs still mount.
 *
 * Owner, pointing at Polymarket's E-Sport page: "die hero bei esports bei
 * polymarket ist nice vielleicht machen wir sowas wie die". Theirs is a live
 * series across the top — round tag, volume, the two teams with their odds and
 * a bar each, two big buy buttons, and a rolling strip of trades underneath.
 * What makes it work is that it is CONTENT, not decoration: it is the match you
 * would have scrolled to find. That is the whole reason it earns the space the
 * themed scenes lost (see components/category/heroes.ts).
 *
 * It renders nothing at all unless the hub actually has a match worth leading
 * with — live first, otherwise the next kickoff inside NEXT_WINDOW_MS. A hub
 * without one just starts at the grid, which is correct: an empty stage is
 * worse than no stage.
 *
 * v25.39 — "worth leading with" now means RENDERABLE, and renderable now
 * includes football. The stage understood one market shape (a two-sided
 * moneyline), the picker understood another (any game with two teams), and on a
 * night whose biggest live game was a three-way 1X2 — no moneyline, three
 * separate binaries instead — the picker handed it over and the stage drew
 * nothing, so the Sports hub had no hero while 21 live matches sat in the grid
 * underneath it. Both halves agree now: see `matchupOf` and `heroMatchOf`.
 *
 * Everything here is real: teams, crests and colours from Gamma (`teams`),
 * score and clock from the shared 45s poll (lib/useScores.ts — ESPN, or the
 * provider's own scoreboard for esports), prices from the match moneyline. The
 * trades strip is the same deliberately-fake activity the cards already show
 * (lib/useActivity.ts) and is marked aria-hidden.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import type { EventGroup, EventTeam, Market, Side } from '@/lib/types';
import {
  formatCents,
  formatMoney,
  isInPlay,
  isMarketClosed,
  liveDetailOf,
  sideLabel,
} from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { useScore } from '@/lib/useScores';
import { startNavProgressTo } from '@/lib/navProgress';
import { avatarClass, fakeTradesFor } from '@/lib/useActivity';
import { streamChannelFor } from '@/lib/streams';
import { cn } from '@/lib/utils';
import StreamPanel from './StreamPanel';
import Button from '@/components/ui/button';
import Badge from '@/components/ui/badge';
import { LiveBadge } from '@/components/common/Countdown';

/** How far ahead a not-yet-started match may be and still lead the hub. Beyond
 *  this the page is better off starting at the grid — a hero counting down
 *  three days is a poster, not a live event. */
const NEXT_WINDOW_MS = 36 * 60 * 60 * 1000;

/** Trades in the rolling strip. */
const TRADE_ROWS = 8;

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** One side of the stage: a team (or the draw), the market that buys it, and
 *  the price. `label` is what the buy button says. */
interface HeroSide {
  team?: EventTeam;
  label: string;
  market: Market;
  side: Side;
  price: number;
}

/** The sides the stage renders, plus the market whose labels the decorative
 *  trades strip borrows. Two sides for a moneyline, three for a 1X2. */
interface HeroMatchup {
  ml: Market;
  sides: HeroSide[];
}

/**
 * The head-to-head of a game event, in whichever shape the feed ships it.
 *
 * TWO-SIDED (tennis, cricket, NBA, esports): one market whose question IS the
 * event title, both sides labelled — the same rule EventCard's matchup card
 * uses (map/game winners carry a "- Map 1 Winner" suffix and never match).
 *
 * THREE-WAY, added v25.39: football has no such market. Its winner line is
 * three plain binaries — "Will BK Hacken win on 2026-07-27?", "Will BK Hacken
 * vs. AIK end in a draw?", "Will AIK win on 2026-07-27?" — so the old rule
 * found nothing and the hero rendered NOTHING for the biggest live match on the
 * board (verified 2026-07-27: 13 of the sports hub's 98 games, including the
 * two most-traded live ones). Rendered 1X2: home, draw, away.
 *
 * Null for anything that is not a head-to-head at all; the caller then leaves
 * the stage out entirely rather than half-drawing it.
 */
function matchupOf(event: EventGroup): HeroMatchup | null {
  const teams = event.teams ?? [];
  if (!event.groups?.length || teams.length < 2) return null;
  const title = normTitle(event.title);

  const ml = event.markets.find(
    (m) => m.yesLabel && m.noLabel && normTitle(m.question) === title
  );
  if (ml && !isMarketClosed(ml)) {
    const byLabel = (label: string) =>
      teams.find((t) => {
        const a = normTitle(t.name);
        const b = normTitle(label);
        return a === b || a.includes(b) || b.includes(a);
      });
    const yes = byLabel(ml.yesLabel!) ?? teams[0];
    const no = byLabel(ml.noLabel!) ?? teams.find((t) => t !== yes) ?? teams[1];
    if (yes !== no) {
      return {
        ml,
        sides: [
          { team: yes, label: sideLabel(ml, 'yes'), market: ml, side: 'yes', price: ml.yesPrice },
          { team: no, label: sideLabel(ml, 'no'), market: ml, side: 'no', price: 1 - ml.yesPrice },
        ],
      };
    }
  }

  // 1X2. The win markets are matched on "will <team> win" rather than on a
  // date suffix, which is the kickoff day and drifts across midnight; the draw
  // names the fixture, so it is matched on the event title plus the word.
  const winOf = (t: EventTeam) => {
    const prefix = `will${normTitle(t.name)}win`;
    return event.markets.find(
      (m) => !isMarketClosed(m) && normTitle(m.question).startsWith(prefix)
    );
  };
  const home = winOf(teams[0]);
  const away = winOf(teams[1]);
  if (!home || !away || home === away) return null;
  const draw = event.markets.find((m) => {
    const q = normTitle(m.question);
    return !isMarketClosed(m) && q.includes('draw') && q.includes(title);
  });

  const teamSideOf = (team: EventTeam, market: Market): HeroSide => ({
    team,
    label: team.name,
    market,
    side: 'yes',
    price: market.yesPrice,
  });
  return {
    // The strip names its sides after the home win — a real market, so a
    // trade row can never claim a side that isn't tradeable.
    ml: home,
    sides: [
      teamSideOf(teams[0], home),
      // A competition without draws (a cup tie decided on the night) simply
      // has none; then the stage is a two-row 1-2.
      ...(draw
        ? [{ label: 'Draw', market: draw, side: 'yes' as Side, price: draw.yesPrice }]
        : []),
      teamSideOf(teams[1], away),
    ],
  };
}

function hexRgb(hex?: string): [number, number, number] | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Team paint for the buy button — mirrors EventCard's `teamTint`: the colour
 *  is lifted toward white before the alpha goes up, so a navy crest brightens
 *  on hover instead of punching a hole in the panel. */
function teamTint(color?: string): CSSProperties | undefined {
  const rgb = hexRgb(color);
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  const lift = (amount: number) =>
    rgb.map((c) => Math.round(c + (255 - c) * amount)).join(', ');
  return {
    ['--team-fill' as string]: `rgba(${r}, ${g}, ${b}, 0.18)`,
    ['--team-fill-hi' as string]: `rgba(${lift(0.25)}, 0.34)`,
    ['--team-edge' as string]: `rgba(${r}, ${g}, ${b}, 0.5)`,
    ['--team-edge-hi' as string]: `rgba(${lift(0.25)}, 0.85)`,
    ['--team-text' as string]: `rgb(${lift(0.6)})`,
    ['--team-text-hi' as string]: `rgb(${lift(0.82)})`,
  };
}

/** Crest with a monogram fallback. */
function Crest({ team, className }: { team: EventTeam; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (team.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.logo}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-lg object-contain', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg bg-surface-3 text-xs font-bold text-tx-sec',
        className
      )}
      aria-hidden
    >
      {(team.abbreviation ?? team.name).slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Pick the match that leads the hub: live first (most volume), else the next
 *  kickoff inside the window.
 *
 *  v25.39 — the pool is the matches the hero can actually RENDER, not every
 *  game with a team roster. It used to hand back the biggest live game whatever
 *  its market shape, and the component then bailed on anything without a
 *  head-to-head — so one unrenderable leader (a football 1X2, before matchupOf
 *  learned the shape) left the hub with NO hero while eleven other live matches
 *  sat in the grid underneath. Picking from the renderable set means the stage
 *  is missing only when the hub genuinely has no match to put on it. */
export function heroMatchOf(events: EventGroup[]): EventGroup | null {
  const games = events.filter((e) => matchupOf(e) !== null);
  if (games.length === 0) return null;

  const live = games
    .filter((e) => e.markets.some((m) => isInPlay(m)))
    .sort((a, b) => b.volume - a.volume);
  if (live.length > 0) return live[0];

  const now = Date.now();
  const upcoming = games
    .map((e) => ({
      event: e,
      start: new Date(e.markets.find((m) => m.startTime)?.startTime ?? e.endDate).getTime(),
    }))
    .filter((x) => Number.isFinite(x.start) && x.start > now && x.start - now < NEXT_WINDOW_MS)
    .sort((a, b) => a.start - b.start);
  return upcoming[0]?.event ?? null;
}

export default function LiveMatchHero({ event }: { event: EventGroup }) {

  const openTradeModal = useCallitStore((s) => s.openTradeModal);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(t);
  }, []);

  const matchup = useMemo(() => matchupOf(event), [event]);
  const score = useScore(event.id);
  const inPlay = event.markets.some((m) => isInPlay(m));
  const live = score ? score.state === 'in' && inPlay : inPlay;
  const liveDetail = score?.state === 'in' ? liveDetailOf(score) : undefined;

  // Deterministic from the event id — never Math.random in render.
  const trades = useMemo(() => fakeTradesFor(event.id, TRADE_ROWS), [event.id]);
  const kickoff = event.markets.find((m) => m.startTime)?.startTime;

  // v25.19 — do we know an official broadcast for this tournament? Null for
  // every stick-and-ball match (and for esports leagues not in the map), and
  // then the panel falls back to the event artwork.
  const stream = streamChannelFor(event.title);

  // Without a winner line there is no head-to-head to show, and a
  // half-rendered stage is worse than none. `heroMatchOf` already picks only
  // renderable matches; this stands for any other caller.
  if (!matchup) return null;

  const href = `/event/${event.id}`;
  const teamSide = (t: EventTeam): 'home' | 'away' =>
    t.side ?? ((event.teams ?? []).indexOf(t) === 0 ? 'home' : 'away');

  const rows = matchup.sides;
  // Either team carries it; the draw row has no team of its own.
  const league = (event.teams ?? []).find((t) => t.league)?.league;

  return (
    <motion.section
      aria-label="Featured match"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="hero-glow relative overflow-hidden card-surface"
    >
      {/*
        v25.19 — copy and stage side by side IN THE FLOW, not stacked with
        absolute positioning.

        The right half is the STREAM when lib/streams.ts knows the tournament's
        official channel (esports), and the event's own artwork otherwise —
        Polymarket runs a live broadcast in exactly this slot, the difference
        being that theirs comes from their backend, so ours is absent rather
        than wrong when we don't know the league.

        A flex row rather than `absolute inset-y-0`: an absolute right half
        spans the WHOLE section, so the video would have sat under the last
        line of copy and over the trades ticker at the bottom. In the flow the
        two columns tile exactly and the ticker keeps the full width beneath
        them.
      */}
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        <div className="relative flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
        {/* Status line: LIVE + clock, or the kickoff countdown. */}
        <div className="flex flex-wrap items-center gap-2 text-micro font-semibold text-tx-mut">
          {live ? (
            <>
              <LiveBadge />
              {liveDetail && <span className="text-tx">{liveDetail}</span>}
            </>
          ) : (
            <Badge variant="neutral">
              {kickoff
                ? new Date(kickoff).toLocaleString(undefined, {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Up next'}
            </Badge>
          )}
          <span className="tabular-nums">
            {formatMoney(event.volume, { compact: true })} Vol.
          </span>
          {league && <span className="uppercase">· {league}</span>}
        </div>

        <Link
          href={href}
          onClick={() => startNavProgressTo(href)}
          className="line-clamp-2 text-2xl font-black leading-tight tracking-tight text-tx transition-colors hover:text-green sm:text-[32px]"
        >
          {event.title}
        </Link>

        {/* Team rows: crest, name, live score, probability + a bar the width of
            that probability. Clicking a row opens the event (chart + every
            market), which is what a price readout invites; the buttons below
            are the ones that buy. */}
        <div className="flex flex-col gap-2">
          {rows.map(({ team, label, market, price }) => {
            // The draw row has no team, so no crest and no score — the two
            // sides' scores being equal IS the draw.
            const s =
              team && score && score.state !== 'pre' ? score[teamSide(team)].score : undefined;
            const other = team && teamSide(team) === 'home' ? 'away' : 'home';
            const won = score?.scoreless && s !== undefined && s > score[other].score;
            return (
              // A real link, not a div with onClick. This row is the ONLY
              // route from the hero to the event — the buttons below open
              // the trade modal instead — and as a div it had no role, no
              // tabIndex and no key handler, so it was unreachable by
              // keyboard and invisible to assistive tech.
              <Link
                key={market.id}
                href={href}
                onClick={() => startNavProgressTo(href)}
                className="group flex items-center gap-2.5 rounded-lg"
              >
                {team ? (
                  <Crest team={team} className="h-8 w-8" />
                ) : (
                  // The draw's crest slot — "X", the way every 1X2 board
                  // writes it, so the three rows read as one line.
                  <span
                    aria-hidden
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-xs font-bold text-tx-mut"
                  >
                    X
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-bold text-tx">
                      {team?.name ?? label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      {s !== undefined && (
                        <span
                          className={cn(
                            'text-sm font-bold tabular-nums',
                            score?.scoreless ? 'text-green' : 'text-tx-sec'
                          )}
                        >
                          {score?.scoreless ? (won ? 'W' : '') : s}
                        </span>
                      )}
                      <span className="text-base font-bold tabular-nums text-tx">
                        {formatCents(price)}
                      </span>
                    </span>
                  </div>
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <span
                      className="block h-full rounded-full bg-green transition-[width] duration-700 ease-out motion-reduce:transition-none"
                      style={{ width: grown ? `${Math.round(price * 100)}%` : '0%' }}
                    />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Buy buttons in the teams' own colours (falling back to yes/no tints
            for teams that ship no usable colour). */}
        {/* One column per side — three on a 1X2, where the middle one is the
            draw and has no colours of its own to wear. */}
        <div className={cn('grid gap-2', rows.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {rows.map(({ team, label, market, side, price }) => {
            const tint = teamTint(team?.color);
            return (
              <Button
                key={market.id}
                variant={
                  tint ? 'team-tint' : !team ? 'outline' : side === 'yes' ? 'yes-tint' : 'no-tint'
                }
                size="md"
                style={tint}
                className={cn(
                  'min-w-0 font-bold',
                  // Three columns on a 390px phone leave ~100px a button, and
                  // the size-md padding alone ate half of it.
                  rows.length === 3 && 'px-2 text-xs sm:px-3 sm:text-sm'
                )}
                onClick={() => openTradeModal(market.id, side)}
              >
                {/* Two spans, not one string: at three columns on a phone a
                    single truncating label ate the price off the end of the
                    button ("BK Hack…"). The name yields, the price never
                    does — a buy button without its price is not one. */}
                <span className="min-w-0 truncate">{label}</span>
                <span className="shrink-0">{formatCents(price)}</span>
              </Button>
            );
          })}
        </div>
        </div>

        {/* The stage. Hidden on phones either way: a 16:9 video under a card's
            worth of copy would push the buy buttons off the first screen. */}
        {stream ? (
          <StreamPanel
            title={event.title}
            poster={event.icon}
            // v25.20 — a LIVE match starts its stream on its own (owner: "der
            // stream sollte direkt automatisch schon laufen … ist viel
            // cooler"). Muted, always. Not for an upcoming match: autostarting
            // a channel twenty hours before kickoff shows an offline screen or
            // somebody else's match, which is worse than a play button.
            autoStart={live}
            className="hidden w-[44%] shrink-0 sm:block"
          />
        ) : (
          event.icon && (
            <div aria-hidden className="relative hidden w-[44%] shrink-0 overflow-hidden sm:block">
              {/* Plain img, not MarketIcon: this is a backdrop, and
                  MarketIcon's border/fallback squircle are meant for avatars.
                  A dead URL simply renders nothing, which is right here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.icon}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover opacity-30"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-surface-2 via-surface-2/50 to-transparent" />
            </div>
          )
        )}
      </div>

      {/* Trades strip — decorative, exactly like the cards' TradePulse, and
          aria-hidden so it is never read as settled activity. Reuses the
          .ticker-track / .animate-marquee / .ticker-dup trio the market ticker
          already uses, which is also what makes it pause on hover and stop
          under prefers-reduced-motion (see globals.css). */}
      <div
        aria-hidden
        className="relative flex items-center gap-3 border-t border-line bg-surface-3/40 px-4 py-1.5"
      >
        <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-tx-mut">
          Live trades
        </span>
        <div className="ticker-track min-w-0 flex-1 overflow-hidden">
          <div className="animate-marquee flex w-max items-center">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className={cn('flex items-center', copy === 1 && 'ticker-dup')}
              >
                {trades.map((t) => (
                  <span
                    key={`${copy}-${t.id}`}
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pr-5 text-micro font-semibold"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black uppercase leading-none',
                        avatarClass(t.name)
                      )}
                    >
                      {t.name.charAt(0)}
                    </span>
                    <span className="text-tx-sec">{t.name}</span>
                    <span className={t.side === 'yes' ? 'text-green' : 'text-sky'}>
                      {sideLabel(matchup.ml, t.side)}
                    </span>
                    <span className="text-tx tabular-nums">${t.amount}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Link
        href={href}
        onClick={() => startNavProgressTo(href)}
        className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 text-micro font-semibold text-tx-sec transition-colors hover:text-tx"
      >
        All markets
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </motion.section>
  );
}
