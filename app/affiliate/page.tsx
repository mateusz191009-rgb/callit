'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Check,
  CloudOff,
  Copy,
  Handshake,
  Hourglass,
  Link2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Select from '@/components/ui/select';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import {
  fetchAffiliateOverview,
  fetchMyAffiliatePayouts,
  requestAffiliatePayoutCloud,
  setAffiliateCodeCloud,
  type AffiliateOverview,
  type AffiliatePayout,
} from '@/lib/cloud';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DepositCurrency } from '@/lib/types';

const CURRENCIES: DepositCurrency[] = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL'];

/** Server-enforced minimum payout (request_affiliate_payout). */
const MIN_PAYOUT = 10;

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="text-xs font-bold uppercase tracking-wide text-tx-mut">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-black tabular-nums',
          accent ? 'text-green' : 'text-tx'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AffiliatePayout['status'] }) {
  if (status === 'approved') return <Badge variant="green">Paid</Badge>;
  if (status === 'rejected') return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="amber">Pending</Badge>;
}

export default function AffiliatePage() {
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const user = useCallitStore((s) => s.user);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);

  const [overview, setOverview] = useState<AffiliateOverview | null>(null);
  const [payouts, setPayouts] = useState<AffiliatePayout[]>([]);
  const [loading, setLoading] = useState(true);

  // Claim/change-code form.
  const [codeInput, setCodeInput] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [editingCode, setEditingCode] = useState(false);

  // Payout request form.
  const [currency, setCurrency] = useState<DepositCurrency>('USDT');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [requesting, setRequesting] = useState(false);

  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [ov, po] = await Promise.all([fetchAffiliateOverview(), fetchMyAffiliatePayouts()]);
    setOverview(ov);
    setPayouts(po);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (supabaseEnabled && user) void load();
    else setLoading(false);
  }, [user, load]);

  const referralLink = overview?.code ? `${origin}/?ref=${overview.code}` : '';

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success('Referral link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy the link manually.');
    }
  };

  const saveCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (savingCode) return;
    setSavingCode(true);
    const res = await setAffiliateCodeCloud(codeInput.trim());
    setSavingCode(false);
    if (res.ok) {
      toast.success(`Your affiliate code is now "${res.code}"`);
      setEditingCode(false);
      setCodeInput('');
      void load();
    } else {
      toast.error(res.error ?? 'Could not save the code.');
    }
  };

  const requestPayout = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (requesting) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n < MIN_PAYOUT) {
      toast.error(`Minimum payout is ${formatMoney(MIN_PAYOUT)}.`);
      return;
    }
    if (!address.trim()) {
      toast.error('Enter the destination address.');
      return;
    }
    setRequesting(true);
    const res = await requestAffiliatePayoutCloud(currency, n, address.trim());
    setRequesting(false);
    if (res.ok) {
      toast.success('Payout requested — the team will review and send it.');
      setAmount('');
      setAddress('');
      void load();
    } else {
      toast.error(res.error ?? 'Could not request the payout.');
    }
  };

  if (!hydrated) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-44 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          icon={Handshake}
          title="Affiliate program"
          description="Sign in to get your personal referral code and earn 50% of every referred user's first deposit."
          actionLabel="Sign in"
          onAction={() => openAuthModal('signin')}
        />
      </div>
    );
  }

  if (!supabaseEnabled) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          icon={CloudOff}
          title="Affiliate program unavailable"
          description="The affiliate program needs the cloud backend, which is not configured in this demo build."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-3xl font-black tracking-tight text-tx">
          <Handshake className="h-7 w-7 text-green" aria-hidden />
          Affiliates
        </h1>
        <p className="mt-1 text-sm text-tx-sec">
          Share your code and earn <span className="font-bold text-green">50%</span> of every
          referred user&apos;s first deposit, paid to you in crypto.
        </p>
      </div>

      {loading || overview === null ? (
        loading ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : (
          <EmptyState
            icon={CloudOff}
            title="Could not load your affiliate data"
            description="The affiliate tables are missing or the server is unreachable. If you run this project, apply supabase/migration-v10-affiliates.sql in the Supabase SQL editor."
            actionLabel="Retry"
            onAction={() => void load()}
          />
        )
      ) : (
        <>
          {/* ----- code / link ----- */}
          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            {overview.code && !editingCode ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-tx-mut">
                      Your code
                    </div>
                    <div className="mt-1 font-mono text-2xl font-black tracking-wide text-green">
                      {overview.code}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      setCodeInput(overview.code ?? '');
                      setEditingCode(true);
                    }}
                  >
                    Change code
                  </Button>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-tx-mut">
                    Your referral link
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-3 px-3.5 py-2.5 font-mono text-sm text-tx">
                      {referralLink}
                    </code>
                    <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                      {copied ? (
                        <Check className="h-4 w-4 text-green" aria-hidden />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden />
                      )}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-tx-mut">
                    Anyone who opens this link — or enters your code at sign-up — counts as
                    your referral.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={saveCode} className="flex flex-col gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-extrabold text-tx">
                    <Link2 className="h-4 w-4 text-green" aria-hidden />
                    {overview.code ? 'Change your affiliate code' : 'Choose your affiliate code'}
                  </div>
                  <p className="mt-1 text-xs text-tx-mut">
                    3-20 characters — letters, numbers, - and _. It becomes part of your
                    referral link, so pick something recognizable.
                    {overview.code &&
                      ' Changing it deactivates the old code and link immediately.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="e.g. maxcalls"
                    maxLength={20}
                    className="max-w-xs"
                  />
                  <Button type="submit" variant="primary" size="md" loading={savingCode}>
                    {overview.code ? 'Save code' : 'Claim code'}
                  </Button>
                  {overview.code && (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      onClick={() => setEditingCode(false)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* ----- stats ----- */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Referred users" value={String(overview.referrals.length)} />
            <StatCard label="Total earned" value={formatMoney(overview.totalEarned)} />
            <StatCard label="Available to withdraw" value={formatMoney(overview.available)} accent />
            <StatCard
              label={overview.pendingPayout > 0 ? 'Payout in review' : 'Paid out'}
              value={formatMoney(
                overview.pendingPayout > 0 ? overview.pendingPayout : overview.totalPaid
              )}
            />
          </div>

          {/* ----- referrals ----- */}
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-tx-sec">
              <Users className="h-4 w-4" aria-hidden />
              Your referrals
            </h2>
            {overview.referrals.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface-2 p-8 text-center text-sm text-tx-mut">
                No sign-ups through your code yet — share your link to get started.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-tx-mut">
                      <th className="px-4 py-3 text-left font-bold">User</th>
                      <th className="px-4 py-3 text-left font-bold">Joined</th>
                      <th className="px-4 py-3 text-left font-bold">Status</th>
                      <th className="px-4 py-3 text-right font-bold">You earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.referrals.map((r) => (
                      <tr
                        key={`${r.username}-${r.joinedAt}`}
                        className="border-b border-line/60 last:border-b-0"
                      >
                        <td className="px-4 py-3 font-bold text-tx">{r.username}</td>
                        <td className="px-4 py-3 text-tx-sec">{formatDate(r.joinedAt)}</td>
                        <td className="px-4 py-3">
                          {r.deposited ? (
                            <span className="inline-flex items-center gap-1.5 font-bold text-green">
                              <BadgeCheck className="h-4 w-4" aria-hidden />
                              Deposited
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-tx-mut">
                              <Hourglass className="h-4 w-4" aria-hidden />
                              Awaiting first deposit
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-tx">
                          {formatMoney(r.earned)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ----- payout ----- */}
          <div className="space-y-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-tx-sec">
              Request a payout
            </h2>
            <div className="rounded-2xl border border-line bg-surface-2 p-5">
              <p className="text-sm text-tx-sec">
                You have <span className="font-bold text-green">{formatMoney(overview.available)}</span>{' '}
                available. Minimum payout is {formatMoney(MIN_PAYOUT)} — the team reviews every
                request and sends the crypto to your address.
              </p>
              <form
                onSubmit={requestPayout}
                className="mt-4 grid gap-3 sm:grid-cols-[140px_140px_1fr_auto]"
              >
                <Select
                  aria-label="Payout currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as DepositCurrency)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={MIN_PAYOUT}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`USD (min ${MIN_PAYOUT})`}
                  aria-label="Payout amount in USD"
                />
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={`Your ${currency} address`}
                  aria-label="Destination address"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  loading={requesting}
                  disabled={overview.available < MIN_PAYOUT}
                >
                  Request payout
                </Button>
              </form>
              {overview.available < MIN_PAYOUT && (
                <p className="mt-2 text-xs text-tx-mut">
                  You need at least {formatMoney(MIN_PAYOUT)} in commissions to request a payout.
                </p>
              )}
            </div>

            {payouts.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-tx-mut">
                      <th className="px-4 py-3 text-left font-bold">Requested</th>
                      <th className="px-4 py-3 text-left font-bold">Currency</th>
                      <th className="px-4 py-3 text-left font-bold">Address</th>
                      <th className="px-4 py-3 text-right font-bold">Amount</th>
                      <th className="px-4 py-3 text-right font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.id} className="border-b border-line/60 last:border-b-0">
                        <td className="px-4 py-3 text-tx-sec">{formatDate(p.createdAt)}</td>
                        <td className="px-4 py-3 font-bold text-tx">{p.currency}</td>
                        <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-tx-sec">
                          {p.address}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-tx">
                          {formatMoney(p.amount)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <StatusBadge status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ----- how it works ----- */}
          <div className="rounded-2xl border border-line bg-surface-2 p-5 text-sm leading-relaxed text-tx-sec">
            <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-tx-sec">
              How it works
            </h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Claim your personal code and share your referral link.</li>
              <li>
                Friends sign up through your link (or enter your code manually) — they appear
                in your referrals list.
              </li>
              <li>
                When a referral&apos;s <span className="font-bold text-tx">first deposit</span> is
                approved, <span className="font-bold text-green">50% of it</span> is credited to
                your affiliate balance instantly.
              </li>
              <li>
                Request a payout (min {formatMoney(MIN_PAYOUT)}) — after review, the crypto is
                sent to your address.
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
