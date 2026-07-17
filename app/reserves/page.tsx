'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import { fetchReserves, type ReservesStats } from '@/lib/cloud';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * v8 — PUBLIC proof of reserves.
 *
 * On a crypto platform, trust IS the product — so the solvency number is
 * published, not asserted. `reserves_stats()` is anon-readable by design
 * and deliberately includes `platform_balance`: a reserves page with a
 * secret house buffer proves nothing.
 *
 * THE claim: total collateral >= open liability, always — every share is
 * minted from a complete set, so the pool holds the losing side's dollar
 * before the winning side can ever claim it.
 */

function Tile({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-black tabular-nums',
          accent ? 'text-green' : 'text-tx'
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-tx-mut">{sub}</div>}
    </div>
  );
}

export default function ReservesPage() {
  const [stats, setStats] = useState<ReservesStats | null>();

  useEffect(() => {
    let alive = true;
    void fetchReserves().then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-tx">
          Proof of reserves
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-tx-sec">
          Every market on Callitnow is fully collateralized: shares are minted from
          complete sets, so the pool holds a dollar of real collateral for every
          dollar it could ever owe. These numbers read live from the book —
          nothing here is asserted, it is published.
        </p>
      </div>

      {stats === undefined ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : stats === null ? (
        // NEVER render zeros here — zeros read as insolvency.
        <EmptyState
          icon={ShieldCheck}
          title="Reserves are published in cloud mode."
          description="This deployment is running without its database connection, so there is no live book to report on."
        />
      ) : (
        <>
          {(() => {
            const ratio = stats.totalCollateral / Math.max(stats.openLiability, 1);
            const backed = ratio >= 1;
            return (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-4 rounded-2xl border p-6',
                  backed
                    ? 'border-green/40 bg-green/5'
                    : 'border-danger/40 bg-danger/5'
                )}
              >
                {backed ? (
                  <CheckCircle2 className="h-10 w-10 shrink-0 text-green" aria-hidden />
                ) : (
                  <ShieldAlert className="h-10 w-10 shrink-0 text-danger" aria-hidden />
                )}
                <div>
                  <div
                    className={cn(
                      'text-2xl font-black tabular-nums',
                      backed ? 'text-green' : 'text-danger'
                    )}
                  >
                    {backed ? 'Fully backed' : 'Under-collateralized'} ·{' '}
                    {(ratio * 100).toFixed(0)}%
                  </div>
                  <p className="mt-0.5 text-sm text-tx-sec">
                    Collateral held vs. the maximum the book could ever owe.
                  </p>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Tile
              label="Total collateral held"
              value={formatMoney(stats.totalCollateral)}
              accent
              sub="Real money sitting in open market pools."
            />
            <Tile
              label="Open liability"
              value={formatMoney(stats.openLiability)}
              sub="The most winners could ever be owed."
            />
            <Tile
              label="Platform balance"
              value={formatMoney(stats.platformBalance)}
              sub="Fees earned — published, not hidden."
            />
            <Tile
              label="Fees accrued to LPs"
              value={formatMoney(stats.feesAccrued)}
              sub="Paid to each market's funder at settlement."
            />
            <Tile label="Open markets" value={String(stats.openMarkets)} />
            <Tile label="Funded pools" value={String(stats.fundedMarkets)} />
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-5 text-sm leading-relaxed text-tx-sec">
            <h2 className="text-sm font-bold text-tx">How this works</h2>
            <p className="mt-2">
              When you buy shares, your money mints a complete set — one Yes and
              one No share — into the market&apos;s pool, and you receive your
              side. Since exactly one side pays $1 at resolution, the pool
              always holds at least as much collateral as the winning side can
              claim. That is why the ratio above cannot drop below 100% through
              trading: it is arithmetic, not a promise.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
