'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Side } from '@/lib/types';
import { useCallitStore } from '@/lib/store';
import { isMarketClosed, shortSideLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fakeTradeAmount, randomTrader } from '@/lib/useActivity';

interface Pulse {
  key: number;
  name: string;
  amount: number;
  side: Side;
  /** Display name of the bought side — `shortSideLabel` at fire time, so a
   *  labeled market pulses "bought $95 Over" instead of a literal Yes. */
  label: string;
}

/**
 * Fake live-activity chip — "<name> bought $<n> Yes/No" — floating in the
 * bottom-right of its (relatively positioned) parent card. Purely visual:
 * no store writes, one timer chain per instance. The first fire is
 * staggered by 2–10s and the cadence (6–14s) is randomized per instance so
 * card grids never pulse in sync. Renders nothing until the first fire.
 *
 * No AnimatePresence exit — the chip is conditionally rendered with an
 * entrance animation only and simply unmounts when hidden.
 */
export default function TradePulse({
  marketId,
  compact,
}: {
  marketId: string;
  compact?: boolean;
}) {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const fire = () => {
      // Cheap read at fire time (no subscription): closed markets have no
      // live flow, and the side lean follows the current Yes probability.
      //
      // v7 — closed is `isMarketClosed`, not `endDate <= now`: a live game is
      // past its (kickoff) `endDate` and is precisely when flow is heaviest,
      // so the old rule killed the chip exactly where it belonged.
      const market = useCallitStore.getState().getMarketById(marketId);
      if (market && (market.status === 'resolved' || isMarketClosed(market))) {
        return;
      }
      const yes = market?.yesPrice ?? 0.5;
      const side: Side = Math.random() < yes ? 'yes' : 'no';
      setPulse({
        key: Date.now(),
        name: randomTrader(Math.floor(Math.random() * 0xffffffff)),
        amount: fakeTradeAmount(Math.random()),
        side,
        label: market
          ? shortSideLabel(market, side)
          : side === 'yes'
            ? 'Yes'
            : 'No',
      });
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setPulse(null), 2500);
    };

    const period = 6000 + Math.random() * 8000; // 6–14s per instance
    const starter = setTimeout(() => {
      fire();
      interval = setInterval(fire, period);
    }, 2000 + Math.random() * 8000); // 2–10s initial stagger

    return () => {
      clearTimeout(starter);
      clearTimeout(hideTimer);
      if (interval) clearInterval(interval);
    };
  }, [marketId]);

  if (!pulse) return null;

  return (
    <motion.div
      key={pulse.key}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-10 rounded-full border px-2 py-1 text-[11px] font-bold shadow-lg backdrop-blur-sm',
        compact ? 'bottom-2 right-2' : 'bottom-14 right-3',
        pulse.side === 'yes'
          ? 'border-green/30 bg-green/15 text-green'
          : 'border-sky/30 bg-sky/15 text-sky'
      )}
    >
      <span className="tabular-nums">
        {pulse.name} bought ${pulse.amount} {pulse.label}
      </span>
    </motion.div>
  );
}
