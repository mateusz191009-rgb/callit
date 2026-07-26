'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { EventGroup, Market } from '@/lib/types';
import Button from '@/components/ui/button';
import EventCard from './EventCard';
import MarketCard from './MarketCard';

/**
 * v25.17 — THE ONE MIXED GRID, in one place.
 *
 * The home page and every category hub render the same thing: events and
 * flat markets interleaved by the active sort, capped at GRID_PAGE cards,
 * the rest behind "Show more markets" (v25.16). Both had their own copy of
 * the grid + the `shown` state + the reset effect, which is how they drifted
 * apart; this component owns all three so a change lands on both surfaces.
 *
 * Sorting and filtering stay with the caller — it passes an ordered item
 * list and a `resetKey`. Whenever that key changes (a tab, a sport chip, a
 * search query, a different category) the grid starts back at the top,
 * because a card cap that survived a filter change would leave the user
 * scrolled into the middle of a list they did not ask for.
 */

export interface MixedGridItem {
  kind: 'event' | 'market';
  /** Stable across re-sorts — the reveal animation keys off mount. */
  key: string;
  event?: EventGroup;
  market?: Market;
}

/** Cards the mixed grid shows per "Show more markets" click (v25.16). */
export const GRID_PAGE = 20;

/** Seconds between two consecutive cards of one reveal. */
const STAGGER = 0.035;
/** Cap on the stagger, so the last card of a 20-card batch is not a
 *  second behind the first. */
const STAGGER_MAX = 0.32;

/**
 * Column tracks. 'full' is the home page's four-up; 'hub' is one narrower,
 * for the category hubs since v25.19 — the sub-category rail takes ~208px off
 * the row and four cards in the remainder squeeze team names and the buy pair.
 */
const COLUMNS = {
  full: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  hub: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3',
} as const;

export default function MixedGrid({
  items,
  resetKey,
  columns = 'full',
}: {
  items: MixedGridItem[];
  /** Change it to send the grid back to the first page of cards. */
  resetKey?: unknown;
  columns?: keyof typeof COLUMNS;
}) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(GRID_PAGE);

  /**
   * Index of the first card of the LAST reveal — everything from here on
   * animates in, everything before it is already on screen and must not
   * move. `Infinity` means "nothing is new", which is the state on first
   * paint and after every reset: the initial page of cards is part of the
   * page load, not a reveal.
   *
   * A ref, not state, on purpose: framer-motion runs `initial` only when an
   * element MOUNTS, and card keys are stable, so this value is read exactly
   * once per card — on the render that first shows it. The 60s feed refresh
   * re-renders the grid without remounting those cards, so nothing replays.
   */
  const revealFrom = useRef(Infinity);

  useEffect(() => {
    setShown(GRID_PAGE);
    revealFrom.current = Infinity;
  }, [resetKey]);

  return (
    <>
      {/* v25.18 — gap-3 with the tighter cards: at gap-4 the shorter cards
          started reading as isolated tiles rather than one grid. */}
      <div className={COLUMNS[columns]}>
        {items.slice(0, shown).map((item, i) => {
          const offset = i - revealFrom.current;
          const isNew = offset >= 0;
          return (
            <motion.div
              key={item.key}
              initial={isNew && !reduceMotion ? { opacity: 0, y: 14, scale: 0.98 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                duration: 0.28,
                ease: [0.22, 1, 0.36, 1],
                delay: isNew ? Math.min(offset * STAGGER, STAGGER_MAX) : 0,
              }}
            >
              {item.kind === 'event' && item.event ? (
                <EventCard event={item.event} />
              ) : item.market ? (
                <MarketCard market={item.market} />
              ) : null}
            </motion.div>
          );
        })}
      </div>

      {items.length > shown && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              revealFrom.current = shown;
              setShown((n) => n + GRID_PAGE);
            }}
          >
            Show more markets
          </Button>
        </div>
      )}
    </>
  );
}
