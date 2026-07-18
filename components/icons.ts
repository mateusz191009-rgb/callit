import { createLucideIcon } from 'lucide-react';

/**
 * Custom sport glyphs in the Lucide grammar (24×24, stroke-only) —
 * lucide ships no basketball/baseball icon, and the v12 US-sports hubs
 * need both. Built with createLucideIcon so they type-check as
 * LucideIcon everywhere the category icon maps expect one.
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
