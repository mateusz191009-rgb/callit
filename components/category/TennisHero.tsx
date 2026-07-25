'use client';

/**
 * Category hero for the Tennis chip — night session on a hard court
 * (v25.9).
 *
 * The court runs LANDSCAPE — net vertical in the middle, baselines left
 * and right — because the field is a 2:1 box and a portrait court squashed
 * into it read as a hockey rink (the v25.8 version did exactly that). One
 * inline SVG: painted acrylic in two blues (doubles surround darker, the
 * court itself brighter), tramlines, service boxes with the centre line,
 * a dashed net with posts, baseline centre marks, and a floodlight wash
 * falling from the top. The ball rallies baseline to baseline over the
 * net (.tennis-ball, CSS keyframes).
 *
 * The two favourites ARE the match-up: they hold the baselines wearing
 * the yes/no glows (green west, sky east); two more outcomes sit up and
 * back from the net like a doubles pair.
 *
 * Falls back to the generic floating-tiles hero below 3 usable outcomes.
 */

import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { SceneShell, SceneTile, useSceneTiles, type Slot } from './scene';

/** Baselines left/right, net players top/bottom (see Slot for spacing). */
const FORMATION: readonly Slot[] = [
  { left: 22, top: 50 }, // west baseline
  { left: 78, top: 50 }, // east baseline
  { left: 50, top: 18 }, // north, at the net
  { left: 50, top: 82 }, // south, at the net
];

/** The two players wear the yes/no side colors. */
const PLAYER_GLOWS = [
  'rgba(0, 225, 126, 0.4)',
  'rgba(59, 157, 248, 0.45)',
] as const;

export default function TennisHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useSceneTiles(events, markets, FORMATION);

  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      <SceneShell fieldClassName="border-sky/15 bg-sky/[0.06]">
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="tns-flood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.09)" />
              <stop offset="45%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>

          {/* Painted acrylic: doubles court, then the brighter singles court. */}
          <rect x="18" y="12" width="164" height="76" fill="rgba(59,157,248,0.10)" />
          <rect x="18" y="22" width="164" height="56" fill="rgba(59,157,248,0.16)" />

          {/* Floodlight wash. */}
          <rect x="0" y="0" width="200" height="100" fill="url(#tns-flood)" />

          {/* Doubles outline + tramlines. */}
          <rect x="18" y="12" width="164" height="76" fill="none" stroke="rgba(199,213,224,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="18" y1="22" x2="182" y2="22" stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="18" y1="78" x2="182" y2="78" stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* Service boxes: two service lines + the centre service line. */}
          <line x1="63" y1="22" x2="63" y2="78" stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="137" y1="22" x2="137" y2="78" stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="63" y1="50" x2="137" y2="50" stroke="rgba(199,213,224,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {/* Baseline centre marks. */}
          <line x1="18" y1="47.5" x2="21.5" y2="47.5" stroke="rgba(199,213,224,0.45)" strokeWidth="1" vectorEffect="non-scaling-stroke" transform="rotate(90 19.75 50)" />
          <line x1="178.5" y1="47.5" x2="182" y2="47.5" stroke="rgba(199,213,224,0.45)" strokeWidth="1" vectorEffect="non-scaling-stroke" transform="rotate(90 180.25 50)" />

          {/* The net: posts, band, mesh ticks. */}
          <line x1="100" y1="6" x2="100" y2="94" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx="100" cy="6" r="1.4" fill="rgba(255,255,255,0.45)" />
          <circle cx="100" cy="94" r="1.4" fill="rgba(255,255,255,0.45)" />
          {[14, 26, 38, 62, 74, 86].map((y) => (
            <line
              key={y}
              x1="97.6"
              y1={y}
              x2="102.4"
              y2={y}
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Ball in a rally. */}
        <span aria-hidden className="tennis-ball absolute h-1.5 w-1.5 rounded-full bg-amber" />

        {tiles.map((t, i) => (
          <SceneTile key={t.market.id} tile={t} index={i} glow={PLAYER_GLOWS[i]} />
        ))}
      </SceneShell>

      <HeroCopy stats={stats} />
    </section>
  );
}
