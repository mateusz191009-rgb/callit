'use client';

/**
 * Category hero for the Tennis chip — "NIGHT SESSION" (v25.10, replaces
 * the v25.9 top-down court).
 *
 * The court is drawn in PERSPECTIVE, from the broadcast camera behind the
 * near baseline: a trapezoid converging toward the far end, tramlines and
 * service boxes following the same vanishing lines, the net strung across
 * with its posts — under a floodlight wash, with a thin band of crowd
 * lights up in the dark. A serve hangs in the air as a dashed arc drawing
 * itself over the net (.scene-arc), the ball pulsing at its landing spot.
 * Top-down field diagrams are exactly what this replaces.
 *
 * The content object is the TV SCORE BUG in the corner — tournament line
 * on top, the two players with their prices — one link to the event (or
 * the favourite's market when tennis arrives as flat markets).
 *
 * Falls back to the generic hero when there aren't two sides to show.
 */

import Link from 'next/link';
import { motion } from 'framer-motion';
import { formatPercent } from '@/lib/format';
import { hashString } from '@/lib/utils';
import { MarketIcon } from '@/components/markets/MarketCard';
import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { useSceneContent } from './scene';

/** Court corners (200×100): far baseline narrow, near baseline wide. */
const COURT = { farY: 34, nearY: 97, farL: 72, farR: 128, nearL: 6, nearR: 194 };

/** X on the left/right sideline at a given y — every perspective line
 *  (tramline, service line, net) hangs off this interpolation. */
function edge(y: number, side: 'l' | 'r'): number {
  const t = (y - COURT.farY) / (COURT.nearY - COURT.farY);
  return side === 'l'
    ? COURT.farL + t * (COURT.nearL - COURT.farL)
    : COURT.farR + t * (COURT.nearR - COURT.farR);
}

/** A line across the court at height y, optionally inset from the
 *  sidelines by a fraction of the local width (tramlines use ~0.095). */
function across(y: number, inset = 0): { x1: number; x2: number } {
  const l = edge(y, 'l');
  const r = edge(y, 'r');
  const w = r - l;
  return { x1: l + w * inset, x2: r - w * inset };
}

const NET_Y = 58;
const FAR_SERVICE_Y = 46;
const NEAR_SERVICE_Y = 78;
const TRAM = 0.095;

export default function TennisHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const { headline, board, labels } = useSceneContent(events, markets);

  if (board.length < 2) return <>{fallback}</>;
  const [a, b] = board;
  const href = headline ? `/event/${headline.id}` : `/market/${a.id}`;
  const title = headline?.title ?? a.question;

  const net = across(NET_Y);
  const farSvc = across(FAR_SERVICE_Y, TRAM);
  const nearSvc = across(NEAR_SERVICE_Y, TRAM);

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden card-surface">
      {/* Court scene — hidden below sm */}
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[48%] sm:block">
        {/* Night above, floodlight wash below it */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-transparent" />
        <div
          aria-hidden
          className="absolute -top-6 left-1/2 h-[130%] w-40 -translate-x-1/2 bg-gradient-to-b from-tx/[0.08] via-tx/[0.02] to-transparent blur-[2px]"
        />

        {/* Crowd lights in the dark */}
        {Array.from({ length: 16 }, (_, i) => {
          const h = hashString(`${a.id}:crowd:${i}`);
          return (
            <span
              key={i}
              aria-hidden
              className="arena-dot absolute h-1 w-1 rounded-full bg-tx-sec"
              style={{
                left: `${3 + i * 6 + ((h % 5) - 2) * 0.6}%`,
                top: `${4 + ((h >>> 3) % 4) * 2.4}%`,
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
          {/* Painted acrylic: run-off, then the court */}
          <polygon
            points={`${COURT.farL - 14},${COURT.farY - 4} ${COURT.farR + 14},${COURT.farY - 4} 200,100 0,100`}
            fill="rgba(59,157,248,0.06)"
          />
          <polygon
            points={`${COURT.farL},${COURT.farY} ${COURT.farR},${COURT.farY} ${COURT.nearR},${COURT.nearY} ${COURT.nearL},${COURT.nearY}`}
            fill="rgba(59,157,248,0.14)"
            stroke="rgba(199,213,224,0.45)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {/* Tramlines riding the vanishing lines */}
          <line x1={COURT.farL + (COURT.farR - COURT.farL) * TRAM} y1={COURT.farY} x2={COURT.nearL + (COURT.nearR - COURT.nearL) * TRAM} y2={COURT.nearY} stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={COURT.farR - (COURT.farR - COURT.farL) * TRAM} y1={COURT.farY} x2={COURT.nearR - (COURT.nearR - COURT.nearL) * TRAM} y2={COURT.nearY} stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* Service lines + centre line */}
          <line x1={farSvc.x1} y1={FAR_SERVICE_Y} x2={farSvc.x2} y2={FAR_SERVICE_Y} stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={nearSvc.x1} y1={NEAR_SERVICE_Y} x2={nearSvc.x2} y2={NEAR_SERVICE_Y} stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="100" y1={FAR_SERVICE_Y} x2="100" y2={NEAR_SERVICE_Y} stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* The serve: dashed arc over the net, ball at the landing spot */}
          <path
            className="scene-arc"
            d="M 162 92 Q 150 16 80 47"
            fill="none"
            stroke="rgba(255,181,71,0.55)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {/* The net, strung over everything behind it */}
          <line x1={net.x1 - 6} y1={NET_Y} x2={net.x2 + 6} y2={NET_Y} stroke="rgba(255,255,255,0.45)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          {Array.from({ length: 13 }, (_, i) => {
            const x = net.x1 - 2 + ((net.x2 - net.x1 + 4) / 12) * i;
            return (
              <line
                key={i}
                x1={x}
                y1={NET_Y}
                x2={x}
                y2={NET_Y + 5.5}
                stroke="rgba(255,255,255,0.14)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <line x1={net.x1 - 6} y1={NET_Y + 5.5} x2={net.x2 + 6} y2={NET_Y + 5.5} stroke="rgba(255,255,255,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={net.x1 - 6} y1={NET_Y} x2={net.x1 - 6} y2={NET_Y + 6.5} stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          <line x1={net.x2 + 6} y1={NET_Y} x2={net.x2 + 6} y2={NET_Y + 6.5} stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* The ball, pulsing where the serve lands */}
        <span
          aria-hidden
          className="arena-dot absolute h-1.5 w-1.5 rounded-full bg-amber"
          style={{
            left: '40%',
            top: '47%',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 6px rgba(255,181,71,0.6)',
            ['--dot-lo' as string]: 0.5,
            ['--dot-hi' as string]: 1,
          }}
        />

        {/* THE SCORE BUG — one link, broadcast-style */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35, ease: 'easeOut' }}
          className="absolute right-2 top-3 z-10 w-[62%] max-w-[190px]"
        >
          <Link
            href={href}
            title={title}
            className="pointer-events-auto block overflow-hidden rounded-lg border border-line-strong bg-surface/95 shadow-2xl transition-transform hover:scale-[1.03]"
          >
            <span className="block border-b border-line bg-surface-3/60 px-2 py-0.5">
              <span className="block truncate text-[8px] font-black uppercase tracking-[0.16em] text-sky">
                {title}
              </span>
            </span>
            {[a, b].map((p, i) => (
              <span
                key={p.id}
                className={`flex items-center gap-1.5 px-2 py-1 ${i === 0 ? 'border-b border-line/60' : ''}`}
              >
                <MarketIcon
                  icon={p.icon}
                  category={p.category}
                  className="h-4 w-4 rounded-full"
                  iconClassName="h-2.5 w-2.5"
                />
                <span className="min-w-0 flex-1 truncate text-nano font-semibold text-tx-sec">
                  {labels.get(p.id) ?? p.question}
                </span>
                <span className="shrink-0 text-micro font-bold text-green tabular-nums">
                  {formatPercent(p.yesPrice)}
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
