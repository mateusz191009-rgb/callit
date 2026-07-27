import { supabase } from './supabase';
import type { Side } from './types';

/**
 * v25.40 — THE SHARED BET SLIP: read and write side of `bet_shares`.
 *
 * ISOMORPHIC ON PURPOSE. `fetchSharedBet()` runs in a server component (the
 * /bet/[token] shell's `generateMetadata`, and the OG image route) AND in the
 * browser. It only ever touches the anon client from lib/supabase.ts, which is
 * built from NEXT_PUBLIC_ vars and therefore exists on both sides — no service
 * key, no server-only import, nothing that would keep this file out of a
 * client bundle.
 *
 * A share token is a POINTER, never a payload: the numbers below come from the
 * server's own fill log via `public_bet_share()`, so a slip cannot be forged by
 * editing a URL. See the note on the SQL function for what the token is
 * allowed to expose.
 *
 * Every helper degrades like the rest of the cloud layer — `null` on local
 * demo mode, an unknown token or a read failure, never a throw. The share page
 * renders one not-found state for all three, deliberately: "this bet was
 * deleted", "you typo'd the link" and "the user is banned" are the same answer
 * to somebody holding a link.
 */

/** A bet slip as the public is allowed to see it (mirrors the SQL select). */
export interface SharedBet {
  token: string;
  /** Who placed it. The only thing said about them. */
  username: string;
  placedAt: string;
  marketId: string;
  /** Absent when the market has no mirror row (a feed sync gap). */
  question?: string;
  icon?: string;
  category: string;
  source: 'callit' | 'polymarket';
  yesLabel?: string;
  noLabel?: string;
  endDate?: string;
  side: Side;
  /** GROSS stake in USD — what left the balance, fee included. */
  stake: number;
  /** Shares bought. Every winning share pays $1, so this is the payout. */
  shares: number;
  /** AVERAGE fill price ((stake - fee) / shares), not the quoted tick. */
  avgPrice: number;
  marketStatus: 'open' | 'resolved';
  resolvedOutcome?: Side;
  /** Resolved with no winner — the source cancelled it, stakes refunded. */
  voided: boolean;
  /** The market's CURRENT yes price, so the slip can mark the call to market. */
  yesPrice: number;
  /** v25.41 — a whole POSITION (one side of one market, every fill blended)
   *  rather than a single fill. */
  isPosition: boolean;
  /** How many fills the numbers above aggregate. 1 for a fill share; on a
   *  position share it is what makes `stake` legible as a total rather than
   *  as one bet somebody placed. */
  fills: number;
}

/** What a slip should say happened. */
export type BetOutcome = 'open' | 'won' | 'lost' | 'void';

export interface BetVerdict {
  outcome: BetOutcome;
  /** Today's price of the SIDE that was bought. */
  currentPrice: number;
  /**
   * What the position is worth right now: the settled payout once the market
   * has resolved, the mark-to-market value while it is open. A voided bet
   * returns its cost basis (`shares * avgPrice`) — exactly what
   * `void_feed_market()` refunds, which is the stake minus the fee the market
   * already took.
   */
  value: number;
  /** `value - stake`, in dollars. Negative is a loss on the GROSS stake. */
  pnl: number;
  /** Payout per dollar staked if the call comes in — the "3.4x" on the slip. */
  multiple: number;
}

/** The one place the slip's arithmetic lives — the widget, the OG image and
 *  the share page all read it, so none of them can disagree. */
export function betVerdict(bet: SharedBet): BetVerdict {
  const currentPrice = bet.side === 'yes' ? bet.yesPrice : 1 - bet.yesPrice;
  const resolved = bet.marketStatus === 'resolved';
  const won = resolved && !bet.voided && bet.resolvedOutcome === bet.side;
  const outcome: BetOutcome = bet.voided
    ? 'void'
    : !resolved
      ? 'open'
      : won
        ? 'won'
        : 'lost';

  const value =
    outcome === 'won'
      ? bet.shares
      : outcome === 'lost'
        ? 0
        : outcome === 'void'
          ? bet.shares * bet.avgPrice
          : bet.shares * currentPrice;

  return {
    outcome,
    currentPrice,
    value,
    pnl: value - bet.stake,
    multiple: bet.stake > 0 ? bet.shares / bet.stake : 0,
  };
}

/**
 * What to call the multiple, given how the bet ended.
 *
 * "Paid" belongs to WON and nothing else. The first cut of the slip used it
 * for every settled outcome, which put "Paid 1.75x" directly above
 * "Payout $0.00" on a losing card — the two loudest numbers on the widget
 * contradicting each other. A lost or voided bet's multiple is what it WOULD
 * have paid, and the card has to say so.
 */
export function multipleLabel(outcome: BetOutcome): string {
  return outcome === 'open' ? 'To win' : outcome === 'won' ? 'Paid' : 'Would have paid';
}

/** The side's display name, without needing a full `Market` object. */
export function sharedSideLabel(bet: SharedBet): string {
  return bet.side === 'yes' ? (bet.yesLabel ?? 'Yes') : (bet.noLabel ?? 'No');
}

/** Raw `public_bet_share()` payload (snake_case, everything nullable). */
interface SharedBetRaw {
  token?: unknown;
  username?: unknown;
  placed_at?: unknown;
  market_id?: unknown;
  question?: unknown;
  icon?: unknown;
  category?: unknown;
  source?: unknown;
  yes_label?: unknown;
  no_label?: unknown;
  end_date?: unknown;
  side?: unknown;
  stake?: unknown;
  shares?: unknown;
  avg_price?: unknown;
  market_status?: unknown;
  resolved_outcome?: unknown;
  yes_price?: unknown;
  is_position?: unknown;
  fills?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapSharedBet(raw: SharedBetRaw): SharedBet | null {
  const token = str(raw.token);
  const username = str(raw.username);
  if (!token || !username) return null;
  const outcome = raw.resolved_outcome;
  return {
    token,
    username,
    placedAt: str(raw.placed_at) ?? '',
    marketId: str(raw.market_id) ?? '',
    question: str(raw.question),
    icon: str(raw.icon),
    category: str(raw.category) ?? 'custom',
    source: raw.source === 'callit' ? 'callit' : 'polymarket',
    yesLabel: str(raw.yes_label),
    noLabel: str(raw.no_label),
    endDate: str(raw.end_date),
    side: raw.side === 'no' ? 'no' : 'yes',
    stake: num(raw.stake),
    shares: num(raw.shares),
    avgPrice: num(raw.avg_price),
    marketStatus: raw.market_status === 'resolved' ? 'resolved' : 'open',
    resolvedOutcome: outcome === 'yes' || outcome === 'no' ? outcome : undefined,
    voided: outcome === 'void',
    // A market with no mirror row has no price either; 0.5 keeps the slip's
    // arithmetic finite rather than rendering NaN across the card.
    yesPrice: num(raw.yes_price, 0.5),
    // Both absent on a pre-v25.41 database, where every share IS a single
    // fill — which is exactly what these defaults describe.
    isPosition: raw.is_position === true,
    fills: Math.max(1, num(raw.fills, 1)),
  };
}

/**
 * Read a share token. Anon-executable, so this works for a logged-out
 * recipient — which is the entire point of the feature.
 */
export async function fetchSharedBet(token: string): Promise<SharedBet | null> {
  if (!supabase) return null;
  const t = token.trim();
  // Tokens are 16 hex chars. Rejecting the obviously-wrong shape here keeps a
  // long URL segment from becoming a database round-trip.
  if (!/^[0-9a-f]{8,64}$/i.test(t)) return null;
  try {
    const { data, error } = await supabase.rpc('public_bet_share', { p_token: t });
    if (error || !data || typeof data !== 'object') return null;
    return mapSharedBet(data as SharedBetRaw);
  } catch {
    return null;
  }
}

export interface CreateBetShareInput {
  /** A specific fill (the receipt list has this). */
  tradeId?: string;
  /** Or: the caller's newest fill on this market — what the trade panel has
   *  right after a buy, since `place_trade` returns the fill and not its id. */
  marketId?: string;
  /**
   * v25.41 — set this (with `marketId`) to share the whole POSITION instead of
   * one fill: every fill on this side of this market, blended.
   *
   * It is a different RPC, not a flag on the same one, because it is a
   * different claim. Sharing "my newest fill" when somebody added to a call
   * three times would print a $5 stake for a $60 position.
   */
  positionSide?: Side;
}

/**
 * Mint (or re-fetch) the share token for one of the CALLER's own fills.
 *
 * Idempotent server-side: the same fill always yields the same token, so a
 * user who shares the same bet twice sends the same link both times and the
 * first one never dies. Returns `null` when there is nothing to share, the
 * caller is signed out, or the RPC is missing (schema not migrated yet).
 */
export async function createBetShare(
  input: CreateBetShareInput = {}
): Promise<string | null> {
  if (!supabase) return null;
  const position = input.positionSide && input.marketId ? input.positionSide : null;
  const fn = position ? 'create_position_share' : 'create_bet_share';
  const args = position
    ? { p_market_id: input.marketId, p_side: position }
    : { p_trade_id: input.tradeId ?? null, p_market_id: input.marketId ?? null };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      console.error(`[betShare] ${fn} failed:`, error.message);
      return null;
    }
    return str(data) ?? null;
  } catch (e) {
    console.error(`[betShare] ${fn} crashed:`, e);
    return null;
  }
}
