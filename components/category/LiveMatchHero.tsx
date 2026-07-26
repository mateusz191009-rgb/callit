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
 * Everything here is real: teams, crests and colours from Gamma (`teams`),
 * score and clock from the shared 45s poll (lib/useScores.ts — ESPN, or the
 * provider's own scoreboard for esports), prices from the match moneyline. The
 * trades strip is the same deliberately-fake activity the cards already show
 * (lib/useActivity.ts) and is marked aria-hidden.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { cn } from '@/lib/utils';
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

/**
 * The match moneyline of a game event and the two teams mapped onto its sides —
 * the same rule EventCard's matchup card uses (the market whose question IS the
 * event title; map/game winners carry a "- Map 1 Winner" suffix and never
 * match). Null for anything that can't be rendered as a head-to-head.
 */
function matchupOf(event: EventGroup): { ml: Market; yes: EventTeam; no: EventTeam } | null {
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
  return yes === no ? null : { ml, yes, no };
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
        'grid shrink-0 place-items-center rounded-lg bg-surface-3 text-xs font-black text-tx-sec',
        className
      )}
      aria-hidden
    >
      {(team.abbreviation ?? team.name).slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Pick the match that leads the hub: live first (most volume), else the next
 *  kickoff inside the window. */
export function heroMatchOf(events: EventGroup[]): EventGroup | null {
  const games = events.filter((e) => e.groups?.length && (e.teams?.length ?? 0) >= 2);
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
  const router = useRouter();
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

  // Without a two-sided moneyline there is no head-to-head to show, and a
  // half-rendered stage is worse than none.
  if (!matchup) return null;

  const href = `/event/${event.id}`;
  const teamSide = (t: EventTeam): 'home' | 'away' =>
    t.side ?? ((event.teams ?? []).indexOf(t) === 0 ? 'home' : 'away');

  const rows = [
    { team: matchup.yes, side: 'yes' as Side, price: matchup.ml.yesPrice },
    { team: matchup.no, side: 'no' as Side, price: 1 - matchup.ml.yesPrice },
  ];

  return (
    <motion.section
      aria-label="Featured match"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="hero-glow relative overflow-hidden rounded-2xl border border-line bg-surface-2"
    >
      {/* Artwork: the event's own image, bled to the right and faded into the
          panel. Polymarket runs the stream frame here; we have one still, so it
          sits behind the copy instead of competing with it. */}
      {event.icon && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] sm:block">
          {/* Plain img, not MarketIcon: this is a backdrop, and MarketIcon's
              border/fallback squircle are meant for avatars. A dead URL simply
              renders nothing, which is the right failure here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.icon}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-surface-2 via-surface-2/70 to-transparent" />
        </div>
      )}

      <div className="relative flex flex-col gap-3 p-4 sm:max-w-[62%] sm:p-5">
        {/* Status line: LIVE + clock, or the kickoff countdown. */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-tx-mut">
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
          {matchup.yes.league && <span className="uppercase">· {matchup.yes.league}</span>}
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
          {rows.map(({ team, price }) => {
            const s = score && score.state !== 'pre' ? score[teamSide(team)].score : undefined;
            const other = teamSide(team) === 'home' ? 'away' : 'home';
            const won = score?.scoreless && s !== undefined && s > score[other].score;
            return (
              <div
                key={team.name}
                onClick={() => {
                  startNavProgressTo(href);
                  router.push(href);
                }}
                className="group flex cursor-pointer items-center gap-2.5"
              >
                <Crest team={team} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-bold text-tx">
                      {team.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      {s !== undefined && (
                        <span
                          className={cn(
                            'text-sm font-black tabular-nums',
                            score?.scoreless ? 'text-green' : 'text-tx-sec'
                          )}
                        >
                          {score?.scoreless ? (won ? 'W' : '') : s}
                        </span>
                      )}
                      <span className="text-base font-black tabular-nums text-tx">
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
              </div>
            );
          })}
        </div>

        {/* Buy buttons in the teams' own colours (falling back to yes/no tints
            for teams that ship no usable colour). */}
        <div className="grid grid-cols-2 gap-2">
          {rows.map(({ team, side, price }) => {
            const tint = teamTint(team.color);
            return (
              <Button
                key={side}
                variant={tint ? 'team-tint' : side === 'yes' ? 'yes-tint' : 'no-tint'}
                size="md"
                style={tint}
                className="min-w-0 font-extrabold"
                onClick={() => openTradeModal(matchup.ml.id, side)}
              >
                <span className="truncate">
                  {sideLabel(matchup.ml, side)} {formatCents(price)}
                </span>
              </Button>
            );
          })}
        </div>
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
                    className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pr-5 text-[11px] font-bold"
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
        className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 text-[11px] font-bold text-tx-sec transition-colors hover:text-tx"
      >
        All markets
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </motion.section>
  );
}
