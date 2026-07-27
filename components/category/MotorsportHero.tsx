'use client';

/**
 * Category hero for the Motorsport chip — "TIMING TOWER" (v25.10, new).
 *
 * The scene is a race at night: an S-curve of track sweeping through the
 * frame — dark tarmac ribbon, dashed centre line, red kerb ticks on the
 * two apexes, a checkered start/finish strip — with two cars as glowing
 * dots lapping it (.race-car-a/-b, CSS keyframes along the same curve)
 * and a strip of grandstand lights twinkling up top.
 *
 * The content object is the TIMING TOWER on the right, and it is the one
 * scene whose metaphor a prediction market fills natively: the top
 * outcomes ranked by price ARE the running order, so the tower shows
 * P1/P2/P3/P4 with their prices exactly like the broadcast graphic. One
 * link to the event ("F1 Drivers' Champion") or the leading market.
 *
 * Falls back to the generic hero below 2 usable markets.
 */

import Link from 'next/link';
import { motion } from 'framer-motion';
import { formatPercent } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { useSceneContent } from './scene';

/** The lap both cars drive (must match the .race-car keyframes). */
const TRACK = 'M -8 84 C 40 82, 42 34, 96 32 C 150 30, 152 74, 208 72';

export default function MotorsportHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const { headline, board, labels } = useSceneContent(events, markets);

  if (board.length < 2) return <>{fallback}</>;
  const rows = board.slice(0, 4);
  const href = headline ? `/event/${headline.id}` : `/market/${rows[0].id}`;
  const title = headline?.title ?? 'Championship';

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden card-surface">
      {/* Track scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Night, one beam over the start straight */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-transparent" />
        <div
          aria-hidden
          className="absolute -top-6 left-[30%] h-[140%] w-20 rotate-[10deg] bg-gradient-to-b from-tx/[0.08] via-tx/[0.02] to-transparent blur-[2px]"
        />

        {/* Grandstand lights */}
        {Array.from({ length: 18 }, (_, i) => {
          const h = hashString(`${rows[0].id}:stand:${i}`);
          return (
            <span
              key={i}
              aria-hidden
              className="arena-dot absolute h-1 w-1 rounded-full bg-tx-sec"
              style={{
                left: `${2 + i * 5.4 + ((h % 5) - 2) * 0.5}%`,
                top: `${5 + ((h >>> 3) % 3) * 2.6}%`,
                ['--dot-lo' as string]: 0.05 + ((h >>> 6) % 8) / 100,
                ['--dot-hi' as string]: 0.2 + ((h >>> 9) % 14) / 100,
                animationDelay: `${-(((h >>> 13) % 38) / 10)}s`,
              }}
            />
          );
        })}

        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="msp-checker" width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="2" height="2" fill="rgba(255,255,255,0.5)" />
              <rect x="2" y="2" width="2" height="2" fill="rgba(255,255,255,0.5)" />
            </pattern>
          </defs>

          {/* Kerbs first, UNDER the tarmac: the same path, 3px wider and
              dashed, so red ticks peek out along both edges of the whole
              lap. v25.13 — replaces two hand-placed kerb strokes that sat
              visibly OFF the road (owner: "hero von motorsport bisschen
              buggy"): deriving them from the track path itself means they
              cannot drift from it. */}
          <path d={TRACK} fill="none" stroke="rgba(255,92,122,0.4)" strokeWidth="17" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          {/* Edge lines: a lighter stroke under a narrower dark one leaves
              a crisp 1px rim on both sides — without it the tarmac read as
              "the gap between the kerb ticks". */}
          <path d={TRACK} fill="none" stroke="rgba(199,213,224,0.28)" strokeWidth="14" vectorEffect="non-scaling-stroke" />
          {/* Tarmac and the centre line */}
          <path d={TRACK} fill="none" stroke="rgba(12,23,33,0.97)" strokeWidth="12" vectorEffect="non-scaling-stroke" />
          <path d={TRACK} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" vectorEffect="non-scaling-stroke" />
          <path d={TRACK} fill="none" stroke="rgba(199,213,224,0.18)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />

          {/* Start/finish across the back straight */}
          <rect x="92" y="26" width="7" height="12" fill="url(#msp-checker)" opacity="0.8" transform="rotate(-4 95.5 32)" />
        </svg>

        {/* The field: two cars lapping */}
        <span
          aria-hidden
          className="race-car race-car-a absolute h-1.5 w-1.5 rounded-full bg-green"
          style={{ boxShadow: '0 0 7px rgba(0,225,126,0.7)' }}
        />
        <span
          aria-hidden
          className="race-car race-car-b absolute h-1.5 w-1.5 rounded-full bg-sky"
          style={{ boxShadow: '0 0 7px rgba(59,157,248,0.7)' }}
        />

        {/* THE TIMING TOWER — one link, the field ranked by price */}
        <motion.div
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: 'easeOut' }}
          className="absolute right-2 top-1/2 z-10 w-[56%] max-w-[178px] -translate-y-1/2"
        >
          <Link
            href={href}
            title={title}
            className="pointer-events-auto block overflow-hidden rounded-lg border border-line-strong bg-surface/95 shadow-2xl transition-transform hover:scale-[1.03]"
          >
            <span className="block border-b border-line bg-surface-3/60 px-2 py-0.5">
              <span className="block truncate text-[8px] font-black uppercase tracking-[0.16em] text-danger">
                {title}
              </span>
            </span>
            {rows.map((m, i) => (
              <span
                key={m.id}
                className={`flex items-center gap-1.5 px-2 py-1 ${i < rows.length - 1 ? 'border-b border-line/60' : ''}`}
              >
                <span className="w-5 shrink-0 text-nano font-black text-amber tabular-nums">
                  P{i + 1}
                </span>
                <MarketIcon
                  icon={m.icon}
                  category={m.category}
                  className="h-4 w-4 rounded-full"
                  iconClassName="h-2.5 w-2.5"
                />
                <span className="min-w-0 flex-1 truncate text-nano font-bold text-tx-sec">
                  {labels.get(m.id) ?? m.question}
                </span>
                <span className="shrink-0 text-micro font-black text-green tabular-nums">
                  {formatPercent(m.yesPrice)}
                </span>
              </span>
            ))}
          </Link>
        </motion.div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
