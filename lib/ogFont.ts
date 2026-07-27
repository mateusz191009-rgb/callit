/**
 * v25.40 — NUNITO FOR THE OG IMAGE ROUTES.
 *
 * `next/og` renders through satori, which does not read the page's CSS and
 * cannot use the `next/font` handle the app is built on. Without an explicit
 * font it falls back to its bundled default — which renders, but at one
 * weight, so a card whose entire hierarchy is "black vs regular" comes out
 * flat. The share image is the thing strangers see first; it is worth the
 * fetch.
 *
 * TTF, NOT WOFF2 — and that is why this deliberately does NOT send a modern
 * User-Agent. Google's css2 endpoint serves woff2 to browsers and truetype to
 * everything else, and satori can only read the latter.
 *
 * Cached in a module-level promise: one fetch per warm lambda, not one per
 * image. Every failure path returns an empty array, and `ImageResponse` falls
 * back to its default font — a plainer card is fine, a 500 on somebody's
 * shared link is not.
 */

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 800;
  style: 'normal';
}

const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;800';

/** How long to wait before giving up and rendering with the default font. */
const FETCH_TIMEOUT_MS = 3000;

let cached: Promise<OgFont[]> | null = null;

async function loadFonts(): Promise<OgFont[]> {
  try {
    const css = await fetch(FONT_CSS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((r) => (r.ok ? r.text() : ''));
    if (!css) return [];

    // The css2 response is one @font-face block per weight, in the order
    // requested. Pair each url with the weight declared in its own block.
    const blocks = css.split('@font-face').slice(1);
    const wanted: (400 | 800)[] = [400, 800];
    const found = new Map<400 | 800, string>();
    for (const block of blocks) {
      const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1]);
      const url = block.match(/src:\s*url\((https:\/\/[^)]+)\)/)?.[1];
      if (!url) continue;
      const w = wanted.find((x) => x === weight);
      if (w !== undefined && !found.has(w)) found.set(w, url);
    }
    if (found.size === 0) return [];

    const fonts = await Promise.all(
      [...found].map(async ([weight, url]) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return null;
        return {
          name: 'Nunito',
          data: await res.arrayBuffer(),
          weight,
          style: 'normal',
        } satisfies OgFont;
      })
    );
    return fonts.filter((f): f is OgFont => f !== null);
  } catch {
    return [];
  }
}

/** Nunito 400 + 800, or `[]` when the fetch failed (render with the default). */
export function ogFonts(): Promise<OgFont[]> {
  // A failed load is not memoised as a permanent verdict: `cached` is only
  // set on the first call, but the resolved value being `[]` is cheap, and a
  // cold lambda retries anyway.
  cached ??= loadFonts();
  return cached;
}
