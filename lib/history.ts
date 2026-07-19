import { supabase } from './supabase';
import type { Side } from './types';

/**
 * Receipts + notification source reads (v6 backlog).
 *
 * Cloud-only, read-only, and deliberately separate from lib/cloud.ts: this
 * module is the read side of the `trades` fill log (the user's receipts)
 * plus the two snapshot reads the notification engine diffs.
 *
 * Every helper degrades like the rest of the cloud layer — `[]`/empty on
 * local demo mode or any failure, never a throw. The snapshot readers are
 * the exception to the "return empty on error" convention: they carry an
 * explicit `ok` flag, because the notification engine MUST be able to tell
 * "you have no pending deposits" apart from "the read failed". Without it a
 * network hiccup reads as "every position vanished" and would either fire
 * phantom notifications or silently poison the baseline it diffs against.
 */

/** One row of the immutable fill log — a receipt for a single trade.
 *  `amount` is the GROSS stake, `fee` the slice taken from it, and `price`
 *  the AVERAGE fill price ((amount - fee) / shares) — not a single tick. */
export interface TradeRow {
  id: string;
  marketId: string;
  /** Joined from `markets` when the row exists there. Global (Polymarket)
   *  markets are only in the book once the server-side feed sync has run,
   *  so callers should fall back to their client-side market map. */
  question?: string;
  /** v19 — joined with the question: whether the market has settled, and
   *  which side won. This is the receipt's "did I win?" answer — the
   *  position rows are DELETED at payout, so the fill log is the only
   *  place a settled bet still renders. */
  status?: 'open' | 'resolved';
  resolvedOutcome?: Side;
  side: Side;
  amount: number;
  shares: number;
  price: number;
  fee: number;
  createdAt: string;
}

/** Minimal `markets` projection — enough to name a market and tell whether
 *  it has settled. */
export interface MarketSummary {
  id: string;
  question: string;
  status: 'open' | 'resolved';
  resolvedOutcome?: Side;
}

/** A deposit/withdrawal reduced to what the notification diff needs. */
export interface PaymentStatusRow {
  id: string;
  currency: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/** A position reduced to what the notification diff needs. */
export interface PositionStatusRow {
  marketId: string;
  side: Side;
  shares: number;
}

/** Snapshot reads carry `ok` so a failed read is never mistaken for
 *  "nothing there" (see the module note). */
export interface PaymentsSnapshotResult {
  ok: boolean;
  deposits: PaymentStatusRow[];
  withdrawals: PaymentStatusRow[];
}

export interface PositionsSnapshotResult {
  ok: boolean;
  positions: PositionStatusRow[];
}

/** Rows per `.in('id', …)` chunk — keeps the query string well inside any
 *  URL length limit. */
const ID_CHUNK = 100;

const DEFAULT_TRADE_LIMIT = 100;

interface TradeRowRaw {
  id: string;
  market_id: string;
  side: string;
  amount: number | string | null;
  shares: number | string | null;
  price: number | string | null;
  fee?: number | string | null;
  created_at: string;
}

function asSide(s: unknown): Side {
  return s === 'no' ? 'no' : 'yes';
}

function asStatus(s: unknown): 'pending' | 'approved' | 'rejected' {
  return s === 'approved' || s === 'rejected' ? s : 'pending';
}

async function authUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Look up `question` / `status` / `resolved_outcome` for a set of market
 * ids. `markets` is anon-readable, so this works for guests too — but a
 * Global market only has a row once the server-side feed sync has mirrored
 * it, so a miss is normal and callers must handle it.
 */
export async function fetchMarketSummaries(
  ids: string[]
): Promise<Map<string, MarketSummary>> {
  const map = new Map<string, MarketSummary>();
  if (!supabase || ids.length === 0) return map;
  const unique = [...new Set(ids)];
  try {
    const results = await Promise.all(
      chunk(unique, ID_CHUNK).map((part) =>
        supabase!
          .from('markets')
          .select('id, question, status, resolved_outcome')
          .in('id', part)
      )
    );
    for (const { data, error } of results) {
      if (error || !data) continue;
      for (const row of data as {
        id: string;
        question: string | null;
        status: string | null;
        resolved_outcome: string | null;
      }[]) {
        map.set(String(row.id), {
          id: String(row.id),
          question: row.question ?? '',
          status: row.status === 'resolved' ? 'resolved' : 'open',
          resolvedOutcome:
            row.resolved_outcome === 'yes' || row.resolved_outcome === 'no'
              ? row.resolved_outcome
              : undefined,
        });
      }
    }
  } catch {
    // A failed lookup only costs a question label — the caller falls back.
  }
  return map;
}

/**
 * The signed-in user's own fills, newest first, with the market question
 * joined in where the book has it.
 *
 * `trades` has no FK to `markets` (the log records Global market ids that
 * may never get a row), so PostgREST cannot embed the question — it is a
 * second read, batched over the ids actually present in the page.
 *
 * RLS on `trades` is own-or-admin, and the explicit `user_id` filter keeps
 * this "MY trades" even when an admin calls it.
 */
export async function fetchMyTrades(limit: number = DEFAULT_TRADE_LIMIT): Promise<TradeRow[]> {
  if (!supabase) return [];
  try {
    const uid = await authUserId();
    if (!uid) return [];
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];

    const rows: TradeRow[] = (data as TradeRowRaw[]).map((r) => ({
      id: String(r.id),
      marketId: String(r.market_id),
      side: asSide(r.side),
      amount: Number(r.amount ?? 0),
      shares: Number(r.shares ?? 0),
      price: Number(r.price ?? 0),
      // `fee` arrived with v6 — default it so a pre-v6 row still renders.
      fee: Number(r.fee ?? 0),
      createdAt: r.created_at,
    }));

    const summaries = await fetchMarketSummaries(rows.map((r) => r.marketId));
    return rows.map((r) => {
      const summary = summaries.get(r.marketId);
      if (!summary) return r;
      return {
        ...r,
        question: summary.question || r.question,
        status: summary.status,
        resolvedOutcome: summary.resolvedOutcome,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Status-only read of the user's own deposits + withdrawals.
 *
 * Same rows as `fetchMyPayments()` in lib/cloud.ts, but projected down to
 * the diff fields and — crucially — with an `ok` flag (see the module
 * note). Kept here rather than added there because lib/cloud.ts is not
 * this module's to change.
 */
export async function fetchPaymentsSnapshot(): Promise<PaymentsSnapshotResult> {
  const empty: PaymentsSnapshotResult = { ok: false, deposits: [], withdrawals: [] };
  if (!supabase) return empty;
  try {
    const uid = await authUserId();
    if (!uid) return empty;
    const [dep, wd] = await Promise.all([
      supabase
        .from('deposits')
        .select('id, currency, amount, status, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('withdrawals')
        .select('id, currency, amount, status, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
    ]);
    if (dep.error || wd.error || !dep.data || !wd.data) return empty;

    const map = (rows: unknown[]): PaymentStatusRow[] =>
      (rows as {
        id: string;
        currency: string | null;
        amount: number | string | null;
        status: string | null;
        created_at: string;
      }[]).map((r) => ({
        id: String(r.id),
        currency: r.currency ?? '',
        amount: Number(r.amount ?? 0),
        status: asStatus(r.status),
        createdAt: r.created_at,
      }));

    return { ok: true, deposits: map(dep.data), withdrawals: map(wd.data) };
  } catch {
    return empty;
  }
}

/**
 * Status-only read of the user's own open positions, with an `ok` flag.
 *
 * The notification engine diffs this to spot markets that settled: a
 * payout DELETES the position rows, so "gone from this list" is the only
 * client-visible trace that a market the user held has resolved.
 */
export async function fetchPositionsSnapshot(): Promise<PositionsSnapshotResult> {
  const empty: PositionsSnapshotResult = { ok: false, positions: [] };
  if (!supabase) return empty;
  try {
    const uid = await authUserId();
    if (!uid) return empty;
    const { data, error } = await supabase
      .from('positions')
      .select('market_id, side, shares')
      .eq('user_id', uid);
    if (error || !data) return empty;
    return {
      ok: true,
      positions: (data as { market_id: string; side: string; shares: number | string }[]).map(
        (r) => ({
          marketId: String(r.market_id),
          side: asSide(r.side),
          shares: Number(r.shares ?? 0),
        })
      ),
    };
  } catch {
    return empty;
  }
}
