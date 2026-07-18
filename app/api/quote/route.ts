import { serviceSupabase } from '@/lib/serverSupabase';

/**
 * v15 — single-market LIVE quote, fetched at bet time.
 *
 * Owner: "mache ein check wenn jemand bettet … nur dann wenn es wirklich
 * keine auswirkung hat". The client calls this ONLY in the moment a user
 * confirms a bet on an IN-PLAY feed market (see `trade()` in lib/store.ts)
 * — never on page loads, never on a poll. One upstream request per call,
 * softened by a 3s per-market memo, so even a click-happy user cannot
 * hammer Gamma/Kalshi through us.
 *
 * Response: `{ yesPrice: number | null }` — null means "could not confirm
 * a fresh price in time"; the caller proceeds with the feed price exactly
 * as before (fail-open). This endpoint must never block a trade for long:
 * upstream fetches are capped at 1.5s.
 *
 * Side effect: when the fresh price is usable and the market's pool is
 * still UNFUNDED (`collateral = 0` — the feed owns the price), it is also
 * written to the `markets` mirror, so the server-side `place_trade` prices
 * this very bet off the fresh quote instead of the ≤60s-old sync. Funded
 * pools are never touched: the pool owns their price (v6 economics rule).
 */
export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 1500;

/** Per-market memo — bounds upstream requests under rapid re-confirms. */
const MEMO_MS = 3000;
const memo = new Map<string, { at: number; p: Promise<number | null> }>();

function clampPrice(p: number): number {
  if (!Number.isFinite(p)) return NaN;
  return Math.min(0.99, Math.max(0.01, p));
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Gamma flat market by numeric id — same price parsing as the feed mapper. */
async function fetchGammaQuote(gammaId: string): Promise<number | null> {
  const res = await fetch(
    `https://gamma-api.polymarket.com/markets?id=${encodeURIComponent(gammaId)}`,
    { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { accept: 'application/json' } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as unknown[];
  const r = (Array.isArray(data) ? data[0] : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!r || r.closed === true || r.active === false) return null;
  const op = r.outcomePrices ?? r.outcome_prices;
  let yes = NaN;
  if (typeof op === 'string') {
    try {
      yes = parseFloat((JSON.parse(op) as string[])?.[0]);
    } catch {
      return null;
    }
  } else if (Array.isArray(op)) {
    yes = parseFloat(String(op[0]));
  }
  const p = clampPrice(yes);
  return Number.isFinite(p) ? p : null;
}

/** Kalshi market by ticker — last trade, else the bid/ask mid (mapper rule). */
async function fetchKalshiQuote(ticker: string): Promise<number | null> {
  const res = await fetch(
    `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`,
    { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { accept: 'application/json' } }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { market?: Record<string, unknown> };
  const m = body.market;
  if (!m || String(m.status ?? '') !== 'active') return null;
  let price = num(m.last_price_dollars) ?? NaN;
  if (!Number.isFinite(price) || price <= 0) {
    const bid = num(m.yes_bid_dollars);
    const ask = num(m.yes_ask_dollars);
    if (bid !== undefined && ask !== undefined && (bid > 0 || ask > 0)) {
      price = (bid + ask) / 2;
    }
  }
  const p = clampPrice(price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** Route a feed market id to its provider. `pm-<slug>` fallback ids (rows
 *  Gamma shipped without a numeric id) are unresolvable — fail open. */
function fetchQuote(id: string): Promise<number | null> {
  if (id.startsWith('pm-')) {
    const ref = id.slice(3);
    if (!/^\d+$/.test(ref)) return Promise.resolve(null);
    return fetchGammaQuote(ref);
  }
  if (id.startsWith('k-')) return fetchKalshiQuote(id.slice(2));
  return Promise.resolve(null);
}

/** Refresh the mirror row so `place_trade` prices THIS bet off the fresh
 *  quote — unfunded rows only (a funded pool owns its own price). Errors
 *  are logged and swallowed: the quote response must never depend on it. */
async function refreshMirror(id: string, yesPrice: number): Promise<void> {
  if (!serviceSupabase) return;
  try {
    const { error } = await serviceSupabase
      .from('markets')
      .update({ yes_price: yesPrice })
      .eq('id', id)
      .eq('collateral', 0);
    if (error) console.error('[api/quote] mirror refresh failed:', error.message);
  } catch (e) {
    console.error('[api/quote] mirror refresh crashed:', e);
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!id || id.length > 120) {
    return Response.json({ yesPrice: null }, { headers: { 'cache-control': 'no-store' } });
  }

  const now = Date.now();
  const hit = memo.get(id);
  const entry =
    hit && now - hit.at < MEMO_MS
      ? hit
      : { at: now, p: fetchQuote(id).catch((): null => null) };
  if (entry !== hit) {
    memo.set(id, entry);
    // Drop stale memo entries so the map cannot grow without bound.
    if (memo.size > 500) {
      for (const [k, v] of memo) if (now - v.at >= MEMO_MS) memo.delete(k);
    }
  }

  const yesPrice = await entry.p;
  // Only a fresh (non-memoized) usable quote writes the mirror — a repeat
  // within the memo window already did.
  if (yesPrice !== null && entry !== hit) await refreshMirror(id, yesPrice);

  return Response.json({ yesPrice }, { headers: { 'cache-control': 'no-store' } });
}
