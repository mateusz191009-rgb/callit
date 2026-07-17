'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Banknote, CloudOff, Coins, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import { platformCashoutCloud } from '@/lib/cloud';
import { RESOLVE_FEE, useCallitStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/** v7 default platform slice (`platform_settings.platform_fee_bps`), used
 *  only until the live config lands so the copy never reads "0%". */
const DEFAULT_PLATFORM_FEE_BPS = 100;

/** `100` -> `'1%'`, `150` -> `'1.5%'`. */
function feeLabel(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** What `admin_platform_stats()` returns (jsonb, so a plain object). */
interface PlatformStats {
  platformBalance: number;
  feesAccruedTotal: number;
  totalCollateral: number;
  openMarkets: number;
}

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: 'green';
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="text-xs font-bold uppercase tracking-wide text-tx-mut">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-black tabular-nums',
          accent === 'green' ? 'text-green' : 'text-tx'
        )}
      >
        {value}
      </div>
      <p className="mt-1 text-xs leading-snug text-tx-mut">{hint}</p>
    </div>
  );
}

/**
 * v9 — the operator taking their earnings out. Bookkeeping only: the RPC
 * deducts the amount from the till and writes an audit row; moving the
 * actual crypto is the operator's own transfer from wallets they already
 * hold. Two-step confirm (arm -> confirm, auto-disarms after 5s) — this
 * changes the PUBLIC /reserves number, it should never be a slip.
 */
function CashOutCard({
  balance,
  onCashedOut,
}: {
  balance: number;
  onCashedOut: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const disarmTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    };
  }, []);

  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= balance;

  const handleClick = async () => {
    if (pending || !valid) return;
    if (!armed) {
      setArmed(true);
      disarmTimer.current = window.setTimeout(() => setArmed(false), 5000);
      return;
    }
    if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    setArmed(false);
    setPending(true);
    const res = await platformCashoutCloud(n);
    setPending(false);
    if (res.ok) {
      toast.success(
        `Cashed out ${formatMoney(n)} — platform balance is now ${formatMoney(res.newBalance ?? 0)}.`
      );
      setAmount('');
      onCashedOut();
    } else {
      toast.error(res.error ?? 'Cash-out failed.');
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-tx-mut">
        <Banknote className="h-4 w-4" aria-hidden />
        Cash out earnings
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-tx-mut">
        Books a withdrawal of platform earnings: the till (and the public
        proof-of-reserves number) drops by the amount, and an audit row is
        kept. Move the actual crypto from your own wallets — user funds are
        untouched. Available:{' '}
        <span className="font-bold tabular-nums text-tx">{formatMoney(balance)}</span>
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setArmed(false);
          }}
          placeholder="Amount in USD"
          className="sm:max-w-[200px]"
        />
        <Button
          variant={armed ? 'danger' : 'outline'}
          size="md"
          loading={pending}
          disabled={!valid}
          onClick={() => void handleClick()}
        >
          {armed ? 'Click again to confirm' : 'Cash out'}
        </Button>
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[116px] w-full rounded-2xl" />
      ))}
    </div>
  );
}

/**
 * The operator's revenue view — "how does this site actually make money".
 *
 * Reads `admin_platform_stats()` (v7, admin-only, SECURITY DEFINER). That
 * RPC is the ONLY read path for the till: v7 narrowed the column grants on
 * `platform_settings`, so selecting `platform_balance` from the table now
 * fails for `authenticated` — admins included. Do not "optimize" this into
 * a table read.
 *
 * Degrades instead of breaking: local mode (no Supabase) and a missing
 * function both land on the EmptyState, since the whole panel is
 * operator-only reporting with nothing to fall back to.
 */
export default function RevenuePanel() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const platformSettings = useCallitStore((s) => s.platformSettings);
  const refreshPlatformSettings = useCallitStore((s) => s.refreshPlatformSettings);

  // The trading-fee slice quoted in the explainer — the live config, so it
  // stays true after an admin changes the split in Settings.
  const platformFeeBps = platformSettings?.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS;

  useEffect(() => {
    if (platformSettings) return;
    void refreshPlatformSettings();
  }, [platformSettings, refreshPlatformSettings]);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setFailed(true);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_platform_stats');
      if (error || !data) {
        setFailed(true);
        setStats(null);
        return;
      }
      const row = data as Record<string, unknown>;
      setStats({
        platformBalance: num(row.platform_balance),
        feesAccruedTotal: num(row.fees_accrued_total),
        totalCollateral: num(row.total_collateral),
        openMarkets: num(row.open_markets),
      });
      setFailed(false);
    } catch {
      setFailed(true);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-tx-mut">
            <Coins className="h-4 w-4" aria-hidden />
            Revenue
          </h2>
          <p className="mt-1 text-xs text-tx-mut">
            What the platform has earned, and what it is holding for other people.
          </p>
        </div>
        {!loading && !failed && (
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </Button>
        )}
      </div>

      {loading ? (
        <StatsSkeleton />
      ) : failed ? (
        <EmptyState
          icon={CloudOff}
          title="Revenue stats unavailable"
          description="This view reads admin_platform_stats() from Supabase. It needs cloud mode and an admin account — in local mode there is no till to report."
        />
      ) : (
        stats && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Platform balance"
              value={formatMoney(stats.platformBalance)}
              hint="Fees earned. Yours."
              accent="green"
            />
            <StatCard
              label="Fees accrued to LPs"
              value={formatMoney(stats.feesAccruedTotal)}
              hint="Owed to funders at resolution — not yours."
            />
            <StatCard
              label="Total collateral held"
              value={formatMoney(stats.totalCollateral)}
              hint="Backs open positions. Never revenue."
            />
            <StatCard
              label="Open markets"
              value={String(stats.openMarkets)}
              hint="Live and taking trades."
            />
          </div>
        )
      )}

      {!loading && !failed && stats && (
        <CashOutCard balance={stats.platformBalance} onCashedOut={() => void load()} />
      )}

      {/* The plain-English version of the three cards above. */}
      <div className="rounded-2xl border border-line bg-surface-2 p-5">
        <h3 className="text-xs font-black uppercase tracking-wide text-tx-mut">
          How Callitnow earns
        </h3>
        <ol className="mt-3 space-y-2.5 text-sm text-tx-sec">
          <li className="flex gap-3">
            <span className="font-black tabular-nums text-green">1</span>
            <span>
              <span className="font-bold text-tx">
                {feeLabel(platformFeeBps)} trading fee on every buy
              </span>{' '}
              — taken at trade time and banked to the platform balance, on every
              market, whoever funded it.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-black tabular-nums text-green">2</span>
            <span>
              <span className="font-bold text-tx">
                LP earnings on platform-seeded Global markets
              </span>{' '}
              — the platform is the liquidity provider there, so their accrued LP
              fees and leftover seed come back to it at resolution. Community
              markets pay their own creator instead.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-black tabular-nums text-green">3</span>
            <span>
              <span className="font-bold text-tx">
                The {formatMoney(RESOLVE_FEE, { decimals: 0 })} resolve fee
              </span>{' '}
              — charged when a manual market is settled.
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}
