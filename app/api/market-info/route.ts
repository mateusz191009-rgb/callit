import { getCachedFeedData } from '@/lib/feed';

/**
 * One market's long text, on demand (v25.20).
 *
 * The resolution rules are the biggest single thing in the feed — 4.5 MB
 * across ~4200 markets, averaging ~1050 characters each — and exactly one of
 * them is ever read at a time, on the market page the user opened. So the list
 * payload stopped shipping them (see toWirePayload) and this hands back the one
 * that is actually being looked at.
 *
 * NO NEW UPSTREAM CALL. It reads the same cached feed the list route serves,
 * which the server already holds in memory; a miss simply returns an empty
 * description rather than going hunting, because a market not in the feed is
 * one whose page renders from the DB row anyway.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) {
    return Response.json({ error: 'missing id' }, { status: 400 });
  }

  const data = await getCachedFeedData();
  const market =
    data.markets.find((m) => m.id === id) ??
    data.events.flatMap((e) => e.markets).find((m) => m.id === id);

  return Response.json(
    { id, description: market?.description ?? null },
    // Rules do not change under a market. Cache hard: this is the one part of
    // the feed that is genuinely static, and it makes a second visit free.
    { headers: { 'cache-control': 'public, max-age=600' } }
  );
}
