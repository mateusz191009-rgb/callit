'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  Info,
  LogIn,
} from 'lucide-react';
import Badge, { type BadgeVariant } from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import EmptyState from '@/components/common/EmptyState';
import { useCallitStore } from '@/lib/store';
import { fetchMyPayments } from '@/lib/cloud';
import { supabaseEnabled } from '@/lib/supabase';
import { useMarketMap, usePositions } from '@/lib/useMarkets';
import {
  MIN_DEPOSIT,
  MIN_DEPOSIT_COPY,
  MIN_WITHDRAWAL,
  MIN_WITHDRAWAL_COPY,
} from '@/lib/limits';
import { WALLETS, walletFor } from '@/lib/wallets';
import { formatDate, formatMoney, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Deposit, DepositCurrency, Withdrawal } from '@/lib/types';

const STATUS_BADGE: Record<Deposit['status'], { variant: BadgeVariant; label: string }> = {
  pending: { variant: 'amber', label: 'Pending' },
  approved: { variant: 'green', label: 'Approved' },
  rejected: { variant: 'danger', label: 'Rejected' },
};

type WalletTab = 'deposit' | 'withdraw';

const WALLET_TABS: TabItem<WalletTab>[] = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdraw', label: 'Withdraw' },
];

/** Minimum plausible length for a crypto destination address (basic check). */
const MIN_ADDRESS_LENGTH = 20;

function CurrencySelector({
  currency,
  onChange,
  ariaLabel,
}: {
  currency: DepositCurrency;
  onChange: (c: DepositCurrency) => void;
  ariaLabel: string;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-tx-sec">
        Choose currency
      </h2>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        {WALLETS.map((w) => {
          const selected = w.currency === currency;
          return (
            <button
              key={w.currency}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(w.currency)}
              className={cn(
                'flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors',
                selected
                  ? 'border-green bg-green/10'
                  : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3'
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: w.color }}
                  aria-hidden
                />
                <span className="text-sm font-extrabold text-tx">{w.currency}</span>
              </span>
              <span className="text-xs text-tx-mut">{w.label}</span>
              <Badge variant="neutral">{w.network}</Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function WalletPage() {
  const balance = useCallitStore((s) => s.balance);
  const deposits = useCallitStore((s) => s.deposits);
  const withdrawals = useCallitStore((s) => s.withdrawals);
  const requestDeposit = useCallitStore((s) => s.requestDeposit);
  const requestWithdrawal = useCallitStore((s) => s.requestWithdrawal);
  const refreshProfile = useCallitStore((s) => s.refreshProfile);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const user = useCallitStore((s) => s.user);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);

  // v4 cloud mode: Supabase is the source of truth for payment history —
  // the persisted store arrays stay empty/stale while signed in there.
  const cloud = supabaseEnabled && Boolean(user);

  // Open positions are a LIABILITY against the balance, not part of it:
  // the stake left the balance when the trade filled and only comes back
  // (as $1/share, or nothing) when the market resolves. The wallet used to
  // say nothing about them, which made "available balance" look like the
  // whole account to anyone holding positions.
  const positions = usePositions();
  const { map: marketById } = useMarketMap();
  const openPositionsCost = useMemo(
    () =>
      positions.reduce((sum, p) => {
        // A resolved market has already paid out; anything still listed
        // against one is stale local state, so it is not a liability.
        const market = marketById.get(p.marketId);
        if (market?.status === 'resolved') return sum;
        return sum + p.shares * p.avgPrice;
      }, 0),
    [positions, marketById]
  );

  const [tab, setTab] = useState<WalletTab>('deposit');
  const [currency, setCurrency] = useState<DepositCurrency>('BTC');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  // Withdraw form
  const [wAmount, setWAmount] = useState('');
  const [wAddress, setWAddress] = useState('');
  const [wSubmitting, setWSubmitting] = useState(false);
  const [wAmountError, setWAmountError] = useState<string | null>(null);
  const [wAddressError, setWAddressError] = useState<string | null>(null);

  // Live crypto prices (USD per unit) for fiat approximations — fetched
  // once on mount. On failure `prices` stays null and every approximation
  // hides silently; bets and balances remain USD-denominated regardless.
  const [prices, setPrices] = useState<Partial<Record<DepositCurrency, number>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/prices')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Partial<Record<DepositCurrency, number>>) => {
        if (!cancelled && data && typeof data === 'object') setPrices(data);
      })
      .catch(() => {
        // Silent — approximations are simply not shown.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cloud payment history (fetchMyPayments). `null` = not loaded yet.
  const [cloudPayments, setCloudPayments] = useState<{
    deposits: Deposit[];
    withdrawals: Withdrawal[];
  } | null>(null);

  const loadPayments = useCallback(async () => {
    if (!cloud) return;
    const payments = await fetchMyPayments();
    setCloudPayments(payments);
  }, [cloud]);

  // On entering cloud mode (mount while signed in, or sign-in later):
  // pull the fresh profile balance and the payment history from Supabase.
  useEffect(() => {
    if (!cloud) {
      setCloudPayments(null);
      return;
    }
    void refreshProfile();
    void loadPayments();
  }, [cloud, loadPayments, refreshProfile]);

  const shownDeposits = cloud ? (cloudPayments?.deposits ?? []) : deposits;
  const shownWithdrawals = cloud ? (cloudPayments?.withdrawals ?? []) : withdrawals;
  const historyLoading = cloud && cloudPayments === null;

  /** '≈ 0.00085 BTC' in the selected currency (max 6 significant digits),
   *  or null when the live price is unavailable. */
  const approxIn = (usd: number): string | null => {
    const price = prices?.[currency];
    if (typeof price !== 'number' || !(price > 0) || !Number.isFinite(usd) || usd < 0) {
      return null;
    }
    const units = usd / price;
    return `≈ ${units.toLocaleString('en-US', { maximumSignificantDigits: 6 })} ${currency}`;
  };

  const depositAmountNum = Number(amount);
  const depositApprox =
    Number.isFinite(depositAmountNum) && depositAmountNum > 0
      ? approxIn(depositAmountNum)
      : null;
  const withdrawAmountNum = Number(wAmount);
  const withdrawApprox =
    Number.isFinite(withdrawAmountNum) && withdrawAmountNum > 0
      ? approxIn(withdrawAmountNum)
      : null;
  const balanceApprox = approxIn(balance);

  const wallet = walletFor(currency);
  const pendingTotal = shownDeposits
    .filter((d) => d.status === 'pending')
    .reduce((sum, d) => sum + d.amount, 0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      toast.success('Address copied');
    } catch {
      toast.error('Could not copy — select the address and copy it manually.');
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setDepositError('Enter a valid USD amount.');
      return;
    }
    if (n < MIN_DEPOSIT) {
      setDepositError(MIN_DEPOSIT_COPY);
      return;
    }
    setDepositError(null);
    setSubmitting(true);
    // Small delay purely for tactile feedback. requestDeposit is async
    // (v4 cloud mode routes through a Supabase RPC).
    setTimeout(() => {
      void requestDeposit(currency, n, txHash || undefined).then((res) => {
        if (res.ok) {
          toast.success('Deposit submitted — pending approval');
          setAmount('');
          setTxHash('');
          // Cloud rows live in Supabase — refetch so the new request shows.
          void loadPayments();
        } else {
          toast.error(res.error ?? 'Could not submit the deposit.');
        }
        setSubmitting(false);
      });
    }, 350);
  };

  const handleWithdraw = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number(wAmount);
    const addr = wAddress.trim();

    // Validate both fields before returning, so one submit surfaces every
    // problem instead of making the user fix them one at a time.
    let amountError: string | null = null;
    if (!Number.isFinite(n) || n <= 0) amountError = 'Enter a valid USD amount.';
    else if (n < MIN_WITHDRAWAL) amountError = MIN_WITHDRAWAL_COPY;
    else if (n > balance) {
      amountError =
        openPositionsCost > 0
          ? `Amount exceeds your balance of ${formatMoney(balance)}. Funds in open positions cannot be withdrawn until those markets resolve.`
          : `Amount exceeds your balance of ${formatMoney(balance)}.`;
    }
    const addressError =
      addr.length < MIN_ADDRESS_LENGTH ? 'Enter a valid destination address.' : null;

    setWAmountError(amountError);
    setWAddressError(addressError);
    if (amountError || addressError) return;

    setWSubmitting(true);
    // Small delay purely for tactile feedback. requestWithdrawal is async
    // (v4 cloud mode reserves the amount server-side via RPC).
    setTimeout(() => {
      void requestWithdrawal(currency, n, addr).then((res) => {
        if (res.ok) {
          toast.success('Withdrawal requested — pending review');
          setWAmount('');
          setWAddress('');
          // The amount is reserved server-side in cloud mode — refresh the
          // profile so the reduced balance shows, and refetch the history.
          void refreshProfile();
          void loadPayments();
        } else {
          toast.error(
            res.error ?? 'Could not request the withdrawal — check amount and balance.'
          );
        }
        setWSubmitting(false);
      });
    }, 350);
  };

  // Guests see a sign-in prompt instead of balance + deposit tools.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-black tracking-tight text-tx">Wallet</h1>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-tx">Wallet</h1>
          <p className="mt-1 text-sm text-tx-mut">
            Deposit crypto to top up your balance. Approved deposits are credited in USD.
          </p>
        </div>
        <EmptyState
          icon={LogIn}
          title="Sign in to deposit"
          description="Your balance, deposit addresses and requests are available once you are signed in."
          actionLabel="Log in"
          onAction={() => openAuthModal('signin')}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Heading */}
      <div>
        <h1 className="text-3xl font-black tracking-tight text-tx">Wallet</h1>
        <p className="mt-1 text-sm text-tx-mut">
          Deposit crypto to top up your balance, or withdraw to your own address.
        </p>
      </div>

      {/* Balance card */}
      <div className="rounded-2xl border border-line bg-surface-2 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
              Available to withdraw
            </div>
            {hydrated ? (
              <>
                <div className="mt-1 text-3xl font-black tabular-nums text-tx">
                  {formatMoney(balance)} <span className="text-base text-tx-sec">USDC</span>
                </div>
                {balanceApprox && (
                  <div className="mt-0.5 text-xs tabular-nums text-tx-mut">{balanceApprox}</div>
                )}
              </>
            ) : (
              <Skeleton className="mt-2 h-8 w-40 rounded-lg" />
            )}
          </div>
          {hydrated && pendingTotal > 0 && (
            <Badge variant="amber" className="px-2 py-1">
              {formatMoney(pendingTotal)} pending approval
            </Badge>
          )}
        </div>

        {/* Open positions are money you have staked, not money you hold —
            say so, rather than letting the balance imply it is everything. */}
        {hydrated && openPositionsCost > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-tx-mut">
            You have{' '}
            <span className="font-bold tabular-nums text-tx-sec">
              {formatMoney(openPositionsCost)}
            </span>{' '}
            in open positions — those funds are not in your balance until the markets
            resolve.
          </p>
        )}
      </div>

      {/* Deposit | Withdraw */}
      <Tabs items={WALLET_TABS} value={tab} onChange={setTab} />

      {tab === 'deposit' && (
        <>
          <CurrencySelector
            currency={currency}
            onChange={setCurrency}
            ariaLabel="Deposit currency"
          />

          {/* Selected wallet panel */}
          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
              {/* QR */}
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-2xl bg-surface-3 p-4">
                  <QRCodeSVG
                    value={wallet.address}
                    size={180}
                    bgColor="transparent"
                    fgColor="#FFFFFF"
                    marginSize={2}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-tx-sec">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: wallet.color }}
                    aria-hidden
                  />
                  {wallet.label} deposit address
                </div>
              </div>

              {/* Address + form */}
              <div className="min-w-0 space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
                      {wallet.currency} address
                    </span>
                    <Badge variant="neutral">{wallet.network}</Badge>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-surface-3 p-3">
                    <span className="min-w-0 break-all font-mono text-xs text-tx">
                      {wallet.address}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label="Copy address"
                      className="shrink-0 rounded-lg border border-line bg-surface-2 p-2 text-tx-sec transition-colors hover:border-green/50 hover:text-green"
                    >
                      <Copy className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/10 p-3 text-xs font-semibold text-amber">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Send only {wallet.currency} on {wallet.network} to this address. Funds
                    sent on any other network cannot be recovered.
                  </span>
                </div>

                {/* Deposit request form */}
                <form onSubmit={handleSubmit} className="space-y-3 border-t border-line pt-4">
                  <h3 className="text-sm font-extrabold text-tx">Request deposit credit</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="deposit-amount"
                        className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-tx-mut"
                      >
                        Amount (USD value)
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-tx-mut">
                          $
                        </span>
                        <Input
                          id="deposit-amount"
                          type="number"
                          min={MIN_DEPOSIT}
                          step="any"
                          inputMode="decimal"
                          placeholder="100"
                          value={amount}
                          onChange={(e) => {
                            setAmount(e.target.value);
                            if (depositError) setDepositError(null);
                          }}
                          error={Boolean(depositError)}
                          aria-describedby={
                            depositError ? 'deposit-amount-error' : 'deposit-amount-hint'
                          }
                          className="pl-7 tabular-nums"
                        />
                      </div>
                      {depositError ? (
                        <p
                          id="deposit-amount-error"
                          className="mt-1 text-xs font-bold text-danger"
                        >
                          {depositError}
                        </p>
                      ) : (
                        <p id="deposit-amount-hint" className="mt-1 text-xs text-tx-mut">
                          Minimum {formatMoney(MIN_DEPOSIT, { decimals: 0 })}.
                        </p>
                      )}
                      {depositApprox && (
                        <p className="mt-1 text-xs tabular-nums text-tx-mut">
                          {depositApprox}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor="deposit-txhash"
                        className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-tx-mut"
                      >
                        Tx hash (optional)
                      </label>
                      <Input
                        id="deposit-txhash"
                        type="text"
                        placeholder="0x…"
                        value={txHash}
                        onChange={(e) => setTxHash(e.target.value)}
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                  <Button type="submit" variant="primary" size="md" loading={submitting}>
                    Submit deposit
                  </Button>
                  <p className="text-xs text-tx-mut">
                    An admin reviews every request. Balance updates after admin approval.
                  </p>
                </form>
              </div>
            </div>
          </div>

          {/* Deposits table */}
          <div className="space-y-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-tx-sec">
              Your deposits
            </h2>
            {historyLoading ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : shownDeposits.length === 0 ? (
              <EmptyState
                icon={ArrowDownToLine}
                title="No deposits yet."
                description="Send crypto to one of the addresses above, then submit a deposit request to get credited."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold">Currency</th>
                      <th className="px-4 py-3 text-right font-bold">Amount</th>
                      <th className="px-4 py-3 text-left font-bold">Status</th>
                      <th className="px-4 py-3 text-right font-bold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDeposits.map((d) => {
                      const status = STATUS_BADGE[d.status];
                      return (
                        <tr
                          key={d.id}
                          className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40"
                        >
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2 font-bold text-tx">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: walletFor(d.currency).color }}
                                aria-hidden
                              />
                              {d.currency}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                            {formatMoney(d.amount)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                            {formatDate(d.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'withdraw' && (
        <>
          <CurrencySelector
            currency={currency}
            onChange={setCurrency}
            ariaLabel="Withdrawal currency"
          />

          {/* Withdrawal request panel */}
          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            <form onSubmit={handleWithdraw} className="space-y-4">
              <h3 className="text-sm font-extrabold text-tx">Request withdrawal</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="withdraw-amount"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-tx-mut"
                  >
                    Amount (USD value)
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-tx-mut">
                      $
                    </span>
                    <Input
                      id="withdraw-amount"
                      type="number"
                      min={MIN_WITHDRAWAL}
                      step="any"
                      inputMode="decimal"
                      placeholder="100"
                      value={wAmount}
                      onChange={(e) => {
                        setWAmount(e.target.value);
                        if (wAmountError) setWAmountError(null);
                      }}
                      error={Boolean(wAmountError)}
                      aria-describedby={
                        wAmountError ? 'withdraw-amount-error' : 'withdraw-amount-hint'
                      }
                      className="pl-7 pr-14 tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setWAmount(String(balance));
                        setWAmountError(null);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface-3 px-2 py-1 text-[11px] font-bold uppercase text-tx-sec transition-colors hover:border-green/50 hover:text-green"
                    >
                      Max
                    </button>
                  </div>
                  {wAmountError ? (
                    <p id="withdraw-amount-error" className="mt-1 text-xs font-bold text-danger">
                      {wAmountError}
                    </p>
                  ) : (
                    <p id="withdraw-amount-hint" className="mt-1 text-xs text-tx-mut">
                      Minimum {formatMoney(MIN_WITHDRAWAL, { decimals: 0 })} · Available{' '}
                      <span className="tabular-nums">{formatMoney(balance)}</span>
                    </p>
                  )}
                  {withdrawApprox && (
                    <p className="mt-1 text-xs tabular-nums text-tx-mut">{withdrawApprox}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="withdraw-address"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-tx-mut"
                  >
                    Destination {currency} address
                  </label>
                  <Input
                    id="withdraw-address"
                    type="text"
                    placeholder={`Your ${currency} address`}
                    value={wAddress}
                    onChange={(e) => {
                      setWAddress(e.target.value);
                      if (wAddressError) setWAddressError(null);
                    }}
                    error={Boolean(wAddressError)}
                    aria-describedby={wAddressError ? 'withdraw-address-error' : undefined}
                    className="font-mono text-xs"
                  />
                  {wAddressError && (
                    <p id="withdraw-address-error" className="mt-1 text-xs font-bold text-danger">
                      {wAddressError}
                    </p>
                  )}
                </div>
              </div>
              <Button type="submit" variant="primary" size="md" loading={wSubmitting}>
                Request withdrawal
              </Button>
              <p className="text-xs text-tx-mut">
                Withdrawals are reviewed manually and paid out to your address. The amount
                is reserved from your balance while the request is pending; rejected
                requests are refunded. Minimum{' '}
                {formatMoney(MIN_WITHDRAWAL, { decimals: 0 })} per request.
              </p>
              {openPositionsCost > 0 && (
                <p className="text-xs text-tx-mut">
                  Only your balance of{' '}
                  <span className="font-bold tabular-nums text-tx-sec">
                    {formatMoney(balance)}
                  </span>{' '}
                  can be withdrawn. The{' '}
                  <span className="font-bold tabular-nums text-tx-sec">
                    {formatMoney(openPositionsCost)}
                  </span>{' '}
                  staked in your open positions is released when those markets resolve.
                </p>
              )}
            </form>
          </div>

          {/* Withdrawals table */}
          <div className="space-y-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-tx-sec">
              Your withdrawals
            </h2>
            {historyLoading ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : shownWithdrawals.length === 0 ? (
              <EmptyState
                icon={ArrowUpFromLine}
                title="No withdrawals yet."
                description="Request a withdrawal above — it is reviewed manually and paid out to your address."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold">Currency</th>
                      <th className="px-4 py-3 text-right font-bold">Amount</th>
                      <th className="px-4 py-3 text-left font-bold">Address</th>
                      <th className="px-4 py-3 text-left font-bold">Status</th>
                      <th className="px-4 py-3 text-right font-bold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownWithdrawals.map((w) => {
                      const status = STATUS_BADGE[w.status];
                      return (
                        <tr
                          key={w.id}
                          className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40"
                        >
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2 font-bold text-tx">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: walletFor(w.currency).color }}
                                aria-hidden
                              />
                              {w.currency}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                            {formatMoney(w.amount)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-tx-mut">
                            {shortAddress(w.address)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                            {formatDate(w.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Demo note */}
      <div className="flex items-start gap-2 rounded-2xl border border-line bg-surface-2 p-4 text-xs text-tx-mut">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Deposits and withdrawals are reviewed manually before they are credited or
          paid out.
        </span>
      </div>
    </div>
  );
}
