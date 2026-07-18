'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { formatTimeLeft, type TimeLeft } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Pulsing LIVE chip — one shared rendering for every surface that shows a
 * game in progress (cards, hero, detail pages). Gate it on `isInPlay(...)`
 * at the call site; never on a raw date comparison (the in-play rules —
 * sanity cap, source-closed — live in that helper).
 */
export function LiveBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-bold text-green', className)}>
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
      </span>
      LIVE
    </span>
  );
}

/**
 * Time-to-close chip.
 *
 * v7 — PASS `open` FOR ANYTHING WHOSE `endDate` WE DON'T OWN. For a feed
 * market that is `!isMarketClosed(market)` (lib/format.ts). Without it a
 * market whose upstream `endDate` has passed but which is still open — a live
 * game, or a stale placeholder date like "Next Prime Minister of Ethiopia?" —
 * renders "Ended" next to its own working Yes/No buttons. Community markets
 * omit it: their deadline is real, so a past `endDate` does mean Ended.
 *
 * v16 — PASS `startsAt` FOR GAMES (owner: "bei france vs england steht Ends
 * in 1h 5m obwohl es da erst anfängt"). A game's upstream `endDate` IS the
 * kickoff, so counting down to it as "Ends in" announces the end of a match
 * that has not started. With `startsAt` set and still in the future the chip
 * reads "Starts in …" instead; from kickoff on it falls back to the normal
 * open/ended logic (the LIVE state is the call site's job via `LiveBadge`).
 */
export default function Countdown({
  endDate,
  open,
  startsAt,
  className,
}: {
  endDate: string;
  /** True when the market is still open despite a past `endDate`. */
  open?: boolean;
  /** Real start (kickoff) of a game market/event — see the v16 note. */
  startsAt?: string;
  className?: string;
}) {
  // Compute only after mount to avoid a server/client hydration mismatch.
  const [time, setTime] = useState<(TimeLeft & { starts?: boolean }) | null>(null);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const start = startsAt ? new Date(startsAt).getTime() : NaN;
      if (Number.isFinite(start) && start > now) {
        setTime({ ...formatTimeLeft(startsAt as string, now), starts: true });
      } else {
        setTime(formatTimeLeft(endDate, now, { open }));
      }
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [endDate, open, startsAt]);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 tabular-nums',
        time?.ended && 'text-tx-mut',
        time && !time.ended && time.urgent && 'text-amber',
        className
      )}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {/* 'Ended' and 'Open' are standalone status words — only a real duration
          gets the "Ends in" / "Starts in" prefix. */}
      {time === null
        ? '—'
        : time.starts
          ? `Starts in ${time.label}`
          : time.ended || time.open
            ? time.label
            : `Ends in ${time.label}`}
    </span>
  );
}
