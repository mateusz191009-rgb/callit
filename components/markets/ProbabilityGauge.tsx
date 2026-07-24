'use client';

import { motion } from 'framer-motion';
import { formatPercent } from '@/lib/format';

/**
 * SVG donut gauge for the Yes share of a market. The arc is ALWAYS green —
 * it represents the Yes probability, not sentiment — with the track drawn
 * in the `line` token color. Animates the stroke on mount.
 *
 * v24.6 — `variant="semi"` renders the Polymarket-style half-circle gauge
 * used on binary market cards: same colors, arc opens downward, the number
 * sits inside the arc's mouth.
 */
export default function ProbabilityGauge({
  value,
  size = 72,
  label,
  variant = 'ring',
}: {
  value: number;
  size?: number;
  label?: string;
  variant?: 'ring' | 'semi';
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const strokeWidth = Math.max(4, Math.round(size / 12));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  if (variant === 'semi') {
    const cx = size / 2;
    const cy = size / 2;
    const height = size / 2 + strokeWidth / 2;
    const arcLength = Math.PI * radius;
    const d = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
    return (
      <div className="inline-flex flex-col items-center gap-0.5">
        <div
          className="relative"
          style={{ width: size, height }}
          role="img"
          aria-label={`${formatPercent(clamped)} probability${label ? ` — ${label}` : ''}`}
        >
          <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} aria-hidden>
            <path
              d={d}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              stroke="currentColor"
              className="text-line"
            />
            <motion.path
              d={d}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              stroke="currentColor"
              className="text-green"
              strokeDasharray={arcLength}
              initial={{ strokeDashoffset: arcLength }}
              animate={{ strokeDashoffset: arcLength * (1 - clamped) }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          </svg>
          <span
            className="absolute inset-x-0 bottom-0 text-center font-black tabular-nums text-tx"
            style={{ fontSize: Math.max(11, Math.round(size * 0.22)) }}
          >
            {formatPercent(clamped)}
          </span>
        </div>
        {label && (
          <span
            className="max-w-full truncate text-center text-[10px] font-bold uppercase tracking-wide text-tx-mut"
            style={{ maxWidth: size * 1.3 }}
          >
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <div
        className="relative"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${formatPercent(clamped)} probability${label ? ` — ${label}` : ''}`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            stroke="currentColor"
            className="text-line"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            stroke="currentColor"
            className="text-green"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - clamped) }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span
            className="font-black tabular-nums text-tx"
            style={{ fontSize: Math.max(11, Math.round(size * 0.24)) }}
          >
            {formatPercent(clamped)}
          </span>
        </div>
      </div>
      {label && (
        <span
          className="max-w-full truncate text-center text-[11px] font-bold uppercase tracking-wide text-tx-mut"
          style={{ maxWidth: size * 1.6 }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
