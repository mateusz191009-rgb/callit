/**
 * v15 — client side of the bet-time quote check (see app/api/quote).
 *
 * Called from `trade()` in lib/store.ts ONLY for in-play feed markets, in
 * the moment the user confirms a bet. Hard 2s cap and null on ANY failure:
 * the check may stop a stale-quote fill, it must never stop a healthy one.
 */

/** How far the live quote may drift from the displayed price before the
 *  bet is interrupted and re-quoted (3¢ — a live goal moves far more,
 *  normal in-play jitter far less). */
export const QUOTE_DRIFT_MAX = 0.03;

export async function fetchFreshQuote(marketId: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/quote?id=${encodeURIComponent(marketId)}`, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { yesPrice?: unknown };
    const p = typeof body.yesPrice === 'number' ? body.yesPrice : NaN;
    return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
  } catch {
    return null;
  }
}
