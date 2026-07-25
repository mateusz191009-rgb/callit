'use client';

/**
 * Category hero for the UFC chip — the cage under the lights (v25.9).
 *
 * The field is one inline SVG (viewBox 200×100, stretched to the shell;
 * every stroke carries vector-effect="non-scaling-stroke" so lines stay
 * hairline-crisp at any size): a double octagon — fence outside, mat edge
 * inside — with the chain-link drawn as an SVG pattern clipped to the mat,
 * a post on all eight fence corners, the red and blue corner pads, a
 * spotlight beam falling from the top and a faint amber glow pooled in the
 * middle where the centre circle and a big quiet VS sit. A light sweeps
 * the canvas (.cage-sweep, CSS).
 *
 * The two favourites face off across the centre circle wearing their
 * corner's glow (SceneTile's halo); the other two outcomes wait at the
 * north and south fence.
 *
 * Falls back to the generic floating-tiles hero below 3 usable outcomes.
 */

import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { SceneShell, SceneTile, useSceneTiles, type Slot } from './scene';

/** Diamond of four (see Slot in scene.tsx for the spacing maths). */
const FORMATION: readonly Slot[] = [
  { left: 30, top: 50 }, // red corner
  { left: 70, top: 50 }, // blue corner
  { left: 50, top: 20 }, // north fence
  { left: 50, top: 80 }, // south fence
];

/** Halo colors for the two corners — danger and sky at low alpha. */
const CORNER_GLOWS = [
  'rgba(255, 92, 122, 0.45)',
  'rgba(59, 157, 248, 0.45)',
] as const;

/** Fence and mat octagons in the 200×100 viewBox. */
const FENCE = '60,3 140,3 197,30 197,70 140,97 60,97 3,70 3,30';
const MAT = '68,12 132,12 185,34 185,66 132,88 68,88 15,66 15,34';

export default function UfcHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useSceneTiles(events, markets, FORMATION);

  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      <SceneShell fieldClassName="border-amber/15 bg-amber/[0.05]">
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 200 100"
          preserveAspectRatio="none"
        >
          <defs>
            <pattern id="ufc-mesh" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 0l7 7M7 0L0 7" stroke="rgba(255,181,71,0.14)" strokeWidth="0.5" />
            </pattern>
            <radialGradient id="ufc-pool" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="rgba(255,181,71,0.16)" />
              <stop offset="100%" stopColor="rgba(255,181,71,0)" />
            </radialGradient>
            <linearGradient id="ufc-beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
            <clipPath id="ufc-mat-clip">
              <polygon points={MAT} />
            </clipPath>
          </defs>

          {/* Spotlight cone from the rig down onto the mat. */}
          <polygon points="78,0 122,0 156,100 44,100" fill="url(#ufc-beam)" />

          {/* The mat: pooled light, canvas, chain-link. */}
          <polygon points={MAT} fill="url(#ufc-pool)" />
          <polygon points={MAT} fill="url(#ufc-mesh)" clipPath="url(#ufc-mat-clip)" />

          {/* Fence and mat edge. */}
          <polygon
            points={FENCE}
            fill="none"
            stroke="rgba(255,181,71,0.28)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={MAT}
            fill="none"
            stroke="rgba(255,181,71,0.4)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* Cables between fence and mat on the four diagonals. */}
          {[
            [60, 3, 68, 12],
            [140, 3, 132, 12],
            [197, 30, 185, 34],
            [197, 70, 185, 66],
            [140, 97, 132, 88],
            [60, 97, 68, 88],
            [3, 70, 15, 66],
            [3, 30, 15, 34],
          ].map(([x1, y1, x2, y2]) => (
            <line
              key={`${x1}-${y1}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(255,181,71,0.22)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Posts on every fence corner. */}
          {FENCE.split(' ').map((pt) => {
            const [x, y] = pt.split(',').map(Number);
            return <circle key={pt} cx={x} cy={y} r="1.6" fill="rgba(255,181,71,0.5)" />;
          })}

          {/* Corner pads: red west, blue east. */}
          <line x1="3" y1="41" x2="3" y2="59" stroke="rgba(255,92,122,0.85)" strokeWidth="3.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1="197" y1="41" x2="197" y2="59" stroke="rgba(59,157,248,0.85)" strokeWidth="3.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

          {/* Centre circle + the quiet VS. */}
          <circle
            className="ufc-ring"
            cx="100"
            cy="50"
            r="13"
            fill="none"
            stroke="rgba(255,181,71,0.35)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x="100"
            y="54.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="900"
            letterSpacing="1.5"
            fill="rgba(255,255,255,0.13)"
          >
            VS
          </text>
        </svg>

        {/* Overhead light sweeping the canvas. */}
        <span aria-hidden className="cage-sweep absolute inset-0" />

        {tiles.map((t, i) => (
          <SceneTile key={t.market.id} tile={t} index={i} glow={CORNER_GLOWS[i]} />
        ))}
      </SceneShell>

      <HeroCopy stats={stats} />
    </section>
  );
}
