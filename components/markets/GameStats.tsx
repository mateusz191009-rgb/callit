'use client';

import { useEffect, useState } from 'react';
import type { EventGroup, EventTeam, GameScore, ScoreGoal } from '@/lib/types';
import { liveDetailOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LiveBadge } from '@/components/common/Countdown';

/**
 * Polymarket-style match surfaces for a game event (v21):
 *
 *  - GameHeader   — flags + team names, kickoff (pre) or live score (in/post)
 *  - LiveStatsPanel — goal timeline (soccer), scorers, per-period linescores
 *
 * Team identity (names, flags, home/away) comes from the EVENT (Gamma
 * `teams`); the numbers come from the matched ESPN score (useScores). The
 * header renders fine with no score at all — kickoff time in the middle —
 * so nothing here depends on ESPN being reachable.
 */

/** Flag/crest image with a plain fallback square (no remote = no image). */
function TeamFlag({
  team,
  className,
}: {
  team?: { name: string; logo?: string };
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (team?.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.logo}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('shrink-0 object-contain drop-shadow-md', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-lg bg-surface-3 text-sm font-bold text-tx-mut',
        className
      )}
      aria-hidden
    >
      {team?.name?.charAt(0) ?? '?'}
    </span>
  );
}

/** "21:00" + "Jul 19" in the viewer's locale. Computed after mount — the
 *  page is client-only, but keep the same hydration-safe habit anyway. */
function useKickoffParts(iso?: string): { time: string; date: string } | null {
  const [parts, setParts] = useState<{ time: string; date: string } | null>(null);
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return;
    setParts({
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }, [iso]);
  return parts;
}

function TeamBlock({ team, align }: { team?: EventTeam; align: 'left' | 'right' }) {
  return (
    <div
      className={cn(
        // max-w-full: justify-self switches the item from stretch to
        // fit-content sizing, and a truncating span still reports its
        // capped 9rem as min-content — wider than a phone's squeezed
        // column, so the block spilled out of the card. Capping at the
        // grid area keeps it inside; short names still hug the score.
        'flex min-w-0 max-w-full flex-col items-center gap-2 text-center',
        align === 'left' ? 'justify-self-end' : 'justify-self-start'
      )}
    >
      <TeamFlag team={team} className="h-12 w-16" />
      {/* w-full: as a centered flex item the span's fit-content width can
          exceed a squeezed column (truncate only kicked in at 9rem) — full
          width clamps it to the column so the ellipsis actually appears. */}
      <span className="w-full max-w-[9rem] truncate text-sm font-bold text-tx sm:max-w-[12rem] sm:text-base">
        {team?.name ?? '—'}
      </span>
    </div>
  );
}

/**
 * The match header: home team — center (kickoff or score) — away team.
 * `teams` is home-first (parseTeams sorts it); the score's own home/away
 * mapping is authoritative for the numbers.
 */
export function GameHeader({
  event,
  score,
  kickoff,
}: {
  event: EventGroup;
  score?: GameScore;
  kickoff?: string;
}) {
  const teams = event.teams ?? [];
  const home = teams.find((t) => t.side === 'home') ?? teams[0];
  const away = teams.find((t) => t.side === 'away') ?? teams[1];
  const parts = useKickoffParts(kickoff);
  const started = score && score.state !== 'pre';

  return (
    <div className="card-surface px-4 py-6 sm:px-5">
      {/* minmax(0,1fr): a bare 1fr track refuses to shrink below its
          content, so on a 390px phone two long team names + the LIVE line
          pushed the grid wider than the card (owner: "schrift guckt raus
          … sieht schief aus"). With a 0 minimum the side columns give way
          and the names truncate instead. */}
      {/* v25.25 — the CENTRE track is minmax(0,auto) for the same reason the
          sides are minmax(0,1fr). A bare `auto` track sizes to max-content
          and never gives any of it back, so a scoreless result headline
          ("Nongshim Red Force wins" — one unbreakable 22-character line at
          text-2xl) ate the whole 390px card and squeezed both team columns
          down to a single letter each, logos clipped to slivers. Now every
          track can yield, and the headline wraps instead of shoving. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-3 sm:gap-8">
        <TeamBlock team={home} align="left" />

        {/* Capped on a phone so a long result line wraps to two short ones
            inside its own column instead of paying for itself out of the
            team names either side of it. */}
        <div className="flex min-w-0 max-w-[180px] flex-col items-center gap-1 text-center sm:max-w-none">
          {started ? (
            <>
              {/* v25.14 — a scoreless sport (UFC) has no scoreline to
                  print: the centrepiece is the state, the method rides
                  below as `detail`, and the winner is named right here —
                  the one thing a fight's "result" actually is. */}
              {score.scoreless ? (
                <span className="max-w-full text-balance break-words text-lg font-black leading-tight tracking-tight text-tx sm:text-3xl">
                  {score.state === 'in'
                    ? score.detail !== 'Live'
                      ? score.detail // 'Rd 2' — the badge below carries LIVE
                      : 'LIVE'
                    : score.home.score === score.away.score
                      ? 'Final'
                      : `${(score.home.score > score.away.score ? score.home : score.away).name} wins`}
                </span>
              ) : (
                <span className="text-3xl font-black tracking-tight text-tx tabular-nums sm:text-4xl">
                  {score.home.score}
                  <span className="mx-2 text-tx-mut">–</span>
                  {score.away.score}
                </span>
              )}
              {score.state === 'in' ? (
                <span className="inline-flex max-w-full items-center gap-2 whitespace-nowrap text-xs font-bold text-green">
                  <LiveBadge className="shrink-0" />
                  {/* Scoreless: the round is already the centrepiece —
                      repeating it beside the badge would read "Rd 2 LIVE
                      Rd 2". */}
                  {!score.scoreless && liveDetailOf(score) && (
                    <span className="truncate">{liveDetailOf(score)}</span>
                  )}
                </span>
              ) : (
                <span className="max-w-full truncate text-xs font-bold uppercase tracking-wide text-tx-mut">
                  {score.detail || 'Final'}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-2xl font-black tracking-tight text-tx tabular-nums sm:text-3xl">
                {parts?.time ?? '—'}
              </span>
              <span className="text-xs font-bold uppercase tracking-wide text-tx-mut">
                {parts?.date ?? ''}
              </span>
            </>
          )}
        </div>

        <TeamBlock team={away} align="right" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live stats                                                           */
/* ------------------------------------------------------------------ */

const TIMELINE_TICKS = [0, 15, 30, 45, 60, 75, 90];

function GoalDot({ goal, max }: { goal: ScoreGoal; max: number }) {
  const minute = goal.minuteValue ?? parseFloat(goal.minute);
  if (!Number.isFinite(minute)) return null;
  const left = Math.min(100, Math.max(0, (minute / max) * 100));
  const label = `${goal.minute} ${goal.player ?? ''}${goal.type && goal.type !== 'Goal' ? ` (${goal.type})` : ''}`.trim();
  return (
    <span
      title={label}
      aria-label={label}
      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-green shadow"
      style={{ left: `${left}%` }}
    />
  );
}

/** One team's row on the 0–90' goal timeline. */
function TimelineRow({
  label,
  goals,
  max,
}: {
  label: string;
  goals: ScoreGoal[];
  max: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-right text-micro font-bold uppercase text-tx-sec">
        {label}
      </span>
      <div className="relative h-6 flex-1 rounded-full bg-surface-3/60">
        {goals.map((g, i) => (
          <GoalDot key={i} goal={g} max={max} />
        ))}
      </div>
    </div>
  );
}

/**
 * v25.22 — the honest fallback: a sport whose provider gives us a SCORE and
 * no breakdown (soccer via Gamma, any game ESPN doesn't cover). The panel
 * used to render an empty box here, and before that a fabricated one-column
 * "set" table — this states the score plainly and says what is missing.
 */
function ScoreOnly({ score }: { score: GameScore }) {
  const side = (s: GameScore['home'], align: string) => (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-1', align)}>
      <span className="truncate text-xs font-bold uppercase tracking-wide text-tx-sec">
        {s.abbreviation ?? s.name}
      </span>
      <span className="text-3xl font-black text-tx tabular-nums">{s.score}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {side(score.home, 'items-start text-left')}
        <span className="shrink-0 text-lg font-black text-tx-mut">–</span>
        {side(score.away, 'items-end text-right')}
      </div>
      <p className="border-t border-line pt-3 text-xs font-semibold text-tx-mut">
        {score.state === 'pre'
          ? 'The scoreline appears here once the game starts.'
          : 'A play-by-play breakdown is not available for this match.'}
      </p>
    </div>
  );
}

/**
 * Per-period scoreboard (sets / innings / quarters / maps) — v25.30.
 *
 * The old version was a 12px text table: tiny uppercase abbreviations, every
 * number the same muted grey, no flags — a linescore that read as debug
 * output (owner: "sieht aktuell immer bisschen tot aus"). This is a
 * broadcast-style board: full names with flags, one column per period with
 * the CURRENT one tinted, the winner of each finished period in full text
 * while the loser recedes, and the match total leading the row.
 */
function LineScores({ score, teams }: { score: GameScore; teams?: EventTeam[] }) {
  const periods = Math.max(
    score.home.linescores?.length ?? 0,
    score.away.linescores?.length ?? 0
  );
  if (periods === 0) return <ScoreOnly score={score} />;
  const cols = Array.from({ length: periods }, (_, i) => i);
  // The period being played = the last one either side has an entry for
  // (only meaningful while the match is live).
  const current = score.state === 'in' ? periods - 1 : -1;

  // parseTeams sorts home-first, matching score.home/score.away.
  const flagFor = (side: 'home' | 'away') =>
    teams && teams.length >= 2 ? teams[side === 'home' ? 0 : 1] : undefined;

  const row = (side: 'home' | 'away') => {
    const mine = score[side];
    const other = score[side === 'home' ? 'away' : 'home'];
    const leading = Number(mine.score) > Number(other.score);
    return (
      <div key={side} className="flex items-center gap-3 py-2.5">
        <TeamFlag team={flagFor(side)} className="h-6 w-8" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            leading ? 'font-bold text-tx' : 'font-semibold text-tx-sec'
          )}
        >
          {mine.name}
        </span>
        {cols.map((i) => {
          const value = mine.linescores?.[i];
          const theirs = other.linescores?.[i];
          const won =
            i !== current &&
            typeof value === 'number' &&
            typeof theirs === 'number' &&
            value > theirs;
          return (
            <span
              key={i}
              className={cn(
                'w-7 shrink-0 rounded-md py-0.5 text-center text-base tabular-nums',
                i === current
                  ? 'bg-surface-3 font-bold text-tx'
                  : won
                    ? 'font-semibold text-tx'
                    : 'text-tx-mut'
              )}
            >
              {value ?? '–'}
            </span>
          );
        })}
        <span
          className={cn(
            'w-9 shrink-0 text-right text-xl font-bold tabular-nums',
            leading ? 'text-tx' : 'text-tx-sec'
          )}
        >
          {mine.score}
        </span>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[300px]">
        {/* Column key: period numbers over their columns, T over the total */}
        <div className="flex items-center gap-3 border-b border-line pb-1.5">
          <span className="h-1 w-8 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1" aria-hidden />
          {cols.map((i) => (
            <span
              key={i}
              className={cn(
                'w-7 shrink-0 text-center text-micro font-semibold tabular-nums',
                i === current ? 'text-tx' : 'text-tx-mut'
              )}
            >
              {i + 1}
            </span>
          ))}
          <span className="w-9 shrink-0 text-right text-micro font-semibold text-tx-mut">
            T
          </span>
        </div>
        <div className="divide-y divide-line/60">
          {row('home')}
          {row('away')}
        </div>
      </div>
    </div>
  );
}

/**
 * The "Live stats" view: soccer gets the goal timeline + scorer list,
 * other sports the per-period line score. Renders a quiet placeholder
 * until the game is matched on the scoreboard.
 */
export function LiveStatsPanel({
  score,
  teams,
}: {
  score?: GameScore;
  /** The event's roster (home-first) — supplies the flags on the board. */
  teams?: EventTeam[];
}) {
  if (!score) {
    return (
      <div className="card-surface p-8 text-center">
        <p className="text-sm font-bold text-tx-sec">Live stats aren't available yet.</p>
        <p className="mt-1 text-xs text-tx-mut">
          Score and match events appear here around kickoff.
        </p>
      </div>
    );
  }

  const soccer = Boolean(score.regulation);
  const goals = score.goals ?? [];
  const max =
    soccer && goals.some((g) => (g.minuteValue ?? 0) > 90) ? 120 : (score.regulation ?? 90);
  const homeLabel = score.home.abbreviation ?? score.home.name;
  const awayLabel = score.away.abbreviation ?? score.away.name;

  return (
    <div className="space-y-4 card-surface p-5">
      {/* Status row */}
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-tx-mut">
          Live stats
        </span>
        {score.state === 'in' ? (
          <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap text-xs font-bold text-green">
            <LiveBadge className="shrink-0" />
            {liveDetailOf(score) && (
              <span className="truncate">{liveDetailOf(score)}</span>
            )}
          </span>
        ) : (
          <span className="min-w-0 truncate text-xs font-bold text-tx-mut">{score.detail}</span>
        )}
      </div>

      {soccer ? (
        <>
          {/* Goal timeline, one row per side */}
          <div className="space-y-2">
            <TimelineRow
              label={homeLabel}
              goals={goals.filter((g) => g.side === 'home')}
              max={max}
            />
            <TimelineRow
              label={awayLabel}
              goals={goals.filter((g) => g.side === 'away')}
              max={max}
            />
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0" />
              <div className="relative flex-1">
                {TIMELINE_TICKS.filter((t) => t <= max).map((t) => (
                  <span
                    key={t}
                    className="absolute -translate-x-1/2 text-nano font-semibold text-tx-mut tabular-nums"
                    style={{ left: `${(t / max) * 100}%` }}
                  >
                    {t}
                  </span>
                ))}
                {/* reserve the tick row's height */}
                <span className="invisible text-nano">0</span>
              </div>
            </div>
          </div>

          {/* Scorers */}
          {goals.length > 0 && (
            <div className="space-y-1.5 border-t border-line pt-3">
              {goals.map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-12 shrink-0 font-black text-tx tabular-nums">
                    {g.minute}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold text-tx-sec">
                    {g.player ?? 'Goal'}
                    {g.type && g.type !== 'Goal' && (
                      <span className="ml-1.5 font-semibold text-tx-mut">({g.type})</span>
                    )}
                  </span>
                  <span className="shrink-0 text-micro font-bold uppercase text-tx-mut">
                    {g.side === 'home' ? homeLabel : awayLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
          {goals.length === 0 && score.state !== 'pre' && (
            <p className="border-t border-line pt-3 text-xs font-semibold text-tx-mut">
              {/* v25.22 — "No goals yet" is only true at 0-0. With goals on
                  the board and none on the timeline, the provider simply
                  did not send us the times, and saying otherwise
                  contradicts the score printed directly above it. */}
              {score.home.score + score.away.score > 0
                ? 'Goal times are not available for this match.'
                : 'No goals yet.'}
            </p>
          )}
        </>
      ) : (
        <LineScores score={score} teams={teams} />
      )}
    </div>
  );
}
