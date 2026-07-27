import { getCachedFeedData } from '@/lib/feed';
import { fetchKalshiHistory } from '@/lib/kalshi';
import { fetchYesHistory } from '@/lib/polymarket';
import type { PricePoint } from '@/lib/types';

/**
 * One chart's REAL price history, on demand (v25.26).
 *
 * The feed deliberately ships no history — it was half the payload (v14) and
 * what it shipped was a seeded random walk anyway. This hands back the actual
 * series for the handful of markets a page is about to draw: one id on the
 * market page, up to four on an event page or hero slide.
 *
 * Both providers serve one: Polymarket's CLOB `prices-history` off the outcome
 * token, Kalshi's `candlesticks` off the series + market ticker. Each is
 * memoized 60s in its own provider module, so a hundred viewers of the same
 * market cost one round trip. A market with neither (community rows, anything
 * the source has no series for) comes back `null` and the chart falls back to
 * the illustrative walk — and says so.
 */
export const dynamic = 'force-dynamic';

/** An event page charts four outcomes; the cap is what stops a crafted URL
 *  from turning one request into a hundred upstream fetches. */
const MAX_IDS = 6;

interface Row {
  id: string;
  provider?: string;
  providerRef?: string;
}

/**
 * The provider, from the id alone.
 *
 * Both feed mappers build the id from the provider's own key — `pm-${gammaId}`
 * and `k-${ticker}` — so the common case needs no lookup at all. That matters
 * on a cold lambda: the alternative, reading the cached feed, BUILDS the whole
 * feed (every Gamma page, the tag top-ups, the Kalshi walk) before it can
 * answer a question about one chart.
 */
function rowFromId(id: string): Row | null {
  if (id.startsWith('pm-')) {
    const ref = id.slice(3);
    // The mapper falls back to a slug when a Gamma row has no numeric id;
    // that is not a market id upstream, so let the feed lookup handle it.
    return /^\d+$/.test(ref) ? { id, provider: 'polymarket', providerRef: ref } : null;
  }
  if (id.startsWith('k-')) return { id, provider: 'kalshi', providerRef: id.slice(2) };
  return null;
}

function historyFor(row: Row): Promise<PricePoint[] | null> {
  if (row.provider === 'kalshi') return fetchKalshiHistory(row);
  if (row.provider === 'polymarket') return fetchYesHistory(row);
  // Community markets own their history (their fills ARE it) and never reach
  // this route for it.
  return Promise.resolve(null);
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('ids')?.trim();
  if (!raw) return Response.json({ error: 'missing ids' }, { status: 400 });

  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].slice(
    0,
    MAX_IDS
  );
  if (ids.length === 0) return Response.json({ error: 'missing ids' }, { status: 400 });

  const rows = new Map<string, Row | null>(ids.map((id) => [id, rowFromId(id)]));

  // Only the ids the prefix could not answer are worth waking the feed for.
  if ([...rows.values()].some((r) => r === null)) {
    const data = await getCachedFeedData();
    const byId = new Map<string, Row>();
    for (const m of data.markets) byId.set(m.id, m);
    for (const e of data.events) for (const m of e.markets) byId.set(m.id, m);
    for (const [id, row] of rows) {
      if (!row) rows.set(id, byId.get(id) ?? null);
    }
  }

  const history: Record<string, PricePoint[] | null> = {};
  await Promise.all(
    ids.map(async (id) => {
      const row = rows.get(id);
      history[id] = row ? await historyFor(row) : null;
    })
  );

  return Response.json(
    { history },
    // Matches the server-side memo. Hourly closes do not move faster than
    // this, and the live tick is appended client-side from the feed price.
    { headers: { 'cache-control': 'public, max-age=60' } }
  );
}
