'use client';

/**
 * Category hero for the Cricket chip — the "ground view" (v25.8).
 *
 * The field is the whole ground from above, which is what makes cricket
 * look like cricket and nothing else: an oval boundary, the 30-yard inner
 * ring, and the pitch as a pale strip down the middle with a wicket at each
 * end. The top-2 outcomes take the two ends (striker and bowler), the rest
 * spread into fielding positions between the ring and the rope. The ball is
 * driven out to the boundary and relayed back (.cricket-ball).
 *
 * Falls back to the generic floating-tiles hero below 3 usable outcomes —
 * which matters more here than elsewhere: cricket arrives as flat markets
 * with no parent event, so a thin week really can leave the ground empty.
 */

import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { SceneShell, SceneTile, useSceneTiles, type Slot } from './scene';

/**
 * Tile CENTRES in percent of the ground. 0 and 1 are the two ends of the
 * pitch; the rest are fielders, kept off the strip so nothing sits on top
 * of the wickets.
 */
const FORMATION: readonly Slot[] = [
  // Four fielding positions (see Slot), all OFF the centre strip: a tile
  // parked on the pitch hides the wicket, and the wickets are what make
  // this read as cricket rather than as a running track.
  { left: 34, top: 26 }, // mid-off
  { left: 66, top: 74 }, // long on
  { left: 24, top: 56 }, // square leg
  { left: 76, top: 44 }, // point
];

export default function CricketHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useSceneTiles(events, markets, FORMATION);

  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      <SceneShell>
        {/* Boundary rope — the oval that says "cricket" at a glance. */}
        <div
          aria-hidden
          className="absolute inset-[6%] rounded-[50%] border border-green/25 bg-green/[0.06]"
        />
        {/* 30-yard inner ring. */}
        <div
          aria-hidden
          className="absolute inset-[24%] rounded-[50%] border border-dashed border-green/20"
        />
        {/* The pitch: a worn strip down the middle. Long enough that its
            two ends stay clear of the tiles flanking them. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[56%] w-[11%] -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-amber/25 bg-amber/15"
        />
        {/* Creases at both ends. */}
        <div aria-hidden className="absolute left-1/2 top-[26%] w-[11%] -translate-x-1/2 border-t border-amber/35" />
        <div aria-hidden className="absolute bottom-[26%] left-1/2 w-[11%] -translate-x-1/2 border-b border-amber/35" />
        {/* Wickets — three stumps at each end, small enough to read as one mark. */}
        {[24, 73].map((top) => (
          <span
            key={top}
            aria-hidden
            className="absolute left-1/2 flex -translate-x-1/2 gap-[2px]"
            style={{ top: `${top}%` }}
          >
            <span className="h-2 w-px bg-amber/70" />
            <span className="h-2 w-px bg-amber/70" />
            <span className="h-2 w-px bg-amber/70" />
          </span>
        ))}

        {/* Ball: driven to the rope, then relayed in. */}
        <span aria-hidden className="cricket-ball absolute h-1.5 w-1.5 rounded-full bg-danger" />

        {tiles.map((t, i) => (
          <SceneTile key={t.market.id} tile={t} index={i} />
        ))}
      </SceneShell>

      <HeroCopy stats={stats} />
    </section>
  );
}
