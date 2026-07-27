'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import type { Side } from '@/lib/types';
import { isMarketClosed } from '@/lib/format';
import { useCallitStore } from '@/lib/store';
import { fakeTradeAmount, fakeTradesFor } from '@/lib/useActivity';
import { cn } from '@/lib/utils';

/**
 * Order flow above the two buy buttons (v25.35, rebuilt v25.37).
 *
 * Owner, pointing at Polymarket's 5-minute BTC market twice: amounts STACK
 * over each side, drift upward as new ones land, and fade out as they rise —
 * "bei denen ist auch unten so nice opacity und die animation dahinter ist
 * viel nicer und hochwertiger als bei uns". v25.36 showed a single number on
 * a reserved 16px line, which read exactly as flat as it sounds.
 *
 * How the feel is built, since every part of it matters:
 *   - It OVERLAYS instead of reserving space (`absolute bottom-full`), so a
 *     card keeps its height and the column can be 40px tall without pushing
 *     anything down.
 *   - A mask fades the column out towards its top edge, so an amount
 *     dissolves as it rises instead of vanishing at a hard boundary — the
 *     same trick as the sticky header's gradient.
 *   - `layout` on each amount animates the PUSH: a new one enters at the
 *     bottom and the stack slides up under it, which is the motion the eye
 *     actually reads as flow.
 *   - Opacity steps down with age (1 / .55 / .3), so depth is visible even
 *     in a still frame.
 *
 * HONESTY, because this is a money surface. These amounts are the same
 * DELIBERATELY FAKE activity the Activity tab carries (lib/useActivity —
 * there is no public per-market trade feed to read, and inventing one that
 * LOOKED authoritative is the one thing this app refuses to do). So:
 * `aria-hidden`, never counted, never presented as a total, and it stops
 * dead on a closed or resolved market, where real flow would be zero too.
 *
 * CARDS ONLY (owner, v25.36). Not in the trade ticket — that is where a real
 * amount is entered against a real preview — and not over the price chart,
 * which is the one genuine data visualisation on the market page.
 */

/**
 * Amounts visible per side before the oldest fades out of the stack.
 *
 * TWO, not three, and that is a card-density decision rather than taste:
 * Polymarket runs this column in their trade RAIL, which has a whole panel
 * of room above it. On our cards the buy pair sits ~30px under the question,
 * so a third amount lands on top of the title text — verified in a zoomed
 * screenshot. Two fit in the gap, still read as a stack, and still fade.
 */
const KEEP = 2;

/** Opacity by age, newest first. */
const FADE = [1, 0.32];

/** How often a new amount lands, randomised per tick so the two sides never
 *  march in lockstep. */
const MIN_GAP_MS = 1800;
const MAX_GAP_MS = 4500;

/** One process-wide cap on how many of these run timers at once: a 40-card
 *  grid must not open 40 timers. Cards past the cap render their seeded
 *  stack and stay still, which is indistinguishable at a glance. */
const MAX_ACTIVE = 8;
let active = 0;

interface Drop {
  key: number;
  side: Side;
  amount: number;
}

export default function SideFlow({ marketId }: { marketId: string }) {
  /**
   * SEEDED ON MOUNT, and that is the difference between "cool" and "there is
   * nothing there": the first tick lands seconds after mount, so the band sat
   * empty on every card until then (the owner's "ich sehe das mit den zahlen
   * noch nicht"). The seed comes from the same deterministic per-market feed
   * the Activity tab uses, so the stack is stable across a reload.
   */
  const [drops, setDrops] = useState<Drop[]>(() =>
    fakeTradesFor(marketId, KEEP * 2)
      .slice()
      .reverse()
      .map((t, i) => ({ key: i, side: t.side, amount: t.amount }))
  );
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // Purely decorative motion — someone who asked the OS for less of it
    // should not be paying for a timer either. The seeded stack stays.
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
          // The side lean follows the live Yes probability: a 78¢ favourite
          // draws the flow it should.
          const side: Side = Math.random() < market.yesPrice ? 'yes' : 'no';
          setDrops((prev) =>
            [
              ...prev,
              {
                key: Date.now() + Math.random(),
                side,
                amount: fakeTradeAmount(Math.random()),
              },
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
    // Newest at the BOTTOM, nearest the button it belongs to; the stack
    // grows upward, which is the direction the amounts travel.
    const list = drops.filter((d) => d.side === side).slice(-KEEP);
    return (
      <div className="flex min-w-0 flex-col items-center justify-end gap-px pb-1">
        <AnimatePresence initial={false} mode="popLayout">
          {list.map((d, i) => (
            <motion.span
              key={d.key}
              layout
              // Enter on OPACITY ALONE. A y-offset on entry pushes the newest
              // amount below the overlay's bottom edge — which is the button's
              // top edge — and `overflow-hidden` then clips it mid-animation
              // (measured: the gap above the buy pair is 17px, so there is
              // nowhere for it to dip). The rise is already there for free:
              // `layout` animates the older amounts being pushed up when a new
              // one lands, and that is the motion the eye reads as flow.
              initial={{ opacity: 0 }}
              animate={{ opacity: FADE[list.length - 1 - i] ?? 0.2 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className={cn(
                'text-nano font-semibold leading-[1.35] tabular-nums',
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
    <div
      aria-hidden
      className={cn(
        // Overlay, not a reserved row: the card keeps its height.
        // h-10 with 28px of content and pb-1: SLACK, deliberately. At an
        // exact fit the bottom amount kept getting clipped mid-animation —
        // `layout` + popLayout move items transiently, and an overlay with
        // no room clips whatever moves. The mask hides the extra height.
        'pointer-events-none absolute inset-x-0 bottom-full grid h-10 grid-cols-2 gap-2 overflow-hidden',
        // …and it dissolves upward instead of ending at a cut, so the older
        // amount is already half gone by the time it reaches the question.
        // Steep on purpose: the card's title starts ~11px into this overlay,
        // so the older amount has to be nearly gone by the time it gets
        // there — faint depth over the question, never text on text.
        '[mask-image:linear-gradient(to_top,#000_40%,transparent_88%)]'
      )}
    >
      {column('yes')}
      {column('no')}
    </div>
  );
}
