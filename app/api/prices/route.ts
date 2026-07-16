import type { DepositCurrency } from '@/lib/types';
import { COINGECKO_IDS } from '@/lib/wallets';

/**
 * Live crypto prices for the deposit currencies — server-side proxy to
 * the CoinGecko simple/price endpoint (3s timeout) with a 5-minute
 * in-memory cache and static fallback prices when the API is
 * unreachable. Response shape: Record<DepositCurrency, number>
 * (USD per 1 unit), e.g. { "BTC": 118000, ..., "USDC": 1 }.
 */
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Static fallback (USD per unit) when CoinGecko is unreachable. */
const FALLBACK_PRICES: Record<DepositCurrency, number> = {
  BTC: 118_000,
  ETH: 4_200,
  USDT: 1,
  USDC: 1,
  BNB: 950,
  SOL: 210,
};

const COINGECKO_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(
  COINGECKO_IDS
).join(',')}&vs_currencies=usd`;

let cache: { at: number; data: Record<DepositCurrency, number> } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return Response.json(cache.data);
  }

  try {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const raw = (await res.json()) as Record<string, { usd?: number } | undefined>;

    const data = { ...FALLBACK_PRICES };
    for (const currency of Object.keys(COINGECKO_IDS) as DepositCurrency[]) {
      const usd = raw[COINGECKO_IDS[currency]]?.usd;
      if (typeof usd === 'number' && isFinite(usd) && usd > 0) {
        data[currency] = usd;
      }
    }
    cache = { at: Date.now(), data };
    return Response.json(data);
  } catch {
    // Do NOT cache the fallback — retry CoinGecko on the next request.
    return Response.json(FALLBACK_PRICES);
  }
}
