'use client';

/**
 * v25.10 — the shared DATA half of the sport-chip heroes (UFC / Tennis /
 * Cricket / Motorsport).
 *
 * The first cut of these scenes (v25.8/9) scattered outcome tiles over a
 * top-down field drawing — a map with icons on it, which is exactly what
 * the owner rejected. The heroes this codebase keeps (BasketballHero's
 * arena, SportsHero's jumbotron) work differently: atmosphere in the
 * background, and ONE object that carries real market content — a screen,
 * a board, a tower — linking to real prices. This module now supplies the
 * content for such objects and nothing visual: each scene draws its own
 * world.
 *
 * All randomness derives from hashString(...) upstream — nothing here is
 * random at all, so server and client always agree.
 */

import { useMemo } from 'react';
import type { EventGroup, Market } from '@/lib/types';
import { outcomeLabels } from '@/components/markets/EventCard';

export interface SceneContent {
  /** The headline event, when there is one — the object's title + link. */
  headline?: EventGroup;
  /** Price-sorted, deduped markets: headline outcomes first, then other
   *  events' favorites, then flat markets. */
  board: Market[];
  /** Short display label per market id (team name over full question). */
  labels: Map<string, string>;
}

/**
 * Collect what a scene's content object shows.
 *
 * Order matters and mirrors BasketballHero's jumbotron: the biggest
 * event's outcomes lead (events arrive volume-sorted, outcomes get
 * price-sorted), then the next events' two favorites each, then flat
 * markets — important for cricket and motorsport, which often arrive as
 * FLAT markets with no parent event at all.
 */
export function useSceneContent(
  events: EventGroup[],
  markets: Market[],
  max = 10
): SceneContent {
  return useMemo(() => {
    const headline = events[0];
    const board: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (seen.has(m.id) || board.length >= max) return;
      seen.add(m.id);
      board.push(m);
    };

    if (headline) {
      [...headline.markets].sort((a, b) => b.yesPrice - a.yesPrice).forEach(add);
    }
    for (const e of events.slice(1)) {
      [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 2).forEach(add);
    }
    markets.forEach(add);

    return { headline, board, labels: outcomeLabels(board) };
  }, [events, markets, max]);
}
