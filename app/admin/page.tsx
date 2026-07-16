'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Activity,
  Check,
  ChevronRight,
  CloudOff,
  RefreshCw,
  SearchX,
  ShieldCheck,
  TriangleAlert,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import EmptyState from '@/components/common/EmptyState';
import RevenuePanel from '@/components/admin/RevenuePanel';
import { mergeMarket, useCallitStore } from '@/lib/store';
import {
  fetchAllPayments,
  fetchAllProfiles,
  fetchMarketVotes,
  type CloudProfileRow,
} from '@/lib/cloud';
import { cloudFeedEnabled, useBannedMarketIds, usePositions } from '@/lib/useMarkets';
import { seedMarkets } from '@/lib/seed';
import { supabase, supabaseEnabled } from '@/lib/supabase';
import { walletFor } from '@/lib/wallets';
import { CATEGORIES } from '@/lib/types';
import { formatDate, formatMoney, isMarketClosed, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Deposit, Market, Side, Withdrawal } from '@/lib/types';

type AdminTab =
  | 'overview'
  | 'revenue'
  | 'users'
  | 'markets'
  | 'categories'
  | 'payments'
  | 'settings';

const TAB_ITEMS: TabItem<AdminTab>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'users', label: 'Users' },
  { value: 'markets', label: 'Markets' },
  { value: 'categories', label: 'Categories' },
  { value: 'payments', label: 'Payments' },
  { value: 'settings', label: 'Settings' },
];

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="text-xs font-bold uppercase tracking-wide text-tx-mut">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-black tabular-nums',
          accent === 'amber' ? 'text-amber' : 'text-tx'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn('px-4 py-3 font-bold', right ? 'text-right' : 'text-left')}>{children}</th>
  );
}

const ROW_CLASSES =
  'border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40';

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-8 text-center text-sm text-tx-mut">
      {children}
    </div>
  );
}

function Panel({ tab, children }: { tab: string; children: React.ReactNode }) {
  // Entrance only — no AnimatePresence exit (broken with React 19.2).
  return (
    <motion.div
      key={tab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="space-y-4"
    >
      {children}
    </motion.div>
  );
}

/** Pending rows first, then newest first — shared by all payment lists. */
function sortPendingFirst<
  T extends { status: 'pending' | 'approved' | 'rejected'; createdAt: string },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1;
    const pb = b.status === 'pending' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/* ------------------------------------------------------------------ */
/* Cloud (Supabase) shared bits                                        */
/* ------------------------------------------------------------------ */

function CloudTableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full rounded-xl" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px] text-tx">
      {children}
    </code>
  );
}

/**
 * A cloud read FAILED (as opposed to returning zero rows — that is an
 * empty state, not this). Prints the real Postgres message verbatim:
 * "check RLS/schema" with no message left the owner no way to tell a
 * missing trigger from a missing admin flag from a wrong URL.
 */
function CloudErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger/5 p-5">
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger"
        >
          <CloudOff className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold text-tx">Could not load from Supabase</h3>
          <p className="mt-1 text-sm text-tx-sec">
            The request reached Supabase and came back with an error. This is the exact
            message it returned:
          </p>
          <pre className="mt-3 select-text overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-3 p-3 font-mono text-xs text-danger">
            {error}
          </pre>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-tx-mut">
            Check, in order
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-tx-sec">
            <li>
              Re-run <Code>supabase/schema.sql</Code> in the Supabase SQL editor — it is
              idempotent and safe to run again.
            </li>
            <li>
              This account needs <Code>is_admin = true</Code> in <Code>profiles</Code> — see
              the bootstrap snippet at the bottom of the schema.
            </li>
            <li>
              Confirm <Code>.env.local</Code> uses the Project URL — not the Data API{' '}
              <Code>/rest/v1</Code> URL.
            </li>
          </ol>
          <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diagnostics (cloud mode, Users tab)                                 */
/* ------------------------------------------------------------------ */

interface DiagCheck {
  key: string;
  ok: boolean;
  label: string;
  value: string;
  note?: React.ReactNode;
}

function DiagRow({ ok, label, value, note }: Omit<DiagCheck, 'key'>) {
  return (
    <div className="flex items-start gap-3 border-b border-line/60 py-2.5 last:border-b-0">
      {ok ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green" aria-hidden />
      ) : (
        <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
            {label}
            <span className="sr-only">{ok ? ' — ok' : ' — problem'}</span>
          </span>
          <span
            className={cn(
              'select-text break-all font-mono text-xs',
              ok ? 'text-tx' : 'text-danger'
            )}
          >
            {value}
          </span>
        </div>
        {note && <p className="mt-1 text-xs text-tx-sec">{note}</p>}
      </div>
    </div>
  );
}

/**
 * What this account can actually SEE in Supabase — the block that would
 * have diagnosed the owner's outage in one glance.
 *
 * The profiles row is matched by email because the store only keeps
 * `AuthUser { email, username, isAdmin }`. Note that `user.isAdmin` can be
 * true from the ADMIN_EMAIL match alone while `profiles.is_admin` is
 * false — that combination passes this page's gate but makes RLS trim
 * every admin read to the own row, which is precisely the failure this
 * block has to name.
 */
function CloudDiagnostics({
  email,
  profiles,
  profilesError,
  payments,
  paymentsError,
}: {
  email: string;
  profiles: CloudProfileRow[];
  profilesError?: string;
  payments: { deposits: Deposit[]; withdrawals: Withdrawal[] } | null;
  paymentsError?: string;
}) {
  const checks = useMemo<DiagCheck[]>(() => {
    const key = email.trim().toLowerCase();
    const myRow = key
      ? (profiles.find((p) => p.email.trim().toLowerCase() === key) ?? null)
      : null;
    // A failed read tells us nothing about the row — never report it missing.
    const rowKnown = !profilesError;

    const list: DiagCheck[] = [
      {
        key: 'email',
        ok: Boolean(key),
        label: 'Signed in as',
        // `key` is only the lowercased match key — show the real address.
        value: email.trim() || 'not signed in',
      },
    ];

    if (!rowKnown) {
      list.push(
        {
          key: 'row',
          ok: false,
          label: 'Profiles row',
          value: 'unknown',
          note: 'The profiles read failed — the error below has the reason.',
        },
        { key: 'admin', ok: false, label: 'is_admin', value: 'unknown' }
      );
    } else if (myRow) {
      list.push({ key: 'row', ok: true, label: 'Profiles row', value: 'found' });
      list.push(
        myRow.isAdmin
          ? { key: 'admin', ok: true, label: 'is_admin', value: 'true' }
          : {
              key: 'admin',
              ok: false,
              label: 'is_admin',
              value: 'false',
              note: (
                <>
                  This account is not an admin in the database, so RLS hides every other
                  user&apos;s rows. Run{' '}
                  <Code>{`update profiles set is_admin = true where email = '${myRow.email}';`}</Code>
                </>
              ),
            }
      );
    } else {
      list.push(
        {
          key: 'row',
          ok: false,
          label: 'Profiles row',
          value: 'missing',
          note: 'No profiles row for this account — re-run supabase/schema.sql; the backfill creates it.',
        },
        {
          key: 'admin',
          ok: false,
          label: 'is_admin',
          value: 'n/a',
          note: 'Needs a profiles row first.',
        }
      );
    }

    list.push({
      key: 'profiles-count',
      ok: !profilesError,
      label: 'Profiles visible',
      value: profilesError ? 'read failed' : `${profiles.length} row(s)`,
    });

    const paymentsOk = !paymentsError && payments !== null;
    list.push(
      {
        key: 'deposits-count',
        ok: paymentsOk,
        label: 'Deposits visible',
        value: paymentsOk ? `${payments.deposits.length} row(s)` : 'read failed',
      },
      {
        key: 'withdrawals-count',
        ok: paymentsOk,
        label: 'Withdrawals visible',
        value: paymentsOk ? `${payments.withdrawals.length} row(s)` : 'read failed',
      }
    );

    return list;
  }, [email, profiles, profilesError, payments, paymentsError]);

  const failing = checks.some((c) => !c.ok);

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-tx-mut">
          <Activity className="h-4 w-4" aria-hidden />
          Diagnostics
        </h2>
        {failing ? (
          <Badge variant="danger">Needs attention</Badge>
        ) : (
          <Badge variant="green">All clear</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-tx-mut">
        What this account can actually read from Supabase right now.
      </p>
      <div className="mt-3">
        {checks.map((c) => (
          <DiagRow key={c.key} ok={c.ok} label={c.label} value={c.value} note={c.note} />
        ))}
      </div>
    </div>
  );
}

function CloudPanelHeader({
  hint,
  refreshing,
  onRefresh,
}: {
  hint: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-tx-mut">{hint}</p>
      <Button size="sm" variant="outline" loading={refreshing} onClick={onRefresh}>
        {!refreshing && <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        Refresh
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users tab — player intelligence                                     */
/* ------------------------------------------------------------------ */

interface UserRow {
  email: string;
  username: string;
  banned: boolean;
  isSession: boolean;
}

function UsersPanel({ rows }: { rows: UserRow[] }) {
  const banUser = useCallitStore((s) => s.banUser);
  const unbanUser = useCallitStore((s) => s.unbanUser);
  const balance = useCallitStore((s) => s.balance);
  const positions = usePositions();
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const deposits = useCallitStore((s) => s.deposits);
  const withdrawals = useCallitStore((s) => s.withdrawals);

  // Session-account position summary: count + total cost basis.
  const positionsSummary = useMemo(() => {
    const cost = positions.reduce((sum, p) => sum + p.shares * p.avgPrice, 0);
    return `${positions.length} · ${formatMoney(cost)}`;
  }, [positions]);

  // Markets launched per creator username (userMarkets are local creations).
  const marketsByCreator = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of userMarkets) {
      const key = m.createdBy ?? 'guest';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [userMarkets]);

  // Deposit / withdrawal USD totals per account email (rejected excluded —
  // those never moved the balance).
  const depositTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of deposits) {
      if (d.status === 'rejected' || !d.userEmail) continue;
      map.set(d.userEmail, (map.get(d.userEmail) ?? 0) + d.amount);
    }
    return map;
  }, [deposits]);

  const withdrawalTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of withdrawals) {
      if (w.status === 'rejected' || !w.userEmail) continue;
      map.set(w.userEmail, (map.get(w.userEmail) ?? 0) + w.amount);
    }
    return map;
  }, [withdrawals]);

  if (rows.length === 0) {
    return <EmptyPanel>No accounts yet — sign up from the topbar to create one.</EmptyPanel>;
  }

  const moneyOrDash = (n: number | undefined) => (n && n > 0 ? formatMoney(n) : '—');

  return (
    <>
      <TableShell>
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
          <tr>
            <Th>Email</Th>
            <Th>Username</Th>
            <Th right>Balance</Th>
            <Th right>Positions</Th>
            <Th right>Markets</Th>
            <Th right>Deposits</Th>
            <Th right>Withdrawals</Th>
            <Th>Joined</Th>
            <Th>Status</Th>
            <Th right>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.email} className={cn(ROW_CLASSES, u.banned && 'opacity-50')}>
              <td className="px-4 py-3 font-semibold text-tx">{u.email}</td>
              <td className="px-4 py-3 text-tx-sec">
                <span className="inline-flex items-center gap-2">
                  {u.username}
                  {u.isSession && <Badge variant="neutral">You</Badge>}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                {u.isSession ? formatMoney(balance) : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                {u.isSession ? positionsSummary : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                {marketsByCreator.get(u.username) ?? 0}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                {moneyOrDash(depositTotals.get(u.email))}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                {moneyOrDash(withdrawalTotals.get(u.email))}
              </td>
              <td className="px-4 py-3 text-tx-mut">—</td>
              <td className="px-4 py-3">
                {u.banned ? (
                  <Badge variant="danger">Banned</Badge>
                ) : (
                  <Badge variant="green">Active</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {u.banned ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      unbanUser(u.email);
                      toast.success('User unbanned.');
                    }}
                  >
                    Unban
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      banUser(u.email);
                      toast.success('User banned.');
                    }}
                  >
                    Ban
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <p className="text-xs text-tx-mut">
        Balance and positions are only visible for the account signed in on this device —
        other accounts keep their balances in their own browsers (local mode).
      </p>
    </>
  );
}

/** Cloud users — every Supabase profile row (fetchAllProfiles). */
function CloudUsersPanel({
  profiles,
  onBanChange,
}: {
  profiles: CloudProfileRow[];
  onBanChange: (id: string, banned: boolean) => void;
}) {
  const banUser = useCallitStore((s) => s.banUser);
  const unbanUser = useCallitStore((s) => s.unbanUser);
  const sessionEmail = useCallitStore((s) => s.user?.email);

  // Zero rows is NOT an error — the red card is reserved for a read that
  // actually failed. The Diagnostics block above explains an empty list
  // when it is caused by a missing profiles row.
  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No users yet"
        description="Profiles appear here as soon as someone signs up."
      />
    );
  }

  const toggleBan = (row: CloudProfileRow, banned: boolean) => {
    // Store action routes to the set_user_banned RPC (fire-and-forget) —
    // update the fetched rows optimistically; Refresh re-pulls the truth.
    if (banned) banUser(row.email, row.id);
    else unbanUser(row.email, row.id);
    onBanChange(row.id, banned);
    toast.success(banned ? 'User banned.' : 'User unbanned.');
  };

  return (
    <>
      <TableShell>
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
          <tr>
            <Th>Email</Th>
            <Th>Username</Th>
            <Th right>Balance</Th>
            <Th>Status</Th>
            <Th right>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((row) => {
            const isSelf = sessionEmail === row.email;
            return (
              <tr key={row.id} className={cn(ROW_CLASSES, row.banned && 'opacity-50')}>
                <td className="px-4 py-3 font-semibold text-tx">{row.email || '—'}</td>
                <td className="px-4 py-3 text-tx-sec">
                  <span className="inline-flex items-center gap-2">
                    {row.username || '—'}
                    {row.isAdmin && <Badge variant="sky">Admin</Badge>}
                    {isSelf && <Badge variant="neutral">You</Badge>}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                  {formatMoney(row.balance)}
                </td>
                <td className="px-4 py-3">
                  {row.banned ? (
                    <Badge variant="danger">Banned</Badge>
                  ) : (
                    <Badge variant="green">Active</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {isSelf ? (
                    <span className="text-tx-mut">—</span>
                  ) : row.banned ? (
                    <Button size="sm" variant="outline" onClick={() => toggleBan(row, false)}>
                      Unban
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => toggleBan(row, true)}>
                      Ban
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
      <p className="text-xs text-tx-mut">
        Profiles, balances and bans live in Supabase — banned users are rejected at sign-in
        and signed out within a minute while online.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Markets tab                                                         */
/*                                                                     */
/* Built around one question: what does a HUMAN actually have to       */
/* decide? Global markets come from Polymarket/Kalshi, which publish   */
/* their own results — /api/settle reads them and pays out on a cron,  */
/* so they need no admin at all. Community markets have no source to   */
/* ask; somebody must say who won.                                     */
/*                                                                     */
/* So: the decisions only a person can make come FIRST and expanded,   */
/* and everything the machine already handles is collapsed out of the  */
/* way with a manual override kept for the stuck ones.                 */
/* ------------------------------------------------------------------ */

/**
 * Closed, still open, not banned — i.e. waiting on a decision.
 *
 * v7 — CLOSED IS `isMarketClosed`, NOT `endDate <= now`. For a community
 * market the two are identical (we own that deadline). For a FEED market they
 * are not: its `endDate` is the kickoff, so the old rule listed every live
 * match as "Awaiting result" and buried the genuinely overdue rows under them.
 * This is the same predicate the server's trade gate uses.
 */
function isAwaitingSettlement(m: Market, bannedIds: string[], now: number): boolean {
  return m.status === 'open' && !bannedIds.includes(m.id) && isMarketClosed(m, now);
}

/** Oldest end date first — the longest-overdue payout is the most urgent. */
function byOldestEnd(a: Market, b: Market): number {
  return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
}

/**
 * Settle controls shared by every section.
 *
 * `settled` is an OPTIMISTIC map: Global markets render from the
 * /api/polymarket payload rather than the shared book, so a server-side
 * resolve cannot travel back to the row on its own — without this the
 * admin would still see "Open" on a market they just paid out.
 */
function useSettleControls() {
  const resolveMarket = useCallitStore((s) => s.resolveMarket);
  // `${id}:${outcome}` armed / in flight.
  const [armed, setArmed] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [settled, setSettled] = useState<Record<string, Side>>({});

  const settle = useCallback(
    async (id: string, outcome: Side) => {
      setArmed(null);
      setSettling(`${id}:${outcome}`);
      // Admin resolutions are free and work on ANY market — including the
      // Global (`resolution: 'oracle'`) book. The server pays $1 per
      // winning share out of the pool and clears the book.
      const ok = await resolveMarket(id, outcome);
      setSettling(null);
      if (ok) {
        setSettled((prev) => ({ ...prev, [id]: outcome }));
        toast.success('Market settled — winners paid out.');
      } else {
        toast.error(
          useCallitStore.getState().lastActionError ?? 'Could not settle this market.'
        );
      }
    },
    [resolveMarket]
  );

  return { armed, setArmed, settling, settled, settle };
}

type SettleControls = ReturnType<typeof useSettleControls>;

/** Two-step Settle Yes / Settle No — arm, then confirm. Settling is
 *  irreversible and pays real money, so it never happens on one click. */
function SettleButtons({
  id,
  controls,
  disabled,
}: {
  id: string;
  controls: SettleControls;
  disabled?: boolean;
}) {
  const { armed, setArmed, settling, settle } = controls;
  const busy = settling?.startsWith(`${id}:`) ?? false;

  return (
    <>
      {(['yes', 'no'] as const).map((side) => {
        const key = `${id}:${side}`;
        const label = side === 'yes' ? 'Yes' : 'No';
        return (
          <Button
            key={side}
            size="sm"
            variant={side === 'yes' ? 'yes-tint' : 'no-tint'}
            loading={settling === key}
            disabled={disabled || busy}
            onClick={() => {
              if (armed === key) void settle(id, side);
              else setArmed(key);
            }}
          >
            {armed === key ? `Confirm ${label}?` : `Settle ${label}`}
          </Button>
        );
      })}
    </>
  );
}

/** Ban / Unban with the two-step confirm. Banning refunds every open
 *  position at cost and VOIDS the pool — it is terminal, not a toggle. */
function BanControls({ id, banned, disabled }: { id: string; banned: boolean; disabled?: boolean }) {
  const banMarket = useCallitStore((s) => s.banMarket);
  const unbanMarket = useCallitStore((s) => s.unbanMarket);
  const [confirming, setConfirming] = useState(false);

  if (banned) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void (async () => {
            const res = await unbanMarket(id);
            if (res.ok) toast.success('Market unbanned — visible again.');
            else toast.error(res.error ?? 'Could not unban this market.');
          })();
        }}
      >
        Unban
      </Button>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex flex-col items-end gap-2">
        <span className="text-xs font-semibold text-danger">
          Ban market? Open positions will be refunded.
        </span>
        <span className="inline-flex gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirming(false);
              void (async () => {
                // Cloud: the server refunds EVERY holder at cost.
                const res = await banMarket(id);
                if (res.ok) toast.success('Market banned — positions refunded.');
                else toast.error(res.error ?? 'Could not ban this market.');
              })();
            }}
          >
            Confirm ban
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      </span>
    );
  }

  return (
    <Button size="sm" variant="danger" disabled={disabled} onClick={() => setConfirming(true)}>
      Ban
    </Button>
  );
}

function MarketStatusBadge({
  banned,
  resolved,
  outcome,
  awaiting,
}: {
  banned: boolean;
  resolved: boolean;
  outcome?: Side;
  awaiting?: boolean;
}) {
  if (banned) return <Badge variant="danger">Banned</Badge>;
  if (resolved) {
    return (
      <Badge variant={outcome === 'yes' ? 'green' : 'sky'}>
        Settled {outcome === 'yes' ? 'Yes' : 'No'}
      </Badge>
    );
  }
  if (awaiting) return <Badge variant="amber">Awaiting result</Badge>;
  return <Badge variant="neutral">Open</Badge>;
}

function MarketLink({ market }: { market: Market }) {
  return (
    <Link
      href={`/market/${encodeURIComponent(market.id)}`}
      className="block max-w-[320px] font-semibold text-tx transition-colors hover:text-green"
    >
      <span className="line-clamp-1">{market.question}</span>
    </Link>
  );
}

/** Collapsible secondary section. Entrance animation only — never an
 *  AnimatePresence exit (React 19.2 leaves the node mounted and blocking). */
function CollapsibleSection({
  title,
  count,
  subtitle,
  action,
  children,
}: {
  title: string;
  count: number;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-tx-sec transition-colors hover:text-tx"
        >
          <ChevronRight
            aria-hidden
            className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-90')}
          />
          {title}
          <Badge variant="neutral">{count}</Badge>
        </button>
        {action}
      </div>
      {subtitle && <p className="text-xs text-tx-mut">{subtitle}</p>}
      {open && <Panel tab={title}>{children}</Panel>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Needs your decision — the admin's actual job                     */
/* ------------------------------------------------------------------ */

/**
 * Community markets that have ENDED and nobody has settled. This is the
 * whole list a human has to work through: everything else on this tab is
 * either automatic or archival.
 */
function NeedsDecisionSection({
  markets,
  bannedIds,
  positionCounts,
}: {
  markets: Market[];
  bannedIds: string[];
  positionCounts: Map<string, number>;
}) {
  const controls = useSettleControls();
  const communityVotes = useCallitStore((s) => s.communityVotes);
  const finalizeCommunityMarket = useCallitStore((s) => s.finalizeCommunityMarket);
  const [cloudTallies, setCloudTallies] = useState<Record<string, { yes: number; no: number }>>(
    {}
  );
  const [finalizing, setFinalizing] = useState<string | null>(null);

  const rows = useMemo(() => {
    const now = Date.now();
    return markets
      .filter((m) => m.source === 'callit' && isAwaitingSettlement(m, bannedIds, now))
      .sort(byOldestEnd);
  }, [markets, bannedIds]);

  // Only community-vote markets have ballots to count.
  const voteIds = useMemo(
    () =>
      rows
        .filter((m) => m.resolution === 'community')
        .map((m) => m.id)
        .join(','),
    [rows]
  );

  const loadTallies = useCallback(async () => {
    if (!cloudFeedEnabled || !voteIds) return;
    const ids = voteIds.split(',');
    const results = await Promise.all(ids.map((id) => fetchMarketVotes(id)));
    setCloudTallies(Object.fromEntries(ids.map((id, i) => [id, results[i]])));
  }, [voteIds]);

  useEffect(() => {
    void loadTallies();
  }, [loadTallies]);

  const tallyFor = (marketId: string) => {
    if (cloudFeedEnabled) return cloudTallies[marketId] ?? { yes: 0, no: 0 };
    const ballots = communityVotes[marketId] ?? {};
    let yes = 0;
    let no = 0;
    for (const side of Object.values(ballots)) {
      if (side === 'yes') yes += 1;
      else no += 1;
    }
    return { yes, no };
  };

  const finalize = async (id: string) => {
    setFinalizing(id);
    const ok = await finalizeCommunityMarket(id);
    setFinalizing(null);
    if (ok) {
      toast.success('Market resolved — winners paid out.');
      void loadTallies();
    } else {
      toast.error(
        useCallitStore.getState().lastActionError ??
          'Cannot finalize — the vote is tied or empty.'
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-tx">
          Needs your decision
          <Badge variant={rows.length > 0 ? 'amber' : 'green'}>{rows.length}</Badge>
        </h2>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-green/30 bg-green/5 p-8 text-center">
          <div
            aria-hidden
            className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-green/10 text-green"
          >
            <Check className="h-5 w-5" />
          </div>
          <h3 className="mt-3 font-extrabold text-tx">Nothing waiting on you</h3>
          <p className="mt-1 text-sm text-tx-sec">
            Every ended community market has been settled. Feed markets settle themselves —
            check deposits and withdrawals in Payments.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-tx-mut">
            Community markets have no source API to read a result from — someone has to call
            it. Oldest first. Settling pays $1 per winning share out of the market&apos;s pool
            and closes every position.
          </p>
          <TableShell>
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
              <tr>
                <Th>Question</Th>
                <Th>Ended</Th>
                <Th>Method</Th>
                <Th right>Positions</Th>
                <Th right>Votes</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isVote = m.resolution === 'community';
                const { yes, no } = tallyFor(m.id);
                const tied = yes === no;
                const settledOutcome = controls.settled[m.id];
                return (
                  <tr key={m.id} className={ROW_CLASSES}>
                    <td className="px-4 py-3">
                      <MarketLink market={m} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-tx-sec">
                      {formatDate(m.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      {isVote ? (
                        <Badge variant="green">Community vote</Badge>
                      ) : (
                        <Badge variant="neutral">Manual</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                      {positionCounts.get(m.id) ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {isVote ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-bold text-green">{yes}</span>
                          <span className="text-tx-mut">/</span>
                          <span className="font-bold text-sky">{no}</span>
                        </span>
                      ) : (
                        <span className="text-tx-mut">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {settledOutcome ? (
                        <MarketStatusBadge banned={false} resolved outcome={settledOutcome} />
                      ) : (
                        <span className="inline-flex flex-wrap items-center justify-end gap-2">
                          {isVote && (
                            <span className="inline-flex flex-col items-end gap-1">
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={tied}
                                loading={finalizing === m.id}
                                onClick={() => void finalize(m.id)}
                              >
                                Finalize vote
                              </Button>
                              {tied && (
                                <span className="text-[11px] text-tx-mut">
                                  {yes === 0 ? 'No votes yet' : 'Tie — needs a majority'}
                                </span>
                              )}
                            </span>
                          )}
                          <SettleButtons id={m.id} controls={controls} />
                          <BanControls id={m.id} banned={false} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Feed markets — auto-settled                                      */
/* ------------------------------------------------------------------ */

/**
 * "Run settlement now" — POSTs to /api/settle.
 *
 * The route is cron-guarded by SETTLE_SECRET, which this page can never
 * hold: any secret a client component can read is a published secret. So
 * instead of proxying the secret, the button sends the admin's own
 * Supabase access token and /api/settle verifies it server-side
 * (auth.getUser + profiles.is_admin under the service key). One endpoint,
 * no second route, and nothing sensitive in the bundle.
 */
function RunSettlementButton({ onDone }: { onDone: (r: SettleRun) => void }) {
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) {
        toast.error('Sign in again — your session expired.');
        return;
      }
      const res = await fetch('/api/settle', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as Partial<SettleRun> & { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? `Settlement failed (${res.status}).`);
        return;
      }
      const result: SettleRun = {
        checked: json.checked ?? 0,
        settled: json.settled ?? 0,
        skipped: json.skipped ?? 0,
        errors: json.errors ?? [],
        at: new Date().toISOString(),
      };
      onDone(result);
      toast.success(
        `Checked ${result.checked} market${result.checked === 1 ? '' : 's'} — settled ${
          result.settled
        }.`
      );
    } catch {
      toast.error('Settlement failed — could not reach the server.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button size="sm" variant="outline" loading={running} onClick={() => void run()}>
      {!running && <Zap className="h-3.5 w-3.5" aria-hidden />}
      Run settlement now
    </Button>
  );
}

interface SettleRun {
  checked: number;
  settled: number;
  skipped: number;
  errors: { id: string; error: string }[];
  at: string;
}

function LastRunNote({ run }: { run: SettleRun }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-bold uppercase tracking-wide text-tx-mut">Last run</span>
        <span className="tabular-nums text-tx-sec">{formatDate(run.at)}</span>
        <span className="tabular-nums text-tx">
          <span className="font-bold">{run.checked}</span> checked
        </span>
        <span className="tabular-nums text-green">
          <span className="font-bold">{run.settled}</span> settled
        </span>
        <span className="tabular-nums text-tx-sec">
          <span className="font-bold">{run.skipped}</span> not ready
        </span>
        {run.errors.length > 0 && (
          <span className="tabular-nums text-danger">
            <span className="font-bold">{run.errors.length}</span> failed
          </span>
        )}
      </div>
      {run.errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {run.errors.map((e) => (
            <li key={e.id} className="font-mono text-[11px] text-danger">
              {e.id}: {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedMarketsSection({
  markets,
  bannedIds,
  positionCounts,
}: {
  markets: Market[];
  bannedIds: string[];
  positionCounts: Map<string, number>;
}) {
  const controls = useSettleControls();
  const [lastRun, setLastRun] = useState<SettleRun | null>(null);

  const rows = useMemo(() => {
    const now = Date.now();
    return markets
      .filter((m) => m.source === 'polymarket')
      .sort((a, b) => {
        // Overdue ones first — those are the only interesting rows here.
        const aw = isAwaitingSettlement(a, bannedIds, now) ? 0 : 1;
        const bw = isAwaitingSettlement(b, bannedIds, now) ? 0 : 1;
        if (aw !== bw) return aw - bw;
        return byOldestEnd(a, b);
      });
  }, [markets, bannedIds]);

  return (
    <CollapsibleSection
      title="Feed markets (auto-settled)"
      count={rows.length}
      subtitle="Results are pulled automatically from the source — you normally don't need to touch these."
      action={<RunSettlementButton onDone={setLastRun} />}
    >
      {lastRun && <LastRunNote run={lastRun} />}
      {rows.length === 0 ? (
        <EmptyPanel>No feed markets loaded.</EmptyPanel>
      ) : (
        <TableShell>
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
            <tr>
              <Th>Question</Th>
              <Th>Ends</Th>
              <Th right>Volume</Th>
              <Th right>Positions</Th>
              <Th>Settle state</Th>
              <Th right>Override</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const now = Date.now();
              const banned = bannedIds.includes(m.id);
              const outcome = controls.settled[m.id] ?? m.resolvedOutcome;
              const resolved = Boolean(controls.settled[m.id]) || m.status === 'resolved';
              const awaiting = !resolved && isAwaitingSettlement(m, bannedIds, now);
              return (
                <tr key={m.id} className={cn(ROW_CLASSES, banned && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <MarketLink market={m} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-tx-sec">{formatDate(m.endDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                    {formatMoney(m.volume, { compact: true })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                    {positionCounts.get(m.id) ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <MarketStatusBadge
                      banned={banned}
                      resolved={resolved}
                      outcome={outcome}
                      awaiting={awaiting}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      {!resolved && !banned && <SettleButtons id={m.id} controls={controls} />}
                      <BanControls id={m.id} banned={banned} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Community markets — the rest of the book (archive)               */
/* ------------------------------------------------------------------ */

/** Every community market that is NOT waiting on a decision: still
 *  running, already settled, or banned. Kept so ban/unban stays reachable
 *  for the whole book. */
function CommunityArchiveSection({
  markets,
  bannedIds,
  positionCounts,
}: {
  markets: Market[];
  bannedIds: string[];
  positionCounts: Map<string, number>;
}) {
  const controls = useSettleControls();

  const rows = useMemo(() => {
    const now = Date.now();
    return markets
      .filter((m) => m.source === 'callit' && !isAwaitingSettlement(m, bannedIds, now))
      .sort(byOldestEnd);
  }, [markets, bannedIds]);

  return (
    <CollapsibleSection
      title="Community markets"
      count={rows.length}
      subtitle="Still running, already settled, or banned — nothing here needs a decision yet."
    >
      {rows.length === 0 ? (
        <EmptyPanel>No community markets yet.</EmptyPanel>
      ) : (
        <TableShell>
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
            <tr>
              <Th>Question</Th>
              <Th>Ends</Th>
              <Th right>Volume</Th>
              <Th right>Positions</Th>
              <Th>Status</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const banned = bannedIds.includes(m.id);
              const outcome = controls.settled[m.id] ?? m.resolvedOutcome;
              const resolved = Boolean(controls.settled[m.id]) || m.status === 'resolved';
              return (
                <tr key={m.id} className={cn(ROW_CLASSES, banned && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <MarketLink market={m} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-tx-sec">{formatDate(m.endDate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                    {formatMoney(m.volume, { compact: true })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                    {positionCounts.get(m.id) ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <MarketStatusBadge banned={banned} resolved={resolved} outcome={outcome} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <BanControls id={m.id} banned={banned} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </CollapsibleSection>
  );
}

/* ------------------------------------------------------------------ */
/* Markets tab shell                                                   */
/* ------------------------------------------------------------------ */

function MarketsTab({ markets }: { markets: Market[] }) {
  const bannedIds = useBannedMarketIds();
  const positions = usePositions();

  const positionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) {
      map.set(p.marketId, (map.get(p.marketId) ?? 0) + 1);
    }
    return map;
  }, [positions]);

  return (
    <>
      <NeedsDecisionSection
        markets={markets}
        bannedIds={bannedIds}
        positionCounts={positionCounts}
      />
      <FeedMarketsSection
        markets={markets}
        bannedIds={bannedIds}
        positionCounts={positionCounts}
      />
      <CommunityArchiveSection
        markets={markets}
        bannedIds={bannedIds}
        positionCounts={positionCounts}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Categories tab                                                      */
/* ------------------------------------------------------------------ */

function CategoriesPanel() {
  const customCategories = useCallitStore((s) => s.customCategories);
  const addCategory = useCallitStore((s) => s.addCategory);
  const removeCategory = useCallitStore((s) => s.removeCategory);
  const [label, setLabel] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!label.trim()) {
      toast.error('Enter a category name.');
      return;
    }
    if (addCategory(label)) {
      toast.success('Category added.');
      setLabel('');
    } else {
      toast.error('This category already exists.');
    }
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface-2 p-5"
      >
        <div className="min-w-[220px] flex-1">
          <label
            htmlFor="new-category"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-tx-mut"
          >
            New category
          </label>
          <Input
            id="new-category"
            type="text"
            placeholder="e.g. Science & Tech"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" size="md">
          Add category
        </Button>
      </form>

      <TableShell>
        <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
          <tr>
            <Th>Label</Th>
            <Th>Value</Th>
            <Th>Type</Th>
            <Th right>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => (
            <tr key={c.value} className={ROW_CLASSES}>
              <td className="px-4 py-3 font-semibold text-tx">{c.label}</td>
              <td className="px-4 py-3 font-mono text-xs text-tx-mut">{c.value}</td>
              <td className="px-4 py-3">
                <Badge variant="neutral">core</Badge>
              </td>
              <td className="px-4 py-3 text-right text-tx-mut">—</td>
            </tr>
          ))}
          {customCategories.map((c) => (
            <tr key={c.value} className={ROW_CLASSES}>
              <td className="px-4 py-3 font-semibold text-tx">{c.label}</td>
              <td className="px-4 py-3 font-mono text-xs text-tx-mut">{c.value}</td>
              <td className="px-4 py-3">
                <Badge variant="green">custom</Badge>
              </td>
              <td className="px-4 py-3 text-right">
                {confirmRemove === c.value ? (
                  <span className="inline-flex flex-col items-end gap-2">
                    <span className="text-xs font-semibold text-danger">
                      Remove this category?
                    </span>
                    <span className="inline-flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          removeCategory(c.value);
                          setConfirmRemove(null);
                          toast.success('Category removed.');
                        }}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmRemove(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmRemove(c.value)}>
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <p className="text-xs text-tx-mut">
        Core categories are built in and cannot be removed. Removing a custom category
        does not change existing markets — they keep their category value.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payments tab                                                        */
/* ------------------------------------------------------------------ */

function DepositStatusBadge({ status }: { status: Deposit['status'] }) {
  if (status === 'pending') return <Badge variant="amber">Pending</Badge>;
  if (status === 'approved') return <Badge variant="green">Approved</Badge>;
  return <Badge variant="danger">Rejected</Badge>;
}

/* ------------------------------------------------------------------ */
/* Payments tab — on-chain verification (v7)                           */
/* ------------------------------------------------------------------ */

/**
 * What the chain said about one deposit.
 *
 * Two sources, same shape: the columns persisted by a previous check
 * (`verified*` on the deposits row) and the fresh answer from a Verify
 * click. `ok` only exists on a fresh result — it separates "we read the
 * chain and it does not back this claim" (evidence, red) from "we could not
 * read the chain at all" (nothing, amber). The DB has no column for that
 * distinction, so a reloaded row falls back to its stored error text.
 */
interface VerifyInfo {
  verified: boolean | null;
  amount: number | null;
  to: string | null;
  confirmations: number | null;
  error: string | null;
  /** Fresh results only: did the LOOKUP itself succeed? */
  ok?: boolean;
}

/** The verification columns, straight off the deposits row. */
interface VerifyRow {
  id: string;
  verified: boolean | null;
  verified_amount: number | string | null;
  verified_to: string | null;
  verified_confirmations: number | null;
  verify_error: string | null;
}

/**
 * Read the persisted evidence.
 *
 * lib/cloud.ts `fetchAllPayments` selects `*` but `mapDeposit` drops these
 * columns, and the shared `Deposit` type has no room for them. Rather than
 * widen a type every page uses for one admin-only panel, this panel reads
 * its own columns. RLS ('deposits: read own or admin') already scopes it —
 * an admin sees every row, and nobody else can call this at all.
 */
async function fetchVerifications(): Promise<Record<string, VerifyInfo>> {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('deposits')
    .select('id, verified, verified_amount, verified_to, verified_confirmations, verify_error');
  if (error || !data) return {};

  const out: Record<string, VerifyInfo> = {};
  for (const r of data as VerifyRow[]) {
    // `verified` is null until a check has ever run — that is "unknown",
    // not "failed", and must render as nothing at all.
    if (r.verified === null) continue;
    out[String(r.id)] = {
      verified: r.verified,
      amount: r.verified_amount === null ? null : Number(r.verified_amount),
      to: r.verified_to,
      confirmations: r.verified_confirmations,
      error: r.verify_error,
    };
  }
  return out;
}

/** POST to /api/deposits/verify with the admin's own session token.
 *  Same pattern as "Run settlement now": the route verifies the JWT and
 *  the is_admin flag server-side, so no secret ever reaches this bundle. */
async function postVerify(body: Record<string, unknown>): Promise<Response | null> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) {
    toast.error('Sign in again — your session expired.');
    return null;
  }
  return fetch('/api/deposits/verify', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Coin amounts are NOT money: formatMoney would render 0.0043 BTC as
 *  "$0.00". The chain reports the coin's own unit and so do we — the USD
 *  figure on the row is what the USER claimed, and comparing the two is
 *  exactly the judgement call this panel exists to support. */
function formatCoin(amount: number, currency: Deposit['currency']): string {
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${currency}`;
}

/** One line of evidence under a deposit row. */
function VerifyLine({ info, currency }: { info: VerifyInfo; currency: Deposit['currency'] }) {
  if (info.verified) {
    const bits = [
      info.amount !== null ? formatCoin(info.amount, currency) : null,
      info.to ? `to ${shortAddress(info.to)}` : null,
      info.confirmations !== null ? `${info.confirmations} confs` : null,
    ].filter(Boolean);
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Verified{bits.length > 0 ? ` — ${bits.join(', ')}` : ''}
      </span>
    );
  }

  // The lookup failed: we know nothing about this deposit. Amber, not red —
  // a dead RPC endpoint is not evidence against the depositor.
  if (info.ok === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Could not check — {info.error ?? 'the chain was unreachable.'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
      <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Not verified — {info.error ?? 'the chain does not back this transaction.'}
    </span>
  );
}

function DepositsPanel({
  deposits,
  onChanged,
}: {
  deposits: Deposit[];
  onChanged?: () => void;
}) {
  const approveDeposit = useCallitStore((s) => s.approveDeposit);
  const rejectDeposit = useCallitStore((s) => s.rejectDeposit);
  // `${id}:approve` / `${id}:reject` while the async action is in flight.
  const [busy, setBusy] = useState<string | null>(null);

  // Evidence: what a previous check stored, overlaid with anything verified
  // in this session. Fresh always wins — it is strictly newer.
  const [stored, setStored] = useState<Record<string, VerifyInfo>>({});
  const [fresh, setFresh] = useState<Record<string, VerifyInfo>>({});
  const [verifying, setVerifying] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  // Local mode has no chain and no server route — deposits there are demo
  // rows in localStorage. The whole verification UI stays off.
  const canVerify = supabaseEnabled;

  const loadStored = useCallback(async () => {
    if (!canVerify) return;
    setStored(await fetchVerifications());
  }, [canVerify]);

  useEffect(() => {
    void loadStored();
  }, [loadStored]);

  const act = async (d: Deposit, approve: boolean) => {
    setBusy(`${d.id}:${approve ? 'approve' : 'reject'}`);
    const res = approve ? await approveDeposit(d.id) : await rejectDeposit(d.id);
    setBusy(null);
    if (res.ok) {
      toast.success(
        approve ? `Deposit approved — ${formatMoney(d.amount)} credited.` : 'Deposit rejected.'
      );
      onChanged?.();
    } else {
      toast.error(res.error ?? 'Request failed — try again.');
    }
  };

  const verifyOne = async (d: Deposit) => {
    setVerifying(d.id);
    try {
      const res = await postVerify({ depositId: d.id });
      if (!res) return;
      const json = (await res.json()) as Partial<VerifyInfo> & { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? `Verification failed (${res.status}).`);
        return;
      }
      setFresh((prev) => ({
        ...prev,
        [d.id]: {
          verified: json.verified ?? false,
          amount: json.amount ?? null,
          to: json.to ?? null,
          confirmations: json.confirmations ?? null,
          error: json.error ?? null,
          ok: json.ok,
        },
      }));
    } catch {
      toast.error('Verification failed — could not reach the server.');
    } finally {
      setVerifying(null);
    }
  };

  const verifyAllPending = async () => {
    setSweeping(true);
    try {
      const res = await postVerify({ all: true });
      if (!res) return;
      const json = (await res.json()) as {
        checked?: number;
        verified?: number;
        results?: (VerifyInfo & { depositId: string })[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? `Verification failed (${res.status}).`);
        return;
      }
      const next: Record<string, VerifyInfo> = {};
      for (const r of json.results ?? []) {
        next[r.depositId] = {
          verified: r.verified ?? false,
          amount: r.amount ?? null,
          to: r.to ?? null,
          confirmations: r.confirmations ?? null,
          error: r.error ?? null,
          ok: r.ok,
        };
      }
      setFresh((prev) => ({ ...prev, ...next }));
      const checked = json.checked ?? 0;
      toast.success(
        `Checked ${checked} deposit${checked === 1 ? '' : 's'} — ${json.verified ?? 0} verified.`
      );
    } catch {
      toast.error('Verification failed — could not reach the server.');
    } finally {
      setSweeping(false);
    }
  };

  const pendingWithHash = deposits.filter(
    (d) => d.status === 'pending' && (d.txHash ?? '').trim() !== ''
  ).length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-tx-sec">Deposits</h2>
        {canVerify && pendingWithHash > 0 && (
          <Button
            size="sm"
            variant="outline"
            loading={sweeping}
            disabled={verifying !== null}
            onClick={() => void verifyAllPending()}
          >
            {!sweeping && <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
            Verify all pending
          </Button>
        )}
      </div>

      {canVerify && (
        <p className="text-xs text-tx-mut">
          Verifying reads the transaction off the chain and reports what it finds — it never
          approves a deposit. A matching payment is evidence, not proof the sender owns this
          account: you still decide.
        </p>
      )}

      {deposits.length === 0 ? (
        <EmptyPanel>No deposit requests yet.</EmptyPanel>
      ) : (
        <TableShell>
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
            <tr>
              <Th>Currency</Th>
              <Th right>Amount</Th>
              <Th>User</Th>
              <Th>Tx hash</Th>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d) => {
              const hasHash = (d.txHash ?? '').trim() !== '';
              const info = fresh[d.id] ?? stored[d.id];
              // A pending row with no hash: the user gave us nothing to look
              // up. That is a different fact from "the chain says no", and
              // it is derived here rather than stored as a failed check.
              const noHash = canVerify && d.status === 'pending' && !hasHash;
              const showEvidence = canVerify && (Boolean(info) || noHash);

              return (
                <Fragment key={d.id}>
                  <tr className={cn(ROW_CLASSES, showEvidence && 'border-b-0')}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2 font-semibold text-tx">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: walletFor(d.currency).color }}
                        />
                        {d.currency}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                      {formatMoney(d.amount)}
                    </td>
                    <td className="px-4 py-3 text-tx-sec">{d.userEmail ?? 'guest'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-tx-mut">
                      {d.txHash ? shortAddress(d.txHash) : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-tx-sec">{formatDate(d.createdAt)}</td>
                    <td className="px-4 py-3">
                      <DepositStatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.status === 'pending' ? (
                        <span className="inline-flex gap-2">
                          {canVerify && hasHash && (
                            <Button
                              size="sm"
                              variant="outline"
                              loading={verifying === d.id}
                              disabled={sweeping || verifying !== null}
                              onClick={() => void verifyOne(d)}
                            >
                              Verify
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="primary"
                            loading={busy === `${d.id}:approve`}
                            disabled={busy?.startsWith(`${d.id}:`) ?? false}
                            onClick={() => void act(d, true)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={busy === `${d.id}:reject`}
                            disabled={busy?.startsWith(`${d.id}:`) ?? false}
                            onClick={() => void act(d, false)}
                          >
                            Reject
                          </Button>
                        </span>
                      ) : (
                        <span className="text-tx-mut">—</span>
                      )}
                    </td>
                  </tr>

                  {showEvidence && (
                    // The evidence row inherits the deposit row's bottom
                    // border (suppressed above with border-b-0) so the pair
                    // reads as one row, not two.
                    <tr className="border-b border-line/60 last:border-b-0">
                      <td colSpan={7} className="px-4 pb-3 pt-0">
                        {info ? (
                          <VerifyLine info={info} currency={d.currency} />
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber">
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            No tx hash provided
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </>
  );
}

function WithdrawalsPanel({
  withdrawals,
  onChanged,
}: {
  withdrawals: Withdrawal[];
  onChanged?: () => void;
}) {
  const approveWithdrawal = useCallitStore((s) => s.approveWithdrawal);
  const rejectWithdrawal = useCallitStore((s) => s.rejectWithdrawal);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (w: Withdrawal, approve: boolean) => {
    setBusy(`${w.id}:${approve ? 'approve' : 'reject'}`);
    const res = approve ? await approveWithdrawal(w.id) : await rejectWithdrawal(w.id);
    setBusy(null);
    if (res.ok) {
      toast.success(
        approve
          ? `Withdrawal approved — ${formatMoney(w.amount)} paid out.`
          : 'Withdrawal rejected — amount refunded.'
      );
      onChanged?.();
    } else {
      toast.error(res.error ?? 'Request failed — try again.');
    }
  };

  if (withdrawals.length === 0) {
    return <EmptyPanel>No withdrawal requests yet.</EmptyPanel>;
  }

  return (
    <TableShell>
      <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
        <tr>
          <Th>Currency</Th>
          <Th right>Amount</Th>
          <Th>User</Th>
          <Th>Address</Th>
          <Th>Date</Th>
          <Th>Status</Th>
          <Th right>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {withdrawals.map((w) => (
          <tr key={w.id} className={ROW_CLASSES}>
            <td className="px-4 py-3">
              <span className="inline-flex items-center gap-2 font-semibold text-tx">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: walletFor(w.currency).color }}
                />
                {w.currency}
              </span>
            </td>
            <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
              {formatMoney(w.amount)}
            </td>
            <td className="px-4 py-3 text-tx-sec">{w.userEmail ?? 'guest'}</td>
            <td className="px-4 py-3 font-mono text-xs text-tx-mut">
              {shortAddress(w.address)}
            </td>
            <td className="px-4 py-3 tabular-nums text-tx-sec">{formatDate(w.createdAt)}</td>
            <td className="px-4 py-3">
              <DepositStatusBadge status={w.status} />
            </td>
            <td className="px-4 py-3 text-right">
              {w.status === 'pending' ? (
                <span className="inline-flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === `${w.id}:approve`}
                    disabled={busy?.startsWith(`${w.id}:`) ?? false}
                    onClick={() => void act(w, true)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === `${w.id}:reject`}
                    disabled={busy?.startsWith(`${w.id}:`) ?? false}
                    onClick={() => void act(w, false)}
                  >
                    Reject
                  </Button>
                </span>
              ) : (
                <span className="text-tx-mut">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/* ------------------------------------------------------------------ */
/* Settings tab                                                        */
/* ------------------------------------------------------------------ */

/** `%` string shown in the fee inputs for a stored bps value (100 -> "1"). */
function bpsToPctString(bps: number | null): string {
  return bps == null ? '' : String(bps / 100);
}

/** Parse a `%` input back to bps (1 -> 100). Null = empty/not a number. */
function pctToBps(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function SettingsField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-tx-mut"
      >
        {label}
      </label>
      {children}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * v7 — the owner's knobs on `platform_settings`: the Global seed and the
 * platform/LP fee split that NEW markets are created with. Saves through
 * the admin-only 3-arg `admin_settings_update` RPC (the v6 2-arg overload
 * is dropped on purpose — CONTRACTS2.md "Hard breaks" #2).
 *
 * Values are read from the store's `platformSettings` (the same
 * anon-readable row the trade panel uses); bps are rendered as `%` and
 * converted back on save. Cloud-only: local mode has no server config.
 */
function PlatformSettingsCard() {
  const platformSettings = useCallitStore((s) => s.platformSettings);
  const refreshPlatformSettings = useCallitStore((s) => s.refreshPlatformSettings);

  const [seed, setSeed] = useState('');
  const [platformPct, setPlatformPct] = useState('');
  const [lpPct, setLpPct] = useState('');
  // Whether the form has been populated from the loaded row. Populate ONCE —
  // a background refresh must never clobber the admin's in-progress edits.
  const [populated, setPopulated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    void refreshPlatformSettings();
  }, [refreshPlatformSettings]);

  useEffect(() => {
    if (populated || !platformSettings) return;
    setSeed(String(platformSettings.globalSeed));
    // Pre-v7 database: the split columns are null — leave the fields empty
    // and let validation ask for values rather than inventing a split.
    setPlatformPct(bpsToPctString(platformSettings.platformFeeBps));
    setLpPct(bpsToPctString(platformSettings.lpFeeBps));
    setPopulated(true);
  }, [populated, platformSettings]);

  // Mirror the RPC's own bounds so a bad value fails HERE, not as a thrown
  // Postgres error: seed $1..$10,000, each fee 0..1000 bps, total <= 1000.
  const seedNum = seed.trim() === '' ? NaN : Number(seed);
  const seedError = !Number.isFinite(seedNum) || seedNum < 1 || seedNum > 10000
    ? 'Enter an amount between $1 and $10,000.'
    : undefined;
  const platformBps = pctToBps(platformPct);
  const platformError = platformBps == null || platformBps < 0 || platformBps > 1000
    ? 'Enter a fee between 0% and 10%.'
    : undefined;
  const lpBps = pctToBps(lpPct);
  const lpError = lpBps == null || lpBps < 0 || lpBps > 1000
    ? 'Enter a fee between 0% and 10%.'
    : undefined;
  const totalError =
    !platformError && !lpError && (platformBps ?? 0) + (lpBps ?? 0) > 1000
      ? 'Platform fee + LP fee must total at most 10%.'
      : undefined;
  const valid = !seedError && !platformError && !lpError && !totalError;
  const showErrors = touched;

  const save = async () => {
    setTouched(true);
    if (!supabase || !valid || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_settings_update', {
        p_global_seed: Math.round(seedNum * 100) / 100,
        p_platform_fee_bps: platformBps,
        p_lp_fee_bps: lpBps,
      });
      if (error) {
        // The RPC raises with user-facing wording ('Admin only',
        // 'Total fee must be at most 1000 bps', …) — surface it as-is.
        toast.error(error.message || 'Could not save platform settings.');
      } else {
        toast.success('Platform settings saved.');
        // Pull the row back so the trade panel's fee line and this form
        // agree with what the server actually stored.
        void refreshPlatformSettings();
      }
    } catch {
      toast.error('Could not save platform settings.');
    } finally {
      setSaving(false);
    }
  };

  // Local mode: there is no platform_settings row to edit.
  if (!supabaseEnabled) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <h2 className="text-sm font-black uppercase tracking-wide text-tx-mut">
        Platform settings
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <SettingsField
          id="platform-global-seed"
          label="Global seed ($)"
          error={showErrors ? seedError : undefined}
        >
          <Input
            id="platform-global-seed"
            type="number"
            min={1}
            max={10000}
            step={0.01}
            inputMode="decimal"
            placeholder="25"
            value={seed}
            error={showErrors && Boolean(seedError)}
            disabled={saving}
            onChange={(e) => {
              setSeed(e.target.value);
              setTouched(true);
            }}
          />
        </SettingsField>
        <SettingsField
          id="platform-fee-pct"
          label="Platform fee (%)"
          error={showErrors ? platformError : undefined}
        >
          <Input
            id="platform-fee-pct"
            type="number"
            min={0}
            max={10}
            step={0.01}
            inputMode="decimal"
            placeholder="1"
            value={platformPct}
            error={showErrors && Boolean(platformError ?? totalError)}
            disabled={saving}
            onChange={(e) => {
              setPlatformPct(e.target.value);
              setTouched(true);
            }}
          />
        </SettingsField>
        <SettingsField
          id="lp-fee-pct"
          label="LP fee (%)"
          error={showErrors ? (lpError ?? totalError) : undefined}
        >
          <Input
            id="lp-fee-pct"
            type="number"
            min={0}
            max={10}
            step={0.01}
            inputMode="decimal"
            placeholder="1"
            value={lpPct}
            error={showErrors && Boolean(lpError ?? totalError)}
            disabled={saving}
            onChange={(e) => {
              setLpPct(e.target.value);
              setTouched(true);
            }}
          />
        </SettingsField>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          loading={saving}
          disabled={saving || (touched && !valid)}
          onClick={() => void save()}
        >
          Save settings
        </Button>
        {!populated && (
          <span className="text-xs text-tx-mut">Loading current values…</span>
        )}
      </div>
      <p className="mt-3 text-xs text-tx-mut">
        Applies to markets created from now on — existing markets keep the fee they
        were created with.
      </p>
    </div>
  );
}

function SettingsPanel() {
  const balance = useCallitStore((s) => s.balance);
  const adjustBalance = useCallitStore((s) => s.adjustBalance);

  return (
    <div className="space-y-4">
      <PlatformSettingsCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface-2 p-5">
          <h2 className="text-sm font-black uppercase tracking-wide text-tx-mut">
            Balance tools
          </h2>
          <div className="mt-2 text-2xl font-black tabular-nums text-tx">
            {formatMoney(balance)} USDC
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                adjustBalance(100);
                toast.success('Balance increased by $100.00.');
              }}
            >
              +$100
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                adjustBalance(-100);
                toast.success('Balance decreased by $100.00.');
              }}
            >
              -$100
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                adjustBalance(1000 - balance);
                toast.success('Balance reset to $1,000.00.');
              }}
            >
              Reset to $1,000
            </Button>
          </div>
          <p className="mt-3 text-xs text-tx-mut">
            Admin tools — the balance lives in your browser storage and never goes below $0.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface-2 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-wide text-tx-mut">Backend</h2>
            {supabaseEnabled ? (
              <Badge variant="green">Supabase connected</Badge>
            ) : (
              <Badge variant="amber">Local mode</Badge>
            )}
          </div>
          <p className="mt-3 text-sm text-tx-sec">
            {supabaseEnabled
              ? 'Auth and profiles are backed by Supabase. Bans on users are synced to the profiles table.'
              : 'Accounts, deposits and bans are stored locally in this browser. Connect Supabase for real auth and persistence:'}
          </p>
          {!supabaseEnabled && (
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-tx-sec">
              <li>Create a Supabase project.</li>
              <li>
                Run{' '}
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px] text-tx">
                  supabase/schema.sql
                </code>{' '}
                in the Supabase SQL editor.
              </li>
              <li>
                Copy{' '}
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px] text-tx">
                  .env.local.example
                </code>{' '}
                to{' '}
                <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px] text-tx">
                  .env.local
                </code>{' '}
                and set the two NEXT_PUBLIC_SUPABASE_* variables.
              </li>
              <li>Restart the dev server.</li>
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AdminPage() {
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const user = useCallitStore((s) => s.user);
  const localUsers = useCallitStore((s) => s.localUsers);
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const overrides = useCallitStore((s) => s.marketOverrides);
  const positions = usePositions();
  const cloudMarkets = useCallitStore((s) => s.cloudMarkets);
  const poly = useCallitStore((s) => s.poly);
  const polyEvents = useCallitStore((s) => s.polyEvents);
  const deposits = useCallitStore((s) => s.deposits);
  const withdrawals = useCallitStore((s) => s.withdrawals);
  const balance = useCallitStore((s) => s.balance);
  const customCategories = useCallitStore((s) => s.customCategories);

  const [tab, setTab] = useState<AdminTab>('overview');

  // ----- v4 cloud data (Supabase is the source of truth when enabled) -----
  const [cloudProfiles, setCloudProfiles] = useState<CloudProfileRow[] | null>(null);
  const [cloudPayments, setCloudPayments] = useState<{
    deposits: Deposit[];
    withdrawals: Withdrawal[];
  } | null>(null);
  const [cloudRefreshing, setCloudRefreshing] = useState(false);
  // The REAL Supabase message per read, or undefined when it succeeded.
  // Tracked separately so each tab shows its own failure, and so an empty
  // result can be told apart from a failed one.
  const [cloudErrors, setCloudErrors] = useState<{ profiles?: string; payments?: string }>(
    {}
  );

  const loadCloud = useCallback(async () => {
    if (!supabaseEnabled) return;
    setCloudRefreshing(true);
    const [profiles, payments] = await Promise.all([fetchAllProfiles(), fetchAllPayments()]);
    setCloudProfiles(profiles.rows);
    setCloudPayments({ deposits: payments.deposits, withdrawals: payments.withdrawals });
    setCloudErrors({ profiles: profiles.error, payments: payments.error });
    setCloudRefreshing(false);
  }, []);

  const isAdmin = Boolean(user?.isAdmin);
  useEffect(() => {
    if (supabaseEnabled && isAdmin) void loadCloud();
  }, [isAdmin, loadCloud]);

  const handleCloudBanChange = useCallback((id: string, banned: boolean) => {
    setCloudProfiles((prev) =>
      prev ? prev.map((p) => (p.id === id ? { ...p, banned } : p)) : prev
    );
  }, []);

  const refreshCloud = useCallback(() => {
    void loadCloud();
  }, [loadCloud]);

  const userRows = useMemo<UserRow[]>(() => {
    const rows: UserRow[] = localUsers.map((u) => ({
      email: u.email,
      username: u.username,
      banned: u.banned,
      isSession: user?.email === u.email,
    }));
    if (user && !localUsers.some((u) => u.email === user.email)) {
      rows.unshift({
        email: user.email,
        username: user.username,
        banned: false,
        isSession: true,
      });
    }
    return rows;
  }, [localUsers, user]);

  // Cloud: the shared book (banned rows INCLUDED — the admin needs them to
  // unban). Local: this browser's markets + the seeds.
  const communityMarkets = useMemo(
    () =>
      cloudFeedEnabled
        ? cloudMarkets
        : [...userMarkets, ...seedMarkets].map((m) => mergeMarket(m, overrides[m.id])),
    [cloudMarkets, userMarkets, overrides]
  );

  /**
   * Every market the admin can act on: the community book above (banned
   * rows INCLUDED — Unban needs them) PLUS the Global feed.
   *
   * Global markets are `resolution: 'oracle'`, and this table is their
   * only settlement path: /portfolio resolves manual markets for their
   * creator, and Finalize needs community ballots. Leaving them out is
   * what made money spent on them impossible to pay out.
   */
  const adminMarkets = useMemo(() => {
    const rows = [...communityMarkets];
    const seen = new Set(rows.map((m) => m.id));
    for (const m of [...poly, ...polyEvents.flatMap((e) => e.markets)]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      rows.push(mergeMarket(m, overrides[m.id]));
    }
    return rows;
  }, [communityMarkets, poly, polyEvents, overrides]);

  // Payment lists — cloud mode reads the Supabase rows, local mode the store.
  const sortedDeposits = useMemo(
    () => sortPendingFirst(supabaseEnabled ? (cloudPayments?.deposits ?? []) : deposits),
    [cloudPayments, deposits]
  );

  const sortedWithdrawals = useMemo(
    () => sortPendingFirst(supabaseEnabled ? (cloudPayments?.withdrawals ?? []) : withdrawals),
    [cloudPayments, withdrawals]
  );

  // Pending payments — split into deposits and withdrawals for the cards.
  const pendingDeposits = useMemo(
    () => sortedDeposits.filter((d) => d.status === 'pending').length,
    [sortedDeposits]
  );
  const pendingWithdrawals = useMemo(
    () => sortedWithdrawals.filter((w) => w.status === 'pending').length,
    [sortedWithdrawals]
  );

  // Overview "Users" card — profiles count from the DB in cloud mode.
  // A failed read shows '—', never '0': that conflation is the bug this
  // pass exists to remove.
  const usersStat = supabaseEnabled
    ? cloudProfiles && !cloudErrors.profiles
      ? String(cloudProfiles.length)
      : '—'
    : String(userRows.length);

  if (!hydrated) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-44 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // Non-admins (signed in or not) get a generic not-found page — this
  // route does not reveal that an admin panel exists.
  if (!user?.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          icon={SearchX}
          title="Page not found"
          description="The page you are looking for does not exist or has been moved."
          actionLabel="Back to home"
          actionHref="/"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-3xl font-black tracking-tight text-tx">
            <ShieldCheck className="h-7 w-7 text-green" aria-hidden />
            Admin
          </h1>
          <p className="mt-1 text-sm text-tx-sec">
            Manage users, markets, categories, payments and platform settings.
          </p>
        </div>
      </div>

      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <Panel tab="overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard label="Users" value={usersStat} />
            <StatCard label="Community markets" value={String(communityMarkets.length)} />
            <StatCard label="Open positions" value={String(positions.length)} />
            <StatCard label="Balance" value={formatMoney(balance)} />
            <StatCard label="Custom categories" value={String(customCategories.length)} />
            <StatCard
              label="Pending deposits"
              value={String(pendingDeposits)}
              accent={pendingDeposits > 0 ? 'amber' : undefined}
            />
            <StatCard
              label="Pending withdrawals"
              value={String(pendingWithdrawals)}
              accent={pendingWithdrawals > 0 ? 'amber' : undefined}
            />
          </div>
        </Panel>
      )}

      {tab === 'revenue' && (
        <Panel tab="revenue">
          <RevenuePanel />
        </Panel>
      )}

      {tab === 'users' && (
        <Panel tab="users">
          {supabaseEnabled ? (
            <>
              <CloudPanelHeader
                hint="Every registered profile, live from Supabase."
                refreshing={cloudRefreshing}
                onRefresh={refreshCloud}
              />
              {cloudProfiles === null ? (
                <CloudTableSkeleton />
              ) : (
                <>
                  <CloudDiagnostics
                    email={user?.email ?? ''}
                    profiles={cloudProfiles}
                    profilesError={cloudErrors.profiles}
                    payments={cloudPayments}
                    paymentsError={cloudErrors.payments}
                  />
                  {cloudErrors.profiles ? (
                    <CloudErrorState error={cloudErrors.profiles} onRetry={refreshCloud} />
                  ) : (
                    <CloudUsersPanel
                      profiles={cloudProfiles}
                      onBanChange={handleCloudBanChange}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <UsersPanel rows={userRows} />
          )}
        </Panel>
      )}

      {tab === 'markets' && (
        <Panel tab="markets">
          <MarketsTab markets={adminMarkets} />
        </Panel>
      )}

      {tab === 'categories' && (
        <Panel tab="categories">
          <CategoriesPanel />
        </Panel>
      )}

      {tab === 'payments' && (
        <Panel tab="payments">
          {supabaseEnabled && (
            <CloudPanelHeader
              hint="Deposit and withdrawal requests from every user, live from Supabase."
              refreshing={cloudRefreshing}
              onRefresh={refreshCloud}
            />
          )}
          {supabaseEnabled && cloudPayments === null ? (
            <CloudTableSkeleton />
          ) : supabaseEnabled && cloudErrors.payments ? (
            <CloudErrorState error={cloudErrors.payments} onRetry={refreshCloud} />
          ) : (
            <>
              {/* The heading moved INTO DepositsPanel — it owns the
                  "Verify all pending" control that sits beside it. */}
              <DepositsPanel
                deposits={sortedDeposits}
                onChanged={supabaseEnabled ? refreshCloud : undefined}
              />
              <h2 className="pt-2 text-sm font-extrabold uppercase tracking-wide text-tx-sec">
                Withdrawals
              </h2>
              <WithdrawalsPanel
                withdrawals={sortedWithdrawals}
                onChanged={supabaseEnabled ? refreshCloud : undefined}
              />
            </>
          )}
        </Panel>
      )}

      {tab === 'settings' && (
        <Panel tab="settings">
          <SettingsPanel />
        </Panel>
      )}
    </div>
  );
}
