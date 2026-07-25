'use client';

/**
 * Category hero for the UFC chip — the "octagon view" (v25.8).
 *
 * Same hero shell as every other themed scene (hero-glow, copy left, field
 * right, hidden below sm) but the field is the cage seen from above: an
 * eight-sided mat cut with clip-path, a chain-link mesh over it, the centre
 * circle, and the two corner posts. The top-2 outcomes square off in the
 * red and blue corners — on a fight card that is exactly the two fighters
 * of the main moneyline — and the rest of the card ranges around the fence.
 * A spotlight sweeps the mat (.cage-sweep).
 *
 * Falls back to the generic floating-tiles hero below 3 usable outcomes.
 */

import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { SceneShell, SceneTile, useSceneTiles, type Slot } from './scene';

/**
 * Tile CENTRES in percent of the mat — a diamond, four of them (see Slot).
 * The first two are the corners the fighters come out of, so the biggest
 * event's two favourites face each other across the centre circle; the
 * other two take the fence, north and south.
 */
const FORMATION: readonly Slot[] = [
  { left: 30, top: 50 }, // red corner
  { left: 70, top: 50 }, // blue corner
  { left: 50, top: 20 }, // north fence
  { left: 50, top: 80 }, // south fence
];

/** Regular octagon, flat-topped — the mat and the fence share it. */
const OCTAGON = 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)';

export default function UfcHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useSceneTiles(events, markets, FORMATION);

  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      {/* The mat is amber, not red: `danger` is the palette's only red and it
          means "error" everywhere else in the app — fine for a 10px corner
          post, wrong as the largest shape on the page. Amber also happens to
          be the right colour for canvas. */}
      <SceneShell fieldClassName="border-amber/15 bg-amber/[0.07]">
        {/* The mat: octagon of canvas, with the chain-link fence over it. */}
        <div
          aria-hidden
          className="cage-mesh absolute inset-[8%] border border-amber/25 bg-amber/10"
          style={{ clipPath: OCTAGON }}
        />
        {/* Centre circle — where they touch gloves. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber/30"
        />
        {/* Corner posts, red and blue, on the diagonal the fighters enter from. */}
        <span
          aria-hidden
          className="absolute left-[14%] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-danger/70"
        />
        <span
          aria-hidden
          className="absolute right-[14%] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-sky/70"
        />
        {/* Overhead light sweeping the canvas. */}
        <span aria-hidden className="cage-sweep absolute inset-0" />

        {tiles.map((t, i) => (
          <SceneTile key={t.market.id} tile={t} index={i} />
        ))}
      </SceneShell>

      <HeroCopy stats={stats} />
    </section>
  );
}
