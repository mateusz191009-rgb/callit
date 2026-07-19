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
    if (data.scores && typeof data.scores === 'object') {
      scores = data.scores as Record<string, GameScore>;
      for (const l of listeners) l();
    }
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

/** Live score for one event, or undefined. */
export function useScore(eventId: string | undefined): GameScore | undefined {
  const all = useScores();
  return eventId ? all[eventId] : undefined;
}
