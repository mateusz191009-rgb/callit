'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AuthUser,
  Category,
  ChatMessage,
  CreateMarketInput,
  Deposit,
  DepositCurrency,
  EventGroup,
  Market,
  MarketOverride,
  Position,
  Side,
  Withdrawal,
} from './types';
import { CATEGORIES } from './types';
import { generatePriceHistory } from './utils';
import { isInPlay, isMarketClosed } from './format';
import { fetchFreshQuote, QUOTE_DRIFT_MAX } from './quote';
import { applySell, applyTrade } from './pricing';
import { seedMarkets } from './seed';
import { supabase } from './supabase';
import {
  approveDepositCloud,
  approveWithdrawalCloud,
  banMarketCloud,
  bpsOrNull,
  castVoteCloud,
  createMarketCloud,
  fetchMarketsSnapshot,
  fetchMyPositions,
  fetchMyProfile,
  fetchPlatformSettings,
  finalizeCommunityCloud,
  notifySharedBookChanged,
  placeTradeCloud,
  rejectDepositCloud,
  rejectWithdrawalCloud,
  requestDepositCloud,
  requestWithdrawalCloud,
  resolveMarketCloud,
  sendWithdrawalConfirmation,
  setUserBannedCloud,
  type CloudResult,
} from './cloud';

export type HomeTab = 'all' | 'trending' | 'polymarket' | 'mine';

const MOCK_ADDRESS = '0x7fA3bC21d94E05Aa1B6f3D8cE47a20F1B3D59c21';

/** The one admin account — `isAdmin` is granted to this email only
 *  (case-insensitive). The v2 password gate is gone. Defined in lib/geo.ts
 *  (server-safe) so the sign-up route can exempt the admin from the
 *  geoblock; re-exported here so existing imports keep working. */
export { ADMIN_EMAIL } from './geo';
import { ADMIN_EMAIL } from './geo';

/** Fresh-start balance for every account (real-economy reset, v3). */
export const START_BALANCE = 0;

/** v8 — the $10 COMMUNITY CONFIRMATION fee (USD). Charged server-side when
 *  an admin confirms a community market's vote (finalize_community_market),
 *  taken from the market's own pot AFTER winners are paid — never from
 *  anyone's balance. The pre-v8 meaning ("deducted from the resolver's
 *  balance for a manual resolve") is GONE: manual resolution no longer
 *  exists and resolve_market_rpc is admin-only and free. Kept exported for
 *  fee copy in the UI. */
export const RESOLVE_FEE = 10;

/** Result of an auth action. `info` carries a non-error notice the UI
 *  should surface (e.g. "Check your email to confirm your account."). */
export interface AuthResult {
  ok: boolean;
  error?: string;
  info?: string;
}

const AUTH_UNREACHABLE =
  'Auth service unreachable — check NEXT_PUBLIC_SUPABASE_URL (use the Project URL, not the REST URL).';

/** Local demo credential record. Plaintext password — DEMO ONLY, this is
 *  an educational build; real deployments use Supabase auth instead. */
export interface LocalUser {
  email: string;
  username: string;
  pass: string;
  banned: boolean;
  balance?: never;
}

export interface CallitStore {
  /* ----- persisted ----- */
  balance: number; // USDC balance — starts at $0, funded only via approved deposits
  wallet: { connected: boolean; connecting: boolean; address?: string };
  userMarkets: Market[];
  marketOverrides: Record<string, MarketOverride>;
  positions: Position[];
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  chat: Record<string, ChatMessage[]>;
  user: AuthUser | null;
  bannedMarketIds: string[];
  localUsers: LocalUser[];
  /** Community-vote ballots: marketId -> voterEmail -> side. */
  communityVotes: Record<string, Record<string, Side>>;
  /** Admin-created categories (built-ins live in CATEGORIES). */
  customCategories: { value: string; label: string }[];

  /* ----- runtime only ----- */
  _hasHydrated: boolean;
  poly: Market[];
  polyEvents: EventGroup[];
  polyLoaded: boolean;
  /** CLOUD MODE ONLY — the signed-in user's positions, straight from the
   *  `positions` table (the server books them; the client can't write).
   *  Read it via `usePositions()` (lib/useMarkets.ts), which falls back
   *  to the local `positions` array outside cloud mode. */
  cloudPositions: Position[];
  /** CLOUD FEED ONLY — community markets from the shared book, INCLUDING
   *  banned ones (admin tables need them; feeds filter via
   *  `cloudBannedIds`). Replaces userMarkets+seedMarkets in the
   *  selectors when Supabase is configured. */
  cloudMarkets: Market[];
  /** CLOUD FEED ONLY — ids of banned markets (any source), from
   *  `markets.banned`. Feeds filter Global markets with this too. */
  cloudBannedIds: string[];
  cloudMarketsLoaded: boolean;
  /** CLOUD FEED ONLY — the platform's public config (`platform_settings`),
   *  so the UI can show the REAL fee and the seed a Global market gets,
   *  instead of hardcoding them. Null until `refreshPlatformSettings()`
   *  has run (and in local mode, where there is no server config).
   *
   *  `feeBps` here is what NEW markets are created with — a LIVE market
   *  charges its own `market.feeBps`, locked in at creation so an admin
   *  changing the global fee cannot retro-price it. Prefer
   *  `market.feeBps ?? platformSettings.feeBps`.
   *
   *  `platformFeeBps` / `lpFeeBps` are the v7 SPLIT of that total: the
   *  slice banked to `platform_balance` at trade time vs. the slice
   *  accruing to `fees_accrued` for the market's LP. They exist so the
   *  fee line can explain WHERE the money goes (1% + 1% by default).
   *  Same locked-at-creation caveat as `feeBps` — these describe NEW
   *  markets, never a live one. `null` on a pre-v7 database or when the
   *  column read failed; consumers must fall back rather than assume. */
  platformSettings: {
    globalSeed: number;
    feeBps: number;
    platformFeeBps: number | null;
    lpFeeBps: number | null;
  } | null;
  /**
   * The server's message for the LAST money/market action (trade,
   * createMarket, resolveMarket, castVote, finalizeCommunityMarket).
   *
   * Those actions keep their boolean/null return contracts, so this is
   * the channel that carries the RPC's user-facing wording
   * ('Insufficient balance', 'This account is banned', 'The vote is
   * tied', …). Read it RIGHT AFTER awaiting the action, e.g.
   * `useCallitStore.getState().lastActionError`, and fall back to your
   * own generic copy when it is null (local mode never sets it).
   */
  lastActionError: string | null;
  /**
   * v8 — the confirmation fee (USD) the LAST successful
   * `finalizeCommunityMarket` banked to the platform. Read it right after a
   * successful await to surface the $10 in the toast ("Finalized — $8.40
   * confirmation fee banked"): the fee is capped by the market's own pot,
   * so it can be less than $10 on a thin market. Null before any finalize
   * and in local mode (which charges nothing).
   */
  lastFinalizeFee: number | null;
  searchQuery: string;
  categoryFilter: Category | 'all';
  homeTab: HomeTab;
  tradeModal: { marketId: string; side: Side } | null;
  /** Which auth tab the global AuthModal should open on; null = closed. */
  authModal: 'signin' | 'signup' | null;

  /* ----- actions ----- */
  setHasHydrated: (v: boolean) => void;
  connectWallet: () => void;
  disconnectWallet: () => void;
  /** Creates a community market. CLOUD: `create_market_rpc` — the server
   *  fixes the economics and owns the row (every user sees it); the
   *  shared book is refetched before this resolves, so the returned
   *  market is immediately routable. LOCAL: appends to `userMarkets`.
   *  Null = rejected; the reason is in `lastActionError`.
   *
   *  v8: `resolution` MUST be 'community' — it is the only user-creatable
   *  kind now ('manual' is gone; 'oracle' stays feed-only). Both modes
   *  reject anything else with 'Only community resolution is available'.
   *
   *  v6: `seed` is REQUIRED and is real money — the server DEBITS it from
   *  the creator ($10–$10,000) and it becomes the market's pool, making
   *  the creator its LP. LOCAL mode keeps the old free-seed behavior (no
   *  debit, no balance check) so the no-Supabase demo still works. */
  createMarket: (input: CreateMarketInput & { seed: number }) => Promise<Market | null>;
  /** Executes a BUY. CLOUD: `place_trade` — the server fills against the
   *  market's own FPMM pool, debits atomically and books the position; the
   *  store then adopts the returned balance and refreshes positions.
   *  LOCAL: settles against the local book as before.
   *  Returns the fill, or null with the reason in `lastActionError`.
   *
   *  v6: `avgPrice` is the AVERAGE FILL the server executed (it walked the
   *  curve), NOT the tick that was quoted — the two differ by the
   *  slippage. `fee` is the trading fee taken off the stake (always 0 in
   *  local mode, which has no fee). */
  trade: (
    marketId: string,
    side: Side,
    amount: number
  ) => Promise<{ shares: number; avgPrice: number; fee: number } | null>;
  /** LOCAL MODE ONLY — sells owned shares back at the current price of
   *  that side. There is no `sell_rpc`: in cloud mode this always
   *  returns null. Nothing in the UI may call it either way (v4 is
   *  buy-only); kept for a future re-introduction. */
  sell: (
    marketId: string,
    side: Side,
    shares: number
  ) => { proceeds: number } | null;
  /** Resolves a market and pays winners $1/share. v8: ADMIN ONLY and FREE
   *  in both modes — the creator self-resolve path (and its $10 fee from
   *  the resolver's balance) is GONE; the $10 moved to the community
   *  confirmation step. CLOUD: `resolve_market_rpc` (raises 'Admin only'
   *  for everyone else). LOCAL: no-op false for non-admins. False =
   *  rejected, reason in `lastActionError`. */
  resolveMarket: (marketId: string, outcome: Side) => Promise<boolean>;
  /** One community vote per signed-in user (re-vote replaces). Only for
   *  resolution 'community' markets that have ended and are unresolved.
   *  CLOUD: `community_vote_rpc`. False = rejected, reason in
   *  `lastActionError`. */
  castVote: (marketId: string, side: Side) => Promise<boolean>;
  /** Admin: the v8 CONFIRMATION step — resolves a community market to the
   *  majority ballot after reviewing it. CLOUD: `finalize_community_market`
   *  (server counts, pays out, and banks the $10 confirmation fee from the
   *  market's pot — read `lastFinalizeFee` after a successful await for the
   *  toast). Ties and empty ballot boxes -> false with lastActionError
   *  'No majority yet — cannot finalize'. LOCAL: majority resolve, no fee. */
  finalizeCommunityMarket: (marketId: string) => Promise<boolean>;
  /** LOCAL tally for a community market. In cloud mode ballots live in
   *  the DB — use `fetchMarketVotes(marketId)` (lib/cloud.ts) instead;
   *  this returns zeros there. */
  getVoteTally: (marketId: string) => { yes: number; no: number };
  /** Adds a custom category (label -> slugified value). Rejects blanks and
   *  duplicates against built-ins + existing customs; returns success. */
  addCategory: (label: string) => boolean;
  /** Removes a CUSTOM category by value (built-ins are untouchable). */
  removeCategory: (value: string) => void;
  setPolymarkets: (data: { markets: Market[]; events: EventGroup[] }) => void;
  /** v15 — stamp a bet-time live quote onto one feed market (price +
   *  history point) so the interrupted bet re-renders at the real odds. */
  applyFreshQuote: (marketId: string, yesPrice: number) => void;
  setSearchQuery: (q: string) => void;
  setCategoryFilter: (c: Category | 'all') => void;
  setHomeTab: (t: HomeTab) => void;
  openTradeModal: (marketId: string, side: Side) => void;
  closeTradeModal: () => void;
  openAuthModal: (tab: 'signin' | 'signup') => void;
  closeAuthModal: () => void;
  /** Merged view (base + override) of a single market. Also finds markets
   *  nested inside polymarket EventGroups. */
  getMarketById: (id: string) => Market | undefined;

  /* ----- auth (dual-mode: Supabase when configured, else local demo) ----- */
  signUp: (
    email: string,
    username: string,
    pass: string,
    refCode?: string
  ) => Promise<AuthResult>;
  signIn: (email: string, pass: string) => Promise<AuthResult>;
  signOut: () => void;
  /** Cloud mode only (no-op otherwise): reloads the own profile row and
   *  syncs `balance`/`isAdmin`/`username` into the store. A user banned
   *  mid-session is signed out. THE balance source of truth in cloud
   *  mode — the client can no longer write a balance at all. Call after
   *  cloud payment mutations; the Providers 60s interval keeps it fresh
   *  in the background. */
  refreshProfile: () => Promise<void>;
  /** Cloud mode only (no-op otherwise): reloads `cloudPositions` from the
   *  `positions` table. Fired automatically after a cloud trade/resolve. */
  refreshPositions: () => Promise<void>;
  /** Cloud FEED only (Supabase configured — no sign-in needed, the book
   *  is public): reloads `cloudMarkets` + `cloudBannedIds`. A failed read
   *  keeps the previous data. Driven by `usePolymarketLoader()` (mount +
   *  90s) and fired after create/resolve/ban and community trades. */
  refreshCommunityMarkets: () => Promise<void>;
  /** Cloud FEED only (no sign-in needed — the row is public): loads
   *  `platformSettings`. Concurrent calls share one request, so callers
   *  may fire it on mount without coordinating. No-op in local mode. */
  refreshPlatformSettings: () => Promise<void>;

  /* ----- deposits (async dual-mode, v4) ----- */
  /** Cloud (supabase + signed in): `request_deposit` RPC inserts the
   *  pending row server-side. Local: pushes a pending Deposit as before.
   *  Resolves { ok:false, error } for invalid amounts / RPC failures. */
  requestDeposit: (
    currency: DepositCurrency,
    amount: number,
    txHash?: string
  ) => Promise<CloudResult>;
  /** Cloud: `approve_deposit` RPC — credits the TARGET user's cloud
   *  balance (which may not be you; local balance is NOT touched).
   *  Local: pending -> approved + credits the local balance. */
  approveDeposit: (id: string) => Promise<CloudResult>;
  /** Cloud: `reject_deposit` RPC. Local: pending -> rejected. */
  rejectDeposit: (id: string) => Promise<CloudResult>;

  /* ----- withdrawals (async dual-mode, v4) ----- */
  /** Cloud: `request_withdrawal` RPC reserves the amount server-side —
   *  the local balance is NOT deducted (refreshProfile picks up the new
   *  balance on ok; no double-deduct). v8: on ok the store also triggers
   *  the confirmation EMAIL (fire-and-forget via the
   *  /api/withdrawals/send-confirmation route) — success copy should read
   *  "Withdrawal requested — check your email to confirm it." Local:
   *  deducts immediately (reserved) and pushes a pending withdrawal (no
   *  email step). Resolves { ok:false, error } for guests, bad input or
   *  short balance. */
  requestWithdrawal: (
    currency: DepositCurrency,
    amount: number,
    address: string
  ) => Promise<CloudResult>;
  /** Cloud: `approve_withdrawal` RPC (funds already reserved). v8: the RPC
   *  refuses unconfirmed rows ('User has not confirmed this withdrawal
   *  yet') — the admin UI shows a Confirmed badge and surfaces that error.
   *  Local: pending -> approved (no email step, implicitly confirmed). */
  approveWithdrawal: (id: string) => Promise<CloudResult>;
  /** Cloud: `reject_withdrawal` RPC — refunds the TARGET user server-side
   *  (local balance untouched). Local: pending -> rejected + refund. */
  rejectWithdrawal: (id: string) => Promise<CloudResult>;

  /* ----- chat ----- */
  addChatMessage: (marketId: string, text: string) => void;

  /* ----- admin ----- */
  /** Bans a market and refunds every open position at cost. CLOUD:
   *  `ban_market_rpc` — the SERVER refunds EVERY user's positions (a
   *  client could only ever refund its own). LOCAL: refunds the local
   *  positions and adds to `bannedMarketIds`. */
  banMarket: (id: string) => Promise<CloudResult>;
  unbanMarket: (id: string) => Promise<CloudResult>;
  /** Dual-mode: always updates the local list; in cloud mode `userId`
   *  (profiles.id, from fetchAllProfiles) is REQUIRED — it routes to the
   *  admin `set_user_banned` RPC. The v2 email-matched profiles update is
   *  gone: v5 revoked the client's UPDATE grant, so it could only ever
   *  fail. Admin UI must always pass `userId` for cloud users. */
  banUser: (email: string, userId?: string) => void;
  unbanUser: (email: string, userId?: string) => void;
  /** LOCAL MODE ONLY — the demo balance tool. In cloud mode the balance
   *  is server-owned (the client's UPDATE on profiles is revoked), so
   *  this is a no-op: fund accounts via an approved deposit instead. */
  adjustBalance: (delta: number) => void;
}

export function mergeOverride(m: Market, o?: MarketOverride): Market {
  return o ? { ...m, ...o } : m;
}

/**
 * v3 override merge — use this instead of raw `mergeOverride` everywhere.
 *
 * For `source: 'polymarket'` markets the LIVE feed wins: base
 * yesPrice/volume/liquidity from the fresh /api/polymarket payload are
 * kept (local trades can't fake stale odds — anti-scam), while
 * override `status`/`resolvedOutcome` are preserved and locally-traded
 * price points newer than the feed history are appended to the chart.
 * Community/callit markets keep the full override behavior.
 */
export function mergeMarket(m: Market, o?: MarketOverride): Market {
  if (!o) return m;
  if (m.source !== 'polymarket') return { ...m, ...o };
  const lastBaseT =
    m.priceHistory.length > 0 ? m.priceHistory[m.priceHistory.length - 1].t : 0;
  const extra = o.priceHistory.filter((p) => p.t > lastBaseT);
  return {
    ...m,
    status: o.status,
    resolvedOutcome: o.resolvedOutcome ?? m.resolvedOutcome,
    priceHistory: extra.length > 0 ? [...m.priceHistory, ...extra] : m.priceHistory,
  };
}

function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

/** Slug for a custom category label, e.g. 'AI & Tech' -> 'ai-tech'. */
function slugifyCategory(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when the currently signed-in user is banned (local list). */
function currentUserBanned(s: Pick<CallitStore, 'user' | 'localUsers'>): boolean {
  if (!s.user) return false;
  return s.localUsers.find((u) => u.email === s.user!.email)?.banned ?? false;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * In-flight `platform_settings` read, shared by concurrent callers.
 *
 * Every trade panel and the create form want the config on mount, and
 * several can mount at once (the event page's rail + a trade modal). One
 * request is enough — the row is a single global config, not per-user.
 */
let platformSettingsInFlight: Promise<void> | null = null;

/**
 * The v7 fee SPLIT (`platform_fee_bps` / `lp_fee_bps`).
 *
 * A separate read from `fetchPlatformSettings()` (which owns
 * `global_seed` / `fee_bps`) purely to keep this change out of
 * `lib/cloud.ts`. It is the same anon-readable row, once per session.
 *
 * Columns are listed EXPLICITLY and deliberately: v7 narrowed the read
 * grant on `platform_settings`, so `select('*')` now fails outright with
 * `permission denied for column platform_balance`. Never widen this.
 *
 * Returns nulls — never throws — on a pre-v7 database (columns absent),
 * so the trade panel degrades to the total instead of breaking.
 */
async function fetchFeeSplit(): Promise<{
  platformFeeBps: number | null;
  lpFeeBps: number | null;
}> {
  const none = { platformFeeBps: null, lpFeeBps: null };
  if (!supabase) return none;
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('platform_fee_bps, lp_fee_bps')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return none;
    const row = data as Record<string, unknown>;
    return {
      platformFeeBps: bpsOrNull(row.platform_fee_bps),
      lpFeeBps: bpsOrNull(row.lp_fee_bps),
    };
  } catch {
    return none;
  }
}

/**
 * CLOUD MODE — Supabase configured AND a user is signed in. Money moves
 * through the RPCs and the server is authoritative: balances, fills,
 * positions and payouts all come back FROM the server. The client cannot
 * write `profiles.balance` at all (v5 revoked the grant).
 */
function cloudActive(s: Pick<CallitStore, 'user'>): boolean {
  return Boolean(supabase && s.user);
}

/**
 * CLOUD FEED — Supabase configured, sign-in NOT required. The shared
 * `markets` book is readable by anon, so the community feed is
 * multiplayer for guests too. This is the branch for market DATA;
 * `cloudActive` is the branch for MONEY.
 */
const cloudFeed = Boolean(supabase);

/** The persisted slice of the store (what lands in localStorage). */
function partializeStore(s: CallitStore) {
  return {
    balance: s.balance,
    wallet: { connected: s.wallet.connected, connecting: false, address: s.wallet.address },
    userMarkets: s.userMarkets,
    marketOverrides: s.marketOverrides,
    positions: s.positions,
    deposits: s.deposits,
    withdrawals: s.withdrawals,
    chat: s.chat,
    user: s.user,
    bannedMarketIds: s.bannedMarketIds,
    localUsers: s.localUsers,
    communityVotes: s.communityVotes,
    customCategories: s.customCategories,
  };
}

type PersistedCallitState = ReturnType<typeof partializeStore>;

export const useCallitStore = create<CallitStore>()(
  persist(
    (set, get) => ({
      balance: START_BALANCE,
      wallet: { connected: false, connecting: false },
      userMarkets: [],
      marketOverrides: {},
      positions: [],
      deposits: [],
      withdrawals: [],
      chat: {},
      user: null,
      bannedMarketIds: [],
      localUsers: [],
      communityVotes: {},
      customCategories: [],

      _hasHydrated: false,
      poly: [],
      polyEvents: [],
      polyLoaded: false,
      cloudPositions: [],
      cloudMarkets: [],
      cloudBannedIds: [],
      cloudMarketsLoaded: false,
      platformSettings: null,
      lastActionError: null,
      lastFinalizeFee: null,
      searchQuery: '',
      categoryFilter: 'all',
      homeTab: 'all',
      tradeModal: null,
      authModal: null,

      setHasHydrated: (v) => set({ _hasHydrated: v }),

      connectWallet: () => {
        if (get().wallet.connected || get().wallet.connecting) return;
        set({ wallet: { connected: false, connecting: true } });
        // Mock wallet: 800ms "connecting", then a fake address. Swap this
        // for wagmi/RainbowKit later — the UI only talks to this action.
        setTimeout(() => {
          set({
            wallet: { connected: true, connecting: false, address: MOCK_ADDRESS },
          });
        }, 800);
      },

      disconnectWallet: () => set({ wallet: { connected: false, connecting: false } }),

      createMarket: async (input) => {
        const s = get();

        // v8 — community is the ONLY user-creatable resolution. The server
        // enforces this too (create_market_rpc raises the same message);
        // checking here keeps local mode on the identical rule and saves
        // the cloud round-trip for a stale form.
        if (input.resolution !== 'community') {
          set({ lastActionError: 'Only community resolution is available' });
          return null;
        }

        if (cloudActive(s)) {
          // Server owns the economics AND the row: create_market_rpc opens
          // the pool at 50¢, DEBITS the creator's seed as its collateral
          // (v6 — there is no free $500 any more), validates the $10–$10k
          // bounds and rejects banned callers. The market is then visible
          // to EVERY user, not just this browser.
          const res = await createMarketCloud(input);
          if (!res.ok || !res.id) {
            set({ lastActionError: res.error ?? null });
            return null;
          }
          set({ lastActionError: null });
          // Pull the book BEFORE resolving: CreateMarketForm navigates to
          // /market/<id> straight after, and the route must find it.
          // The seed was just debited server-side, so the balance moved —
          // refresh it or the topbar keeps showing the pre-funding number.
          await Promise.all([
            get().refreshCommunityMarkets(),
            get().refreshProfile(),
          ]);
          const stored = get().getMarketById(res.id);
          if (stored) return stored;
          // Refetch hiccup — hand back what the server just created.
          return {
            id: res.id,
            source: 'callit',
            question: input.question.trim(),
            description: input.description?.trim() || undefined,
            category: input.category,
            endDate: input.endDate,
            resolution: input.resolution,
            yesPrice: 0.5,
            volume: 0,
            // v6: liquidity is the pool's REAL collateral, which at
            // creation is exactly the seed the creator just funded.
            liquidity: input.seed,
            seed: input.seed,
            createdBy: s.user?.username,
            createdAt: new Date().toISOString(),
            status: 'open',
            // The server seeds price_history as [] — place_trade appends
            // the first point. Keep the optimistic object identical.
            priceHistory: [],
          };
        }

        // LOCAL DEMO — the free-seed path, deliberately unchanged. There is
        // no pool and no collateral here (applyTrade mints unbacked shares
        // by design; that is what v6 fixed on the SERVER), so `seed` is not
        // debited and the balance is not checked. Local accounts start at
        // $0, so enforcing the funding rule here would make it impossible
        // to create a market in demo mode at all.
        if (currentUserBanned(s)) {
          set({ lastActionError: null });
          return null;
        }
        const now = Date.now();
        const market: Market = {
          id: `cm-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          source: 'callit',
          question: input.question.trim(),
          description: input.description?.trim() || undefined,
          category: input.category,
          endDate: input.endDate,
          resolution: input.resolution,
          yesPrice: 0.5,
          volume: 0,
          liquidity: 500,
          createdBy: get().user?.username ?? 'guest',
          createdAt: new Date(now).toISOString(),
          status: 'open',
          priceHistory: [{ t: now, yes: 0.5 }],
        };
        set((st) => ({ userMarkets: [market, ...st.userMarkets], lastActionError: null }));
        return market;
      },

      trade: async (marketId, side, amount) => {
        const s = get();

        // v15 — BET-TIME QUOTE CHECK, live games only. In-play odds move in
        // seconds while the feed refreshes in minutes; before booking, pull
        // the live source price for THIS market (server route, 2s cap). If
        // it drifted more than QUOTE_DRIFT_MAX the bet is interrupted, the
        // displayed quote updated, and the user must confirm the new price.
        // Deliberately scoped so it cannot slow anything else down: feed
        // markets only, in-play only, fail-open on timeout/error — every
        // other bet takes the exact path it always took. The route also
        // refreshes the server-side mirror, so the re-confirmed bet is
        // PRICED off the fresh quote, not just displayed at it.
        const pre = s.getMarketById(marketId);
        if (pre && pre.source === 'polymarket' && isInPlay(pre)) {
          const fresh = await fetchFreshQuote(marketId);
          if (fresh !== null && Math.abs(fresh - pre.yesPrice) > QUOTE_DRIFT_MAX) {
            get().applyFreshQuote(marketId, fresh);
            set({
              lastActionError:
                'Live odds just moved — the quote was updated. Review the new price and confirm again.',
            });
            return null;
          }
        }

        if (cloudActive(s)) {
          // SERVER-AUTHORITATIVE PATH. Every check that used to run here
          // (banned user, banned/closed/ended market, price, balance)
          // now runs inside place_trade, against server state, under a
          // row lock — the client cannot influence the fill price and
          // cannot overdraw. We just report the result.
          const res = await placeTradeCloud(marketId, side, amount);
          if (!res.ok || res.shares === undefined) {
            set({ lastActionError: res.error ?? null });
            return null;
          }
          // The RPC returns the caller's NEW balance — adopt it, never
          // compute it. Positions are server-booked: refetch them.
          set({
            balance: res.balance ?? s.balance,
            lastActionError: null,
          });
          void get().refreshPositions();
          // A fill on a community market moved the shared price; pull the
          // book so every chart/card follows. Global market prices come
          // from the feed (place_trade only adds volume there).
          if (s.getMarketById(marketId)?.source === 'callit') {
            notifySharedBookChanged();
          }
          // v6: `price` is the average fill the server walked to, and
          // `fee` is what the market's own fee_bps took off the stake.
          return {
            shares: res.shares,
            avgPrice: res.price ?? 0,
            fee: res.fee ?? 0,
          };
        }

        set({ lastActionError: null });
        if (currentUserBanned(s)) return null;
        // Banned markets are delisted AND untradeable (also via direct URL).
        if (s.bannedMarketIds.includes(marketId)) return null;
        const market = s.getMarketById(marketId);
        if (!market || market.status === 'resolved') return null;
        // v7 — the same gate the server applies (`place_trade`) and the trade
        // panel shows: a feed market is closed when its SOURCE closes it, a
        // community market when its own end date passes. The old
        // `ended && !isInPlay` rule rejected live games and stale-dated open
        // markets that cloud mode accepts.
        if (isMarketClosed(market)) return null;
        if (!(amount > 0) || amount > s.balance) return null;

        const fill = applyTrade(market, side, amount);
        const price = side === 'yes' ? market.yesPrice : 1 - market.yesPrice;

        const override: MarketOverride = {
          yesPrice: fill.yesPrice,
          volume: fill.volume,
          liquidity: fill.liquidity,
          priceHistory: [...market.priceHistory, { t: Date.now(), yes: fill.yesPrice }],
          status: market.status,
          resolvedOutcome: market.resolvedOutcome,
        };

        // Merge into an existing position on the same market+side.
        const existing = s.positions.find(
          (p) => p.marketId === marketId && p.side === side
        );
        let positions: Position[];
        if (existing) {
          const shares = existing.shares + fill.shares;
          const avgPrice =
            (existing.avgPrice * existing.shares + price * fill.shares) / shares;
          positions = s.positions.map((p) =>
            p.id === existing.id ? { ...p, shares, avgPrice } : p
          );
        } else {
          positions = [
            {
              id: uid('pos'),
              marketId,
              side,
              shares: fill.shares,
              avgPrice: price,
              createdAt: new Date().toISOString(),
            },
            ...s.positions,
          ];
        }

        const newBalance = Math.round((s.balance - amount) * 100) / 100;
        set({
          balance: newBalance,
          positions,
          marketOverrides: { ...s.marketOverrides, [marketId]: override },
        });
        // Local mode has no pool and no fee: the legacy applyTrade() fills
        // the whole order at the tick, so avgPrice IS the tick and fee is 0.
        return { shares: fill.shares, avgPrice: price, fee: 0 };
      },

      sell: (marketId, side, shares) => {
        const s = get();
        // No sell_rpc exists (v4 is buy-only) — a local settle would be a
        // forged balance the server never agreed to.
        if (cloudActive(s)) return null;
        if (currentUserBanned(s)) return null;
        // Banned markets are delisted AND untradeable (also via direct URL).
        if (s.bannedMarketIds.includes(marketId)) return null;
        const market = s.getMarketById(marketId);
        if (!market || market.status !== 'open') return null;
        // Same trade window as buys — see the note in `trade()`.
        if (isMarketClosed(market)) return null;
        if (!(shares > 0)) return null;

        const pos = s.positions.find(
          (p) => p.marketId === marketId && p.side === side
        );
        // Tiny epsilon so "sell all" isn't rejected by float noise.
        if (!pos || shares > pos.shares + 1e-9) return null;

        const fill = applySell(market, side, Math.min(shares, pos.shares));
        const proceeds = Math.round(fill.proceeds * 100) / 100;
        const remaining = pos.shares - shares;
        const positions =
          remaining > 1e-6
            ? s.positions.map((p) =>
                p.id === pos.id ? { ...p, shares: remaining } : p
              )
            : s.positions.filter((p) => p.id !== pos.id);

        const override: MarketOverride = {
          yesPrice: fill.yesPrice,
          volume: fill.volume,
          liquidity: fill.liquidity,
          priceHistory: [
            ...market.priceHistory,
            { t: Date.now(), yes: fill.yesPrice },
          ],
          status: market.status,
          resolvedOutcome: market.resolvedOutcome,
        };

        const newBalance = Math.round((s.balance + proceeds) * 100) / 100;
        set({
          balance: newBalance,
          positions,
          marketOverrides: { ...s.marketOverrides, [marketId]: override },
        });
        return { proceeds };
      },

      resolveMarket: async (marketId, outcome) => {
        const s = get();

        if (cloudActive(s)) {
          // v8: ADMIN-ONLY and FREE server-side (resolve_market_rpc raises
          // 'Admin only' for everyone else — the creator self-resolve path
          // and its $10 fee are gone). Flips the market and pays EVERY
          // winning holder $1/share — a client could only ever pay itself.
          const res = await resolveMarketCloud(marketId, outcome);
          if (!res.ok) {
            set({ lastActionError: res.error ?? null });
            return false;
          }
          set({ lastActionError: null });
          await Promise.all([get().refreshProfile(), get().refreshPositions()]);
          notifySharedBookChanged();
          return true;
        }

        set({ lastActionError: null });
        // v8: same admin gate as the server. Local demo mode mirrors the
        // product rule — no user self-resolves anything, no fee anywhere.
        if (!s.user?.isAdmin) {
          set({ lastActionError: 'Admin only' });
          return false;
        }
        const market = s.getMarketById(marketId);
        if (!market || market.status === 'resolved') return false;

        // Winning positions pay out $1 per share; all positions on this
        // market are then settled (removed).
        const payout = s.positions
          .filter((p) => p.marketId === marketId && p.side === outcome)
          .reduce((sum, p) => sum + p.shares, 0);

        const override: MarketOverride = {
          yesPrice: outcome === 'yes' ? 0.99 : 0.01,
          volume: market.volume,
          liquidity: market.liquidity,
          priceHistory: [
            ...market.priceHistory,
            { t: Date.now(), yes: outcome === 'yes' ? 0.99 : 0.01 },
          ],
          status: 'resolved',
          resolvedOutcome: outcome,
        };

        const newBalance = Math.round((s.balance + payout) * 100) / 100;
        set({
          balance: newBalance,
          positions: s.positions.filter((p) => p.marketId !== marketId),
          marketOverrides: { ...s.marketOverrides, [marketId]: override },
        });
        return true;
      },

      castVote: async (marketId, side) => {
        const s = get();

        if (cloudActive(s)) {
          // Ballots live in `community_votes`; the RPC enforces
          // ended + unresolved + community-resolution + one-per-user.
          const res = await castVoteCloud(marketId, side);
          set({ lastActionError: res.ok ? null : (res.error ?? null) });
          return res.ok;
        }

        set({ lastActionError: null });
        if (!s.user) return false;
        const market = s.getMarketById(marketId);
        if (!market || market.resolution !== 'community') return false;
        if (market.status !== 'open') return false; // already resolved
        // Community markets only — we own the deadline, so this is
        // `endDate <= now`; routed through the shared predicate regardless.
        if (!isMarketClosed(market)) return false; // voting opens once it ends
        const ballots = {
          ...(s.communityVotes[marketId] ?? {}),
          [s.user.email]: side, // re-vote replaces
        };
        set({ communityVotes: { ...s.communityVotes, [marketId]: ballots } });
        return true;
      },

      getVoteTally: (marketId) => {
        // Cloud ballots are in the DB, not here — fetchMarketVotes() is
        // the cloud read (async, so it can't be this selector).
        if (cloudActive(get())) return { yes: 0, no: 0 };
        const ballots = get().communityVotes[marketId] ?? {};
        let yes = 0;
        let no = 0;
        for (const side of Object.values(ballots)) {
          if (side === 'yes') yes += 1;
          else no += 1;
        }
        return { yes, no };
      },

      finalizeCommunityMarket: async (marketId) => {
        const s = get();

        if (cloudActive(s)) {
          // v8 — the ADMIN CONFIRMATION step. The server counts the
          // ballots, settles, pays out, and banks the $10 confirmation fee
          // from the market's own pot (capped by what the pot holds — the
          // returned `fee` is what was actually taken; surface it via
          // `lastFinalizeFee`). Raises 'No majority yet — cannot finalize'
          // on a tie/empty box — surfaced via lastActionError, market
          // stays open.
          const res = await finalizeCommunityCloud(marketId);
          if (!res.ok) {
            set({ lastActionError: res.error ?? null });
            return false;
          }
          set({ lastActionError: null, lastFinalizeFee: res.fee ?? 0 });
          await Promise.all([get().refreshProfile(), get().refreshPositions()]);
          notifySharedBookChanged();
          return true;
        }

        set({ lastActionError: null });
        if (!s.user?.isAdmin) {
          set({ lastActionError: 'Admin only' });
          return false;
        }
        const market = s.getMarketById(marketId);
        if (!market || market.resolution !== 'community') return false;
        if (market.status !== 'open') return false;
        const { yes, no } = s.getVoteTally(marketId);
        if (yes === no) {
          // tie (incl. zero votes) -> no action, same wording as the RPC
          set({ lastActionError: 'No majority yet — cannot finalize' });
          return false;
        }
        // Local mode has no pool and no platform till — no fee is charged
        // (lastFinalizeFee stays null; the $10 is a cloud-economy fact).
        return s.resolveMarket(marketId, yes > no ? 'yes' : 'no');
      },

      addCategory: (label) => {
        const lb = label.trim();
        const value = slugifyCategory(lb);
        if (!lb || !value) return false;
        const s = get();
        const taken =
          CATEGORIES.some((c) => c.value === value) ||
          s.customCategories.some((c) => c.value === value);
        if (taken) return false;
        set({ customCategories: [...s.customCategories, { value, label: lb }] });
        return true;
      },

      removeCategory: (value) =>
        set((s) => ({
          customCategories: s.customCategories.filter((c) => c.value !== value),
        })),

      // v14 — the API ships feed markets WITHOUT their decorative price
      // history (it was half the payload); regenerate it here, once per
      // ingest. Deterministic from (id, yesPrice), so every client draws
      // the same curve. Mock/local rows arrive with a real history and are
      // left untouched.
      setPolymarkets: (data) => {
        const fill = (m: Market): Market =>
          m.priceHistory.length > 0
            ? m
            : { ...m, priceHistory: generatePriceHistory(m.id, m.yesPrice, 50, Date.now()) };
        set({
          poly: data.markets.map(fill),
          // `groups` hold their own serialized market copies (the event page
          // charts them) — fill those too, not just the flat outcome list.
          polyEvents: data.events.map((e) => ({
            ...e,
            markets: e.markets.map(fill),
            groups: e.groups?.map((g) => ({ ...g, markets: g.markets.map(fill) })),
          })),
          polyLoaded: true,
        });
      },
      applyFreshQuote: (marketId, yesPrice) => {
        const point = { t: Date.now(), yes: yesPrice };
        const patch = (m: Market): Market =>
          m.id === marketId
            ? { ...m, yesPrice, priceHistory: [...m.priceHistory, point] }
            : m;
        set((st) => ({
          poly: st.poly.map(patch),
          polyEvents: st.polyEvents.map((e) => ({
            ...e,
            markets: e.markets.map(patch),
            groups: e.groups?.map((g) => ({ ...g, markets: g.markets.map(patch) })),
          })),
        }));
      },

      setSearchQuery: (q) => set({ searchQuery: q }),
      setCategoryFilter: (c) => set({ categoryFilter: c }),
      setHomeTab: (t) => set({ homeTab: t }),
      openTradeModal: (marketId, side) => set({ tradeModal: { marketId, side } }),
      closeTradeModal: () => set({ tradeModal: null }),
      openAuthModal: (tab) => set({ authModal: tab }),
      closeAuthModal: () => set({ authModal: null }),

      getMarketById: (id) => {
        const s = get();
        // Cloud feed: the shared book replaces userMarkets+seedMarkets and
        // is already authoritative (no local overrides are applied to it —
        // the server owns those markets' economics).
        if (cloudFeed) {
          const cloud = s.cloudMarkets.find((m) => m.id === id);
          if (cloud) return cloud;
          const feed =
            s.poly.find((m) => m.id === id) ??
            s.polyEvents.flatMap((e) => e.markets).find((m) => m.id === id);
          return feed ? mergeMarket(feed, s.marketOverrides[id]) : undefined;
        }
        const base =
          s.userMarkets.find((m) => m.id === id) ??
          seedMarkets.find((m) => m.id === id) ??
          s.poly.find((m) => m.id === id) ??
          s.polyEvents.flatMap((e) => e.markets).find((m) => m.id === id);
        return base ? mergeMarket(base, s.marketOverrides[id]) : undefined;
      },

      /* ----- auth ----- */

      signUp: async (email, username, pass, refCode) => {
        const em = email.trim().toLowerCase();
        const un = username.trim();
        const ref = refCode?.trim() || undefined;
        if (!em || !un || !pass) return { ok: false, error: 'All fields are required.' };

        if (supabase) {
          try {
            const { data, error } = await supabase.auth.signUp({
              email: em,
              password: pass,
              // Read by the handle_new_user() trigger, which creates the
              // profiles row server-side. Passing it here is what makes the
              // chosen username survive the email-confirmation flow (where
              // the client has no session yet and cannot insert the row).
              // v10: ref_code rides along the same way — the trigger
              // resolves it to profiles.referred_by (invalid codes are
              // silently ignored server-side).
              options: { data: { username: un, ...(ref ? { ref_code: ref } : {}) } },
            });
            if (error) {
              const msg = error.message.toLowerCase();
              if (msg.includes('fetch') || msg.includes('network')) {
                return { ok: false, error: AUTH_UNREACHABLE };
              }
              if (msg.includes('already')) {
                return { ok: false, error: 'An account with this email already exists.' };
              }
              return { ok: false, error: error.message };
            }
            // v5: the `profiles` upsert that used to live here is GONE.
            // An upsert needs UPDATE on every column in its SET list, and
            // section 7b revokes UPDATE on profiles down to `username` —
            // so it could only ever error. It was already dead code: the
            // handle_new_user() trigger creates the row server-side from
            // the `username` passed in options.data above.
            if (!data.session) {
              // Email confirmation enabled — account created, no session
              // yet. Do NOT set a user; the UI shows an info toast instead.
              return { ok: true, info: 'Check your email to confirm your account.' };
            }
            const confirmedEmail = data.user?.email?.toLowerCase() ?? em;
            let isAdmin = isAdminEmail(confirmedEmail);
            // Cloud profile is the balance source of truth (v4) — a fresh
            // account starts at the DB default (0). Best-effort load.
            const prof = await fetchMyProfile();
            if (prof) {
              if (prof.isAdmin) isAdmin = true;
              set({ balance: prof.balance });
            }
            set({
              user: { email: confirmedEmail, username: un, isAdmin },
            });
            return { ok: true };
          } catch {
            return { ok: false, error: AUTH_UNREACHABLE };
          }
        }

        // Local demo mode — plaintext credential store, DEMO ONLY.
        if (get().localUsers.some((u) => u.email === em)) {
          return { ok: false, error: 'An account with this email already exists.' };
        }
        const unLower = un.toLowerCase();
        if (get().localUsers.some((u) => u.username.toLowerCase() === unLower)) {
          return { ok: false, error: 'Username already taken' };
        }
        set((s) => ({
          localUsers: [...s.localUsers, { email: em, username: un, pass, banned: false }],
          user: { email: em, username: un, isAdmin: isAdminEmail(em) },
        }));
        return { ok: true };
      },

      signIn: async (email, pass) => {
        const em = email.trim().toLowerCase();
        if (!em || !pass) return { ok: false, error: 'Email and password are required.' };

        if (supabase) {
          try {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: em,
              password: pass,
            });
            if (error) {
              const msg = error.message.toLowerCase();
              if (msg.includes('fetch') || msg.includes('network')) {
                return { ok: false, error: AUTH_UNREACHABLE };
              }
              if (msg.includes('confirm')) {
                return { ok: false, error: 'Email not confirmed yet' };
              }
              if (msg.includes('invalid') || msg.includes('credential')) {
                return { ok: false, error: 'Invalid credentials' };
              }
              return { ok: false, error: error.message };
            }
            let username = em.split('@')[0] ?? em;
            let isAdmin = isAdminEmail(em);
            if (data.user?.id) {
              // Profile load is best-effort — fall back to email-derived
              // username when the row is missing or RLS blocks the read.
              // In cloud mode the profile balance is the source of truth.
              const prof = await fetchMyProfile();
              if (prof?.banned) {
                await supabase.auth.signOut();
                return { ok: false, error: 'This account is banned.' };
              }
              if (prof) {
                if (prof.username) username = prof.username;
                if (prof.isAdmin) isAdmin = true;
                set({ balance: prof.balance });
              }
            }
            set({ user: { email: em, username, isAdmin } });
            return { ok: true };
          } catch {
            return { ok: false, error: AUTH_UNREACHABLE };
          }
        }

        const local = get().localUsers.find((u) => u.email === em);
        if (!local || local.pass !== pass) {
          return { ok: false, error: 'Invalid email or password.' };
        }
        if (local.banned) return { ok: false, error: 'This account is banned.' };
        set({ user: { email: em, username: local.username, isAdmin: isAdminEmail(em) } });
        return { ok: true };
      },

      signOut: () => {
        if (supabase) void supabase.auth.signOut();
        // Drop the server-owned book with the session — it belongs to the
        // account that just left, not to the next one.
        set({ user: null, cloudPositions: [], lastActionError: null, lastFinalizeFee: null });
      },

      refreshProfile: async () => {
        const s = get();
        if (!supabase || !s.user) return;
        const prof = await fetchMyProfile();
        if (!prof) return; // network/RLS hiccup — keep local state
        if (prof.banned) {
          // Banned mid-session: mirror the signIn rejection.
          void supabase.auth.signOut();
          set({ user: null });
          return;
        }
        set({
          balance: prof.balance,
          user: {
            ...s.user,
            username: prof.username || s.user.username,
            isAdmin: prof.isAdmin || isAdminEmail(s.user.email),
          },
        });
      },

      refreshPositions: async () => {
        if (!cloudActive(get())) return;
        const positions = await fetchMyPositions();
        set({ cloudPositions: positions });
      },

      refreshCommunityMarkets: async () => {
        if (!cloudFeed) return;
        const snap = await fetchMarketsSnapshot();
        if (!snap) {
          // The read failed (offline, schema not applied yet, RLS). Keep
          // the last good book — but ALWAYS release the loading gate:
          // the community book must never be able to hold the Polymarket
          // feed hostage. A broken DB costs you community markets, not
          // the whole site.
          set({ cloudMarketsLoaded: true });
          return;
        }
        set({
          cloudMarkets: snap.markets,
          cloudBannedIds: snap.bannedIds,
          cloudMarketsLoaded: true,
        });
      },

      refreshPlatformSettings: async () => {
        // Public row (anon-readable) — the FEED branch, not the money one:
        // guests see the trade panel and its fee line too.
        if (!cloudFeed) return;
        if (platformSettingsInFlight) {
          await platformSettingsInFlight;
          return;
        }
        const load = (async () => {
          // The split rides along with the config it describes, so the fee
          // line never renders a total without the breakdown behind it.
          const [cfg, split] = await Promise.all([
            fetchPlatformSettings(),
            fetchFeeSplit(),
          ]);
          // A failed read keeps the last good config (null on first load —
          // consumers fall back to the documented defaults).
          if (cfg) set({ platformSettings: { ...cfg, ...split } });
        })();
        platformSettingsInFlight = load;
        try {
          await load;
        } finally {
          platformSettingsInFlight = null;
        }
      },

      /* ----- deposits (async dual-mode, v4) ----- */

      requestDeposit: async (currency, amount, txHash) => {
        const amt = Math.round(amount * 100) / 100;
        if (!(amt > 0)) return { ok: false, error: 'Enter a positive amount.' };
        const s = get();
        if (cloudActive(s)) {
          // Server inserts the pending row for auth.uid() — visible to
          // the admin via fetchAllPayments (lib/cloud.ts).
          return requestDepositCloud(currency, amt, txHash?.trim() || undefined);
        }
        const deposit: Deposit = {
          id: uid('dep'),
          currency,
          amount: amt,
          txHash: txHash?.trim() || undefined,
          status: 'pending',
          createdAt: new Date().toISOString(),
          userEmail: s.user?.email,
        };
        set((st) => ({ deposits: [deposit, ...st.deposits] }));
        return { ok: true };
      },

      approveDeposit: async (id) => {
        const s = get();
        if (cloudActive(s)) {
          // RPC credits the TARGET user's cloud balance — that user may
          // not be the admin, so the local balance stays untouched. If
          // the admin approved their OWN deposit, refreshProfile picks
          // the new balance up.
          const res = await approveDepositCloud(id);
          if (res.ok) void get().refreshProfile();
          return res;
        }
        const d = s.deposits.find((x) => x.id === id);
        if (!d || d.status !== 'pending') {
          return { ok: false, error: 'Deposit is not pending.' };
        }
        set((st) => ({
          deposits: st.deposits.map((x) =>
            x.id === id ? { ...x, status: 'approved' as const } : x
          ),
          balance: Math.round((st.balance + d.amount) * 100) / 100,
        }));
        return { ok: true };
      },

      rejectDeposit: async (id) => {
        const s = get();
        if (cloudActive(s)) {
          return rejectDepositCloud(id);
        }
        const d = s.deposits.find((x) => x.id === id);
        if (!d || d.status !== 'pending') {
          return { ok: false, error: 'Deposit is not pending.' };
        }
        set((st) => ({
          deposits: st.deposits.map((x) =>
            x.id === id ? { ...x, status: 'rejected' as const } : x
          ),
        }));
        return { ok: true };
      },

      /* ----- withdrawals (async dual-mode, v4) ----- */

      requestWithdrawal: async (currency, amount, address) => {
        const s = get();
        if (!s.user) return { ok: false, error: 'Sign in to withdraw.' };
        const addr = address.trim();
        if (!addr) return { ok: false, error: 'Enter a destination address.' };
        const amt = Math.round(amount * 100) / 100;
        if (!(amt > 0)) return { ok: false, error: 'Enter a positive amount.' };
        if (cloudActive(s)) {
          // Server reserves the amount atomically (balance check + deduct
          // in the RPC) — do NOT deduct locally too. refreshProfile pulls
          // the post-reserve balance in.
          const res = await requestWithdrawalCloud(currency, amt, addr);
          if (res.ok) {
            // v8 — the withdrawal starts UNCONFIRMED: trigger the
            // confirmation email through the server route (which holds the
            // token; the client never sees it). Fire-and-forget: a failed
            // send only leaves the row unconfirmed, and the wallet page can
            // resend. Without RESEND_API_KEY the route auto-confirms
            // (documented graceful degradation).
            if (res.id) void sendWithdrawalConfirmation(res.id);
            await get().refreshProfile();
          }
          // Strip the id — callers get the plain CloudResult contract.
          return { ok: res.ok, error: res.error };
        }
        if (amt > s.balance) {
          return { ok: false, error: 'Amount exceeds your balance.' };
        }
        const withdrawal: Withdrawal = {
          id: uid('wd'),
          currency,
          amount: amt,
          address: addr,
          status: 'pending',
          createdAt: new Date().toISOString(),
          userEmail: s.user.email,
        };
        // Reserve the funds immediately — a rejection refunds them.
        set({
          withdrawals: [withdrawal, ...s.withdrawals],
          balance: Math.round((s.balance - amt) * 100) / 100,
        });
        return { ok: true };
      },

      approveWithdrawal: async (id) => {
        const s = get();
        if (cloudActive(s)) {
          // Funds were reserved on request — approval only flips status.
          return approveWithdrawalCloud(id);
        }
        const w = s.withdrawals.find((x) => x.id === id);
        if (!w || w.status !== 'pending') {
          return { ok: false, error: 'Withdrawal is not pending.' };
        }
        set((st) => ({
          withdrawals: st.withdrawals.map((x) =>
            x.id === id ? { ...x, status: 'approved' as const } : x
          ),
        }));
        return { ok: true };
      },

      rejectWithdrawal: async (id) => {
        const s = get();
        if (cloudActive(s)) {
          // RPC refunds the TARGET user's reserve server-side — local
          // balance untouched; refreshProfile covers a self-rejection.
          const res = await rejectWithdrawalCloud(id);
          if (res.ok) void get().refreshProfile();
          return res;
        }
        const w = s.withdrawals.find((x) => x.id === id);
        if (!w || w.status !== 'pending') {
          return { ok: false, error: 'Withdrawal is not pending.' };
        }
        set((st) => ({
          withdrawals: st.withdrawals.map((x) =>
            x.id === id ? { ...x, status: 'rejected' as const } : x
          ),
          balance: Math.round((st.balance + w.amount) * 100) / 100,
        }));
        return { ok: true };
      },

      /* ----- chat ----- */

      addChatMessage: (marketId, text) => {
        const t = text.trim();
        if (!t) return;
        set((s) => {
          const msg: ChatMessage = {
            id: uid('msg'),
            marketId,
            author: s.user?.username ?? 'guest',
            text: t,
            createdAt: new Date().toISOString(),
          };
          const list = [...(s.chat[marketId] ?? []), msg].slice(-200);
          return { chat: { ...s.chat, [marketId]: list } };
        });
      },

      /* ----- admin ----- */

      banMarket: async (id) => {
        const s = get();

        if (cloudActive(s)) {
          // ban_market_rpc refunds EVERY holder at cost server-side and
          // flips markets.banned (so the market disappears from all
          // clients' feeds, not just this admin's).
          const res = await banMarketCloud(id, true);
          if (!res.ok) return res;
          await Promise.all([get().refreshProfile(), get().refreshPositions()]);
          notifySharedBookChanged();
          return res;
        }

        // Local: refund this browser's positions at cost and settle them.
        const refund = s.positions
          .filter((p) => p.marketId === id)
          .reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
        set({
          bannedMarketIds: s.bannedMarketIds.includes(id)
            ? s.bannedMarketIds
            : [...s.bannedMarketIds, id],
          positions: s.positions.filter((p) => p.marketId !== id),
          balance: Math.round((s.balance + refund) * 100) / 100,
        });
        return { ok: true };
      },

      unbanMarket: async (id) => {
        if (cloudActive(get())) {
          const res = await banMarketCloud(id, false);
          if (res.ok) notifySharedBookChanged();
          return res;
        }
        set((s) => ({ bannedMarketIds: s.bannedMarketIds.filter((x) => x !== id) }));
        return { ok: true };
      },

      banUser: (email, userId) => {
        set((s) => ({
          localUsers: s.localUsers.map((u) =>
            u.email === email ? { ...u, banned: true } : u
          ),
        }));
        // Cloud: the admin RPC is the ONLY path (v5 revoked the client's
        // UPDATE on profiles, so the old email-matched fallback could
        // only fail). Admin UI must pass userId from fetchAllProfiles().
        if (supabase && userId) void setUserBannedCloud(userId, true);
      },

      unbanUser: (email, userId) => {
        set((s) => ({
          localUsers: s.localUsers.map((u) =>
            u.email === email ? { ...u, banned: false } : u
          ),
        }));
        if (supabase && userId) void setUserBannedCloud(userId, false);
      },

      adjustBalance: (delta) => {
        const s = get();
        // Cloud: the balance is server-owned and the client's UPDATE on
        // profiles is revoked — writing it locally would just desync the
        // UI from the truth until the next refreshProfile(). Fund cloud
        // accounts through an approved deposit instead.
        if (cloudActive(s)) return;
        set({
          balance: Math.max(0, Math.round((s.balance + delta) * 100) / 100),
        });
      },
    }),
    {
      name: 'callit-store-v1',
      version: 2,
      // SSR safety: hydrate manually after mount (see StoreHydration).
      skipHydration: true,
      // v3 "real economy" reset: every pre-v2 client starts fresh at
      // START_BALANCE with no positions/overrides/deposits/withdrawals.
      // Accounts, chat, own markets, bans and UI prefs are kept.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          delete s.adminUnlocked; // password gate removed in v3
          return {
            ...s,
            balance: START_BALANCE,
            positions: [],
            marketOverrides: {},
            deposits: [],
            withdrawals: [],
            communityVotes: {},
            customCategories: [],
          } as unknown as PersistedCallitState;
        }
        return s as unknown as PersistedCallitState;
      },
      partialize: partializeStore,
    }
  )
);
