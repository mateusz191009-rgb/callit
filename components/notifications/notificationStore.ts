'use client';

import {
  fetchMarketSummaries,
  fetchPaymentsSnapshot,
  fetchPositionsSnapshot,
  type PaymentStatusRow,
} from '@/lib/history';
import { formatMoney } from '@/lib/format';
import type { Side } from '@/lib/types';

/**
 * Client-derived notifications — no schema changes, no new tables.
 *
 * There is no notifications table and nothing pushes to the client, so
 * events are DERIVED by diffing two snapshots of what the user can already
 * read: their own payments and their own positions. Three transitions are
 * worth telling someone about:
 *
 *   1. a deposit of theirs flipped pending -> approved/rejected
 *   2. a withdrawal of theirs flipped
 *   3. a market they held a position in resolved — a payout DELETES the
 *      position rows, so "the position is gone AND the market now reads
 *      resolved" is the only client-visible trace of a settlement
 *
 * State lives in localStorage rather than the zustand store because
 * lib/store.ts belongs to another agent; a module-level store +
 * `useSyncExternalStore` gives the same subscribe semantics without
 * touching it.
 *
 * The BASELINE is persisted alongside the notifications on purpose. Diffing
 * against an in-memory-only baseline would mean seeding it fresh on every
 * reload, and a deposit approved while the tab was closed — the common case
 * — would never be noticed. Persisting it means the first poll after a
 * reload still sees the flip. The flip side is that the very first run for
 * an account has nothing to diff against: it seeds silently and stays
 * quiet, which is the right trade (an empty bell beats replaying a year of
 * history as "new").
 */

export type NotificationKind = 'deposit' | 'withdrawal' | 'resolution';

/** Maps to the Badge/token palette: green = good, sky = No side, danger =
 *  rejected, neutral = informational. */
export type NotificationTone = 'green' | 'sky' | 'danger' | 'neutral';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  title: string;
  body: string;
  /** ISO time the event was DETECTED — the flip itself is not timestamped
   *  anywhere (only the request's `created_at` is, which would read as
   *  days-old news the moment an admin approves it). */
  createdAt: string;
  href: string;
}

/** What the bell renders. `unreadCount` is derived on write so the badge
 *  never recomputes it during render. */
export interface NotificationState {
  notifications: AppNotification[];
  seenIds: string[];
  unreadCount: number;
}

/** The diff baseline: id -> status for payments, `marketId|side` -> shares
 *  for positions. */
interface Snapshot {
  deposits: Record<string, string>;
  withdrawals: Record<string, string>;
  positions: Record<string, number>;
}

interface PersistedState {
  v: 1;
  /** Which account the notifications + baseline belong to (email). A
   *  different account wipes both — one browser, many users. */
  userKey: string | null;
  notifications: AppNotification[];
  seenIds: string[];
  snapshot: Snapshot | null;
}

const STORAGE_KEY = 'callit-notifications-v1';
const MAX_NOTIFICATIONS = 20;
const POLL_MS = 30_000;

const EMPTY_STATE: NotificationState = { notifications: [], seenIds: [], unreadCount: 0 };

const EMPTY_PERSISTED: PersistedState = {
  v: 1,
  userKey: null,
  notifications: [],
  seenIds: [],
  snapshot: null,
};

/* ------------------------------------------------------------------ */
/* module store                                                        */
/* ------------------------------------------------------------------ */

let persisted: PersistedState = EMPTY_PERSISTED;
let publicState: NotificationState = EMPTY_STATE;
let loaded = false;

const listeners = new Set<() => void>();

function derivePublic(p: PersistedState): NotificationState {
  const seen = new Set(p.seenIds);
  return {
    notifications: p.notifications,
    seenIds: p.seenIds,
    unreadCount: p.notifications.reduce((n, item) => (seen.has(item.id) ? n : n + 1), 0),
  };
}

function isNotification(value: unknown): value is AppNotification {
  if (!value || typeof value !== 'object') return false;
  const n = value as Partial<AppNotification>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.body === 'string' &&
    typeof n.createdAt === 'string' &&
    typeof n.href === 'string'
  );
}

/** Read localStorage once, lazily. Anything unparseable is discarded — a
 *  corrupt bell must never take the topbar down with it. */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed || parsed.v !== 1) return;
    persisted = {
      v: 1,
      userKey: typeof parsed.userKey === 'string' ? parsed.userKey : null,
      notifications: Array.isArray(parsed.notifications)
        ? parsed.notifications.filter(isNotification).slice(0, MAX_NOTIFICATIONS)
        : [],
      seenIds: Array.isArray(parsed.seenIds)
        ? parsed.seenIds.filter((id): id is string => typeof id === 'string')
        : [],
      snapshot:
        parsed.snapshot && typeof parsed.snapshot === 'object'
          ? (parsed.snapshot as Snapshot)
          : null,
    };
    publicState = derivePublic(persisted);
  } catch {
    persisted = EMPTY_PERSISTED;
    publicState = EMPTY_STATE;
  }
}

function commitPersisted(next: PersistedState): void {
  persisted = next;
  publicState = derivePublic(next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota/private mode — notifications simply do not survive a reload.
    }
  }
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A broken listener must never break the poll that fired it.
    }
  }
}

export function subscribeNotifications(fn: () => void): () => void {
  ensureLoaded();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getNotificationState(): NotificationState {
  ensureLoaded();
  return publicState;
}

/** Server + hydration snapshot: always empty, so SSR and the first client
 *  render agree and localStorage can never cause a hydration mismatch. */
export function getServerNotificationState(): NotificationState {
  return EMPTY_STATE;
}

export function markAllNotificationsRead(): void {
  ensureLoaded();
  if (persisted.notifications.length === 0) return;
  commitPersisted({ ...persisted, seenIds: persisted.notifications.map((n) => n.id) });
}

/* ------------------------------------------------------------------ */
/* derivation                                                          */
/* ------------------------------------------------------------------ */

function posKey(marketId: string, side: Side): string {
  return `${marketId}|${side}`;
}

function parsePosKey(key: string): { marketId: string; side: Side } {
  const at = key.lastIndexOf('|');
  if (at === -1) return { marketId: key, side: 'yes' };
  return { marketId: key.slice(0, at), side: key.slice(at + 1) === 'no' ? 'no' : 'yes' };
}

function sideLabel(side: Side): string {
  return side === 'yes' ? 'Yes' : 'No';
}

function paymentNotification(
  row: PaymentStatusRow,
  kind: 'deposit' | 'withdrawal',
  at: string
): AppNotification {
  const money = `${formatMoney(row.amount)} ${row.currency}`.trim();
  const approved = row.status === 'approved';
  const body =
    kind === 'deposit'
      ? approved
        ? `${money} was credited to your balance.`
        : `${money} was not credited. Contact support if that looks wrong.`
      : approved
        ? `${money} is on its way to your address.`
        : `${money} was refunded to your balance.`;
  return {
    id: `${kind === 'deposit' ? 'dep' : 'wd'}-${row.id}-${row.status}`,
    kind,
    tone: approved ? 'green' : 'danger',
    title: `${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} ${approved ? 'approved' : 'rejected'}`,
    body,
    createdAt: at,
    href: '/wallet',
  };
}

/** pending -> approved/rejected on the user's own payment rows. */
function derivePaymentEvents(
  prev: Snapshot,
  deposits: PaymentStatusRow[],
  withdrawals: PaymentStatusRow[],
  at: string
): AppNotification[] {
  const out: AppNotification[] = [];
  for (const d of deposits) {
    if (prev.deposits[d.id] === 'pending' && d.status !== 'pending') {
      out.push(paymentNotification(d, 'deposit', at));
    }
  }
  for (const w of withdrawals) {
    if (prev.withdrawals[w.id] === 'pending' && w.status !== 'pending') {
      out.push(paymentNotification(w, 'withdrawal', at));
    }
  }
  return out;
}

/**
 * Positions that disappeared since the last snapshot, reconstructed into
 * "your market resolved" from the baseline's shares + the market's row.
 *
 * A position also vanishes when an admin BANS a market (the RPC refunds
 * every holder at cost and clears the book), so a settled `markets.status`
 * is required before anything is claimed about a payout.
 */
async function deriveResolutionEvents(
  prev: Snapshot,
  next: Snapshot,
  at: string
): Promise<AppNotification[]> {
  const vanished = Object.keys(prev.positions).filter((key) => !(key in next.positions));
  if (vanished.length === 0) return [];

  const summaries = await fetchMarketSummaries(
    vanished.map((key) => parsePosKey(key).marketId)
  );

  const out: AppNotification[] = [];
  for (const key of vanished) {
    const { marketId, side } = parsePosKey(key);
    const summary = summaries.get(marketId);
    if (!summary || summary.status !== 'resolved' || !summary.resolvedOutcome) continue;
    const shares = prev.positions[key] ?? 0;
    const won = summary.resolvedOutcome === side;
    const question = summary.question || 'A market you traded';
    out.push({
      id: `res-${marketId}-${side}`,
      kind: 'resolution',
      tone: won ? 'green' : 'neutral',
      title: `Market resolved — ${sideLabel(summary.resolvedOutcome)}`,
      body: won
        ? `${question} — your ${shares.toFixed(2)} ${sideLabel(side)} shares paid out ${formatMoney(shares)}.`
        : `${question} — your ${shares.toFixed(2)} ${sideLabel(side)} shares did not pay out.`,
      createdAt: at,
      href: `/market/${encodeURIComponent(marketId)}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* sync engine                                                         */
/* ------------------------------------------------------------------ */

type FreshHandler = (items: AppNotification[]) => void;

const freshHandlers = new Set<FreshHandler>();

let activeUserKey: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function toSnapshot(
  deposits: PaymentStatusRow[],
  withdrawals: PaymentStatusRow[],
  positions: { marketId: string; side: Side; shares: number }[]
): Snapshot {
  const snap: Snapshot = { deposits: {}, withdrawals: {}, positions: {} };
  for (const d of deposits) snap.deposits[d.id] = d.status;
  for (const w of withdrawals) snap.withdrawals[w.id] = w.status;
  for (const p of positions) snap.positions[posKey(p.marketId, p.side)] = p.shares;
  return snap;
}

async function poll(userKey: string): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const [payments, positions] = await Promise.all([
      fetchPaymentsSnapshot(),
      fetchPositionsSnapshot(),
    ]);
    // A FAILED read must never advance the baseline: an empty result would
    // be indistinguishable from "everything vanished", and committing it
    // would silently swallow the very flips this exists to catch.
    if (!payments.ok || !positions.ok) return;
    // Signed out or switched accounts while the reads were in flight.
    if (activeUserKey !== userKey || persisted.userKey !== userKey) return;

    const next = toSnapshot(payments.deposits, payments.withdrawals, positions.positions);
    const prev = persisted.snapshot;

    // First run for this account: seed the baseline, say nothing.
    if (!prev) {
      commitPersisted({ ...persisted, snapshot: next });
      return;
    }

    const at = new Date().toISOString();
    const fresh = [
      ...derivePaymentEvents(prev, payments.deposits, payments.withdrawals, at),
      ...(await deriveResolutionEvents(prev, next, at)),
    ];

    // The market lookup above is another round trip — re-check the account.
    if (activeUserKey !== userKey || persisted.userKey !== userKey) return;

    if (fresh.length === 0) {
      commitPersisted({ ...persisted, snapshot: next });
      return;
    }

    const known = new Set(persisted.notifications.map((n) => n.id));
    const added = fresh.filter((n) => !known.has(n.id));
    const notifications = [...added, ...persisted.notifications].slice(0, MAX_NOTIFICATIONS);
    const keep = new Set(notifications.map((n) => n.id));
    commitPersisted({
      ...persisted,
      notifications,
      // Prune seen ids to what is still listed, or the array grows forever.
      seenIds: persisted.seenIds.filter((id) => keep.has(id)),
      snapshot: next,
    });

    if (added.length > 0) {
      for (const fn of freshHandlers) {
        try {
          fn(added);
        } catch {
          // Toasting must never break the poll loop.
        }
      }
    }
  } finally {
    inFlight = false;
  }
}

/**
 * Start polling for the signed-in user. Returns an unsubscribe function.
 * Safe to call from several components — the interval is shared and only
 * cleared when the last subscriber leaves.
 *
 * `userKey` identifies the account (email): a change wipes the previous
 * account's notifications and baseline before the first poll.
 */
export function startNotificationSync(userKey: string, onFresh: FreshHandler): () => void {
  ensureLoaded();
  if (persisted.userKey !== userKey) {
    commitPersisted({ ...EMPTY_PERSISTED, userKey });
  }
  activeUserKey = userKey;
  freshHandlers.add(onFresh);
  void poll(userKey);
  if (!timer) {
    timer = setInterval(() => {
      if (activeUserKey) void poll(activeUserKey);
    }, POLL_MS);
  }
  return () => {
    freshHandlers.delete(onFresh);
    if (freshHandlers.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      activeUserKey = null;
    }
  };
}
