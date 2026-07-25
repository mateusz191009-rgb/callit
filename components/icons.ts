import { createLucideIcon } from 'lucide-react';

/**
 * Custom sport glyphs in the Lucide grammar (24×24, stroke-only) —
 * lucide ships no basketball/baseball icon, and the v12 US-sports hubs
 * need both. Built with createLucideIcon so they type-check as
 * LucideIcon everywhere the category icon maps expect one.
 *
 * v25.7 adds tennis and cricket for the sport chips. Every glyph here is
 * stroke-only on the same 24×24 grid as lucide's own set, so a chip mixing
 * `Swords` with `TennisIcon` reads as one icon family rather than two.
 */

/** Ball with the four classic seams: cross + two curved side seams. */
export const BasketballIcon = createLucideIcon('BasketballCustom', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M12 2v20', key: 'seam-v' }],
  ['path', { d: 'M2 12h20', key: 'seam-h' }],
  ['path', { d: 'M5.3 5.3a15 15 0 0 1 0 13.4', key: 'seam-l' }],
  ['path', { d: 'M18.7 5.3a15 15 0 0 0 0 13.4', key: 'seam-r' }],
]);

/** Ball with the two opposing stitch seams of a baseball. */
export const BaseballIcon = createLucideIcon('BaseballCustom', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'ball' }],
  ['path', { d: 'M12.55 2.03a10 10 0 0 1-10.52 10.52', key: 'seam-tl' }],
  ['path', { d: 'M21.97 11.45a10 10 0 0 0-10.52 10.52', key: 'seam-br' }],
]);

/**
 * Tennis RACKET — head, strings, handle. Not a ball, deliberately: a ball
 * would be a third circle-with-curves next to Basketball and Baseball, and
 * the seam orientation is not a difference the eye catches at 14px. The
 * racket silhouette is unmistakable at any size, and the crossed strings
 * are what stop it reading as a magnifying glass.
 *
 * (A ball version was drawn and rendered first — it read as a closed eye.)
 */
export const TennisIcon = createLucideIcon('TennisCustom', [
  ['ellipse', { cx: '12', cy: '8.5', rx: '6.5', ry: '7', key: 'head' }],
  ['path', { d: 'M12 1.5v14', key: 'strings-v' }],
  ['path', { d: 'M5.5 8.5h13', key: 'strings-h' }],
  ['path', { d: 'M12 15.5V22', key: 'handle' }],
]);
