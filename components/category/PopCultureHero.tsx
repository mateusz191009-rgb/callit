'use client';

/**
 * Category hero for /category/pop-culture — "premiere night".
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a cinema on opening night: a marquee frame (rounded border
 * whose bulbs — .v7bb-bulb, ring-ordered delays — chase around the edge
 * like a real sign) around a horizontal FILM STRIP: up to five poster
 * frames (artwork via MarketIcon) between two sprocket-hole strips
 * (.v7bb-sprockets), the whole strip slowly panning a few px sideways
 * forever (.v7bb-film — the signature ambient). Behind the strip two
 * spotlight beams sweep very slowly in opposite phase (.v7bb-beam,
 * opacity .08). Each poster carries its market's Yes price as a "ticket
 * stub" chip (ADMIT | 62¢ with a dashed perforation). Hover lifts a
 * poster, click opens that market. Falls back to the node passed in
 * `fallback` (the generic floating-tiles hero) when the category has
 * fewer than 3 usable markets.
 *
 * All geometry is derived from hashString(market.id) / pure index maths —
 * never Math.random — so server and client render the same night.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/* ------------------------------------------------------------------ */
/* Marquee geometry                                                    */
/* ------------------------------------------------------------------ */

/** Posters on the strip. Below 3 the hero hands back to `fallback`. */
const MAX_POSTERS = 5;

/** Bulbs per edge of the marquee frame — dense enough that the chase
 *  reads as a border of lights, not scattered dots. */
const BULB_COLS = 9;
const BULB_ROWS = 4;

/** One full trip of the chase around the frame (seconds) — MUST match
 *  the .v7bb-bulb animation duration in globals.css so the lit run
 *  travels exactly once around the ring per cycle. */
const CHASE_DUR = 3;

/**
 * Bulb positions in ring order (top edge L->R, right edge T->B, bottom
 * edge R->L, left edge B->T) so the staggered delays read as light
 * chasing around the sign. Corners land exactly once. Pure geometry —
 * the same array on server and client.
 */
function buildBulbs(cols: number, rows: number): { left: number; top: number }[] {
  const pts: { left: number; top: number }[] = [];
  for (let i = 0; i < cols; i++) pts.push({ left: (i / cols) * 100, top: 0 });
  for (let i = 0; i < rows; i++) pts.push({ left: 100, top: (i / rows) * 100 });
  for (let i = 0; i < cols; i++) pts.push({ left: 100 - (i / cols) * 100, top: 100 });
  for (let i = 0; i < rows; i++) pts.push({ left: 0, top: 100 - (i / rows) * 100 });
  return pts;
}

const BULBS = buildBulbs(BULB_COLS, BULB_ROWS);

interface Poster {
  market: Market;
  /** Tiny hand-placed rotation, ±2deg (deterministic). */
  wobble: number;
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export default function PopCultureHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const posters = useMemo<Poster[]>(() => {
    // Candidate pool: flat category markets (already top-volume-sorted by
    // the page), then event outcome markets. Deduped by id.
    const pool: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        pool.push(m);
      }
    };
    markets.forEach(add);
    events.forEach((e) => e.markets.forEach(add));

    // Repeated artwork would read as a duplicate frame on the strip.
    const seenIcons = new Set<string>();
    const distinct = pool.filter((m) => {
      if (!m.icon) return true;
      if (seenIcons.has(m.icon)) return false;
      seenIcons.add(m.icon);
      return true;
    });

    // Posters with real artwork lead the strip; Array#sort is stable, so
    // the page's volume order survives inside each group.
    const chosen = [...distinct]
      .sort((a, b) => Number(Boolean(b.icon)) - Number(Boolean(a.icon)))
      .slice(0, MAX_POSTERS);

    return chosen.map((m) => {
      const h = hashString(m.id);
      return { market: m, wobble: (h % 5) - 2 };
    });
  }, [markets, events]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (posters.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Premiere scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Stage interior — clipped so the beams and a wide strip never
            escape; the bulbs live on a sibling layer so they are not
            cut in half by this overflow-hidden. */}
        <div className="v7bb-stage absolute inset-x-5 inset-y-4 overflow-hidden rounded-2xl border border-line bg-ink/40">
          {/* Crossing spotlight beams, sweeping slowly behind the strip */}
          <span
            aria-hidden
            className="v7bb-beam absolute -top-4 left-[20%] h-[130%] w-20"
            style={{
              ['--v7bb-beam-base' as string]: '16deg',
              ['--v7bb-beam-dur' as string]: '17s',
            }}
          />
          <span
            aria-hidden
            className="v7bb-beam absolute -top-4 right-[20%] h-[130%] w-20"
            style={{
              ['--v7bb-beam-base' as string]: '-16deg',
              ['--v7bb-beam-dur' as string]: '21s',
              animationDelay: '-7s',
            }}
          />

          {/* Film strip — pans a few px sideways forever */}
          <div className="v7bb-film absolute left-1/2 top-1/2">
            <div className="border-y border-line/60 bg-ink/70 shadow-xl">
              <div aria-hidden className="v7bb-sprockets h-2 w-full" />
              <div className="flex items-stretch gap-1.5 px-2 py-1.5">
                {posters.map((p, i) => (
                  <motion.div
                    key={p.market.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ rotate: p.wobble }}
                    whileHover={{ scale: 1.07, rotate: 0, y: -3 }}
                    transition={{ delay: 0.06 * i, type: 'spring', stiffness: 260, damping: 22 }}
                  >
                    <Link
                      href={`/market/${p.market.id}`}
                      title={p.market.question}
                      className="pointer-events-auto flex flex-col items-center gap-1 rounded-md border border-line/70 bg-surface-3/50 p-1.5 transition-colors hover:border-green/40"
                    >
                      <MarketIcon
                        icon={p.market.icon}
                        category={p.market.category}
                        className="h-[56px] w-[44px] rounded"
                        iconClassName="h-5 w-5"
                      />
                      {/* Ticket-stub price chip: ADMIT | 62¢ */}
                      <span className="flex items-stretch overflow-hidden rounded border border-amber/30 text-[8px] font-bold leading-none">
                        <span className="bg-amber/10 px-1 py-0.5 uppercase tracking-wider text-amber">
                          Admit
                        </span>
                        <span className="border-l border-dashed border-amber/40 bg-surface-3/80 px-1 py-0.5 text-green tabular-nums">
                          {formatCents(p.market.yesPrice)}
                        </span>
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </div>
              <div aria-hidden className="v7bb-sprockets h-2 w-full" />
            </div>
          </div>
        </div>

        {/* Marquee bulb frame — light chases around the ring */}
        <div aria-hidden className="absolute inset-x-5 inset-y-4">
          {BULBS.map((b, i) => (
            <span
              key={`bulb-${i}`}
              className={`v7bb-bulb absolute h-1.5 w-1.5 rounded-full bg-current ${
                i % 3 === 2 ? 'text-green' : 'text-amber'
              }`}
              style={{
                left: `${b.left}%`,
                top: `${b.top}%`,
                animationDelay: `${((i / BULBS.length) * CHASE_DUR).toFixed(3)}s`,
              }}
            />
          ))}
        </div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
