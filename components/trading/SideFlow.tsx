'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import type { Side } from '@/lib/types';
import { isMarketClosed } from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { fakeTradeAmount, fakeTradesFor } from '@/lib/useActivity';
import { cn } from '@/lib/utils';

/**
 * Order flow above the two buy buttons (v25.35).
 *
 * Owner, pointing at Polymarket's 5-minute BTC market: "über dem no einfach
 * eine zahl steht wie viel gekauft wurde auf welcher seite … sieht viel
 * cooler aus". Theirs is a little column of amounts drifting up over each
 * side — +$2 / +$1 over Up, +$9 / +$5 over Down — so you can feel which way
 * the money is going without reading a single number properly.
 *
 * HONESTY, because this is a money surface. These amounts are the same
 * DELIBERATELY FAKE activity the cards and the chart chip already carry
 * (lib/useActivity — there is no public per-market trade feed to read, and
 * inventing one that LOOKED authoritative would be the one thing this app
 * refuses to do). So: `aria-hidden`, never counted anywhere, never presented
 * as a total, and it stops dead on a closed or resolved market, where real
 * flow would also be zero.
 *
 * The side lean follows the live Yes probability: a 78¢ favourite draws the
 * flow it should.
 *
 * CARDS ONLY (v25.36, owner). Not in the trade ticket — that is where a real
 * amount is entered against a real preview — and not over the price chart,
 * which is the one genuine data visualisation on the market page. The old
 * floating TradePulse chip that did both is deleted.
 */

/** Amounts visible per side before the oldest drops off. Cards get one:
 *  a grid of 40 cards has no room for a column each, and one live number
 *  over each button is the whole signal anyway. */
const KEEP = 3;
const KEEP_COMPACT = 1;

/** How often a new amount lands, randomised per tick so the two sides never
 *  march in lockstep. */
const MIN_GAP_MS = 2200;
const MAX_GAP_MS = 5200;

/** One process-wide cap on how many of these run timers at once — the same
 *  guard the old chip used, for the same reason: a 40-card grid must not
 *  open 40 timers. The cards past the cap simply render their seeded amounts and
 *  stay still, which is indistinguishable at a glance. */
const MAX_ACTIVE = 6;
let active = 0;

interface Drop {
  key: number;
  side: Side;
  amount: number;
}

export default function SideFlow({
  marketId,
  compact,
}: {
  marketId: string;
  /** Card variant: one amount per side on a single 16px line. */
  compact?: boolean;
}) {
  const keep = compact ? KEEP_COMPACT : KEEP;
  /**
   * SEEDED ON MOUNT, and that is the whole difference between "cool" and
   * "there is nothing there". The first tick lands 2-5s after mount, so the
   * band sat empty for several seconds on every page and card — the owner's
   * "ich sehe das mit den zahlen noch nicht". These come from the same
   * deterministic per-market feed the Activity tab uses, so the numbers are
   * stable across a reload instead of flickering into something new.
   */
  const [drops, setDrops] = useState<Drop[]>(() =>
    fakeTradesFor(marketId, keep * 2)
      .slice()
      .reverse()
      .map((t, i) => ({ key: i, side: t.side, amount: t.amount }))
  );
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // Purely decorative motion — someone who asked the OS for less of it
    // should not be paying for a timer either.
    if (reduceMotion) return;
    if (active >= MAX_ACTIVE) return;
    active += 1;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(
        () => {
          // Cheap read at fire time (no subscription): a closed or settled
          // market has no flow, so neither does this.
          const market = useCallitStore.getState().getMarketById(marketId);
          if (!market || market.status === 'resolved' || isMarketClosed(market)) {
            schedule();
            return;
          }
          const yes = market.yesPrice;
          const side: Side = Math.random() < yes ? 'yes' : 'no';
          setDrops((prev) =>
            [
              ...prev,
              { key: Date.now() + Math.random(), side, amount: fakeTradeAmount(Math.random()) },
            ].slice(-KEEP * 2)
          );
          schedule();
        },
        MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS)
      );
    };
    schedule();

    return () => {
      if (timer) clearTimeout(timer);
      active -= 1;
    };
  }, [marketId, reduceMotion]);

  const column = (side: Side) => {
    // Newest at the BOTTOM, nearest the button it belongs to — the direction
    // the eye travels when the amount drifts up and out.
    const list = drops.filter((d) => d.side === side).slice(-keep);
    return (
      <div className="flex min-w-0 flex-col items-center justify-end gap-0.5">
        <AnimatePresence initial={false}>
          {list.map((d, i) => (
            <motion.span
              key={d.key}
              initial={{ opacity: 0, y: 6 }}
              // y MUST be animated back to 0: `animate` replaces the whole
              // target, so an animate without `y` leaves the initial 6px
              // offset in place — which pushed the amount out of the card's
              // 16px line and clipped it in half.
              animate={{ opacity: i === list.length - 1 ? 1 : 0.45, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn(
                'text-nano font-semibold tabular-nums leading-tight',
                side === 'yes' ? 'text-green' : 'text-sky-bright'
              )}
            >
              +${d.amount}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    );
  };

  return (
    // Fixed height so the panel never jumps as amounts come and go, and
    // `overflow-hidden` so the third amount clips at the TOP as it drifts
    // out rather than spilling down over the buy button. aria-hidden
    // because none of this is real.
    <div
      aria-hidden
      className={cn(
        'grid grid-cols-2 gap-2 overflow-hidden',
        compact ? 'h-4' : 'h-11'
      )}
    >
      {column('yes')}
      {column('no')}
    </div>
  );
}
