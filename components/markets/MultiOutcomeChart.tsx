'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { PricePoint } from '@/lib/types';
import { cn } from '@/lib/utils';
import Skeleton from '@/components/ui/skeleton';

import { CHART_LINE as LINE, CHART_TX_MUT as TX_MUT } from './chartTokens';

type RangeKey = '1D' | '1W' | 'ALL';

const RANGES: { key: RangeKey; ms: number }[] = [
  { key: '1D', ms: 24 * 60 * 60 * 1000 },
  { key: '1W', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'ALL', ms: Number.POSITIVE_INFINITY },
];

// Re-exported for existing importers; the values live in ./chartTokens so
// they can be imported without dragging recharts along.
export { CHART_COLORS } from './chartTokens';

export interface OutcomeSeries {
  name: string;
  color: string;
  history: PricePoint[];
}

interface Row {
  [key: string]: number;
  t: number;
}

function MultiTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const t = (payload[0].payload as Row).t;
  const date = new Date(t);
  const entries = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className="rounded-xl border border-line bg-surface-3 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-mut">
        {date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </div>
      <div className="space-y-1">
        {entries.map((e) => (
          <div key={String(e.dataKey)} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: e.color }}
              aria-hidden
            />
            <span className="max-w-[160px] truncate text-tx-sec">{e.name}</span>
            <span className="ml-auto pl-3 font-bold text-tx tabular-nums">
              {Number(e.value)}¢
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Multi-line probability chart for event outcomes. Merges every series onto
 * a shared time axis (union of timestamps, forward-filled) so lines with
 * slightly different sampling still align.
 */
export default function MultiOutcomeChart({
  series,
  height = 220,
  showRange = false,
}: {
  series: OutcomeSeries[];
  height?: number;
  /** Polymarket-style 1D / 1W / ALL pills under the chart. Off by default so
   *  compact embeds (FeaturedHero) stay exactly as they are. */
  showRange?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<RangeKey>('ALL');
  useEffect(() => setMounted(true), []);

  const data = useMemo<Row[]>(() => {
    const ts = new Set<number>();
    for (const s of series) for (const p of s.history) ts.add(p.t);
    const sortedTs = [...ts].sort((a, b) => a - b);
    const hists = series.map((s) => [...s.history].sort((a, b) => a.t - b.t));
    const cursor = hists.map(() => 0);
    const last: (number | undefined)[] = hists.map(() => undefined);

    return sortedTs.map((t) => {
      const row: Row = { t };
      hists.forEach((h, i) => {
        while (cursor[i] < h.length && h[cursor[i]].t <= t) {
          last[i] = h[cursor[i]].yes;
          cursor[i] += 1;
        }
        // Forward-fill; back-fill the leading gap with the first sample.
        const v = last[i] ?? h[0]?.yes;
        if (v !== undefined) row[`s${i}`] = Math.round(v * 100);
      });
      return row;
    });
  }, [series]);

  // Range filter over the merged rows; too-sparse ranges fall back to the
  // full history exactly like PriceChart.
  const shown = useMemo<Row[]>(() => {
    const rangeMs = RANGES.find((r) => r.key === range)?.ms ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(rangeMs)) return data;
    const cutoff = Date.now() - rangeMs;
    const filtered = data.filter((r) => r.t >= cutoff);
    return filtered.length >= 2 ? filtered : data;
  }, [data, range]);

  /**
   * Y range from the DATA, not a fixed 0-100.
   *
   * A four-way title race trades at 22/20/14/9¢, and on a 0-100 axis all
   * four lines sat crushed into the bottom fifth of the panel with 80% of
   * the chart empty — the movement the chart exists to show was invisible.
   * Polymarket scales to the range for the same reason.
   *
   * Two guards keep the zoom honest: never tighter than MIN_SPAN, so a
   * market that has barely moved reads as flat instead of as a
   * rollercoaster of noise; and always clamped inside 0-100, because a
   * probability axis running past either end is nonsense.
   */
  const yDomain = useMemo<[number, number]>(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const row of shown) {
      for (const key in row) {
        if (key === 't') continue;
        const v = row[key];
        if (typeof v !== 'number') continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];

    const MIN_SPAN = 20;
    const pad = Math.max(2, (hi - lo) * 0.15);
    let min = lo - pad;
    let max = hi + pad;
    if (max - min < MIN_SPAN) {
      const mid = (lo + hi) / 2;
      min = mid - MIN_SPAN / 2;
      max = mid + MIN_SPAN / 2;
    }
    return [Math.max(0, Math.floor(min)), Math.min(100, Math.ceil(max))];
  }, [shown]);

  const xTickFormatter = (t: number) => {
    const date = new Date(t);
    if (showRange && range === '1D') {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!mounted) {
    return (
      <div style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (series.length === 0 || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-tx-mut"
        style={{ height }}
      >
        No price history yet.
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
      {/* Axis on the RIGHT, like Polymarket's: it puts each tick next to the
          line ends it labels, and it retires the -16px left margin that was
          clipping the widest tick — "100¢" rendered as "00¢". */}
      <LineChart data={shown} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 6" stroke={LINE} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={xTickFormatter}
          tick={{ fill: TX_MUT, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          // A week of history was printing a label per day — eleven of them,
          // crowding the axis. Wide gaps leave the handful that orient you.
          minTickGap={90}
        />
        <YAxis
          orientation="right"
          domain={yDomain}
          tickCount={4}
          tickFormatter={(v: number) => `${Math.round(v)}¢`}
          tick={{ fill: TX_MUT, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          content={<MultiTooltip />}
          cursor={{ stroke: LINE, strokeDasharray: '3 3' }}
        />
        {series.map((s, i) => (
          <Line
            key={`s${i}`}
            // `linear`, not `monotone`: the spline was rounding every tick
            // into a wave, so the chart showed motion between two samples
            // that the market never made. Prices step; draw them stepping.
            type="linear"
            dataKey={`s${i}`}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            // A dot on the last sample, so each line's current value is
            // pinned against its axis label instead of trailing off.
            dot={(props: { key?: string; index?: number; cx?: number; cy?: number }) =>
              props.index === shown.length - 1 &&
              typeof props.cx === 'number' &&
              typeof props.cy === 'number' ? (
                <circle key={props.key} cx={props.cx} cy={props.cy} r={3} fill={s.color} />
              ) : (
                <g key={props.key} />
              )
            }
            activeDot={{ r: 3, fill: s.color, stroke: s.color }}
            animationDuration={600}
          />
        ))}
      </LineChart>
      </ResponsiveContainer>
      {showRange && (
        <div className="mt-1 flex items-center justify-end gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={cn(
                'rounded-full border px-2.5 py-1 text-micro font-bold transition-colors',
                range === r.key
                  ? 'border-green/40 bg-green/15 text-green'
                  : 'border-transparent text-tx-mut hover:bg-surface-3 hover:text-tx-sec'
              )}
            >
              {r.key}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
