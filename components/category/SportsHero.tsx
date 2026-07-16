'use client';

/**
 * Category hero for /category/sports — the "stadium jumbotron".
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a stadium at night: a perspective-tilted jumbotron screen
 * (.v7bb-jumbo, subtle rotateX seen from the stands) framed like a board
 * on two support struts, standing over a thin crowd-silhouette strip
 * (.v7bb-crowd) with two floodlight cones washing down over everything
 * (.sports-floodlight, opacity .07). The screen carries the old
 * dot-matrix texture (.scoreboard-matrix) and up to five of the
 * category's top markets as rows — icon, short outcome label and the Yes
 * price flipping into place like a split-flap departure board: two
 * stacked spans, a "00¢" placeholder rotating out (.v7bb-flap-old) while
 * the real price rotates in (.v7bb-flap-new), staggered per row from the
 * market-id hash. The board's corner shows a tiny game clock whose last
 * digit ticks forever via a CSS steps() reel (.v7bb-clock-reel) — purely
 * visual, phase-offset deterministically.
 *
 * Hover tints a row (question via title attr), click opens the market.
 * Falls back to the node passed in `fallback` (the generic floating-tiles
 * hero) when the category has fewer than 3 usable markets. All values
 * are derived from hashString(...) — never Math.random — so server and
 * client render the same board.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/** Row cap — five rows is what the tilted board fits comfortably. */
const MAX_ROWS = 5;

/** Digit column for the game clock's ticking reel (steps() scrolls it,
 *  one digit per second — see .v7bb-clock-reel in globals.css). */
const REEL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

interface BoardRow {
  market: Market;
  label: string;
  /** Split-flap start delay in ms (deterministic). */
  delay: number;
}

export default function SportsHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const rows = useMemo<BoardRow[]>(() => {
    // Board pool: flat category markets first (sports is mostly binary
    // game/prop markets — they arrive volume-sorted from the page), then
    // event outcomes to top the board up. Deduped by id.
    const chosen: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (chosen.length >= MAX_ROWS || seen.has(m.id)) return;
      seen.add(m.id);
      chosen.push(m);
    };
    markets.forEach(add);
    for (const e of events) {
      [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice).forEach(add);
    }

    const labels = outcomeLabels(chosen);
    return chosen.map((m, i) => {
      const h = hashString(m.id);
      return {
        market: m,
        label: labels.get(m.id) ?? m.question,
        delay: 250 + i * 120 + ((h >>> 4) % 80), // cascade + deterministic jitter
      };
    });
  }, [markets, events]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (rows.length < 3) return <>{fallback}</>;

  // Game clock — purely visual. Quarter, minutes and the frozen tens
  // digit come from the top market's id hash; the ones digit ticks via
  // the CSS reel, phase-offset by a deterministic negative delay.
  const clockH = hashString(rows[0].market.id);
  const quarter = 1 + (clockH % 4);
  const minutes = String(2 + ((clockH >>> 2) % 9)).padStart(2, '0');
  const tensDigit = (clockH >>> 6) % 6;
  const reelDelay = -((clockH >>> 9) % 10);

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Stadium scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Jumbotron. Perspective lives on this wrapper (a plain CSS
            property, so framer's entrance transform never fights it);
            the static rotateX lives on the child via .v7bb-jumbo. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="absolute inset-x-4 top-3 bottom-9"
          style={{ perspective: '900px' }}
        >
          <div className="v7bb-jumbo relative h-full overflow-hidden rounded-xl border-2 border-line-strong bg-ink/60 shadow-2xl">
            {/* Dot-matrix screen texture */}
            <div aria-hidden className="scoreboard-matrix absolute inset-0" />

            <div className="relative flex h-full flex-col px-3 py-1.5">
              {/* Board header: title + ticking game clock */}
              <div className="flex items-center justify-between border-b border-line/60 pb-1">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-green/70">
                  Live odds
                </span>
                <span
                  aria-hidden
                  className="flex items-center font-mono text-[10px] font-black text-green tabular-nums"
                >
                  <span className="mr-1.5">Q{quarter}</span>
                  <span>{minutes}</span>
                  <span className="v7bb-clock-colon">:</span>
                  <span>{tensDigit}</span>
                  {/* 1em window over a 10-digit column — steps() ticks it */}
                  <span className="inline-flex h-[1em] overflow-hidden">
                    <span
                      className="v7bb-clock-reel"
                      style={{ animationDelay: `${reelDelay}s` }}
                    >
                      {REEL_DIGITS.map((d) => (
                        <span key={d} className="block h-[1em] leading-none">
                          {d}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
              </div>

              {/* Matchup rows with split-flap odds */}
              <div className="flex flex-1 flex-col justify-center">
                {rows.map((r) => (
                  <Link
                    key={r.market.id}
                    href={`/market/${r.market.id}`}
                    title={r.market.question}
                    className="pointer-events-auto flex items-center gap-2 border-b border-line/40 px-1 py-[3px] transition-colors last:border-0 hover:bg-surface-3/40"
                  >
                    <MarketIcon
                      icon={r.market.icon}
                      category={r.market.category}
                      className="h-5 w-5 rounded"
                      iconClassName="h-3 w-3"
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-tx-sec">
                      {r.label}
                    </span>
                    {/* Split-flap: placeholder rotates out, price rotates in */}
                    <span className="v7bb-flap relative shrink-0 font-mono text-[13px] font-black tabular-nums">
                      <span
                        aria-hidden
                        className="v7bb-flap-old absolute inset-0 text-right text-tx-mut"
                        style={{ animationDelay: `${r.delay}ms` }}
                      >
                        00¢
                      </span>
                      <span
                        className="v7bb-flap-new block text-green"
                        style={{ animationDelay: `${r.delay + 240}ms` }}
                      >
                        {formatCents(r.market.yesPrice)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Support struts — the board stands on these */}
        <span aria-hidden className="absolute bottom-2 left-[28%] h-7 w-1 rounded-b bg-line/60" />
        <span aria-hidden className="absolute bottom-2 right-[28%] h-7 w-1 rounded-b bg-line/60" />

        {/* Crowd silhouette strip along the bottom */}
        <span aria-hidden className="v7bb-crowd absolute inset-x-2 bottom-1 h-3.5" />

        {/* Floodlights — rendered last so the light washes OVER the scene */}
        <span aria-hidden className="sports-floodlight absolute left-[10%] top-0 h-36 w-28" />
        <span aria-hidden className="sports-floodlight absolute right-[10%] top-0 h-36 w-28" />
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
