import { getEspnScores } from '@/lib/espn';
import { getFeedData } from '@/lib/feed';
import type { GameScore } from '@/lib/types';

/**
 * Live scores for the feed's game events (v21) — `{ scores: { [eventId]:
 * GameScore } }`, matched from the public ESPN scoreboard (lib/espn.ts).
 *
 * The whole response is memoized for CACHE_MS per instance, so however
 * many clients poll, upstream sees at most one feed read + a handful of
 * scoreboard fetches per 30s. An empty result is not cached — a transient
 * ESPN outage recovers on the next request instead of blanking the ticker.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const CACHE_MS = 30_000;

let memo: { at: number; p: Promise<Record<string, GameScore>> } | null = null;

async function buildScores(): Promise<Record<string, GameScore>> {
  const { events } = await getFeedData();
  return getEspnScores(events);
}

export async function GET() {
  const now = Date.now();
  if (!memo || now - memo.at >= CACHE_MS) {
    const entry = {
      at: now,
      p: buildScores().catch((): Record<string, GameScore> => ({})),
    };
    memo = entry;
    void entry.p.then((scores) => {
      if (Object.keys(scores).length === 0 && memo === entry) memo = null;
    });
  }
  const scores = await memo.p;
  return Response.json(
    { scores },
    // 20s: under the 30s server memo, so a browser-cached reuse can never
    // stack with a stale memo into a minute-old scoreline.
    { headers: { 'cache-control': 'public, max-age=20' } }
  );
}
