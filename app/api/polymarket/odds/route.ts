import { getCachedFeedData } from '@/lib/feed';
import { maybeSettle, maybeSync } from '@/lib/feedSync';
import type { EventGroup, FeedOdds, Market } from '@/lib/types';

/**
 * THE REFRESH BEAT — quotes and live state only (v25.18).
 *
 * Owner: "market beschreibungen etc. brauchen wir nur einmal eigentlich nur
 * die quoten und livetiming bei manchen markets". Exactly right, and the
 * numbers were brutal: /api/polymarket is ~12 MB (19.84 before the wire fix)
 * and every client refetched ALL of it every 60 seconds to learn that a price
 * moved a cent. Questions, descriptions, icons, categories, end dates, team
 * rosters and section labels do not change between two polls.
 *
 * So the poll splits in two (see lib/useMarkets.ts):
 *   - the FULL feed on mount and every FULL_REFRESH_MS, which is what brings
 *     in newly listed markets and retires closed ones;
 *   - this route on the 60s beat, ~300 KB, which is what keeps a quote from
 *     ever being a minute and a half old.
 *
 * The 60s cadence is load-bearing, not cosmetic: it is the stale-quote window
 * the owner asked for ("damit es nicht irgendwelche alten quoten gibt beim
 * wetten die ausgenutzt werden können"). Splitting the poll makes that window
 * cheap enough to keep.
 *
 * Keys are one or two characters because there are ~4200 of them and the id is
 * already the biggest part of each entry.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * One market's volatile state — the shape lives in lib/types.ts (`FeedOdds`)
 * so the store's patch and this route can never drift apart. Field by field:
 *   p  yesPrice
 *   v  volume (lifetime)
 *   d  volume24hr — omitted when the provider gives us none
 *   c  sourceClosed, the trading gate — omitted when false
 *   l  sourceLive  — the provider says the match is running
 *   e  sourceEnded — the provider says it is over
 *   s  startTime — the one date that really moves (delayed kickoffs); sent for
 *      every game row, since the server can't know what the client holds.
 * Everything omitted is metadata the full payload carried and that cannot
 * change under a market.
 */
type OddsRow = FeedOdds['markets'][string];

function rowOf(m: Market): OddsRow {
  const row: OddsRow = { p: m.yesPrice, v: m.volume };
  if (typeof m.volume24hr === 'number') row.d = m.volume24hr;
  if (m.sourceClosed === true) row.c = 1;
  if (typeof m.sourceLive === 'boolean') row.l = m.sourceLive ? 1 : 0;
  if (typeof m.sourceEnded === 'boolean') row.e = m.sourceEnded ? 1 : 0;
  // Only game sub-markets have a kickoff, and it is the one date that really
  // does move between polls (delays, reschedules).
  if (m.groupId && m.startTime) row.s = m.startTime;
  return row;
}

export async function GET(req: Request) {
  const data = await getCachedFeedData();
  // v25.18 — THE SIDE EFFECTS RIDE ALONG. This is now the request that arrives
  // every 60s while someone is using the site, so it is what has to keep the
  // DB mirror and the settlement sweep on their old cadence; the full feed is
  // only fetched every 5 minutes. Both are throttled in lib/feedSync.ts and
  // shared with the full route, so this costs nothing when it has just run.
  maybeSync(data);
  maybeSettle(req);

  const markets: FeedOdds['markets'] = {};
  const add = (m: Market) => {
    if (!m?.id || markets[m.id]) return;
    markets[m.id] = rowOf(m);
  };
  for (const m of data.markets) add(m);
  for (const e of data.events) for (const m of e.markets) add(m);

  const events: FeedOdds['events'] = {};
  for (const e of data.events as EventGroup[]) {
    events[e.id] =
      typeof e.volume24hr === 'number' ? { v: e.volume, d: e.volume24hr } : { v: e.volume };
  }

  // Same 30s as the full feed: at most one cached reuse per 60s poll.
  return Response.json({ markets, events } satisfies FeedOdds, {
    headers: { 'cache-control': 'public, max-age=30' },
  });
}
