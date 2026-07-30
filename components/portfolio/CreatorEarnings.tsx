'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Coins, Info, Plus } from 'lucide-react';
import { toast } from 'sonner';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import { RecordCard, RecordField, RecordFields } from '@/components/ui/record';
import EmptyState from '@/components/common/EmptyState';
import {
  claimCreatorFeesCloud,
  fetchCreatorEarnings,
  type CreatorEarnings as Earnings,
  type CreatorMarketEarning,
} from '@/lib/cloud';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { feeLabel, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * v25.46 — WHAT YOUR MARKETS HAVE EARNED YOU, AND THE BUTTON THAT PAYS IT.
 *
 * Every trade on a market takes a fee and splits it: one half is the
 * platform's and is banked at trade time, the other half is the LP's — and on
 * a community market the LP is whoever funded it, i.e. the creator. That half
 * accrues in `markets.fees_accrued` and, before this, only ever became money
 * inside the settlement path. Community markets settle when an ADMIN confirms
 * the community vote, and `finalize_community_market` refuses a market with no
 * majority, so a creator's fees could sit unreachable indefinitely with no way
 * to even see them.
 *
 * This is the other half: read `creator_earnings()`, show the number, and let
 * them take it with `claim_creator_fees()` whenever they want. Claiming does
 * not touch the pool — the fee never entered `collateral` — so the seed stays
 * backing the market exactly as before and the residual is still settled at
 * resolution.
 *
 * The SERVER decides what is claimable. Everything here is display: the
 * buttons are hidden when the amount is zero, but the RPC is what enforces
 * "open, unbanned, funded by you", and it is idempotent — a double click pays
 * once and reports $0.00 the second time.
 */

/** A row's own title: an event outcome reads "Event — Outcome". */
function titleOf(m: CreatorMarketEarning): string {
  if (m.eventTitle && m.shortName) return `${m.eventTitle} — ${m.shortName}`;
  return m.question || m.id;
}

/** What this market is doing right now, in one badge. */
function StatusBadge({ m, ended }: { m: CreatorMarketEarning; ended: boolean }) {
  if (m.banned) return <Badge variant="danger">Voided</Badge>;
  if (m.status === 'resolved') {
    return (
      <Badge variant="neutral">
        {m.resolvedOutcome === 'void'
          ? 'Refunded'
          : m.resolvedOutcome
            ? `Resolved ${m.resolvedOutcome === 'yes' ? 'Yes' : 'No'}`
            : 'Resolved'}
      </Badge>
    );
  }
  return ended ? <Badge variant="amber">Awaiting vote</Badge> : <Badge variant="green">Live</Badge>;
}

/** One stat tile of the summary strip. */
function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="card-surface p-4 sm:p-5">
      <div className="text-micro font-semibold uppercase tracking-wide text-tx-mut">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-xl font-black tabular-nums sm:text-2xl',
          accent ? 'text-green' : 'text-tx'
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-micro text-tx-mut">{hint}</div>}
    </div>
  );
}

export default function CreatorEarnings() {
  const user = useCallitStore((s) => s.user);
  const refreshProfile = useCallitStore((s) => s.refreshProfile);
  const cloud = supabaseEnabled && Boolean(user);

  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  /** The market id being claimed, or 'all' — one spinner at a time. */
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cloud) {
      setData(null);
      setLoading(false);
      return;
    }
    const next = await fetchCreatorEarnings();
    setData(next);
    setLoading(false);
  }, [cloud]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchCreatorEarnings().then((next) => {
      if (cancelled) return;
      setData(cloud ? next : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [cloud]);

  const claim = async (marketId?: string) => {
    if (claiming) return;
    setClaiming(marketId ?? 'all');
    const res = await claimCreatorFeesCloud(marketId);
    setClaiming(null);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not claim your fees.');
      return;
    }
    const amount = res.claimed ?? 0;
    if (amount <= 0) {
      // Not an error: someone else's settlement (or a second click) already
      // moved this money onto the balance.
      toast.info('Nothing left to claim — already paid out.');
    } else {
      toast.success(
        `Claimed ${formatMoney(amount)} in creator fees — it is on your balance.`
      );
    }
    // The balance changed server-side; pull both numbers back rather than
    // guessing them locally.
    await Promise.all([refreshProfile(), load()]);
  };

  // Ended but still open = the community vote + admin confirmation the
  // creator is waiting on. Computed once, post-hydration, so the server and
  // the first client render agree.
  const now = Date.now();
  const rows = useMemo(() => {
    if (!data) return [];
    return data.markets.map((m) => {
      const end = new Date(m.endDate).getTime();
      const ended = Number.isFinite(end) && end <= now;
      const claimable = m.status === 'open' && !m.banned ? m.feesAccrued : 0;
      return { m, ended, claimable };
    });
    // `now` intentionally not a dependency — a re-render per tick would only
    // flip the "Awaiting vote" badge a second earlier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading) return <Skeleton className="h-64 w-full rounded-2xl" />;

  if (!cloud) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs text-tx-mut">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Creator fees are booked by the server. Local demo mode has no fee ledger — sign
          in on the live app to see what your markets have earned.
        </span>
      </div>
    );
  }

  // `null` is NOT zero. A failed read must never render "$0.00 earned" over a
  // market that has been trading.
  if (!data) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs text-tx-mut">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
        <span>
          Your earnings could not be read just now. Refresh in a moment — nothing has been
          lost, the fees stay booked against each market until you claim them.
        </span>
      </div>
    );
  }

  if (data.markets.length === 0) {
    return (
      <EmptyState
        icon={Plus}
        title="You haven't funded a market yet."
        description={`Launch one and you earn ${feeLabel(data.lpFeeBps)} of every dollar traded on it, claimable any time.`}
        actionLabel="Create your first market"
        actionHref="/create"
      />
    );
  }

  const claimingAll = claiming === 'all';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="Claimable now"
          value={formatMoney(data.claimable)}
          hint={`${feeLabel(data.lpFeeBps)} of every trade`}
          accent={data.claimable > 0}
        />
        <Stat
          label="Already paid out"
          value={formatMoney(data.claimed)}
          hint="Claimed + settled"
        />
        <Stat
          label="Seed in your pools"
          value={formatMoney(data.locked)}
          hint="Returns at resolution"
        />
        <Stat label="Volume traded" value={formatMoney(data.volume)} hint="Across your markets" />
      </div>

      <div className="card-surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-tx">
            <Coins className="h-4 w-4 shrink-0 text-green" aria-hidden />
            Your share of the trading fee
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-tx-mut">
            Every buy on a market you funded pays you {feeLabel(data.lpFeeBps)} of the
            stake. It is yours as soon as it is earned — you do not have to wait for the
            market to resolve, and claiming leaves your seed backing the pool untouched.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          disabled={data.claimable <= 0 || claiming !== null}
          loading={claimingAll}
          onClick={() => void claim()}
        >
          {data.claimable > 0 ? `Claim ${formatMoney(data.claimable)}` : 'Nothing to claim'}
        </Button>
      </div>

      {/* Phone: one card per market — the table below is six columns wide and
          the two that matter (claimable + the button) sit furthest right. */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map(({ m, ended, claimable }) => (
          <RecordCard key={m.id}>
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/market/${encodeURIComponent(m.id)}`}
                className="min-w-0 flex-1 text-mini font-semibold leading-snug text-tx"
              >
                <span className="line-clamp-2">{titleOf(m)}</span>
              </Link>
              <StatusBadge m={m} ended={ended} />
            </div>
            <RecordFields>
              <RecordField label="Volume" value={formatMoney(m.volume)} />
              <RecordField label="Your rate" value={feeLabel(m.lpFeeBps)} />
              <RecordField label="Paid out" value={formatMoney(m.feesClaimed)} />
            </RecordFields>
            <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
              <div className="min-w-0">
                <div className="text-nano font-semibold uppercase tracking-wide text-tx-mut">
                  Claimable
                </div>
                <div
                  className={cn(
                    'text-base font-black tabular-nums',
                    claimable > 0 ? 'text-green' : 'text-tx-mut'
                  )}
                >
                  {formatMoney(claimable)}
                </div>
              </div>
              {claimable > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={claiming !== null}
                  loading={claiming === m.id}
                  onClick={() => void claim(m.id)}
                >
                  Claim
                </Button>
              ) : (
                <span className="text-mini text-tx-mut">
                  {m.status === 'resolved' ? 'Settled' : 'No fees yet'}
                </span>
              )}
            </div>
            {m.status === 'open' && ended && (
              <p className="flex items-start gap-1.5 text-nano leading-snug text-tx-mut">
                <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Awaiting community vote + team confirmation — your fees are claimable
                already.
              </p>
            )}
          </RecordCard>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-2xl border border-line md:block">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-tx-mut">
            <tr>
              <th className="px-4 py-3 font-semibold">Market</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Volume</th>
              <th className="px-4 py-3 text-right font-semibold">Your rate</th>
              <th className="px-4 py-3 text-right font-semibold">Paid out</th>
              <th className="px-4 py-3 text-right font-semibold">Claimable</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ m, ended, claimable }) => (
              <tr key={m.id} className="hover:bg-surface-2/60">
                <td className="max-w-[22rem] px-4 py-3">
                  <Link
                    href={`/market/${encodeURIComponent(m.id)}`}
                    className="line-clamp-2 font-semibold text-tx hover:text-green"
                  >
                    {titleOf(m)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge m={m} ended={ended} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                  {formatMoney(m.volume)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                  {feeLabel(m.lpFeeBps)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                  {formatMoney(m.feesClaimed)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-bold tabular-nums',
                    claimable > 0 ? 'text-green' : 'text-tx-mut'
                  )}
                >
                  {formatMoney(claimable)}
                </td>
                <td className="px-4 py-3 text-right">
                  {claimable > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={claiming !== null}
                      loading={claiming === m.id}
                      onClick={() => void claim(m.id)}
                    >
                      Claim
                    </Button>
                  ) : (
                    <span className="text-xs text-tx-mut">
                      {m.status === 'resolved' ? 'Settled' : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
