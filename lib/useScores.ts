'use client';

import { useSyncExternalStore } from 'react';
import type { GameScore } from './types';

/**
 * Shared live-score store (v21). One /api/scores poll app-wide no matter
 * how many components subscribe (every EventCard does); the interval only
 * runs while at least one subscriber is mounted. Failures keep the last
 * good payload — a blank ticker is worse than a 45s-old one.
 */

const REFRESH_MS = 45_000;

/** Stable empty snapshot for SSR / pre-first-fetch. */
const EMPTY: Record<string, GameScore> = {};

let scores: Record<string, GameScore> = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastFetchAt = 0;

async function refresh(): Promise<void> {
  lastFetchAt = Date.now();
  try {
    const res = await fetch('/api/scores');
    if (!res.ok) return;
    const data = (await res.json()) as { scores?: unknown };
    if (!data.scores || typeof data.scores !== 'object') return;
    const incoming = data.scores as Record<string, GameScore>;

    // Carry the PREVIOUS object forward for every game whose score is
    // unchanged. Fresh JSON gives every entry a new identity each poll, so
    // without this `scores[id]` differed on every tick even for a game that
    // finished hours ago — and `useScore` (below) would re-render its card
    // every 45s forever. Games are few and their rows are small, so the
    // stringify compare is cheaper than the renders it prevents.
    const next: Record<string, GameScore> = {};
    let changed = false;
    for (const [id, score] of Object.entries(incoming)) {
      const prev = scores[id];
      if (prev && JSON.stringify(prev) === JSON.stringify(score)) {
        next[id] = prev;
      } else {
        next[id] = score;
        changed = true;
      }
    }
    // A game LEAVING the payload is a change too, and the loop above cannot
    // see it.
    if (!changed && Object.keys(next).length !== Object.keys(scores).length) {
      changed = true;
    }
    if (!changed) return;

    scores = next;
    for (const l of listeners) l();
  } catch {
    /* keep the last good payload */
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // First subscriber (or return after everything unmounted): fetch now
  // unless the data is fresher than half the poll interval.
  if (Date.now() - lastFetchAt > REFRESH_MS / 2) void refresh();
  if (!timer) timer = setInterval(() => void refresh(), REFRESH_MS);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Live scores keyed by event id ({} until the first poll lands). */
export function useScores(): Record<string, GameScore> {
  return useSyncExternalStore(
    subscribe,
    () => scores,
    () => EMPTY
  );
}

/**
 * Live score for one event, or undefined.
 *
 * Subscribes to the ONE event, not the whole map. It used to read the
 * entire record and index into it, so every EventCard on screen re-rendered
 * on every poll — including the cards with no game at all, which were
 * indexing out `undefined` each time. Paired with the identity-preserving
 * merge in `refresh`, a card now re-renders only when its own score moves.
 */
export function useScore(eventId: string | undefined): GameScore | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (eventId ? scores[eventId] : undefined),
    () => undefined
  );
}
