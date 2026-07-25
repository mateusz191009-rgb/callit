'use client';

/**
 * Category hero for the Tennis chip — the "court view" (v25.8).
 *
 * The field is a hard court seen from the umpire's chair: baselines, the
 * singles tramlines, the service boxes with their centre line, and the net
 * strung across the middle. The top-2 outcomes stand at the two baselines —
 * on a match market that is the two players — and the rest take the service
 * and tramline positions. A ball rallies over the net (.tennis-ball), its
 * keyframed path routed through the same percent coordinates the formation
 * uses so the two never drift apart.
 *
 * Falls back to the generic floating-tiles hero below 3 usable outcomes.
 */

import { HeroCopy, type CategoryHeroProps } from './CryptoHero';
import { SceneShell, SceneTile, useSceneTiles, type Slot } from './scene';

/**
 * Tile CENTRES in percent of the court, near end first — four of them in a
 * diamond (see Slot). Index 0 and 1 are the two baselines, so the biggest
 * event's favourites face each other across the net; the other two come in
 * to the service line either side.
 */
const FORMATION: readonly Slot[] = [
  { left: 50, top: 80 }, // near baseline
  { left: 50, top: 20 }, // far baseline
  { left: 26, top: 50 }, // deuce side, at the net
  { left: 74, top: 50 }, // ad side, at the net
];

export default function TennisHero({ markets, events, stats, fallback }: CategoryHeroProps) {
  const tiles = useSceneTiles(events, markets, FORMATION);

  if (tiles.length < 3) return <>{fallback}</>;

  return (
    <section className="hero-glow relative min-h-[220px] overflow-hidden rounded-2xl border border-line bg-surface-2">
      <SceneShell fieldClassName="border-sky/15 bg-sky/10">
        {/* Court markings. The inner rect is the singles court; the two
            boxes either side of the net are the service courts. */}
        <div aria-hidden className="absolute inset-x-[14%] inset-y-[6%] border border-sky/25">
          {/* Service line, near and far, plus the centre service line. */}
          <div className="absolute inset-x-0 top-[26%] border-t border-sky/20" />
          <div className="absolute inset-x-0 bottom-[26%] border-b border-sky/20" />
          <div className="absolute inset-y-[26%] left-1/2 border-l border-sky/20" />
          {/* Centre marks on the baselines. */}
          <div className="absolute left-1/2 top-0 h-1.5 border-l border-sky/30" />
          <div className="absolute bottom-0 left-1/2 h-1.5 border-l border-sky/30" />
        </div>
        {/* Tramlines — the doubles alleys sit outside the singles court. */}
        <div aria-hidden className="absolute inset-x-[8%] inset-y-[6%] border-x border-sky/15" />

        {/* The net: a dashed band across the middle, taller at the posts. */}
        <div
          aria-hidden
          className="absolute inset-x-[6%] top-1/2 -translate-y-1/2 border-t-2 border-dashed border-white/25"
        />
        <span aria-hidden className="absolute left-[6%] top-1/2 h-3 w-px -translate-y-1/2 bg-white/30" />
        <span aria-hidden className="absolute right-[6%] top-1/2 h-3 w-px -translate-y-1/2 bg-white/30" />

        {/* Ball in a rally. */}
        <span aria-hidden className="tennis-ball absolute h-1.5 w-1.5 rounded-full bg-amber" />

        {tiles.map((t, i) => (
          <SceneTile key={t.market.id} tile={t} index={i} />
        ))}
      </SceneShell>

      <HeroCopy stats={stats} />
    </section>
  );
}
