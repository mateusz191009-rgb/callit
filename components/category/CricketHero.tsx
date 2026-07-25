'use client';

/**
 * Category hero for the Cricket chip — the oval from the broadcast gantry
 * (v25.9).
 *
 * One inline SVG: the boundary ellipse filled with mowed stripes (an SVG
 * band pattern clipped to the oval — the alternating light/dark rings are
 * what make a cricket ground read instantly as one), the 30-yard circle
 * dashed inside it, and the pitch laid ALONG the long axis — amber strip,
 * popping creases, three stumps at either end — because a landscape field
 * wants a landscape pitch (the v25.8 version stood it upright and the
 * composition fought itself). A red ball is cut to the boundary and the
 * shot's trajectory hangs as a dashed arc that draws itself (.cricket-arc).
 *
 * The four outcomes field at the diamond's corners, off the strip so the
 * stumps stay visible; the top two wear a soft floodlight glow.
 *
 * Falls back to the generic floating-tiles hero below 3 usable outcomes —
 * which matters more here than elsewhere: cricket arrives as flat markets
 * with no parent event, so a thin week really can leave the ground empty.
 */

import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { SceneShell, SceneTile, useSceneTiles, type Slot } from './scene';

/** Diamond corners, all off the strip (see Slot for the spacing maths). */
const FORMATION: readonly Slot[] = [
  { left: 30, top: 28 }, // cover
  { left: 70, top: 72 }, // midwicket
  { left: 30, top: 72 }, // mid-on
  { left: 70, top: 28 }, // mid-off
];

/** Floodlight glow on the two favourites. */
const FIELD_GLOWS = ['rgba(255, 181, 71, 0.4)', 'rgba(255, 181, 71, 0.4)'] as const;

/** Three stumps + bail as one little group, centred on x. */
function Stumps({ x }: { x: number }) {
  return (
    <g stroke="rgba(255,181,71,0.8)" strokeWidth="1" vectorEffect="non-scaling-stroke">
      <line x1={x - 1.6} y1="46.5" x2={x - 1.6} y2="53.5" />
      <line x1={x} y1="46.5" x2={x} y2="53.5" />
      <line x1={x + 1.6} y1="46.5" x2={x + 1.6} y2="53.5" />
      <line x1={x - 2.2} y1="46.5" x2={x + 2.2} y2="46.5" />
    </g>
  );
}

export default function CricketHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useSceneTiles(events, markets, FORMATION);

  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      <SceneShell>
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="crk-mow" width="200" height="14" patternUnits="userSpaceOnUse">
              <rect width="200" height="7" fill="rgba(0,225,126,0.07)" />
              <rect y="7" width="200" height="7" fill="rgba(0,225,126,0.03)" />
            </pattern>
            <clipPath id="crk-oval">
              <ellipse cx="100" cy="50" rx="93" ry="43" />
            </clipPath>
          </defs>

          {/* The ground: mowed stripes inside the boundary rope. */}
          <ellipse cx="100" cy="50" rx="93" ry="43" fill="url(#crk-mow)" />
          <ellipse
            cx="100"
            cy="50"
            rx="93"
            ry="43"
            fill="none"
            stroke="rgba(0,225,126,0.35)"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
          {/* 30-yard circle. */}
          <ellipse
            cx="100"
            cy="50"
            rx="56"
            ry="26"
            fill="none"
            stroke="rgba(0,225,126,0.22)"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />

          {/* The pitch, along the long axis: strip, creases, stumps. */}
          <rect x="76" y="43" width="48" height="14" rx="1" fill="rgba(255,181,71,0.16)" stroke="rgba(255,181,71,0.3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="83" y1="43" x2="83" y2="57" stroke="rgba(255,181,71,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="117" y1="43" x2="117" y2="57" stroke="rgba(255,181,71,0.4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <Stumps x={79.5} />
          <Stumps x={120.5} />

          {/* The shot: a dashed arc from the bat out to the rope. */}
          <path
            className="cricket-arc"
            d="M 121 48 Q 152 10 188 32"
            fill="none"
            stroke="rgba(255,92,122,0.5)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* The ball riding that arc to the boundary. */}
        <span aria-hidden className="cricket-ball absolute h-1.5 w-1.5 rounded-full bg-danger" />

        {tiles.map((t, i) => (
          <SceneTile key={t.market.id} tile={t} index={i} glow={FIELD_GLOWS[i]} />
        ))}
      </SceneShell>

      <HeroCopy stats={stats} />
    </section>
  );
}
