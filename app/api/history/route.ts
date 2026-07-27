import { getCachedFeedData } from '@/lib/feed';
import { fetchYesHistory } from '@/lib/polymarket';
import type { PricePoint } from '@/lib/types';

/**
 * One chart's REAL price history, on demand (v25.26).
 *
 * The feed deliberately ships no history — it was half the payload (v14) and
 * what it shipped was a seeded random walk anyway. This hands back the actual
 * series from Polymarket's CLOB for the handful of markets a page is about to
 * draw: one id on the market page, up to four on an event page.
 *
 * Same shape as /api/market-info: read the cached feed for the row (no extra
 * upstream call to identify it), then one small fetch for the series itself,
 * memoized 60s server-side in lib/polymarket.ts so a hundred viewers of the
 * same market cost one round trip. A market with no CLOB series (Kalshi,
 * community) comes back `null` and the chart falls back to the illustrative
 * walk — and says so.
 */
export const dynamic = 'force-dynamic';

/** An event page charts four outcomes; the cap is what stops a crafted URL
 *  from turning one request into a hundred upstream fetches. */
const MAX_IDS = 6;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('ids')?.trim();
  if (!raw) return Response.json({ error: 'missing ids' }, { status: 400 });

  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(
    0,
    MAX_IDS
  );
  if (ids.length === 0) return Response.json({ error: 'missing ids' }, { status: 400 });

  const data = await getCachedFeedData();
  const byId = new Map<string, { id: string; provider?: string; providerRef?: string }>();
  for (const m of data.markets) byId.set(m.id, m);
  for (const e of data.events) for (const m of e.markets) byId.set(m.id, m);

  const history: Record<string, PricePoint[] | null> = {};
  await Promise.all(
    ids.map(async (id) => {
      const market = byId.get(id);
      // Unknown id: not an error, just no series — a market page can render
      // from the DB row for something the live feed no longer carries.
      history[id] = market ? await fetchYesHistory(market) : null;
    })
  );

  return Response.json(
    { history },
    // Matches the server-side memo. Hourly closes do not move faster than
    // this, and the live tick is appended client-side from the feed price.
    { headers: { 'cache-control': 'public, max-age=60' } }
  );
}
