'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { formatTimeLeft, type TimeLeft } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Time-to-close chip.
 *
 * v7 — PASS `open` FOR ANYTHING WHOSE `endDate` WE DON'T OWN. For a feed
 * market that is `!isMarketClosed(market)` (lib/format.ts). Without it a
 * market whose upstream `endDate` has passed but which is still open — a live
 * game, or a stale placeholder date like "Next Prime Minister of Ethiopia?" —
 * renders "Ended" next to its own working Yes/No buttons. Community markets
 * omit it: their deadline is real, so a past `endDate` does mean Ended.
 */
export default function Countdown({
  endDate,
  open,
  className,
}: {
  endDate: string;
  /** True when the market is still open despite a past `endDate`. */
  open?: boolean;
  className?: string;
}) {
  // Compute only after mount to avoid a server/client hydration mismatch.
  const [time, setTime] = useState<TimeLeft | null>(null);

  useEffect(() => {
    const update = () => setTime(formatTimeLeft(endDate, Date.now(), { open }));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [endDate, open]);

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
          gets the "Ends in" prefix. */}
      {time === null ? '—' : time.ended || time.open ? time.label : `Ends in ${time.label}`}
    </span>
  );
}
