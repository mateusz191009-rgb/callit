'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, LogIn, Plus, Wallet } from 'lucide-react';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import MarketCard from '@/components/markets/MarketCard';
import EmptyState from '@/components/common/EmptyState';
import TradeHistory from '@/components/portfolio/TradeHistory';
import { cloudFeedEnabled, useAllMarkets, useMarketMap, usePositions } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import { formatCents, formatMoney, isMarketClosed, marketEndInfo } from '@/lib/format';
import { cn } from '@/lib/utils';

type PortfolioTab = 'positions' | 'created' | 'history';

const TAB_ITEMS: TabItem<PortfolioTab>[] = [
  { value: 'positions', label: 'My positions' },
  { value: 'created', label: 'My created markets' },
  { value: 'history', label: 'History' },
];

function signedMoney(n: number): string {
  return `${n < 0 ? '-' : '+'}${formatMoney(Math.abs(n))}`;
}

function signedPercent(n: number): string {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toFixed(1)}%`;
}

export default function PortfolioPage() {
  const { markets } = useAllMarkets();
  // Full lookup map (includes event outcome markets and banned markets) so
  // every position resolves to its question and live price.
  const { map: marketById } = useMarketMap();
  const balance = useCallitStore((s) => s.balance);
  // Cloud: the server-booked positions; local: the persisted array.
  const positions = usePositions();
  const userMarkets = useCallitStore((s) => s.userMarkets);
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const user = useCallitStore((s) => s.user);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);

  const [tab, setTab] = useState<PortfolioTab>('positions');

  const rows = useMemo(
    () =>
      positions.map((p) => {
        const market = marketById.get(p.marketId);
        const current = market
          ? p.side === 'yes'
            ? market.yesPrice
            : 1 - market.yesPrice
          : p.avgPrice;
        const value = p.shares * current;
        const cost = p.shares * p.avgPrice;
        const pnl = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        return { position: p, market, current, value, cost, pnl, pnlPct };
      }),
    [positions, marketById]
  );

  const positionsValue = useMemo(() => rows.reduce((sum, r) => sum + r.value, 0), [rows]);
  const openPnl = useMemo(() => rows.reduce((sum, r) => sum + r.pnl, 0), [rows]);

  const createdMarkets = useMemo(() => {
    // Cloud: markets live in the shared book, so "mine" is a creator
    // match. Local: they live in this browser's userMarkets.
    if (cloudFeedEnabled) {
      if (!user) return [];
      return markets.filter((m) => m.source === 'callit' && m.createdBy === user.username);
    }
    const ids = new Set(userMarkets.map((m) => m.id));
    return markets.filter((m) => ids.has(m.id));
  }, [markets, userMarkets, user]);

  // Guests see a sign-in prompt instead of balance/summary cards.
  if (!hydrated) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-black tracking-tight text-tx">Portfolio</h1>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-black tracking-tight text-tx">Portfolio</h1>
        <EmptyState
          icon={LogIn}
          title="Sign in to track your positions"
          description="Your portfolio, open PnL and created markets live here once you are signed in."
          actionLabel="Log in"
          onAction={() => openAuthModal('signin')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-tx">Portfolio</h1>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface-2 p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
            Balance
          </div>
          <div className="mt-1 text-2xl font-black tabular-nums text-tx">
            {formatMoney(balance)} USDC
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-2 p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
            Positions value
          </div>
          <div className="mt-1 text-2xl font-black tabular-nums text-tx">
            {formatMoney(positionsValue)}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-2 p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-tx-mut">
            Open PnL
          </div>
          <div
            className={cn(
              'mt-1 text-2xl font-black tabular-nums',
              openPnl >= 0 ? 'text-green' : 'text-danger'
            )}
          >
            {signedMoney(openPnl)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} />

      {tab === 'positions' &&
        (!hydrated ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No positions yet."
            description="Make your first call on any market."
            actionLabel="Explore markets"
            actionHref="/"
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
                <tr>
                  <th className="px-4 py-3 text-left font-bold">Market</th>
                  <th className="px-4 py-3 text-left font-bold">Side</th>
                  <th className="px-4 py-3 text-left font-bold">Ends</th>
                  <th className="px-4 py-3 text-right font-bold">Shares</th>
                  <th className="px-4 py-3 text-right font-bold">Avg. price</th>
                  <th className="px-4 py-3 text-right font-bold">Current</th>
                  <th className="px-4 py-3 text-right font-bold">Value</th>
                  <th className="px-4 py-3 text-right font-bold">PnL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ position: p, market, current, value, pnl, pnlPct }) => (
                  <tr
                    key={p.id}
                    className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/market/${encodeURIComponent(p.marketId)}`}
                        className="block max-w-[280px] font-semibold text-tx transition-colors hover:text-green"
                      >
                        <span className="line-clamp-1">
                          {market?.question ?? 'Unknown market'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={p.side === 'yes' ? 'green' : 'sky'}>
                        {p.side === 'yes' ? 'Yes' : 'No'}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {/* Table renders post-hydration only, so Date.now()
                          inside marketEndInfo is SSR-safe here (same reasoning
                          as MarketCard). */}
                      {market ? (
                        (() => {
                          const end = marketEndInfo(market);
                          return (
                            <>
                              <div className="text-tx-sec">{end.label}</div>
                              {end.detail && (
                                <div className="text-xs text-tx-mut">{end.detail}</div>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <span className="text-tx-mut">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                      {p.shares.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                      {formatCents(p.avgPrice)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                      {formatCents(current)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                      {formatMoney(value)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-semibold tabular-nums',
                        pnl >= 0 ? 'text-green' : 'text-danger'
                      )}
                    >
                      {signedMoney(pnl)} ({signedPercent(pnlPct)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'created' &&
        (!hydrated ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : createdMarkets.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="You haven't launched a market yet."
            actionLabel="Create your first market"
            actionHref="/create"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {createdMarkets.map((m) => (
              <div key={m.id} className="space-y-2">
                <MarketCard market={m} />
                {/* v8 — self-resolution is gone: every community market is
                    settled by the community vote + an admin confirmation
                    (resolve_market_rpc rejects non-admins server-side). */}
                {m.status === 'open' && isMarketClosed(m) && (
                  <p className="flex items-start gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-tx-mut">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Awaiting community vote + team confirmation.
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}

      {/* Receipts — the server's fill log in cloud mode (TradeHistory
          handles its own loading + the degraded local view). */}
      {tab === 'history' && <TradeHistory />}
    </div>
  );
}
