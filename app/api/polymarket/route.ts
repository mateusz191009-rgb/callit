import { getFeedData } from '@/lib/feed';
import { serviceEnabled, serviceSupabase } from '@/lib/serverSupabase';
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
 *  v5: when SUPABASE_SERVICE_ROLE_KEY is configured this route ALSO
 *  mirrors every Global market into the `markets` table (see syncMarkets
 *  below). That mirror is what lets `place_trade()` price a Global market
 *  from a fresh SERVER-held price — the client never supplies one. */
export const dynamic = 'force-dynamic';
// Vercel: the default function limit can be too tight for a cold cycle
// (Kalshi 9s budget + Gamma fetches + DB mirror) — give it headroom.
export const maxDuration = 30;

/* ------------------------------------------------------------------ */
/* DB sync (service role — bypasses RLS, server-only)                  */
/* ------------------------------------------------------------------ */

/** The feed is refetched by clients every 90s and cached 60s (v9: was 120s,
 *  which let the browser serve a stale payload to every other poll — odds
 *  were effectively up to ~3 min old); mirroring it more than once a minute
 *  buys nothing. Module-level guard: one process, one timer. */
const SYNC_INTERVAL_MS = 60_000;

/** Upsert batch size — ~300 rows (flat markets + event outcomes) split
 *  into a handful of requests keeps each payload small. */
const SYNC_CHUNK = 100;

let lastSyncAt = 0;

/** Metadata the feed always owns — safe to refresh on every cycle, for both
 *  funded and unfunded markets. Deliberately contains NO economics. */
interface MarketMetaRow {
  id: string;
  source: 'polymarket';
  question: string;
  category: string;
  end_date: string;
  resolution: 'oracle';
  icon: string | null;
  short_name: string | null;
  event_id: string | null;
  /** v6 — which feed owns the row; the settlement poller branches on it. */
  provider: 'polymarket' | 'kalshi';
  /** v6 — the source ticker/id used to poll for the result. */
  provider_ref: string | null;
  /** v6 — game/sub-market grouping. */
  group_id: string | null;
  group_label: string | null;
  /** v6 — the LIVE label. v7: NOT a trading gate any more. */
  in_play_ok: boolean;
  /** v7 — THE PROVIDER'S OWN VERDICT, and the trading gate `place_trade` uses
   *  for a feed market. If this route stops writing it, it stays `false` and
   *  every feed market trades until the 30-day valve — the safety net, not the
   *  design. */
  source_closed: boolean;
  /** v7 — the real kickoff, when the provider reports one. */
  start_time: string | null;
  /** v8 — side display labels ('Over'/'Under', 'England'/'Argentina');
   *  null = literal Yes/No. Presentation only, never touches the pool. */
  yes_label: string | null;
  no_label: string | null;
}

/** Metadata + the economics the feed only owns BEFORE the pool is funded. */
interface MarketSyncRow extends MarketMetaRow {
  yes_price: number;
  volume: number;
  liquidity: number;
}

function clampPrice(p: number): number {
  // Mirror lib/utils clampPrice + the ensure_market() clamp: a 0/1 price
  // would divide by zero on one side of the fill.
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

function toSyncRow(m: Market): MarketSyncRow | null {
  const end = new Date(m.endDate).getTime();
  if (!m.id || !Number.isFinite(end)) return null;
  const start = m.startTime ? new Date(m.startTime).getTime() : NaN;
  return {
    id: m.id,
    source: 'polymarket',
    question: m.question?.trim() || m.id,
    category: m.category?.trim() || 'custom',
    end_date: new Date(end).toISOString(),
    // Global markets always resolve off the upstream oracle; the create
    // form can't pick this value (v4: Community vote | Manual only).
    resolution: 'oracle',
    yes_price: clampPrice(m.yesPrice),
    volume: Math.max(0, Number(m.volume) || 0),
    liquidity: Math.max(1, Number(m.liquidity) || 500),
    icon: m.icon?.trim() || null,
    short_name: m.shortName?.trim() || null,
    event_id: m.eventId?.trim() || null,
    // v6. `provider` is CHECK-constrained to callit|polymarket|kalshi; a feed
    // row is never 'callit', so default the unset case to 'polymarket'.
    provider: m.provider === 'kalshi' ? 'kalshi' : 'polymarket',
    provider_ref: m.providerRef?.trim() || null,
    group_id: m.groupId?.trim() || null,
    group_label: m.groupLabel?.trim() || null,
    in_play_ok: m.inPlayOk === true,
    // v7 — the server's expiry gate for feed markets reads these two. They are
    // in MarketMetaRow (not the economics), so they keep being refreshed for
    // the life of the market — including after its pool is funded, which is
    // exactly when a stale `source_closed` would cost real money.
    source_closed: m.sourceClosed === true,
    start_time: Number.isFinite(start) ? new Date(start).toISOString() : null,
    // v8 — metadata (not economics), so a renamed side stays fresh for the
    // life of the market. Both or neither: the mappers already enforce that.
    yes_label: m.yesLabel?.trim() || null,
    no_label: m.noLabel?.trim() || null,
  };
}

/** Strip the economics — everything left is metadata the feed still owns
 *  once a pool is live. Keep this list in sync with MarketMetaRow. */
function toMetaRow(row: MarketSyncRow): MarketMetaRow {
  const { yes_price: _p, volume: _v, liquidity: _l, ...meta } = row;
  return meta;
}

/**
 * ids of markets whose pool holds real money (`collateral > 0`).
 *
 * v6: once a market is funded, the POOL owns its price — we fill trades out
 * of our own collateral, so the fill must move the curve we pay from. The
 * feed must never write `yes_price`/`volume`/`liquidity` over it.
 *
 * On any error (most likely: supabase/schema.sql not re-run yet, so
 * `collateral` doesn't exist) this returns an EMPTY set, which falls back to
 * the v5 behavior of syncing economics for everything. That is the correct
 * fallback: no `collateral` column means no pools exist to protect.
 */
async function fundedIds(ids: string[]): Promise<Set<string>> {
  const funded = new Set<string>();
  if (!serviceSupabase) return funded;

  for (let i = 0; i < ids.length; i += SYNC_CHUNK) {
    const { data, error } = await serviceSupabase
      .from('markets')
      .select('id, collateral')
      .in('id', ids.slice(i, i + SYNC_CHUNK))
      .gt('collateral', 0);
    if (error) {
      console.error(
        '[api/polymarket] collateral probe failed (is supabase/schema.sql v6 applied?):',
        error.message
      );
      return new Set<string>();
    }
    for (const row of data ?? []) funded.add((row as { id: string }).id);
  }
  return funded;
}

/**
 * Mirror the feed into `markets` (upsert on id).
 *
 * Deliberately NOT written: `status`, `resolved_outcome`, `banned` and
 * `price_history`. The column defaults cover fresh inserts ('open',
 * false, '[]'), and leaving them out of the payload means an upsert can
 * never re-open a market an admin resolved or silently unban one.
 *
 * v6 — THE ECONOMICS RULE. v5 overwrote `yes_price`/`volume`/`liquidity`
 * every cycle because the live feed owned the price of a Global market. It
 * no longer does: once a pool is funded (`collateral > 0`) the FPMM owns the
 * price, because we fill trades out of that collateral and the fill has to
 * move the curve we pay from. Letting the feed stamp its own price back over
 * a live pool would desync price from reserves and hand out free money.
 *
 * So each row is written one of two ways:
 *   - `collateral = 0` (or brand new)  -> FULL row. The feed still owns the
 *     price here; it is what the pool will be seeded AT on the first trade.
 *   - `collateral > 0`                 -> METADATA ONLY (question, icon,
 *     end_date, in_play_ok, provider_ref, grouping…). Never the economics.
 *
 * Both paths always refresh the v6 columns, so grouping/settlement/in-play
 * stay correct for the life of the market.
 */
async function syncMarkets(markets: Market[], events: EventGroup[]): Promise<void> {
  if (!serviceSupabase) return;

  const seen = new Set<string>();
  const rows: MarketSyncRow[] = [];
  for (const m of [...markets, ...events.flatMap((e) => e.markets)]) {
    if (!m || m.source !== 'polymarket' || seen.has(m.id)) continue;
    const row = toSyncRow(m);
    if (!row) continue;
    seen.add(m.id);
    rows.push(row);
  }
  if (rows.length === 0) return;

  const funded = await fundedIds(rows.map((r) => r.id));

  // Two payloads, same upsert. Splitting by funded-ness is what keeps the
  // pool's price authoritative (see the note above).
  const fullRows = rows.filter((r) => !funded.has(r.id));
  const metaRows = rows.filter((r) => funded.has(r.id)).map(toMetaRow);

  for (const batch of [fullRows, metaRows]) {
    for (let i = 0; i < batch.length; i += SYNC_CHUNK) {
      const chunk = batch.slice(i, i + SYNC_CHUNK);
      if (chunk.length === 0) continue;
      const { error } = await serviceSupabase
        .from('markets')
        .upsert(chunk, { onConflict: 'id' });
      if (error) {
        // Never break the response: log and stop this cycle, the next one
        // (60s) retries with a fresh payload.
        console.error('[api/polymarket] market sync failed:', error.message);
        return;
      }
    }
  }
}

/** Fire-and-forget mirror, throttled to once per SYNC_INTERVAL_MS. */
function maybeSync(data: { markets: Market[]; events: EventGroup[] }): void {
  if (!serviceEnabled) return;
  const now = Date.now();
  if (now - lastSyncAt < SYNC_INTERVAL_MS) return;
  // Stamp BEFORE awaiting so concurrent requests can't start a second
  // sync (and a failed sync backs off for a full interval).
  lastSyncAt = now;
  void syncMarkets(data.markets, data.events).catch((e: unknown) => {
    console.error('[api/polymarket] market sync crashed:', e);
  });
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function GET() {
  const data = await getFeedData();
  maybeSync(data);
  return Response.json(data, {
    headers: { 'cache-control': 'public, max-age=60' },
  });
}
