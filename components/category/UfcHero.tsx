'use client';

/**
 * Category hero for the UFC chip — "FIGHT NIGHT" (v25.10, replaces the
 * v25.9 top-down mat).
 *
 * Built in the arena-night language of BasketballHero: house lights down,
 * two spotlight cones, a thin band of twinkling crowd dots — and low in
 * the frame the cage itself, seen from the stands as a silhouette:
 * a flattened octagon platform, posts rising off its back edge, the
 * chain-link hinted by an SVG mesh pattern. No top-down diagrams.
 *
 * The content object is the MAIN EVENT card hanging in the light: event
 * title on the bezel, the two favourites face to face — red corner, blue
 * corner, each with its price — and a five-round dot strip underneath,
 * one round pulsing. The whole card is ONE link to the event (or to the
 * favourite's market when the sport arrives as flat markets).
 *
 * Falls back to the generic hero when there aren't two sides to bill.
 */

import Link from 'next/link';
import { motion } from 'framer-motion';
import { formatPercent } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { useSceneContent } from './scene';

export default function UfcHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const { headline, board, labels } = useSceneContent(events, markets);

  if (board.length < 2) return <>{fallback}</>;
  const [red, blue] = board;
  const href = headline ? `/event/${headline.id}` : `/market/${red.id}`;
  const title = headline?.title ?? red.question;
  // Which round dot burns — stable per card, never per render.
  const liveRound = hashString(red.id) % 5;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden card-surface">
      {/* Arena scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* House lights down */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-transparent" />

        {/* Spotlight cones from the rig */}
        <div
          aria-hidden
          className="absolute -top-6 left-[16%] h-[150%] w-16 rotate-[14deg] bg-gradient-to-b from-tx/10 via-tx/[0.03] to-transparent blur-[2px]"
        />
        <div
          aria-hidden
          className="absolute -top-6 right-[16%] h-[150%] w-16 -rotate-[14deg] bg-gradient-to-b from-tx/10 via-tx/[0.03] to-transparent blur-[2px]"
        />

        {/* Far crowd — a sparse band of lights up high */}
        {Array.from({ length: 22 }, (_, i) => {
          const h = hashString(`${red.id}:crowd:${i}`);
          return (
            <span
              key={i}
              aria-hidden
              className="arena-dot absolute h-1 w-1 rounded-full bg-tx-sec"
              style={{
                left: `${2 + i * 4.4 + ((h % 5) - 2) * 0.5}%`,
                top: `${5 + ((h >>> 3) % 4) * 2.2}%`,
                ['--dot-lo' as string]: 0.06 + ((h >>> 6) % 8) / 100,
                ['--dot-hi' as string]: 0.22 + ((h >>> 9) % 14) / 100,
                animationDelay: `${-(((h >>> 13) % 38) / 10)}s`,
              }}
            />
          );
        })}

        {/* The cage, from the stands: platform, posts, mesh, top rail */}
        <svg
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[58%] w-full"
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="ufc-mesh" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M0 0l5 5M5 0L0 5" stroke="rgba(255,181,71,0.10)" strokeWidth="0.5" />
            </pattern>
            <linearGradient id="ufc-glow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,181,71,0.02)" />
              <stop offset="100%" stopColor="rgba(255,181,71,0.14)" />
            </linearGradient>
          </defs>

          {/* Mat platform — flattened octagon catching the light */}
          <polygon
            points="52,64 148,64 188,78 188,92 148,100 52,100 12,92 12,78"
            fill="url(#ufc-glow)"
            stroke="rgba(255,181,71,0.3)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* Fence: mesh panel standing on the platform's back edge */}
          <rect x="34" y="18" width="132" height="46" fill="url(#ufc-mesh)" />
          <line x1="34" y1="18" x2="166" y2="18" stroke="rgba(255,181,71,0.35)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <line x1="34" y1="64" x2="166" y2="64" stroke="rgba(255,181,71,0.25)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {/* Posts with their pads */}
          {[34, 78, 122, 166].map((x) => (
            <line
              key={x}
              x1={x}
              y1="16"
              x2={x}
              y2="66"
              stroke="rgba(255,181,71,0.4)"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Red and blue corners on the outer posts */}
          <line x1="34" y1="18" x2="34" y2="34" stroke="rgba(255,92,122,0.8)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1="166" y1="18" x2="166" y2="34" stroke="rgba(59,157,248,0.8)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* THE MAIN EVENT CARD — one link, hanging in the light */}
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: 'easeOut' }}
          className="absolute left-1/2 top-[12%] z-10 w-[88%] max-w-[268px] -translate-x-1/2"
        >
          <Link
            href={href}
            title={title}
            className="pointer-events-auto block overflow-hidden rounded-xl border border-line-strong bg-surface/95 shadow-2xl transition-transform hover:scale-[1.03]"
          >
            {/* Bezel: the billing */}
            <span className="block border-b border-line bg-surface-3/60 px-2.5 py-1">
              <span className="block truncate text-center text-[9px] font-black uppercase tracking-[0.18em] text-amber">
                {title}
              </span>
            </span>

            {/* Tale of the tape: red corner vs blue corner */}
            <span className="grid grid-cols-[1fr_auto_1fr] items-center">
              <span className="flex flex-col items-center gap-1 border-t-2 border-danger/60 px-2 py-2">
                <MarketIcon
                  icon={red.icon}
                  category={red.category}
                  className="h-8 w-8 rounded-full shadow-lg"
                  iconClassName="h-4 w-4"
                />
                <span className="max-w-full truncate text-nano font-semibold text-tx-sec">
                  {labels.get(red.id) ?? red.question}
                </span>
                <span className="text-sm font-bold text-green tabular-nums">
                  {formatPercent(red.yesPrice)}
                </span>
              </span>

              <span className="px-1 text-xs font-bold uppercase tracking-widest text-tx-mut">
                vs
              </span>

              <span className="flex flex-col items-center gap-1 border-t-2 border-sky/60 px-2 py-2">
                <MarketIcon
                  icon={blue.icon}
                  category={blue.category}
                  className="h-8 w-8 rounded-full shadow-lg"
                  iconClassName="h-4 w-4"
                />
                <span className="max-w-full truncate text-nano font-semibold text-tx-sec">
                  {labels.get(blue.id) ?? blue.question}
                </span>
                <span className="text-sm font-bold text-green tabular-nums">
                  {formatPercent(blue.yesPrice)}
                </span>
              </span>
            </span>

            {/* Five rounds, one burning */}
            <span className="flex items-center justify-center gap-2 border-t border-line bg-ink/70 py-1.5">
              {Array.from({ length: 5 }, (_, i) => (
                <span
                  key={i}
                  className={
                    i === liveRound
                      ? 'arena-dot h-1.5 w-1.5 rounded-full bg-amber'
                      : 'h-1.5 w-1.5 rounded-full bg-line-strong'
                  }
                  style={
                    i === liveRound
                      ? { ['--dot-lo' as string]: 0.5, ['--dot-hi' as string]: 1 }
                      : undefined
                  }
                />
              ))}
            </span>
          </Link>
        </motion.div>
      </div>

      <HeroCopy stats={stats} />
    </section>
  );
}
