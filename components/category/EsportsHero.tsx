'use client';

/**
 * Category hero for /category/esports — the "broadcast overlay" (v11).
 *
 * Same hero shell as the other category heroes (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a tournament stream overlay: a screen framed by an animated
 * green→sky RGB ring (.esp-frame, the gamer-rig glow) with a faint
 * scanline texture (.esp-scanlines) over a neon grid backdrop
 * (.esp-grid). The screen carries a broadcast header (pulsing LIVE dot,
 * "grand final" round tag from the id hash, a deterministic viewer
 * count), a face-off of the category's two leading contenders — icon,
 * outcome label and a health bar whose width IS the market's Yes
 * probability, green vs sky, growing in after mount with a looping
 * sheen sweep (.esp-hp) — around a glitch-flickering VS (.esp-vs), and
 * a killfeed of the next markets sliding in staggered (.esp-feed-row)
 * with their Yes prices.
 *
 * Hover highlights a row/side (question via title attr), click opens
 * the market. Falls back to the node passed in `fallback` (the generic
 * floating-tiles hero) when the category has fewer than 3 usable
 * markets. All values derive from hashString(...) — never Math.random —
 * so server and client render the same screen.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { cn, hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/** Killfeed row cap — three rows keep the screen airy under the duel. */
const FEED_ROWS = 3;

interface Contender {
  market: Market;
  label: string;
}

/** One side of the face-off: icon + outcome label + Yes price over a
 *  health bar sized by that probability. Left = green, right = sky
 *  (brand: the two accent colors — never red). */
function DuelSide({
  contender,
  side,
  grown,
}: {
  contender: Contender;
  side: 'left' | 'right';
  grown: boolean;
}) {
  const { market, label } = contender;
  const right = side === 'right';
  const pct = Math.round(market.yesPrice * 100);
  return (
    <Link
      href={`/market/${market.id}`}
      title={market.question}
      className={cn(
        'group pointer-events-auto flex min-w-0 flex-1 flex-col gap-1.5',
        right && 'items-end'
      )}
    >
      <span className={cn('flex w-full min-w-0 items-center gap-2', right && 'flex-row-reverse')}>
        <MarketIcon
          icon={market.icon}
          category={market.category}
          className="h-8 w-8 rounded-lg ring-1 ring-line-strong"
          iconClassName="h-4 w-4"
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[11px] font-black text-tx transition-colors',
              right ? 'text-right group-hover:text-sky' : 'group-hover:text-green'
            )}
          >
            {label}
          </span>
          <span
            className={cn(
              'block font-mono text-[10px] font-bold tabular-nums',
              right ? 'text-right text-sky' : 'text-green'
            )}
          >
            Yes {formatCents(market.yesPrice)}
          </span>
        </span>
      </span>
      {/* Health bar — width IS the Yes probability (min 8% so it reads). */}
      <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-surface-3/80">
        <span
          className={cn(
            'esp-hp absolute inset-y-0 rounded-full',
            right
              ? 'right-0 bg-gradient-to-l from-sky to-sky/40'
              : 'left-0 bg-gradient-to-r from-green to-green/40'
          )}
          style={{
            width: grown ? `${Math.max(8, pct)}%` : '0%',
            transition: 'width .8s cubic-bezier(.2,.8,.2,1)',
          }}
        />
      </span>
    </Link>
  );
}

export default function EsportsHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  // Health bars start at 0 and grow to their probability shortly after
  // mount (setTimeout instead of rAF — it also fires in throttled tabs).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 80);
    return () => clearTimeout(t);
  }, []);

  const { duel, feed } = useMemo(() => {
    // Face-off pool: the top multi-outcome event's two leading contenders
    // first — a REAL rivalry with competing probabilities (e.g. the two
    // tournament favorites) — then flat markets and remaining outcomes
    // top the killfeed up. Deduped by id.
    const pool: Market[] = [];
    const seen = new Set<string>();
    const add = (m: Market) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      pool.push(m);
    };
    const topEvent = events.find((e) => e.markets.length >= 2);
    if (topEvent) {
      [...topEvent.markets]
        .sort((a, b) => b.yesPrice - a.yesPrice)
        .slice(0, 2)
        .forEach(add);
    }
    markets.forEach(add);
    for (const e of events) {
      [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice).forEach(add);
    }

    const labels = outcomeLabels(pool);
    const toContender = (m: Market): Contender => ({
      market: m,
      label: labels.get(m.id) ?? m.question,
    });
    return {
      duel: pool.slice(0, 2).map(toContender),
      feed: pool.slice(2, 2 + FEED_ROWS).map(toContender),
    };
  }, [markets, events]);

  // Sparse category — hand back to the generic floating-tiles hero.
  if (duel.length < 2 || feed.length < 1) return <>{fallback}</>;

  // Broadcast chrome — purely visual, deterministic from the top id.
  const h = hashString(duel[0].market.id);
  const viewers = 12 + (h % 88); // "47K watching"
  const round = 1 + ((h >>> 3) % 5);

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Neon grid backdrop */}
      <div aria-hidden className="esp-grid absolute inset-0" />

      {/* Stream overlay scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="absolute inset-x-4 inset-y-4"
        >
          <div className="esp-frame relative flex h-full flex-col overflow-hidden rounded-xl border border-line-strong bg-ink/70">
            {/* CRT scanline texture */}
            <div aria-hidden className="esp-scanlines absolute inset-0" />

            {/* Broadcast header: LIVE + round tag + viewers */}
            <div className="relative flex items-center justify-between gap-2 border-b border-line/60 px-3 py-1.5">
              <span className="flex shrink-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-danger">
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
                </span>
                Live
              </span>
              <span className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-green/70">
                Grand final · Map {round}
              </span>
              <span
                aria-hidden
                className="shrink-0 font-mono text-[10px] font-black text-tx-mut tabular-nums"
              >
                {viewers}K watching
              </span>
            </div>

            {/* Face-off: two leading contenders around a glitching VS */}
            <div className="relative flex flex-1 items-center gap-2.5 px-3">
              <DuelSide contender={duel[0]} side="left" grown={grown} />
              <span
                aria-hidden
                className="esp-vs shrink-0 px-0.5 font-mono text-lg font-black text-tx"
              >
                VS
              </span>
              <DuelSide contender={duel[1]} side="right" grown={grown} />
            </div>

            {/* Killfeed — the next markets slide in with their odds */}
            <div className="relative flex flex-col gap-1 px-3 pb-2.5">
              {feed.map((f, i) => (
                <Link
                  key={f.market.id}
                  href={`/market/${f.market.id}`}
                  title={f.market.question}
                  className="esp-feed-row pointer-events-auto flex items-center gap-2 rounded-md border border-line/50 bg-surface-2/70 px-2 py-1 transition-colors hover:border-line-strong hover:bg-surface-3/60"
                  style={{
                    // Cascade + deterministic per-row jitter.
                    animationDelay: `${350 + i * 160 + (hashString(f.market.id) % 90)}ms`,
                  }}
                >
                  <MarketIcon
                    icon={f.market.icon}
                    category={f.market.category}
                    className="h-4 w-4 rounded"
                    iconClassName="h-2.5 w-2.5"
                  />
                  <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-tx-sec">
                    {f.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] font-black text-green tabular-nums">
                    {formatCents(f.market.yesPrice)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
