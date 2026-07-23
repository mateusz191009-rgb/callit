'use client';

/**
 * Category hero for /category/basketball — "ARENA NIGHT" (v23.7, replaces
 * the v12 half-court view).
 *
 * Same hero shell as the generic category hero (rounded-2xl border-line
 * bg-surface-2 + hero-glow, copy + stat chips on the left) but the right
 * half is a dark arena: two spotlight cones from the rafters, tribune
 * bands of hash-seeded crowd dots (twinkling via .arena-dot), a glossy
 * hardwood strip along the floor — and the JUMBOTRON hanging center
 * court. Its screen shows the category's biggest event: title on the
 * bezel, the two price-favorites face to face (icon + Yes-percent), and
 * an LED line cycling the rest of the field via the shared marquee
 * (duplicated copy + .ticker-dup, so reduced-motion degrades to a
 * scrollable track like every other ticker). The whole screen is ONE
 * link to the event page — no nested anchors. All positions/phases
 * derive from hashString(...) — never Math.random — so server and client
 * render the same scene. Falls back to the node passed in `fallback`
 * when the category can't fill a screen (no event with 2 priced
 * outcomes).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Market } from '@/lib/types';
import { formatPercent } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { outcomeLabels } from '@/components/markets/EventCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';

/** Crowd layout: dots per tribune row, rows per band. */
const CROWD_COLS = 14;
const CROWD_ROWS = 3;

interface CrowdDot {
  key: string;
  left: number;
  top: number;
  lo: number;
  hi: number;
  delay: number;
  accent: boolean;
}

interface TickerEntry {
  key: string;
  label: string;
  pct: string;
}

export default function BasketballHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  // The jumbotron shows the category's biggest event (events arrive
  // volume-sorted); its outcomes rank by price. Ticker = the rest of that
  // field, then other events' favorites, then flat markets — deduped.
  const scene = useMemo(() => {
    const headline = events[0];
    if (!headline) return null;
    const outcomes = [...headline.markets].sort((a, b) => b.yesPrice - a.yesPrice);
    if (outcomes.length < 2) return null;
    const favorites = outcomes.slice(0, 2);

    const rest: Market[] = [];
    const seen = new Set(favorites.map((m) => m.id));
    const add = (m: Market) => {
      if (seen.has(m.id) || rest.length >= 10) return;
      seen.add(m.id);
      rest.push(m);
    };
    outcomes.slice(2).forEach(add);
    for (const e of events.slice(1)) {
      [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 2).forEach(add);
    }
    markets.forEach(add);

    const labels = outcomeLabels([...favorites, ...rest]);
    // A short field still needs enough LED copy for the -50% marquee loop
    // to close without a gap — repeat the run (keys stay unique via idx).
    const base: TickerEntry[] = rest.map((m, i) => ({
      key: `${m.id}:${i}`,
      label: labels.get(m.id) ?? m.question,
      pct: formatPercent(m.yesPrice),
    }));
    const ticker: TickerEntry[] = [];
    while (base.length > 0 && ticker.length < 8) {
      for (const t of base) ticker.push({ ...t, key: `${t.key}:${ticker.length}` });
    }

    return { headline, favorites, labels, ticker };
  }, [events, markets]);

  // Tribunes: two dot bands flanking the truss, seeded by the headline id
  // so the crowd reshuffles with the event, never per render.
  const crowd = useMemo<CrowdDot[]>(() => {
    if (!scene) return [];
    const out: CrowdDot[] = [];
    for (let band = 0; band < 2; band++) {
      for (let row = 0; row < CROWD_ROWS; row++) {
        for (let col = 0; col < CROWD_COLS; col++) {
          const h = hashString(`${scene.headline.id}:dot:${band}:${row}:${col}`);
          out.push({
            key: `${band}:${row}:${col}`,
            left: band * 55 + 2 + col * 3.1 + ((h % 5) - 2) * 0.4,
            top: 6 + row * 6.5 + (((h >>> 3) % 5) - 2) * 0.6,
            lo: 0.08 + ((h >>> 6) % 10) / 100,
            hi: 0.28 + ((h >>> 9) % 18) / 100,
            delay: -(((h >>> 13) % 38) / 10),
            accent: (h >>> 18) % 11 === 0,
          });
        }
      }
    }
    return out;
  }, [scene]);

  // No screen-worthy event — hand back to the generic floating-tiles hero.
  if (!scene) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Arena scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* House lights down */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/60 via-transparent to-transparent" />

        {/* Spotlight cones from the rafters */}
        <div
          aria-hidden
          className="absolute -top-6 left-[10%] h-[150%] w-14 rotate-[16deg] bg-gradient-to-b from-tx/10 via-tx/[0.03] to-transparent blur-[2px]"
        />
        <div
          aria-hidden
          className="absolute -top-6 right-[10%] h-[150%] w-14 -rotate-[16deg] bg-gradient-to-b from-tx/10 via-tx/[0.03] to-transparent blur-[2px]"
        />

        {/* Tribunes: twinkling crowd dots */}
        {crowd.map((d) => (
          <span
            key={d.key}
            aria-hidden
            className={`arena-dot absolute h-1 w-1 rounded-full ${d.accent ? 'bg-amber' : 'bg-tx-sec'}`}
            style={{
              left: `${d.left}%`,
              top: `${d.top}%`,
              ['--dot-lo' as string]: d.lo,
              ['--dot-hi' as string]: d.hi,
              animationDelay: `${d.delay}s`,
            }}
          />
        ))}

        {/* Hardwood floor with sheen and center circle */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[24%] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-amber/25 via-amber/10 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-px bg-amber/30" />
          <div className="absolute bottom-0 left-1/2 h-10 w-24 -translate-x-1/2 rounded-t-full border border-b-0 border-amber/30" />
          <div className="absolute inset-y-0 left-[16%] w-10 -skew-x-12 bg-tx/5" />
        </div>

        {/* Truss the jumbotron hangs from */}
        <div aria-hidden className="absolute left-1/2 top-0 h-[13%] w-px bg-line-strong" />

        {/* THE JUMBOTRON — one link, the whole screen opens the event */}
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: 'easeOut' }}
          className="absolute left-1/2 top-[13%] z-10 w-[84%] max-w-[252px] -translate-x-1/2"
        >
          <Link
            href={`/event/${scene.headline.id}`}
            title={scene.headline.title}
            className="pointer-events-auto block overflow-hidden rounded-xl border border-line-strong bg-surface/95 shadow-2xl transition-transform hover:scale-[1.03]"
          >
            {/* Bezel: event title */}
            <span className="block border-b border-line bg-surface-3/60 px-2.5 py-1">
              <span className="block truncate text-center text-[9px] font-black uppercase tracking-[0.18em] text-amber">
                {scene.headline.title}
              </span>
            </span>

            {/* Screen: the two favorites face to face */}
            <span className="grid grid-cols-2 divide-x divide-line">
              {scene.favorites.map((f) => (
                <span key={f.id} className="flex flex-col items-center gap-1 px-2 py-2">
                  <MarketIcon
                    icon={f.icon}
                    category={f.category}
                    className="h-8 w-8 rounded-full shadow-lg"
                    iconClassName="h-4 w-4"
                  />
                  <span className="max-w-full truncate text-[10px] font-bold text-tx-sec">
                    {scene.labels.get(f.id) ?? f.question}
                  </span>
                  <span className="text-sm font-black text-green tabular-nums">
                    {formatPercent(f.yesPrice)}
                  </span>
                </span>
              ))}
            </span>

            {/* LED line: the rest of the field on the shared marquee */}
            {scene.ticker.length > 0 && (
              <span className="ticker-track block overflow-hidden border-t border-line bg-ink/70">
                <span
                  aria-hidden
                  className="animate-marquee flex w-max items-center"
                  style={{ animationDuration: '22s' }}
                >
                  {[false, true].map((dup) => (
                    <span
                      key={dup ? 'dup' : 'run'}
                      className={dup ? 'ticker-dup flex items-center' : 'flex items-center'}
                    >
                      {scene.ticker.map((t) => (
                        <span
                          key={`${dup ? 'd' : 'r'}:${t.key}`}
                          className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-bold"
                        >
                          <span className="max-w-[88px] truncate uppercase tracking-wide text-tx-mut">
                            {t.label}
                          </span>
                          <span className="shrink-0 text-green tabular-nums">{t.pct}</span>
                          <span aria-hidden className="ml-1 h-0.5 w-0.5 rounded-full bg-line-strong" />
                        </span>
                      ))}
                    </span>
                  ))}
                </span>
              </span>
            )}
          </Link>
        </motion.div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
