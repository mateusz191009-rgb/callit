'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { cn } from '@/lib/utils';
import type { PricePoint } from '@/lib/types';
import Skeleton from '@/components/ui/skeleton';

// Hex constants matching the Tailwind tokens (charts only).
const GREEN = '#00E17E';
const LINE = '#2C4356';
const TX_MUT = '#6F8CA4';

type RangeKey = '1D' | '1W' | 'ALL';

const RANGES: { key: RangeKey; ms: number }[] = [
  { key: '1D', ms: 24 * 60 * 60 * 1000 },
  { key: '1W', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'ALL', ms: Number.POSITIVE_INFINITY },
];

interface ChartPoint {
  t: number;
  cents: number;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0];
  const t = (point.payload as ChartPoint).t;
  const date = new Date(t);
  return (
    <div className="rounded-xl border border-line bg-surface-3 px-3 py-2 text-xs shadow-lg">
      <div className="text-tx-mut">
        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })},{' '}
        {date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}
      </div>
      <div className="font-bold text-tx tabular-nums">{point.value}¢</div>
    </div>
  );
}

export interface PriceChartProps {
  history: PricePoint[];
  /** Header label — pass `sideLabel(market, 'yes')` so a labeled market
   *  ('Over', 'England') names its own side. Absent = literal 'Yes'. */
  yesName?: string;
  className?: string;
}

/** Yes-probability area chart with 1D / 1W / ALL range pills. */
export default function PriceChart({ history, yesName, className }: PriceChartProps) {
  const [range, setRange] = useState<RangeKey>('ALL');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const allPoints = useMemo<ChartPoint[]>(
    () =>
      [...history]
        .sort((a, b) => a.t - b.t)
        .map((p) => ({ t: p.t, cents: Math.round(p.yes * 100) })),
    [history]
  );

  const data = useMemo<ChartPoint[]>(() => {
    const rangeMs = RANGES.find((r) => r.key === range)?.ms ?? Number.POSITIVE_INFINITY;
    const cutoff = Date.now() - rangeMs;
    const filtered =
      rangeMs === Number.POSITIVE_INFINITY
        ? allPoints
        : allPoints.filter((p) => p.t >= cutoff);
    // Fall back to the full history when the range is too sparse.
    const points = filtered.length >= 2 ? filtered : allPoints;
    // A single point still deserves a flat line.
    if (points.length === 1) {
      return [{ t: points[0].t - 60 * 60 * 1000, cents: points[0].cents }, points[0]];
    }
    return points;
  }, [allPoints, range]);

  const xTickFormatter = (t: number) => {
    const date = new Date(t);
    if (range === '1D') {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className={cn('rounded-2xl border border-line bg-surface-2 p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-tx-mut">
          {yesName ?? 'Yes'} probability
        </span>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors',
                range === r.key
                  ? 'border-green/40 bg-green/15 text-green'
                  : 'border-transparent text-tx-mut hover:bg-surface-3 hover:text-tx-sec'
              )}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {!mounted ? (
        <Skeleton className="h-[280px] w-full" />
      ) : data.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center text-sm text-tx-mut">
          No price history yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="callit-yes-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GREEN} stopOpacity={0.25} />
                <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={xTickFormatter}
              tick={{ fill: TX_MUT, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
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
              content={<ChartTooltip />}
              cursor={{ stroke: LINE, strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey="cents"
              stroke={GREEN}
              strokeWidth={2}
              fill="url(#callit-yes-fill)"
              dot={false}
              activeDot={{ r: 3, fill: GREEN, stroke: GREEN }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
