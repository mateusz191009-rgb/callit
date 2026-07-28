'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
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
import {
  CHART_COLORS,
  CHART_GREEN as GREEN,
  CHART_LINE as LINE,
  CHART_TX_MUT as TX_MUT,
} from '@/components/markets/chartTokens';
import { endLabels } from '@/components/markets/chartEndLabels';

/** The No side draws in the same sky the rest of the app gives it. */
const SKY = CHART_COLORS[1];

type RangeKey = '1D' | '1W' | 'ALL';

const RANGES: { key: RangeKey; ms: number }[] = [
  { key: '1D', ms: 24 * 60 * 60 * 1000 },
  { key: '1W', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'ALL', ms: Number.POSITIVE_INFINITY },
];

interface ChartPoint {
  t: number;
  cents: number;
  /** 100 - cents, precomputed so both lines share one row (see allPoints). */
  no: number;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const t = (payload[0].payload as ChartPoint).t;
  const date = new Date(t);
  // Both sides, favourite first — the same order the end labels stack in.
  const entries = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className="rounded-xl border border-line bg-surface-3 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-mut">
        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })},{' '}
        {date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
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
            <span className="max-w-[140px] truncate text-tx-sec">{e.name}</span>
            <span className="ml-auto pl-3 font-bold text-tx tabular-nums">
              {Number(e.value)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PriceChartProps {
  history: PricePoint[];
  /** Header label — pass `sideLabel(market, 'yes')` so a labeled market
   *  ('Over', 'England') names its own side. Absent = literal 'Yes'. */
  yesName?: string;
  /** v25.30 — the second side's name. When present the chart draws BOTH
   *  lines, Polymarket-style: the No side is the Yes complement, in sky,
   *  with each side's name + live percent labelled at its line's end.
   *  Absent keeps the single-line chart (compact embeds). */
  noName?: string;
  /** v25.26 — this series is the seeded walk from lib/utils.ts, not the
   *  source's own history (community rows, and anything neither provider has
   *  a series for). Says so under the chart: ranging over invented movement
   *  while saying nothing is the same class of claim as the leaderboard's
   *  invented rankings, which this app already labels. */
  illustrative?: boolean;
  /** v25.27 — the real series is still being fetched. Holds the skeleton
   *  rather than drawing the fallback walk and redrawing a beat later: one
   *  chart turning into a different one is worse than a chart arriving. */
  loading?: boolean;
  className?: string;
}

/** Yes-probability area chart with 1D / 1W / ALL range pills. */
export default function PriceChart({
  history,
  yesName,
  noName,
  illustrative,
  loading,
  className,
}: PriceChartProps) {
  const twoSided = noName !== undefined;
  const [range, setRange] = useState<RangeKey>('ALL');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const allPoints = useMemo<ChartPoint[]>(
    () =>
      [...history]
        .sort((a, b) => a.t - b.t)
        // `no` is derived from the ROUNDED yes, so the two lines always
        // mirror to exactly 100 — same rule as formatNoCents.
        .map((p) => {
          const cents = Math.round(p.yes * 100);
          return { t: p.t, cents, no: 100 - cents };
        }),
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
      return [{ ...points[0], t: points[0].t - 60 * 60 * 1000 }, points[0]];
    }
    return points;
  }, [allPoints, range]);

  /**
   * Y range from the data, not a fixed 0-100 — see MultiOutcomeChart for
   * the reasoning. A market trading 47-53¢ was rendering as a dead flat
   * line across the middle of the panel.
   *
   * MIN_SPAN is what stops the opposite failure: without it, a market that
   * moved half a cent all week would be zoomed until that half-cent filled
   * the panel and read as violent movement.
   */
  const yDomain = useMemo<[number, number]>(() => {
    if (data.length === 0) return [0, 100];
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of data) {
      if (p.cents < lo) lo = p.cents;
      if (p.cents > hi) hi = p.cents;
    }
    // Two-sided: the No line is the mirror, so the domain is the union of
    // the series and its complement — symmetric around 50 by construction.
    if (twoSided) {
      const mirrorLo = 100 - hi;
      const mirrorHi = 100 - lo;
      lo = Math.min(lo, mirrorLo);
      hi = Math.max(hi, mirrorHi);
    }
    const MIN_SPAN = 20;
    const pad = Math.max(2, (hi - lo) * 0.15);
    let min = lo - pad;
    let max = hi + pad;
    if (max - min < MIN_SPAN) {
      const mid = (lo + hi) / 2;
      min = mid - MIN_SPAN / 2;
      max = mid + MIN_SPAN / 2;
    }
    // Ends snapped to 5s so the ticks come out round — see MultiOutcomeChart.
    return [
      Math.max(0, Math.floor(min / 5) * 5),
      Math.min(100, Math.ceil(max / 5) * 5),
    ];
  }, [data, twoSided]);

  /** Round ticks, ~3-4 across the domain — minus any tick that would sit
   *  under a line-end label. The labels ARE the axis at those heights; a
   *  tick underneath just prints through the halo as garbage. ~18px of the
   *  ~240px plot, converted into value space. */
  const yTicks = useMemo(() => {
    const [min, max] = yDomain;
    const step = [5, 10, 20, 25, 50].find((s) => (max - min) / s <= 4) ?? 50;
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    if (data.length === 0) return out;
    const last = data[data.length - 1];
    const occupied = twoSided ? [last.cents, last.no] : [last.cents];
    const clearance = ((max - min) * 18) / 240;
    return out.filter((t) => occupied.every((v) => Math.abs(t - v) > clearance));
  }, [yDomain, data, twoSided]);

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

  // p-5 matches TradePanel, which sits directly beside this card in the
  // market page's rail — the two were 4px apart and it showed.
  return (
    <div className={cn('card-surface p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-tx-mut">
          {twoSided ? 'Probability' : (yesName ?? 'Yes') + ' probability'}
        </span>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={cn(
                'rounded-full border px-2.5 py-1 text-micro font-semibold transition-colors',
                range === r.key
                  ? 'border-line-strong bg-surface-3 text-tx'
                  : 'border-transparent text-tx-mut hover:bg-surface-3 hover:text-tx-sec'
              )}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {!mounted || loading ? (
        <Skeleton className="h-[280px] w-full" />
      ) : data.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center text-sm text-tx-mut">
          No price history yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          {/* Axis right, no negative left margin — see MultiOutcomeChart:
              the -16px was clipping "100¢" down to "00¢". The right margin
              is the gutter the line-end labels draw into. */}
          <LineChart
            data={data}
            margin={{ top: 8, right: twoSided ? 12 : 4, left: 4, bottom: 0 }}
          >
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
              minTickGap={90}
            />
            <YAxis
              orientation="right"
              domain={yDomain}
              ticks={yTicks}
              tickFormatter={(v: number) => `${Math.round(v)}%`}
              tick={{ fill: TX_MUT, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: LINE, strokeDasharray: '3 3' }}
            />
            {/* `linear`: a market at 47-53¢ was being drawn as a smooth
                wave by the spline, inventing movement between samples. No
                entrance animation — a trading chart is either there or it
                is not; a line sweeping in is decoration. */}
            <Line
              type="linear"
              dataKey="cents"
              name={yesName ?? 'Yes'}
              stroke={GREEN}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: GREEN, stroke: GREEN }}
              isAnimationActive={false}
            />
            {twoSided && (
              <Line
                type="linear"
                dataKey="no"
                name={noName}
                stroke={SKY}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: SKY, stroke: SKY }}
                isAnimationActive={false}
              />
            )}
            {/* Each side's name + live percent at its line's end — the
                Polymarket read: the line ends, and the answer is there. */}
            {data.length > 0 && (
              <Customized
                component={endLabels(
                  twoSided
                    ? [
                        {
                          value: data[data.length - 1].cents,
                          color: GREEN,
                          name: yesName ?? 'Yes',
                        },
                        {
                          value: data[data.length - 1].no,
                          color: SKY,
                          name: noName,
                        },
                      ]
                    : [{ value: data[data.length - 1].cents, color: GREEN }]
                )}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {illustrative && data.length > 0 && (
        <p className="mt-2 text-micro text-tx-mut">
          {/* v25.43 — "the source has no chart" was written when only feed
              markets could land here. A community market has no source at
              all, so on one the old line named a thing that does not exist. */}
          Illustrative path — this market has no traded history to chart. The
          current price is live.
        </p>
      )}
    </div>
  );
}
