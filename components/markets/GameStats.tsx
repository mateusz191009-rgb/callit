'use client';

import { useEffect, useState } from 'react';
import type { EventGroup, EventTeam, GameScore, ScoreGoal } from '@/lib/types';
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
        'grid shrink-0 place-items-center rounded-lg bg-surface-3 text-sm font-black text-tx-mut',
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
        'flex min-w-0 flex-col items-center gap-2 text-center',
        align === 'left' ? 'justify-self-end' : 'justify-self-start'
      )}
    >
      <TeamFlag team={team} className="h-12 w-16" />
      {/* w-full: as a centered flex item the span's fit-content width can
          exceed a squeezed column (truncate only kicked in at 9rem) — full
          width clamps it to the column so the ellipsis actually appears. */}
      <span className="w-full max-w-[9rem] truncate text-sm font-black text-tx sm:max-w-[12rem] sm:text-base">
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
    <div className="rounded-2xl border border-line bg-surface-2 px-4 py-6 sm:px-5">
      {/* minmax(0,1fr): a bare 1fr track refuses to shrink below its
          content, so on a 390px phone two long team names + the LIVE line
          pushed the grid wider than the card (owner: "schrift guckt raus
          … sieht schief aus"). With a 0 minimum the side columns give way
          and the names truncate instead. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-8">
        <TeamBlock team={home} align="left" />

        <div className="flex min-w-0 flex-col items-center gap-1 text-center">
          {started ? (
            <>
              <span className="text-3xl font-black tracking-tight text-tx tabular-nums sm:text-4xl">
                {score.home.score}
                <span className="mx-2 text-tx-mut">–</span>
                {score.away.score}
              </span>
              {score.state === 'in' ? (
                <span className="inline-flex max-w-full items-center gap-2 whitespace-nowrap text-xs font-bold text-green">
                  <LiveBadge className="shrink-0" />
                  <span className="truncate">
                    {score.clock && score.regulation ? score.clock : score.detail}
                  </span>
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
      <span className="w-10 shrink-0 text-right text-[11px] font-black uppercase text-tx-sec">
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

/** Per-period line-score table (innings / quarters) for non-soccer games. */
function LineScores({ score }: { score: GameScore }) {
  const periods = Math.max(
    score.home.linescores?.length ?? 0,
    score.away.linescores?.length ?? 0
  );
  if (periods === 0) return null;
  const cols = Array.from({ length: periods }, (_, i) => i);
  const row = (side: 'home' | 'away') => {
    const s = score[side];
    return (
      <tr key={side}>
        <td className="pr-3 text-left font-black uppercase text-tx-sec">
          {s.abbreviation ?? s.name}
        </td>
        {cols.map((i) => (
          <td key={i} className="px-1.5 text-center text-tx-sec tabular-nums">
            {s.linescores?.[i] ?? '-'}
          </td>
        ))}
        <td className="pl-3 text-center font-black text-tx tabular-nums">{s.score}</td>
      </tr>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[280px] text-xs">
        <thead>
          <tr>
            <th />
            {cols.map((i) => (
              <th key={i} className="px-1.5 pb-1 text-center font-bold text-tx-mut">
                {i + 1}
              </th>
            ))}
            <th className="pl-3 pb-1 text-center font-bold text-tx-mut">T</th>
          </tr>
        </thead>
        <tbody>
          {row('home')}
          {row('away')}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The "Live stats" view: soccer gets the goal timeline + scorer list,
 * other sports the per-period line score. Renders a quiet placeholder
 * until the game is matched on the scoreboard.
 */
export function LiveStatsPanel({ score }: { score?: GameScore }) {
  if (!score) {
    return (
      <div className="rounded-2xl border border-line bg-surface-2 p-8 text-center">
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
    <div className="space-y-4 rounded-2xl border border-line bg-surface-2 p-5">
      {/* Status row */}
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-tx-mut">
          Live stats
        </span>
        {score.state === 'in' ? (
          <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap text-xs font-bold text-green">
            <LiveBadge className="shrink-0" />
            <span className="truncate">
              {soccer && score.clock ? score.clock : score.detail}
            </span>
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
                    className="absolute -translate-x-1/2 text-[10px] font-bold text-tx-mut tabular-nums"
                    style={{ left: `${(t / max) * 100}%` }}
                  >
                    {t}
                  </span>
                ))}
                {/* reserve the tick row's height */}
                <span className="invisible text-[10px]">0</span>
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
                  <span className="shrink-0 text-[11px] font-black uppercase text-tx-mut">
                    {g.side === 'home' ? homeLabel : awayLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
          {goals.length === 0 && score.state !== 'pre' && (
            <p className="border-t border-line pt-3 text-xs font-semibold text-tx-mut">
              No goals yet.
            </p>
          )}
        </>
      ) : (
        <LineScores score={score} />
      )}
    </div>
  );
}
