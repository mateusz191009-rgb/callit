import { supabase } from './supabase';
import {
  DEFAULT_FEE_BPS,
  DEFAULT_GLOBAL_SEED,
  syntheticPool,
  type PoolMarket,
} from './pricing';
import type {
  CreateMarketInput,
  Deposit,
  DepositCurrency,
  Market,
  Position,
  PricePoint,
  ResolutionMethod,
  Side,
  Withdrawal,
} from './types';

/**
 * Cloud helpers (v4/v5) — thin typed wrappers around Supabase. Every
 * function degrades gracefully: when `supabase` is null (local demo
 * mode) or any call fails, reads return `null`/`[]`/empty payloads and
 * writes return `{ ok: false, error }` — callers never need try/catch.
 *
 * Everything that moves money or a price goes through the
 * security-definer RPCs in supabase/schema.sql (place_trade,
 * create_market_rpc, resolve_market_rpc, request_deposit, …). The client
 * has no write path to `profiles.balance`, `markets`, `positions`,
 * `trades` or `community_votes` — the v5 schema revokes those grants, so
 * a table write here would fail with 'permission denied'. Read the
 * result of the RPC; never compute money locally.
 */

/** Result of a cloud mutation (RPC). `error` is user-presentable. */
export interface CloudResult {
  ok: boolean;
  error?: string;
}

/** Snapshot of the signed-in user's own profile row. */
export interface CloudProfile {
  balance: number;
  banned: boolean;
  isAdmin: boolean;
  username: string;
}

/** Admin view of any profile row (fetchAllProfiles). */
export interface CloudProfileRow {
  id: string;
  email: string;
  username: string;
  balance: number;
  banned: boolean;
  isAdmin: boolean;
}

/** Result of a `place_trade` call. `shares`/`price`/`fee`/`balance` are
 *  the SERVER's numbers — the fill it actually executed and the caller's
 *  new balance. Present only when `ok`.
 *
 *  v6: `price` is the AVERAGE FILL (`(amount - fee) / shares`), not the
 *  tick the market quoted — it walks the FPMM curve, so it will differ
 *  from the price the trader clicked. That difference is the slippage.
 *  `fee` is the trading fee the market took (its own `fee_bps`). */
export interface CloudTradeResult extends CloudResult {
  shares?: number;
  price?: number;
  fee?: number;
  balance?: number;
}

/** The public platform config (`platform_settings`, row id 1). Readable by
 *  everyone incl. anon — the trade panel shows the fee to guests too. */
export interface CloudPlatformSettings {
  /** What the platform funds a Global market with on its first trade. */
  globalSeed: number;
  /** Fee NEW markets are created with. A live market charges its OWN
   *  `feeBps`, locked in at creation — never assume this one applies. */
  feeBps: number;
}

/** A market's live FPMM pool — what `place_trade` will actually fill
 *  against. `funded: false` means the pool does not exist yet and these
 *  reserves are the LAZY SEED the server will create on the first trade
 *  (Global markets only). */
export interface CloudMarketPool {
  yesReserve: number;
  noReserve: number;
  /** The market's own fee, locked in at creation. */
  feeBps: number;
  /** v7 — THIS MARKET'S OWN fee split, locked in at creation alongside
   *  `feeBps`, and what `place_trade` actually charges (it sums these two
   *  rather than reading `fee_bps`). Read them from the market instead of
   *  inferring the split from `platform_settings`: the config holds what NEW
   *  markets get, and a market funded under the v6 deal carries platform 0 /
   *  lp = its whole fee. Those two cases have the SAME total, so the total
   *  cannot tell them apart — quoting the config's split over a legacy market
   *  states the wrong destination for the money at the same fee.
   *
   *  `null` only on a row where the column is somehow absent; consumers must
   *  fall back to saying nothing rather than guessing. */
  platformFeeBps: number | null;
  lpFeeBps: number | null;
  funded: boolean;
}

/** Result of `create_market_rpc` — `id` is the id the server stored. */
export interface CloudCreateResult extends CloudResult {
  id?: string;
}

/** Result of `finalize_community_market` — `outcome` is the winning side,
 *  `fee` the confirmation fee (USD) actually banked to the platform. v8
 *  charges $10 at this admin-confirm step, taken from the market's own pot
 *  AFTER winners are paid — `fee` can therefore be less than 10 (down to 0)
 *  on a thin market, and that is correct, not an error. */
export interface CloudFinalizeResult extends CloudResult {
  outcome?: Side;
  fee?: number;
}

/** A consistent read of the shared book (all markets + the banned set).
 *  `null` from `fetchMarketsSnapshot()` means the read FAILED — callers
 *  must keep their previous data instead of blanking the feed. */
export interface CloudMarketsSnapshot {
  /** Community (`source: 'callit'`) markets, INCLUDING banned ones —
   *  admin tables need them; feeds filter with `bannedIds`. */
  markets: Market[];
  /** Ids of every banned market, any source (feeds filter these out). */
  bannedIds: string[];
}

const GENERIC_ERROR = 'Request failed — try again.';

/** place_trade raises this when the market has no row in the shared book
 *  yet — i.e. the server-side feed sync has not run (missing
 *  SUPABASE_SERVICE_ROLE_KEY) or the market is brand new. */
const MARKET_NOT_SYNCED =
  'This market is not open for trading yet — try again in a moment.';

const SCHEMA_MISSING = 'Server functions are missing — run supabase/schema.sql.';

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/** Raw deposits row (snake_case; `profiles` present on admin joins). */
interface DepositRow {
  id: string;
  user_id: string;
  currency: string;
  amount: number | string;
  tx_hash: string | null;
  status: string;
  created_at: string;
  profiles?: { email?: string | null } | null;
}

/** Raw withdrawals row (snake_case; `profiles` present on admin joins). */
interface WithdrawalRow {
  id: string;
  user_id: string;
  currency: string;
  amount: number | string;
  address: string;
  status: string;
  /** v8 — email confirmation state. */
  confirmed: boolean | null;
  created_at: string;
  profiles?: { email?: string | null } | null;
}

/**
 * v8 HARD BREAK — `select('*')` on withdrawals now FAILS with "permission
 * denied for column confirm_token" (the token is the email-confirmation
 * secret; the schema narrows the SELECT grant so a hijacked session cannot
 * read its own token and self-confirm). Every withdrawals read must list
 * columns explicitly — use this constant.
 */
const WITHDRAWAL_COLUMNS =
  'id, user_id, currency, amount, address, status, confirmed, created_at';

async function authUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function asStatus(s: string): 'pending' | 'approved' | 'rejected' {
  return s === 'approved' || s === 'rejected' ? s : 'pending';
}

function mapDeposit(r: DepositRow): Deposit {
  return {
    id: String(r.id),
    currency: r.currency as DepositCurrency,
    amount: Number(r.amount),
    txHash: r.tx_hash ?? undefined,
    status: asStatus(r.status),
    createdAt: r.created_at,
    userEmail: r.profiles?.email ?? undefined,
    userId: r.user_id,
  };
}

function mapWithdrawal(r: WithdrawalRow): Withdrawal {
  return {
    id: String(r.id),
    currency: r.currency as DepositCurrency,
    amount: Number(r.amount),
    address: r.address,
    status: asStatus(r.status),
    createdAt: r.created_at,
    userEmail: r.profiles?.email ?? undefined,
    userId: r.user_id,
    // v8 — pre-migration rows were repaired to true server-side; a null here
    // (column somehow absent) renders as confirmed, matching the local-mode
    // convention in lib/types.ts.
    confirmed: r.confirmed ?? true,
  };
}

/**
 * Map a Supabase/Postgres error to a user-presentable string.
 *
 * The RPCs raise messages that are already written FOR the user
 * ('Insufficient balance', 'This account is banned', 'Admin only',
 * 'Deposit is not pending', …) — those pass through untouched. Only the
 * plumbing-level failures (missing function, revoked grant, expired JWT,
 * offline) get rewritten, because Postgres' wording for those is
 * meaningless to a trader.
 */
function mapRpcError(error: { message?: string } | null | undefined): string {
  const raw = (error?.message ?? '').trim();
  if (!raw) return GENERIC_ERROR;
  const m = raw.toLowerCase();
  // Schema not applied / stale PostgREST cache.
  if (
    m.includes('could not find the function') ||
    m.includes('schema cache') ||
    m.includes('does not exist')
  ) {
    return SCHEMA_MISSING;
  }
  // Grants revoked in v5 (e.g. a leftover client write to profiles).
  if (m.includes('permission denied')) return 'You are not allowed to do that.';
  if (m.includes('jwt') || m.includes('not signed in')) return 'Sign in to continue.';
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Network error — try again.';
  }
  return raw;
}

/** Shared RPC runner — maps Supabase errors to a CloudResult. */
async function callRpc(fn: string, args: Record<string, unknown>): Promise<CloudResult> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: mapRpcError(error) };
    return { ok: true };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/* ------------------------------------------------------------------ */
/* own profile                                                         */
/* ------------------------------------------------------------------ */

/** The signed-in user's profile, or null (signed out / local / error). */
export async function fetchMyProfile(): Promise<CloudProfile | null> {
  if (!supabase) return null;
  try {
    const uid = await authUserId();
    if (!uid) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('username, balance, banned, is_admin')
      .eq('id', uid)
      .maybeSingle();
    if (error || !data) return null;
    return {
      balance: Number(data.balance ?? 0),
      banned: Boolean(data.banned),
      isAdmin: Boolean(data.is_admin),
      username: typeof data.username === 'string' ? data.username : '',
    };
  } catch {
    return null;
  }
}

// v5: `pushMyBalance()` is GONE. `update` on public.profiles is revoked
// from `authenticated` (only the `username` column survives), so mirroring
// a client-computed balance now fails with 'permission denied for table
// profiles'. The balance is whatever place_trade / the payment RPCs return
// — read it from the RPC result or refetch with fetchMyProfile(). Never
// push. (supabase/schema.sql section 7b.)

/* ------------------------------------------------------------------ */
/* own payments (user-facing)                                          */
/* ------------------------------------------------------------------ */

/** Insert a pending deposit for the signed-in user (RPC). */
export async function requestDepositCloud(
  currency: DepositCurrency,
  amount: number,
  txHash?: string
): Promise<CloudResult> {
  return callRpc('request_deposit', {
    currency,
    amount,
    tx_hash: txHash?.trim() || null,
  });
}

/** Result of `request_withdrawal` — `id` is the new withdrawal's uuid,
 *  needed to trigger the v8 confirmation email. */
export interface CloudWithdrawalRequestResult extends CloudResult {
  id?: string;
}

/**
 * Reserve the amount server-side and insert a pending withdrawal (RPC).
 *
 * v8: the row starts UNCONFIRMED — the store immediately triggers the
 * confirmation email via `sendWithdrawalConfirmation(id)`, and the admin can
 * only approve once the user clicks the emailed link. The reserve itself is
 * unchanged (funds are held from this moment).
 */
export async function requestWithdrawalCloud(
  currency: DepositCurrency,
  amount: number,
  address: string
): Promise<CloudWithdrawalRequestResult> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { data, error } = await supabase.rpc('request_withdrawal', {
      currency,
      amount,
      address,
    });
    if (error) return { ok: false, error: mapRpcError(error) };
    return { ok: true, id: typeof data === 'string' && data ? data : undefined };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * v8 — trigger the withdrawal-confirmation email for a withdrawal the
 * CALLER just requested. POSTs to the server route (which holds the service
 * key — the client can never read the confirm token itself):
 *
 *   POST /api/withdrawals/send-confirmation
 *   Authorization: Bearer <the caller's Supabase access token>
 *   { id: string }            -> { ok, skipped?, confirmed?, error? }
 *
 * `skipped: true` = RESEND_API_KEY is not configured; the route then
 * AUTO-CONFIRMS the withdrawal (documented graceful degradation — the flow
 * must complete without third-party keys) and reports `confirmed: true`.
 *
 * Fire-and-forget safe: never throws, and a failure only means the
 * withdrawal stays unconfirmed (the wallet page can offer a resend).
 */
export async function sendWithdrawalConfirmation(
  withdrawalId: string
): Promise<{ ok: boolean; skipped?: boolean; confirmed?: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return { ok: false, error: 'Sign in to continue.' };
    const res = await fetch('/api/withdrawals/send-confirmation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: withdrawalId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      skipped?: boolean;
      confirmed?: boolean;
      error?: string;
    };
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return {
      ok: body.ok !== false,
      skipped: body.skipped,
      confirmed: body.confirmed,
      error: body.error,
    };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** The signed-in user's own deposits + withdrawals, newest first. */
export async function fetchMyPayments(): Promise<{
  deposits: Deposit[];
  withdrawals: Withdrawal[];
}> {
  const empty = { deposits: [], withdrawals: [] };
  if (!supabase) return empty;
  try {
    const uid = await authUserId();
    if (!uid) return empty;
    // Explicit user_id filter: RLS lets ADMINS read every row, but this
    // helper must always mean "MY payments".
    const [dep, wd] = await Promise.all([
      supabase
        .from('deposits')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('withdrawals')
        // v8: never '*' on withdrawals — confirm_token is grant-hidden and
        // a star select fails outright. See WITHDRAWAL_COLUMNS.
        .select(WITHDRAWAL_COLUMNS)
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
    ]);
    return {
      deposits: ((dep.data ?? []) as DepositRow[]).map(mapDeposit),
      withdrawals: ((wd.data ?? []) as WithdrawalRow[]).map(mapWithdrawal),
    };
  } catch {
    return empty;
  }
}

/* ------------------------------------------------------------------ */
/* admin                                                               */
/* ------------------------------------------------------------------ */

/**
 * Format a read failure for /admin's diagnostics card: the RAW Postgres
 * message plus its code/details/hint, verbatim.
 *
 * Deliberately NOT mapRpcError() — that rewrites plumbing failures into
 * trader-friendly copy, which is exactly the information the operator
 * needs here ('column markets.creator_name does not exist' beats 'Server
 * functions are missing'). /admin prints this string as-is.
 */
function readError(
  error:
    | { message?: string; code?: string; details?: string; hint?: string }
    | null
    | undefined
): string {
  if (!error) return GENERIC_ERROR;
  const parts: string[] = [error.message?.trim() || GENERIC_ERROR];
  if (error.code?.trim()) parts.push(`(code ${error.code.trim()})`);
  if (error.details?.trim()) parts.push(`— ${error.details.trim()}`);
  if (error.hint?.trim()) parts.push(`Hint: ${error.hint.trim()}`);
  return parts.join(' ');
}

/**
 * ADMIN: every profile row (RLS returns only own row for non-admins).
 *
 * `error` is the REAL Supabase message when the read failed — an empty
 * `rows` with NO `error` is a genuine "no rows visible", which /admin
 * renders as an empty state instead of a failure. The two cases are not
 * the same: an admin whose own `profiles` row is missing sees zero rows
 * and no error (is_admin() is false without a row, so RLS trims the
 * result to an own-row that does not exist).
 */
export async function fetchAllProfiles(): Promise<{
  rows: CloudProfileRow[];
  error?: string;
}> {
  if (!supabase) return { rows: [], error: 'Cloud mode is not enabled.' };
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, username, balance, banned, is_admin')
      .order('created_at', { ascending: false });
    if (error) return { rows: [], error: readError(error) };
    const rows = (data ?? []).map(
      (r: {
        id: string;
        email: string | null;
        username: string | null;
        balance: number | string | null;
        banned: boolean | null;
        is_admin: boolean | null;
      }): CloudProfileRow => ({
        id: String(r.id),
        email: r.email ?? '',
        username: r.username ?? '',
        balance: Number(r.balance ?? 0),
        banned: Boolean(r.banned),
        isAdmin: Boolean(r.is_admin),
      })
    );
    return { rows };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : GENERIC_ERROR };
  }
}

/**
 * ADMIN: all deposits + withdrawals with `userEmail` joined from profiles.
 *
 * Like `fetchAllProfiles`, `error` carries the REAL Supabase message so
 * /admin can tell a failed read apart from an empty one (no requests yet
 * is normal and must not render as an error).
 */
export async function fetchAllPayments(): Promise<{
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  error?: string;
}> {
  const empty = { deposits: [], withdrawals: [] };
  if (!supabase) return { ...empty, error: 'Cloud mode is not enabled.' };
  try {
    const [dep, wd] = await Promise.all([
      supabase
        .from('deposits')
        .select('*, profiles(email)')
        .order('created_at', { ascending: false }),
      supabase
        .from('withdrawals')
        // v8: never '*' on withdrawals — see WITHDRAWAL_COLUMNS.
        .select(`${WITHDRAWAL_COLUMNS}, profiles(email)`)
        .order('created_at', { ascending: false }),
    ]);
    const failure = dep.error ?? wd.error;
    if (failure) return { ...empty, error: readError(failure) };
    return {
      deposits: ((dep.data ?? []) as DepositRow[]).map(mapDeposit),
      withdrawals: ((wd.data ?? []) as WithdrawalRow[]).map(mapWithdrawal),
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : GENERIC_ERROR };
  }
}

/** ADMIN: approve a pending deposit — credits the depositor server-side. */
export async function approveDepositCloud(id: string): Promise<CloudResult> {
  return callRpc('approve_deposit', { deposit_id: id });
}

/** ADMIN: reject a pending deposit (nothing was credited). */
export async function rejectDepositCloud(id: string): Promise<CloudResult> {
  return callRpc('reject_deposit', { deposit_id: id });
}

/** ADMIN: approve a pending withdrawal (funds were reserved on request). */
export async function approveWithdrawalCloud(id: string): Promise<CloudResult> {
  return callRpc('approve_withdrawal', { withdrawal_id: id });
}

/** ADMIN: reject a pending withdrawal — refunds the reserve server-side. */
export async function rejectWithdrawalCloud(id: string): Promise<CloudResult> {
  return callRpc('reject_withdrawal', { withdrawal_id: id });
}

/** ADMIN: ban/unban any user by profile id. */
export async function setUserBannedCloud(
  userId: string,
  banned: boolean
): Promise<CloudResult> {
  return callRpc('set_user_banned', { user_id: userId, is_banned: banned });
}

/* ------------------------------------------------------------------ */
/* v5 — server-authoritative economy                                   */
/* ------------------------------------------------------------------ */

/** Raw `markets` row (snake_case). */
interface MarketRow {
  id: string;
  source: string | null;
  question: string | null;
  description: string | null;
  category: string | null;
  end_date: string;
  resolution: string | null;
  yes_price: number | string | null;
  volume: number | string | null;
  liquidity: number | string | null;
  creator_name: string | null;
  created_by: string | null;
  status: string | null;
  resolved_outcome: string | null;
  resolved_at: string | null;
  icon: string | null;
  short_name: string | null;
  /* v8 — side display labels; null = literal Yes/No. */
  yes_label: string | null;
  no_label: string | null;
  event_id: string | null;
  price_history: unknown;
  banned: boolean | null;
  created_at: string;
  /* v6 — the pool + its metadata. */
  yes_reserve: number | string | null;
  no_reserve: number | string | null;
  fee_bps: number | null;
  seed: number | string | null;
  in_play_ok: boolean | null;
  provider: string | null;
  provider_ref: string | null;
  group_id: string | null;
  group_label: string | null;
}

/** Raw `positions` row (snake_case). */
interface PositionRow {
  id: string;
  market_id: string;
  side: string;
  shares: number | string;
  avg_price: number | string;
  created_at: string;
}

// v6 columns are included: the trade preview must quote against the pool
// the server fills from, and `liquidity`+`yes_price` alone cannot rebuild
// a traded curve (see syntheticPool's note in lib/pricing.ts).
// REQUIRES supabase/schema.sql at v6 — on an older DB this select fails
// and the book read degrades exactly as documented (community markets go
// empty, one console.warn, the Polymarket feed is unaffected).
// REQUIRES supabase/schema.sql at v8 (`yes_label`/`no_label` — idempotent,
// just re-run it) for the same reason.
const MARKET_COLUMNS =
  'id, source, question, description, category, end_date, resolution, yes_price, ' +
  'volume, liquidity, creator_name, created_by, status, resolved_outcome, resolved_at, icon, ' +
  'short_name, yes_label, no_label, event_id, price_history, banned, created_at, ' +
  'yes_reserve, no_reserve, fee_bps, seed, in_play_ok, provider, provider_ref, ' +
  'group_id, group_label';

/** `provider` is CHECK-constrained server-side; keep the client honest too. */
function asProvider(s: unknown): Market['provider'] {
  return s === 'callit' || s === 'kalshi' || s === 'polymarket' ? s : undefined;
}

/**
 * A basis-points column: present and sane, or null.
 *
 * Rejects NaN/negative/absurd values rather than letting a bad row render a
 * nonsense fee label. 1000 bps = the 10% total cap `admin_settings_update`
 * enforces. Shared with lib/store.ts's fee-split read so both agree on what
 * counts as a usable bps value.
 */
export function bpsOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
}

/** A nullable numeric column -> number, or undefined when absent. */
function optionalNumber(v: number | string | null): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asSide(s: unknown): Side {
  return s === 'no' ? 'no' : 'yes';
}

/** `price_history` is jsonb — validate every point before it reaches a chart. */
function mapPriceHistory(raw: unknown): PricePoint[] {
  if (!Array.isArray(raw)) return [];
  const points: PricePoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const { t, yes } = p as { t?: unknown; yes?: unknown };
    const tn = Number(t);
    const yn = Number(yes);
    if (!Number.isFinite(tn) || !Number.isFinite(yn)) continue;
    points.push({ t: tn, yes: yn });
  }
  return points;
}

/**
 * DB row -> the app's `Market` (snake_case -> camelCase).
 *
 * Returns a `PoolMarket`: the v6 FPMM reserves ride along on the object so
 * `previewBuy()` can quote the REAL curve. They are not on the `Market`
 * type (the v6 contract's type list has `feeBps`/`seed`/`provider`… but no
 * reserves), so this is a structural widening — a `PoolMarket` IS a
 * `Market` and every existing consumer is unaffected.
 */
function mapMarket(r: MarketRow): PoolMarket {
  return {
    id: String(r.id),
    source: r.source === 'polymarket' ? 'polymarket' : 'callit',
    question: r.question ?? '',
    description: r.description ?? undefined,
    category: r.category ?? 'custom',
    endDate: r.end_date,
    resolution: (r.resolution ?? 'manual') as ResolutionMethod,
    yesPrice: Number(r.yes_price ?? 0.5),
    volume: Number(r.volume ?? 0),
    liquidity: Number(r.liquidity ?? 500),
    // v5 stores the creator username in creator_name; created_by is the
    // v2 legacy column (back-filled by the schema).
    createdBy: r.creator_name ?? r.created_by ?? undefined,
    createdAt: r.created_at,
    status: r.status === 'resolved' ? 'resolved' : 'open',
    resolvedOutcome:
      r.resolved_outcome === 'yes' || r.resolved_outcome === 'no'
        ? r.resolved_outcome
        : undefined,
    resolvedAt: r.resolved_at ?? undefined,
    priceHistory: mapPriceHistory(r.price_history),
    icon: r.icon ?? undefined,
    shortName: r.short_name ?? undefined,
    // v8 — side display labels (presentation only; absent = literal Yes/No).
    yesLabel: r.yes_label ?? undefined,
    noLabel: r.no_label ?? undefined,
    eventId: r.event_id ?? undefined,
    // v6 — metadata. `inPlayOk` is the FEED's verdict and the only thing
    // that keeps a market tradeable past endDate; never infer it.
    provider: asProvider(r.provider),
    providerRef: r.provider_ref ?? undefined,
    groupId: r.group_id ?? undefined,
    groupLabel: r.group_label ?? undefined,
    inPlayOk: Boolean(r.in_play_ok),
    feeBps: optionalNumber(r.fee_bps ?? null),
    seed: optionalNumber(r.seed),
    // v6 — the live pool. Undefined when the market has never been traded
    // (feed markets are inserted unfunded) or its pool was voided by a ban.
    yesReserve: optionalNumber(r.yes_reserve),
    noReserve: optionalNumber(r.no_reserve),
  };
}

/**
 * THE trade path in cloud mode. `place_trade` fills against the market's
 * SERVER-held FPMM pool, debits atomically and books the position — the
 * client supplies only (market, side, amount) and reads the result back.
 *
 * v6: the returned `price` is the AVERAGE FILL, so it will not match the
 * tick the trader clicked. Show the server's numbers; never recompute
 * them (`previewBuy()` quotes the same curve for the pre-trade preview).
 */
export async function placeTradeCloud(
  marketId: string,
  side: Side,
  amount: number
): Promise<CloudTradeResult> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { data, error } = await supabase.rpc('place_trade', {
      p_market_id: marketId,
      p_side: side,
      p_amount: amount,
    });
    if (error) {
      // 'Market not found' means the shared book has no row for this
      // market — a server-sync gap, not something the user did wrong.
      if ((error.message ?? '').toLowerCase().includes('market not found')) {
        return { ok: false, error: MARKET_NOT_SYNCED };
      }
      return { ok: false, error: mapRpcError(error) };
    }
    const fill = (data ?? {}) as {
      shares?: number | string;
      price?: number | string;
      fee?: number | string;
      balance?: number | string;
    };
    return {
      ok: true,
      shares: Number(fill.shares ?? 0),
      price: Number(fill.price ?? 0),
      fee: Number(fill.fee ?? 0),
      balance: Number(fill.balance ?? 0),
    };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * Launch a community market. The client only picks the id + the question
 * fields; the server fixes the economics. `resolution` must be
 * community|manual — 'oracle' is reserved for the Global feed and the RPC
 * rejects it.
 *
 * v6: `seed` is REQUIRED and is REAL MONEY — `create_market_rpc` debits it
 * from the creator and it becomes the pool's collateral, making the
 * creator the market's LP. There is no more free $500. The 6-arg overload
 * is dropped server-side, so omitting `p_seed` fails at runtime.
 */
export async function createMarketCloud(
  input: CreateMarketInput & { seed: number }
): Promise<CloudCreateResult> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  const id = `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const { data, error } = await supabase.rpc('create_market_rpc', {
      p_id: id,
      p_question: input.question.trim(),
      p_description: input.description?.trim() || null,
      p_category: input.category,
      p_end_date: new Date(input.endDate).toISOString(),
      p_resolution: input.resolution,
      // The server re-validates the bounds ($10–$10,000) and the balance.
      p_seed: input.seed,
    });
    if (error) return { ok: false, error: mapRpcError(error) };
    return { ok: true, id: typeof data === 'string' && data ? data : id };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** Resolve a market — server charges the $10 fee (creator + 'manual')
 *  and pays every winning share $1. Admins resolve free. */
export async function resolveMarketCloud(
  marketId: string,
  outcome: Side
): Promise<CloudResult> {
  return callRpc('resolve_market_rpc', {
    p_market_id: marketId,
    p_outcome: outcome,
  });
}

/** ADMIN: ban/unban a market — banning refunds every open position at
 *  cost (shares * avgPrice) server-side. */
export async function banMarketCloud(
  marketId: string,
  banned: boolean
): Promise<CloudResult> {
  return callRpc('ban_market_rpc', { p_market_id: marketId, p_banned: banned });
}

/** Cast (or replace) a community-resolution ballot. Ended, unresolved,
 *  `resolution: 'community'` markets only. */
export async function castVoteCloud(
  marketId: string,
  side: Side
): Promise<CloudResult> {
  return callRpc('community_vote_rpc', { p_market_id: marketId, p_side: side });
}

/** ADMIN: the v8 CONFIRMATION step — settle a community market to the
 *  majority ballot and charge the $10 confirmation fee from the market's
 *  pot. Raises (so returns `{ ok:false }`) on a missing majority
 *  ('No majority yet — cannot finalize'), a market that has not ended, or
 *  one that is banned/already resolved. */
/**
 * v9 — ADMIN housekeeping: delete resolved markets older than `days` that
 * nothing references (no trades/positions), and slim the chart data of the
 * rest so history joins keep working on tiny archive rows.
 */
export async function cleanupResolvedMarketsCloud(
  days = 30
): Promise<{ ok: boolean; deleted?: number; slimmed?: number; error?: string }> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { data, error } = await supabase.rpc('cleanup_resolved_markets', {
      p_days: days,
    });
    if (error) return { ok: false, error: mapRpcError(error) };
    const r = (data ?? {}) as { deleted?: number; slimmed?: number };
    return { ok: true, deleted: r.deleted ?? 0, slimmed: r.slimmed ?? 0 };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * v9 — ADMIN: cash out platform earnings. Bookkeeping only: the RPC
 * deducts from the till and logs an audit row (platform_cashouts); the
 * actual crypto leaves wallets the operator already controls. Raises (so
 * `{ ok:false }`) on a non-positive amount or one above the balance.
 */
export async function platformCashoutCloud(
  amount: number
): Promise<{ ok: boolean; newBalance?: number; error?: string }> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { data, error } = await supabase.rpc('admin_platform_cashout', {
      p_amount: amount,
    });
    if (error) return { ok: false, error: mapRpcError(error) };
    const r = (data ?? {}) as { new_balance?: number };
    return { ok: true, newBalance: Number(r.new_balance) || 0 };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function finalizeCommunityCloud(
  marketId: string
): Promise<CloudFinalizeResult> {
  if (!supabase) return { ok: false, error: 'Cloud mode is not enabled.' };
  try {
    const { data, error } = await supabase.rpc('finalize_community_market', {
      p_market_id: marketId,
    });
    if (error) return { ok: false, error: mapRpcError(error) };
    // v8 returns jsonb { outcome, fee }; a pre-v8 DB returned a bare text
    // outcome — accept both so an un-migrated project degrades gracefully.
    if (data && typeof data === 'object') {
      const row = data as { outcome?: unknown; fee?: unknown };
      const fee = Number(row.fee);
      return {
        ok: true,
        outcome: asSide(row.outcome),
        fee: Number.isFinite(fee) ? fee : 0,
      };
    }
    return { ok: true, outcome: asSide(data), fee: 0 };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** The signed-in user's open positions (RLS: own rows only). */
export async function fetchMyPositions(): Promise<Position[]> {
  if (!supabase) return [];
  try {
    const uid = await authUserId();
    if (!uid) return [];
    const { data, error } = await supabase
      .from('positions')
      .select('id, market_id, side, shares, avg_price, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as PositionRow[]).map((r) => ({
      id: String(r.id),
      marketId: String(r.market_id),
      side: asSide(r.side),
      shares: Number(r.shares),
      avgPrice: Number(r.avg_price),
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * One consistent read of the shared book: every community market (banned
 * included — admin tables need those rows) plus the id set of banned
 * markets of ANY source (feeds filter Global markets with it too, since
 * those come from the API payload rather than the DB).
 *
 * Returns `null` when the read fails, so the caller can keep its last
 * good data instead of blanking the feed on a network hiccup. `markets`
 * is readable by anon — the signed-out feed renders too.
 */
export async function fetchMarketsSnapshot(): Promise<CloudMarketsSnapshot | null> {
  if (!supabase) return null;
  try {
    const [community, bannedRes] = await Promise.all([
      supabase
        .from('markets')
        .select(MARKET_COLUMNS)
        .eq('source', 'callit')
        .order('created_at', { ascending: false }),
      supabase.from('markets').select('id').eq('banned', true),
    ]);
    const failure = community.error ?? bannedRes.error;
    if (failure || !community.data) {
      warnBookRead(failure?.message);
      return null;
    }
    return {
      markets: (community.data as unknown as MarketRow[]).map(mapMarket),
      bannedIds: ((bannedRes.data ?? []) as { id: string }[]).map((r) => String(r.id)),
    };
  } catch (e) {
    warnBookRead(e instanceof Error ? e.message : undefined);
    return null;
  }
}

let bookReadWarned = false;

/**
 * The shared-book read fails silently by design (the feed keeps working
 * on the Polymarket half), which makes "where are my community markets?"
 * impossible to debug. Log the real reason ONCE — the usual cause is
 * supabase/schema.sql not having been applied to the project yet, which
 * shows up as a missing column / relation.
 */
function warnBookRead(message?: string): void {
  if (bookReadWarned) return;
  bookReadWarned = true;
  console.warn(
    '[callit] Could not read the shared market book from Supabase — community ' +
      'markets will be empty (the Polymarket feed is unaffected). Run ' +
      'supabase/schema.sql in the SQL editor if you have not yet. Reason:',
    message ?? 'unknown'
  );
}

/** Community (`source: 'callit'`) markets, banned ones filtered out.
 *  Thin wrapper over `fetchMarketsSnapshot()` — the store uses the
 *  snapshot directly (it needs the banned rows for /admin). */
export async function fetchCommunityMarkets(): Promise<Market[]> {
  const snap = await fetchMarketsSnapshot();
  if (!snap) return [];
  const banned = new Set(snap.bannedIds);
  return snap.markets.filter((m) => !banned.has(m.id));
}

/** Ids of every banned market (any source). */
export async function fetchBannedMarketIds(): Promise<string[]> {
  const snap = await fetchMarketsSnapshot();
  return snap?.bannedIds ?? [];
}

/* ------------------------------------------------------------------ */
/* v6 — platform config + live pools                                   */
/* ------------------------------------------------------------------ */

/**
 * The platform's public config (`platform_settings` row 1) — readable by
 * everyone including anon, so the UI can show the REAL fee instead of a
 * hardcoded 2%.
 *
 * Only `global_seed` and `fee_bps` are read here. The till columns
 * (`platform_balance` / `platform_exposure`) are operator numbers with no
 * client write path; they belong in /admin, not in a trade panel.
 */
export async function fetchPlatformSettings(): Promise<CloudPlatformSettings | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('global_seed, fee_bps')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { global_seed: number | string | null; fee_bps: number | null };
    return {
      globalSeed: Number(row.global_seed ?? DEFAULT_GLOBAL_SEED),
      feeBps: Number(row.fee_bps ?? DEFAULT_FEE_BPS),
    };
  } catch {
    return null;
  }
}

/**
 * The pool `place_trade` will actually fill against — the input the trade
 * preview needs to stop lying.
 *
 * Why this read exists: Global markets render from the /api/polymarket
 * payload, whose `liquidity` is POLYMARKET's book depth (often tens of
 * thousands), while OUR pool is seeded with `global_seed` (default $25).
 * Quoting the feed number would preview a $100 order at ~0 slippage when
 * the real fill walks a $25 curve — a worse lie than the flat tick it
 * replaced, because it looks precise. `markets` is readable by anon.
 *
 * Returns null when the row is missing (feed sync has not run — the trade
 * itself would raise 'Market not found' too) or the market is a community
 * one with no pool (voided by a ban; the next trade raises 'This market
 * has no liquidity'). Callers then fall back to `previewBuy`'s synthetic
 * pool, which is the documented degraded path.
 */
export async function fetchMarketPool(
  marketId: string
): Promise<CloudMarketPool | null> {
  if (!supabase) return null;
  try {
    // ONE string literal, deliberately: supabase-js parses the column list at
    // the TYPE level, and a concatenation is opaque to it — the row degrades
    // to `GenericStringError` and the cast below stops compiling.
    const { data, error } = await supabase
      .from('markets')
      .select('yes_reserve, no_reserve, collateral, yes_price, fee_bps, platform_fee_bps, lp_fee_bps, source')
      .eq('id', marketId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      yes_reserve: number | string | null;
      no_reserve: number | string | null;
      collateral: number | string | null;
      yes_price: number | string | null;
      fee_bps: number | null;
      platform_fee_bps: number | null;
      lp_fee_bps: number | null;
      source: string | null;
    };
    const feeBps = Number(row.fee_bps ?? DEFAULT_FEE_BPS);
    const platformFeeBps = bpsOrNull(row.platform_fee_bps);
    const lpFeeBps = bpsOrNull(row.lp_fee_bps);
    const split = { platformFeeBps, lpFeeBps };
    const yesReserve = Number(row.yes_reserve ?? 0);
    const noReserve = Number(row.no_reserve ?? 0);

    // Funded: quote the real curve.
    if (Number(row.collateral ?? 0) > 0 && yesReserve > 0 && noReserve > 0) {
      return { yesReserve, noReserve, feeBps, ...split, funded: true };
    }

    // Unfunded community market = a voided pool. There is nothing to quote
    // and the trade will be rejected; don't invent a curve for it.
    if (row.source === 'callit') return null;

    // Unfunded FEED market: place_trade lazily seeds it from
    // platform_settings.global_seed at the stored price, then fills against
    // THAT. Mirror the seed so the first trade previews honestly.
    const settings = await fetchPlatformSettings();
    const pool = syntheticPool(
      settings?.globalSeed ?? DEFAULT_GLOBAL_SEED,
      Number(row.yes_price ?? 0.5)
    );
    if (!pool) return null;
    return { ...pool, feeBps, ...split, funded: false };
  } catch {
    return null;
  }
}

/** Public ballot tally for a community market (`community_votes` is
 *  readable by anon — tallies are public). */
export async function fetchMarketVotes(
  marketId: string
): Promise<{ yes: number; no: number }> {
  const empty = { yes: 0, no: 0 };
  if (!supabase) return empty;
  try {
    const { data, error } = await supabase
      .from('community_votes')
      .select('side')
      .eq('market_id', marketId);
    if (error || !data) return empty;
    let yes = 0;
    let no = 0;
    for (const row of data as { side: string }[]) {
      if (row.side === 'yes') yes += 1;
      else if (row.side === 'no') no += 1;
    }
    return { yes, no };
  } catch {
    return empty;
  }
}

/* ------------------------------------------------------------------ */
/* v8 — public profiles + proof of reserves                            */
/* ------------------------------------------------------------------ */

/** The safe, public slice of a user profile (`public_profile` RPC —
 *  anon-readable BY DESIGN; it never contains email/balance/admin/ids). */
export interface PublicProfile {
  username: string;
  /** ISO join date (profiles.created_at). */
  joinedAt: string;
  /** Non-banned community markets this user has launched. */
  marketsCreated: number;
  /** Lifetime traded volume (USD) across those markets. */
  marketsVolume: number;
}

/**
 * A username's public profile, or `null` (unknown/banned user, local mode,
 * or a read failure — the profile page renders its not-found state either
 * way, deliberately not distinguishing "banned" from "does not exist").
 */
export async function fetchPublicProfile(
  username: string
): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const name = username.trim();
  if (!name) return null;
  try {
    const { data, error } = await supabase.rpc('public_profile', {
      p_username: name,
    });
    if (error || !data || typeof data !== 'object') return null;
    const row = data as {
      username?: unknown;
      joined_at?: unknown;
      markets_created?: unknown;
      markets_volume?: unknown;
    };
    if (typeof row.username !== 'string' || !row.username) return null;
    return {
      username: row.username,
      joinedAt: typeof row.joined_at === 'string' ? row.joined_at : '',
      marketsCreated: Number(row.markets_created ?? 0),
      marketsVolume: Number(row.markets_volume ?? 0),
    };
  } catch {
    return null;
  }
}

/** Raw `list_creator_markets` row (snake_case). */
interface CreatorMarketRow {
  id: string;
  question: string | null;
  category: string | null;
  yes_price: number | string | null;
  volume: number | string | null;
  status: string | null;
  end_date: string;
  resolved_outcome: string | null;
  created_at: string;
}

/**
 * A creator's public, non-banned community markets (newest first, max 100),
 * mapped into full `Market` objects so `MarketCard` renders them directly.
 *
 * The RPC returns a REDUCED projection — the fields the profile page shows —
 * so the rest of the Market is filled with safe defaults: `priceHistory: []`
 * (no chart on profile cards), `liquidity: 0`, `resolution: 'community'`
 * (the only user-creatable kind in v8), `createdBy` = the queried username.
 * Anything that needs the full market (trade modal, detail page) resolves it
 * by id through the shared book as usual. `[]` on local mode or any error.
 */
export async function fetchCreatorMarkets(username: string): Promise<Market[]> {
  if (!supabase) return [];
  const name = username.trim();
  if (!name) return [];
  try {
    const { data, error } = await supabase.rpc('list_creator_markets', {
      p_username: name,
    });
    if (error || !Array.isArray(data)) return [];
    return (data as CreatorMarketRow[]).map((r) => ({
      id: String(r.id),
      source: 'callit' as const,
      question: r.question ?? '',
      category: r.category ?? 'custom',
      endDate: r.end_date,
      resolution: 'community' as const,
      yesPrice: Number(r.yes_price ?? 0.5),
      volume: Number(r.volume ?? 0),
      liquidity: 0,
      createdBy: name,
      createdAt: r.created_at,
      status: r.status === 'resolved' ? ('resolved' as const) : ('open' as const),
      resolvedOutcome:
        r.resolved_outcome === 'yes' || r.resolved_outcome === 'no'
          ? r.resolved_outcome
          : undefined,
      priceHistory: [],
    }));
  } catch {
    return [];
  }
}

/** The public proof-of-reserves numbers (`reserves_stats` RPC, anon-readable).
 *  The trust claim: `totalCollateral >= openLiability`, always — under the
 *  v6 complete-set AMM that is arithmetic, not policy. */
export interface ReservesStats {
  /** Real money (USD) sitting in open markets' pools. */
  totalCollateral: number;
  /** The MAXIMUM the book could ever owe across open markets. */
  openLiability: number;
  /** The operator's till — deliberately public here (v8): a reserves page
   *  with a secret house buffer proves nothing. */
  platformBalance: number;
  /** LP fees accrued in open markets (paid out at resolution). */
  feesAccrued: number;
  openMarkets: number;
  fundedMarkets: number;
}

/** Proof-of-reserves stats, or `null` (local mode / read failure — the page
 *  shows an unavailable state, never zeros that would read as insolvency). */
export async function fetchReserves(): Promise<ReservesStats | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('reserves_stats');
    if (error || !data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      totalCollateral: num(row.total_collateral),
      openLiability: num(row.open_liability),
      platformBalance: num(row.platform_balance),
      feesAccrued: num(row.fees_accrued),
      openMarkets: num(row.open_markets),
      fundedMarkets: num(row.funded_markets),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* shared book change notifier                                         */
/* ------------------------------------------------------------------ */

/**
 * Tiny emitter so the store can tell lib/useMarkets.ts "the shared book
 * changed, refetch now" (after a create/resolve/ban/community trade)
 * without importing it — useMarkets already imports the store, and the
 * reverse import would be a cycle. cloud.ts imports neither, so it is
 * the natural place for the channel.
 */
type BookListener = () => void;

const bookListeners = new Set<BookListener>();

/** Subscribe to shared-book changes. Returns an unsubscribe function. */
export function onSharedBookChanged(fn: BookListener): () => void {
  bookListeners.add(fn);
  return () => {
    bookListeners.delete(fn);
  };
}

/** Notify every subscriber that the shared book changed. */
export function notifySharedBookChanged(): void {
  for (const fn of bookListeners) {
    try {
      fn();
    } catch {
      // A broken listener must never break the action that fired it.
    }
  }
}
