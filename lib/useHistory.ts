'use client';

import { useEffect, useState } from 'react';
import type { PricePoint } from './types';

/**
 * Real yes-side history for the markets a page is charting (v25.26).
 *
 * One request for the whole set — the market page asks for one id, the event
 * page for its four charted outcomes — answered by /api/history from
 * Polymarket's CLOB. Markets with no source series simply do not appear in the
 * returned map, and the caller keeps drawing `market.priceHistory`, which for
 * a feed row is the illustrative walk (see lib/utils.ts).
 *
 * Failure is silence, like every other optional read in this app: the chart
 * that was already rendering keeps rendering.
 */
export function useYesHistories(ids: string[]): {
  histories: Record<string, PricePoint[]>;
  /** The request has settled — with data or without. `false` while it is in
   *  flight, which is what keeps the "illustrative" note from flashing on
   *  every chart for the second before the real series lands. */
  ready: boolean;
} {
  // The join is the dep, not the array: callers build a fresh array on every
  // render and an array dep would refetch on every one of them.
  const key = ids.filter(Boolean).join(',');
  const [state, setState] = useState<{
    key: string;
    histories: Record<string, PricePoint[]>;
  }>({ key: '', histories: {} });

  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch(`/api/history?ids=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { history?: Record<string, PricePoint[] | null> } | null) => {
        if (!alive) return;
        const next: Record<string, PricePoint[]> = {};
        for (const [id, points] of Object.entries(data?.history ?? {})) {
          if (Array.isArray(points) && points.length > 1) next[id] = points;
        }
        setState({ key, histories: next });
      })
      // A failed read settles too: the chart keeps its fallback series, and
      // saying it is illustrative is then exactly right.
      .catch(() => {
        if (alive) setState({ key, histories: {} });
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return {
    histories: state.key === key ? state.histories : {},
    ready: state.key === key,
  };
}
