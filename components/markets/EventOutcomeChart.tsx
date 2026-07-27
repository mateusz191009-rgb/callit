'use client';

import dynamic from 'next/dynamic';

import Skeleton from '@/components/ui/skeleton';
import { useYesHistories } from '@/lib/useHistory';
import type { OutcomeSeries } from './MultiOutcomeChart';

/** The 1D / 1W / ALL row's height, reserved while loading so resolving the
 *  history does not nudge the page. */
const RANGE_ROW_H = 36;

/** Lazy for the same reason its two call sites were: recharts is ~90-110 KB
 *  gzipped and both legends paint from ./chartTokens without it. No `loading`
 *  fallback — the wrapper below reserves the exact height, and the chart
 *  renders its own skeleton until it has mounted. */
const MultiOutcomeChart = dynamic(() => import('./MultiOutcomeChart'), {
  ssr: false,
});

export interface EventOutcomeChartProps {
  /** One entry per charted outcome, in the same order as `ids`. `history` is
   *  the fallback series (the seeded walk) — replaced per outcome by the
   *  source's own where there is one. */
  series: OutcomeSeries[];
  /** Market ids for `series`, positionally. */
  ids: string[];
  height?: number;
  showRange?: boolean;
}

/**
 * The event page's outcome chart, drawn from REAL history where it exists
 * (v25.26).
 *
 * A wrapper rather than a fetch inside EventDetail on purpose: the ids are
 * derived from the event, which EventDetail only has AFTER its not-found
 * early return, and a hook cannot live there. One request covers all four
 * outcomes.
 */
export default function EventOutcomeChart({
  series,
  ids,
  height = 300,
  showRange,
}: EventOutcomeChartProps) {
  const { histories, ready } = useYesHistories(ids);
  const anyReal = ids.some((id) => histories[id]);

  /**
   * Nothing is drawn until the real series has been asked for.
   *
   * v25.26 shipped the fallback walk first and swapped it for the real curve
   * when it landed — one chart visibly redrawing into a different one a beat
   * after the page settled (owner: "zuerst kommt kurz unser alter und dann der
   * neue"). A skeleton is the honest state: we do not know this market's shape
   * yet. The wrapper holds the exact final height either way, so nothing
   * shifts when it resolves.
   */
  if (!ready) {
    return (
      <div style={{ minHeight: height + (showRange ? RANGE_ROW_H : 0) }}>
        <div style={{ height }}>
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  const merged = series.map((s, i) => {
    const real = histories[ids[i]];
    if (!real) return s;
    // Same tail treatment as the market page: the CLOB series ends at its
    // last hourly close, the legend beside it prints the live percentage.
    return { ...s, history: [...real, { t: Date.now(), yes: s.current ?? real[real.length - 1].yes }] };
  });

  return (
    <div style={{ minHeight: height }}>
      <MultiOutcomeChart series={merged} height={height} showRange={showRange} />
      {ready && !anyReal && (
        <p className="mt-2 text-micro text-tx-mut">
          Illustrative paths — the source has no chart for these outcomes. The
          current percentages are live.
        </p>
      )}
    </div>
  );
}
