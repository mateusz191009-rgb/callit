'use client';

/**
 * Category hero for /category/politics — "ELECTION NIGHT", a war-room
 * results board.
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a framed board panel (same inset box as FootballHero's pitch)
 * layered as a scene:
 *
 * - BACKDROP: the faint dotted grid (.politics-dots, shared with the old
 *   board) plus a thin scrolling results ticker across the top of the
 *   panel — the site marquee reused at whisper volume (top-6 markets,
 *   name + ¢, duplicated copy carries .ticker-dup so reduced motion
 *   drops it when the marquee stops).
 * - MIDGROUND: a semicircular PARLIAMENT ARC of 51 seat dots on three
 *   concentric arcs (SVG, deterministic trigonometry — no randomness).
 *   Seats fill green vs sky proportional to the frontrunner market's
 *   yesPrice and light up one by one on mount (staggered
 *   animation-delay, CSS only: .v7b-seat in globals.css). The signature
 *   ambient is a slow counting shimmer that sweeps the arc left to
 *   right forever (second animation on the same dots, angle-derived
 *   delay).
 * - FOREGROUND: 3-4 candidate cards (MarketIcon portraits up to 64px at
 *   xl, short name + bold ¢ badge) standing on a podium rail; the poll
 *   leader wears the green .politics-leader ring and a tiny LEADING
 *   micro-badge.
 *
 * Widths are measured against the 48% scene column (283px at sm, 340px
 * at lg, 463px at xl): 3 candidates below lg, 4 from lg, portraits
 * 40 -> 48 -> 64px. The candidate row is centered and does not wrap, so
 * re-measure at 640/1024/1280 before widening anything.
 *
 * Hover lifts a candidate (question via title attr), click opens the
 * market. Falls back to the node passed in `fallback` (the generic
 * floating-tiles hero) when the category has fewer than 3 usable markets.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { cn, hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/** Candidates on the podium (the 4th only renders from lg — the scene
 *  column is 283px at sm, which three cards already fill). */
const MAX_CANDIDATES = 4;
/** Markets scrolling through the results ticker. */
const MAX_TICKER = 6;

/**
 * Parliament arc: three concentric seat rows, 51 seats total (spec range
 * 40-60). Radii/counts are viewBox units of the 200x104 arc SVG below;
 * seat counts grow with radius so spacing stays even.
 */
const SEAT_ROWS: { radius: number; count: number }[] = [
  { radius: 50, count: 13 },
  { radius: 68, count: 17 },
  { radius: 86, count: 21 },
];
const ARC_CX = 100;
const ARC_CY = 100;

interface Seat {
  x: number;
  y: number;
  /** Frontrunner (Yes) seat vs the rest (No). */
  green: boolean;
  /** Light-up delay in ms (left-to-right cascade + hash jitter). */
  inDelay: number;
  /** Counting-shimmer phase in ms (angle-derived, so the pulse sweeps). */
  pulseDelay: number;
}

interface Candidate {
  market: Market;
  label: string;
}

export default function PoliticsHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  /** Candidate pool: event outcomes first (nominee/primary races are the
   *  heart of politics), then flat category markets. Deduped by id and
   *  sorted strongest-first so index 0 is always the frontrunner. */
  const pool = useMemo<Market[]>(() => {
    const out: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      out.push(m);
    };
    for (const e of events) {
      [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice).forEach(add);
    }
    markets.forEach(add);
    out.sort((a, b) => b.yesPrice - a.yesPrice);
    return out;
  }, [events, markets]);

  const candidates = useMemo<Candidate[]>(() => {
    const top = pool.slice(0, MAX_CANDIDATES);
    const labels = outcomeLabels(top);
    return top.map((m) => ({ market: m, label: labels.get(m.id) ?? m.question }));
  }, [pool]);

  const ticker = useMemo<Candidate[]>(() => {
    const top = pool.slice(0, MAX_TICKER);
    const labels = outcomeLabels(top);
    return top.map((m) => ({ market: m, label: labels.get(m.id) ?? m.question }));
  }, [pool]);

  const leader: Market | undefined = pool[0];

  /** Seat geometry + green/sky split from the frontrunner's yesPrice.
   *  Pure trigonometry over constants and hashString — deterministic. */
  const seats = useMemo<Seat[]>(() => {
    if (!leader) return [];
    const placed: { x: number; y: number; angle: number }[] = [];
    for (const row of SEAT_ROWS) {
      for (let k = 0; k < row.count; k++) {
        const angle = Math.PI * (1 - k / (row.count - 1)); // PI (left) -> 0 (right)
        placed.push({
          x: ARC_CX + row.radius * Math.cos(angle),
          y: ARC_CY - row.radius * Math.sin(angle),
          angle,
        });
      }
    }
    // Left-to-right across all rows: the green (Yes) block starts on the
    // left, exactly like a hemicycle seat projection.
    placed.sort((a, b) => b.angle - a.angle);
    const greenCount = Math.round(placed.length * leader.yesPrice);
    return placed.map((s, i) => ({
      x: s.x,
      y: s.y,
      green: i < greenCount,
      inDelay: i * 35 + (hashString(`${leader.id}:seat:${i}`) % 30),
      // Shimmer starts after the last seat has landed and sweeps with angle.
      pulseDelay: 2200 + Math.round((1 - s.angle / Math.PI) * 2600),
    }));
  }, [leader]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (pool.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Faint dotted war-room backdrop */}
      <div aria-hidden className="politics-dots absolute inset-0" />

      {/* Election-night board — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Board panel — same inset box as FootballHero's pitch, so the
            scene occupies the right half just as fully. */}
        <div className="absolute inset-x-5 inset-y-4 overflow-hidden rounded-2xl border border-line/70 bg-surface-3/25">
          {/* Results ticker — the site marquee at whisper volume. Pure
              decoration (the same data is on the cards below). */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 flex h-6 items-center overflow-hidden border-b border-line/60 opacity-70"
          >
            <div className="animate-marquee flex w-max items-center">
              {[0, 1].map((copy) => (
                <div key={copy} className={cn('flex items-center', copy === 1 && 'ticker-dup')}>
                  {ticker.map((t) => (
                    <span
                      key={`${copy}:${t.market.id}`}
                      className="flex items-center gap-1 whitespace-nowrap px-3 text-[9px] font-bold uppercase tracking-wider text-tx-mut"
                    >
                      <span className="max-w-[120px] truncate">{t.label}</span>
                      <span className="text-green tabular-nums">
                        {formatCents(t.market.yesPrice)}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* LIVE COUNT caption over the arc */}
          <div aria-hidden className="absolute inset-x-0 top-8 flex items-center justify-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
            </span>
            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-tx-mut">
              Live seat count
            </span>
          </div>

          {/* Parliament arc — seats light up one by one, then the counting
              shimmer sweeps left to right forever (.v7b-seat keyframes).
              The box runs down behind the candidates (who render later
              and sit at z-10), so the hemicycle reads as the midground
              of the war room rather than a small centered chart. */}
          <div aria-hidden className="absolute inset-x-4 bottom-8 top-9">
            <svg className="h-full w-full" viewBox="0 0 200 104" preserveAspectRatio="xMidYMax meet">
              {seats.map((s, i) => (
                <circle
                  key={i}
                  cx={s.x}
                  cy={s.y}
                  r={3.4}
                  className={cn('v7b-seat', s.green ? 'fill-green' : 'fill-sky')}
                  style={{ animationDelay: `${s.inDelay}ms, ${s.pulseDelay}ms` }}
                />
              ))}
            </svg>
          </div>

          {/* Podium rail the candidates stand on */}
          <div
            aria-hidden
            className="absolute inset-x-3 bottom-2 h-1.5 rounded-full border border-line bg-surface-3/80"
          />

          {/* Candidates — foreground layer, in front of the seat arc */}
          <div className="absolute inset-x-0 bottom-3.5 z-10 flex items-end justify-center gap-2 xl:gap-3">
            {candidates.map((c, i) => (
              <motion.div
                key={c.market.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                transition={{ delay: 0.08 * i, type: 'spring', stiffness: 260, damping: 22 }}
                className={cn('flex flex-col items-center', i === 3 && 'hidden lg:flex')}
              >
                <Link
                  href={`/market/${c.market.id}`}
                  title={c.market.question}
                  className="pointer-events-auto flex flex-col items-center gap-1"
                >
                  {i === 0 && (
                    <span className="rounded-full border border-green/40 bg-green/10 px-1.5 py-px text-[8px] font-black tracking-[0.18em] text-green">
                      LEADING
                    </span>
                  )}
                  <MarketIcon
                    icon={c.market.icon}
                    category={c.market.category}
                    className={cn(
                      'h-10 w-10 rounded-full shadow-lg lg:h-12 lg:w-12 xl:h-16 xl:w-16',
                      i === 0 && 'politics-leader'
                    )}
                    iconClassName="h-4 w-4 lg:h-5 lg:w-5 xl:h-7 xl:w-7"
                  />
                  <span className="max-w-[56px] truncate text-[9px] font-bold text-tx-sec lg:max-w-[64px] xl:max-w-[84px] xl:text-[10px]">
                    {c.label}
                  </span>
                  <span className="whitespace-nowrap rounded-full border border-line bg-surface-3/90 px-1.5 py-0.5 text-[10px] font-black text-green tabular-nums xl:px-2 xl:text-[11px]">
                    {formatCents(c.market.yesPrice)}
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
