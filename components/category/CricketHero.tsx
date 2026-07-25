'use client';

/**
 * Category hero for the Cricket chip — "UNDER THE LIGHTS" (v25.10,
 * replaces the v25.9 top-down oval).
 *
 * A night match seen from behind the wicketkeeper: the pitch runs away in
 * PERSPECTIVE toward the far crease, the stumps stand LARGE in the
 * foreground — three stumps and the bails, the one silhouette that means
 * cricket and nothing else — and two floodlight masts pour light in from
 * the top corners, their heads drawn as little dot grids. A slog hangs in
 * the air as a dashed arc drawing itself toward the boundary
 * (.scene-arc), the ball pulsing red at the top of its flight.
 *
 * The content object is the INNINGS BOARD on the right: competition line
 * on the bezel, up to three markets with prices, and a six-ball over
 * ticker along the bottom. One link to the event — or the top market:
 * cricket usually arrives as FLAT markets with no parent event, which is
 * exactly why useSceneContent falls through to them.
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

/** One floodlight mast: pole, dot-grid head, pooled glow. */
function Mast({ x, flip }: { x: number; flip?: boolean }) {
  const dots = [0, 1, 2, 3, 4, 5];
  return (
    <g transform={flip ? `translate(${x} 0) scale(-1 1)` : `translate(${x} 0)`}>
      <line x1="0" y1="10" x2="6" y2="46" stroke="rgba(199,213,224,0.25)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <rect x="-5" y="3" width="12" height="8" rx="1.5" fill="rgba(28,46,60,0.9)" stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {dots.map((d) => (
        <circle
          key={d}
          cx={-2.5 + (d % 3) * 3.5}
          cy={5.5 + Math.floor(d / 3) * 3}
          r="1"
          fill="rgba(255,255,255,0.55)"
        />
      ))}
    </g>
  );
}

export default function CricketHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const { headline, board, labels } = useSceneContent(events, markets);

  if (board.length < 2) return <>{fallback}</>;
  const rows = board.slice(0, 3);
  const href = headline ? `/event/${headline.id}` : `/market/${rows[0].id}`;
  const title = headline?.title ?? 'Cricket';
  // Balls of the over already bowled — stable per board, never per render.
  const ballsGone = 1 + (hashString(rows[0].id) % 5);

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* Ground scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Night sky, light pooling down */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-transparent" />
        <div
          aria-hidden
          className="absolute -top-8 left-[8%] h-[130%] w-24 rotate-[18deg] bg-gradient-to-b from-tx/[0.09] via-tx/[0.02] to-transparent blur-[2px]"
        />
        <div
          aria-hidden
          className="absolute -top-8 right-[8%] h-[130%] w-24 -rotate-[18deg] bg-gradient-to-b from-tx/[0.09] via-tx/[0.02] to-transparent blur-[2px]"
        />

        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="crk-turf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(0,225,126,0.03)" />
              <stop offset="100%" stopColor="rgba(0,225,126,0.12)" />
            </linearGradient>
            <linearGradient id="crk-strip" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,181,71,0.08)" />
              <stop offset="100%" stopColor="rgba(255,181,71,0.22)" />
            </linearGradient>
          </defs>

          {/* Outfield rising to the boundary, faint mow bands following it */}
          <rect x="0" y="40" width="200" height="60" fill="url(#crk-turf)" />
          <path d="M 0 44 Q 100 32 200 44" fill="none" stroke="rgba(0,225,126,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d="M 0 60 Q 100 50 200 60" fill="none" stroke="rgba(0,225,126,0.10)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d="M 0 78 Q 100 70 200 78" fill="none" stroke="rgba(0,225,126,0.10)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* The pitch, running away from the keeper — a strip, not a road */}
          <polygon
            points="52,100 78,100 70,46 60,46"
            fill="url(#crk-strip)"
            stroke="rgba(255,181,71,0.3)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* Creases, near and far */}
          <line x1="54" y1="86" x2="76" y2="86" stroke="rgba(255,181,71,0.45)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="59" y1="52" x2="71" y2="52" stroke="rgba(255,181,71,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {/* Far stumps, tiny at the bowler's end */}
          <g stroke="rgba(255,181,71,0.6)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            <line x1="63" y1="42.5" x2="63" y2="47" />
            <line x1="65" y1="42.5" x2="65" y2="47" />
            <line x1="67" y1="42.5" x2="67" y2="47" />
          </g>

          {/* THE STUMPS at the near crease — on the pitch, bails on top */}
          <g stroke="rgba(255,181,71,0.9)" strokeLinecap="round">
            <line x1="61.5" y1="72" x2="61.5" y2="86" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            <line x1="65" y1="72" x2="65" y2="86" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            <line x1="68.5" y1="72" x2="68.5" y2="86" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            <line x1="60.8" y1="71" x2="64.6" y2="71" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            <line x1="65.4" y1="71" x2="69.2" y2="71" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          </g>

          {/* The slog, off the near end and sailing for the rope */}
          <path
            className="scene-arc"
            d="M 68 72 Q 110 6 178 30"
            fill="none"
            stroke="rgba(255,92,122,0.55)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {/* Floodlight masts */}
          <Mast x={16} />
          <Mast x={184} flip />
        </svg>

        {/* The ball at the top of its flight */}
        <span
          aria-hidden
          className="arena-dot absolute h-1.5 w-1.5 rounded-full bg-danger"
          style={{
            left: '58%',
            top: '17%',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 6px rgba(255,92,122,0.6)',
            ['--dot-lo' as string]: 0.5,
            ['--dot-hi' as string]: 1,
          }}
        />

        {/* THE INNINGS BOARD — one link */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: 'easeOut' }}
          className="absolute right-2 top-[10%] z-10 w-[58%] max-w-[184px]"
        >
          <Link
            href={href}
            title={title}
            className="pointer-events-auto block overflow-hidden rounded-lg border border-line-strong bg-surface/95 shadow-2xl transition-transform hover:scale-[1.03]"
          >
            <span className="block border-b border-line bg-surface-3/60 px-2 py-0.5">
              <span className="block truncate text-[8px] font-black uppercase tracking-[0.16em] text-green">
                {title}
              </span>
            </span>
            {rows.map((m) => (
              <span
                key={m.id}
                className="flex items-center gap-1.5 border-b border-line/60 px-2 py-1"
              >
                <MarketIcon
                  icon={m.icon}
                  category={m.category}
                  className="h-4 w-4 rounded-full"
                  iconClassName="h-2.5 w-2.5"
                />
                <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-tx-sec">
                  {labels.get(m.id) ?? m.question}
                </span>
                <span className="shrink-0 text-[11px] font-black text-green tabular-nums">
                  {formatPercent(m.yesPrice)}
                </span>
              </span>
            ))}
            {/* This over, ball by ball */}
            <span className="flex items-center justify-center gap-1.5 bg-ink/70 py-1">
              {Array.from({ length: 6 }, (_, i) => (
                <span
                  key={i}
                  className={`h-1 w-1 rounded-full ${i < ballsGone ? 'bg-green' : 'bg-line-strong'}`}
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
