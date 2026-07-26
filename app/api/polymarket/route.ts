import { getCachedFeedData } from '@/lib/feed';
import { maybeSettle, maybeSync } from '@/lib/feedSync';
import type { EventGroup, Market } from '@/lib/types';

/** Server-side proxy for the UNIFIED feed — avoids CORS in the browser and
 *  centralizes the mock fallback. Returns both trending binary markets and
 *  multi-outcome events: `{ markets, events }`.
 *
 *  v6: the payload now comes from `lib/feed.ts` (Polymarket + Kalshi, merged
 *  and category-balanced) rather than Polymarket alone. The ROUTE PATH IS
 *  UNCHANGED on purpose — lib/useMarkets.ts and the mock fallback both
 *  depend on it, and the response shape is identical.
 *
 *  v25.18: this is now the STRUCTURE feed — clients fetch it on mount and
 *  every POLY_FULL_REFRESH_MS, while the 60s beat goes to ./odds. The DB
 *  mirror and the settlement trigger moved to lib/feedSync.ts so both routes
 *  keep them running (see the header there). */
export const dynamic = 'force-dynamic';
// Vercel: the default function limit can be too tight for a cold cycle
// (Kalshi 9s budget + Gamma fetches + DB mirror) — give it headroom.
export const maxDuration = 30;

/* ------------------------------------------------------------------ */
/* Wire shape (v25.18)                                                  */
/* ------------------------------------------------------------------ */

/**
 * THE SAME MARKET, SERIALIZED THREE TIMES.
 *
 * Measured on the live feed: this response was **19.84 MB**, and every client
 * refetched all of it every 60 seconds. Two thirds of that was not data, it was
 * repetition:
 *
 *   - `markets[]` held all 4468 event outcomes AS WELL AS their events
 *     (getPolymarketData merges them in so lookups can find them) — 7.78 MB of
 *     objects that were already inside `events[].markets`.
 *   - each game event's `groups[]` held ANOTHER copy of its sub-markets, since
 *     buildGroups partitions the event's own list rather than referencing it —
 *     which is why 151 game events alone weighed 9.45 MB.
 *
 * Neither copy carries information. So on the wire: `markets[]` keeps only
 * genuinely standalone rows, and a group carries ids. The client rebuilds both
 * views on ingest (`setPolymarkets` in lib/store.ts) — `useMarketMap` already
 * indexed `poly` and `polyEvents` together, so nothing downstream changed.
 *
 * The DB mirror runs on the FULL payload, before this — `syncMarkets` needs
 * every outcome row, and shrinking the wire must never shrink the book.
 */
function toWirePayload(data: { markets: Market[]; events: EventGroup[] }) {
  const outcomeIds = new Set<string>();
  for (const e of data.events) for (const m of e.markets) outcomeIds.add(m.id);

  return {
    markets: data.markets.filter((m) => !outcomeIds.has(m.id)).map(stripLongText),
    events: data.events.map((e) => ({
      ...e,
      markets: e.markets.map(stripLongText),
      ...(e.groups
        ? {
            groups: e.groups.map((g) => ({
              id: g.id,
              label: g.label,
              // Empty, not omitted: MarketGroup.markets stays a required
              // field so no consumer needs a null check (see lib/types.ts).
              markets: [],
              marketIds: g.markets.map((m) => m.id),
            })),
          }
        : null),
    })),
  };
}

/**
 * v25.20 — THE RESOLUTION RULES DO NOT BELONG IN A LIST.
 *
 * `description` is the single biggest field in the feed: 4.5 MB across ~4200
 * markets, ~1050 characters each, and no card renders one. Exactly one is read
 * at a time — on the market page the user opened — so it is fetched there,
 * from /api/market-info, out of this same cached payload. No new upstream
 * call, and ~40% off the one payload a first visit has to download.
 */
function stripLongText(m: Market): Market {
  if (!m.description) return m;
  const { description: _drop, ...rest } = m;
  return rest as Market;
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  const data = await getCachedFeedData();
  maybeSync(data);
  maybeSettle(req);
  // v14: max-age 60 -> 30. Clients poll every 60s now; a 60s browser cache
  // would hand every other poll a stale payload (the exact v9 bug at the
  // next scale down). 30s guarantees at most one cached reuse.
  //
  // v25.18 — clients only fetch this on mount and every FULL_REFRESH_MS
  // (lib/useMarkets.ts); the 60s beat in between hits /api/polymarket/odds,
  // which is ~1% of these bytes.
  return Response.json(toWirePayload(data), {
    headers: { 'cache-control': 'public, max-age=30' },
  });
}
