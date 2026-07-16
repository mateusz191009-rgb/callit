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
import Skeleton from '@/components/ui/skeleton';

// Hex constants matching the Tailwind tokens (charts only).
const LINE = '#2C4356';
const TX_MUT = '#6F8CA4';

/** Shared outcome palette — green first (frontrunner), then sky/amber/rose. */
export const CHART_COLORS = ['#00E17E', '#3B9DF8', '#FFB547', '#FF5C7A'];

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
}: {
  series: OutcomeSeries[];
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);
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
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(t: number) =>
            new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }
          tick={{ fill: TX_MUT, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickFormatter={(v: number) => `${v}¢`}
          tick={{ fill: TX_MUT, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          content={<MultiTooltip />}
          cursor={{ stroke: LINE, strokeDasharray: '3 3' }}
        />
        {series.map((s, i) => (
          <Line
            key={`s${i}`}
            type="monotone"
            dataKey={`s${i}`}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: s.color, stroke: s.color }}
            animationDuration={600}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
