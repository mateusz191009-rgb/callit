'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, LogIn, Plus, Wallet } from 'lucide-react';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import Tabs, { type TabItem } from '@/components/ui/tabs';
import { RecordCard, RecordField, RecordFields } from '@/components/ui/record';
import MarketCard from '@/components/markets/MarketCard';
import EmptyState from '@/components/common/EmptyState';
import TradeHistory from '@/components/portfolio/TradeHistory';
import CreatorEarnings from '@/components/portfolio/CreatorEarnings';
import ShareButton from '@/components/share/ShareButton';
import ShareBetButton from '@/components/share/ShareBetButton';
import type { SharedBet } from '@/lib/betShare';
import { profileUrl } from '@/lib/share';
import { cloudFeedEnabled, useAllMarkets, useMarketMap, usePositions } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { formatCents, formatMoney, isMarketClosed, marketEndInfo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Market, Position } from '@/lib/types';

type PortfolioTab = 'positions' | 'created' | 'earnings' | 'history';

// v25.46 — "Earnings" sits next to "My created markets" because it is the
// same object seen from the money side: what the markets on that tab have
// paid their creator, and the button that moves it onto the balance.
const TAB_ITEMS: TabItem<PortfolioTab>[] = [
  { value: 'positions', label: 'My positions' },
  { value: 'created', label: 'My created markets' },
  { value: 'earnings', label: 'Creator earnings' },
  { value: 'history', label: 'History' },
];

function signedMoney(n: number): string {
  return `${n < 0 ? '-' : '+'}${formatMoney(Math.abs(n))}`;
}

function signedPercent(n: number): string {
  return `${n < 0 ? '-' : '+'}${Math.abs(n).toFixed(1)}%`;
}

/**
 * v25.41 — the position row, in the shape the share sheet renders.
 *
 * A PREVIEW ONLY: the sheet replaces it with `public_bet_share()`'s own
 * aggregate the moment the token is minted. That matters more here than it did
 * for a receipt, because the two are computed differently — this row is the
 * `positions` summary (shares at a weighted average), while the shared page
 * re-derives everything from the fill log. They agree; the server's version is
 * the one that ships.
 *
 * `fills: 1` because this row cannot know how many buys built it. The sheet
 * learns the real count a beat later, which is when "3 fills" appears on the
 * card.
 */
function positionPreview(
  p: Position,
  m: Market | undefined,
  username: string
): SharedBet {
  return {
    token: '',
    username,
    placedAt: p.createdAt,
    marketId: p.marketId,
    question: m?.question,
    icon: m?.icon,
    category: m?.category ?? 'custom',
    source: m?.source ?? 'polymarket',
    yesLabel: m?.yesLabel,
    noLabel: m?.noLabel,
    endDate: m?.endDate,
    side: p.side,
    // Cost basis — what the shares actually cost, which is what the server's
    // `sum(amount)` will come back with (modulo the fee it also carries).
    stake: p.shares * p.avgPrice,
    shares: p.shares,
    avgPrice: p.avgPrice,
    marketStatus: m?.status === 'resolved' ? 'resolved' : 'open',
    resolvedOutcome: m?.resolvedOutcome,
    voided: m?.voided === true,
    yesPrice: m?.yesPrice ?? 0.5,
    isPosition: true,
    fills: 1,
  };
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

  // A share token points at rows in the server's fill log, which local demo
  // mode does not have — so the position share only exists in cloud mode.
  const cloudPositions = supabaseEnabled && Boolean(user);
  const username = user?.username ?? 'you';

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
        // v17 — what this position pays if the side wins: every winning
        // share settles at $1 (the same rule previewBuy and the resolution
        // path use), so the payout is simply the share count in dollars.
        // Hidden once the market resolved — the payout already happened
        // (or never will).
        const open = market ? market.status !== 'resolved' : true;
        const payout = p.shares;
        return { position: p, market, current, value, cost, pnl, pnlPct, payout, open };
      }),
    [positions, marketById]
  );

  const positionsValue = useMemo(() => rows.reduce((sum, r) => sum + r.value, 0), [rows]);
  const openPnl = useMemo(() => rows.reduce((sum, r) => sum + r.pnl, 0), [rows]);
  /** Sum of every open position's payout — "if all my calls hit". */
  const potentialPayout = useMemo(
    () => rows.reduce((sum, r) => sum + (r.open ? r.payout : 0), 0),
    [rows]
  );

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
      {/* v25.40 — "share my user". The link goes to /u/<username>, which is
          aggregates only (win rate, settled bets, volume, best call) — never
          a position, a stake or a balance. The privacy boundary is
          `public_profile()`'s select list, not this button. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black tracking-tight text-tx">Portfolio</h1>
        {user?.username && (
          <ShareButton
            variant="labelled"
            label="Share my profile"
            url={profileUrl(user.username)}
            title={`@${user.username} on callitnow`}
            text={`My calls on callitnow — @${user.username}`}
            copiedMessage="Profile link copied — your record, no positions."
          />
        )}
      </div>

      {/* Summary. Two across on a phone: as four stacked full-width cards
          these four numbers were 440px of scrolling before the tabs, and a
          $250.00 balance does not need 358px to be legible. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="card-surface p-4 sm:p-5">
          <div className="text-micro font-semibold uppercase tracking-wide text-tx-mut">
            Balance
          </div>
          <div className="mt-1 text-xl font-black tabular-nums text-tx sm:text-2xl">
            {formatMoney(balance)}{' '}
            <span className="text-mini font-semibold text-tx-mut">USDC</span>
          </div>
        </div>
        <div className="card-surface p-4 sm:p-5">
          <div className="text-micro font-semibold uppercase tracking-wide text-tx-mut">
            Positions value
          </div>
          <div className="mt-1 text-xl font-black tabular-nums text-tx sm:text-2xl">
            {formatMoney(positionsValue)}
          </div>
        </div>
        <div className="card-surface p-4 sm:p-5">
          <div className="text-micro font-semibold uppercase tracking-wide text-tx-mut">
            Open PnL
          </div>
          {/* Flat is not a gain: an empty portfolio was printing a green
              +$0.00 as if it had made money standing still. */}
          <div
            className={cn(
              'mt-1 text-xl font-black tabular-nums sm:text-2xl',
              openPnl > 0 ? 'text-green' : openPnl < 0 ? 'text-danger' : 'text-tx'
            )}
          >
            {openPnl === 0 ? formatMoney(0) : signedMoney(openPnl)}
          </div>
        </div>
        {/* v17 — payout if every open call hits ($1 per winning share). */}
        <div className="card-surface p-4 sm:p-5">
          <div className="text-micro font-semibold uppercase tracking-wide text-tx-mut">
            Maximum payout
          </div>
          <div
            className={cn(
              'mt-1 text-xl font-black tabular-nums sm:text-2xl',
              'text-tx'
            )}
          >
            {formatMoney(potentialPayout)}
          </div>
          {/* "If all open calls win" was not reachable: two positions on
              opposite outcomes of the same event cannot both pay, so the
              sum overstates the ceiling whenever a portfolio holds any. Say
              what the number actually is — an upper bound. */}
          <div className="mt-0.5 text-micro text-tx-mut">
            Upper bound — outcomes in one event can&apos;t all win
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
          <>
          {/* Phone: one card per position. The table below it carries nine
              columns, which cannot be read on a 390px screen — see
              components/ui/record.tsx. */}
          <ul className="space-y-2.5 md:hidden">
            {rows.map(({ position: p, market, current, value, pnl, pnlPct, payout, open }) => (
              <RecordCard key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/market/${encodeURIComponent(p.marketId)}`}
                    className="min-w-0 flex-1 text-mini font-semibold leading-snug text-tx"
                  >
                    <span className="line-clamp-2">
                      {market?.question ?? 'Unknown market'}
                    </span>
                  </Link>
                  <Badge variant={p.side === 'yes' ? 'green' : 'sky'}>
                    {p.side === 'yes' ? 'Yes' : 'No'}
                  </Badge>
                  {/* v25.41 — share the POSITION, not a fill: this row is the
                      blend of every buy on this side, and that is what the
                      link resolves to. Cloud mode only (a local demo position
                      has no fill log behind it). */}
                  {cloudPositions && (
                    <ShareBetButton
                      marketId={p.marketId}
                      positionSide={p.side}
                      preview={positionPreview(p, market, username)}
                      label="Share this position"
                    />
                  )}
                </div>
                {/* PnL first: it is the one number the old horizontal
                    scroller pushed furthest out of reach. */}
                <div
                  className={cn(
                    'text-base font-bold tabular-nums',
                    pnl > 0 ? 'text-green' : pnl < 0 ? 'text-danger' : 'text-tx'
                  )}
                >
                  {signedMoney(pnl)} <span className="text-mini">({signedPercent(pnlPct)})</span>
                </div>
                <RecordFields>
                  <RecordField label="Value" value={formatMoney(value)} />
                  <RecordField label="Shares" value={p.shares.toFixed(2)} />
                  <RecordField
                    label="To win"
                    value={
                      <span className={open ? 'text-green' : undefined}>
                        {open ? formatMoney(payout) : '—'}
                      </span>
                    }
                  />
                  <RecordField label="Avg." value={formatCents(p.avgPrice)} />
                  <RecordField label="Current" value={formatCents(current)} />
                  <RecordField
                    label="Ends"
                    value={market ? marketEndInfo(market).label : '—'}
                  />
                </RecordFields>
              </RecordCard>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
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
                  <th className="px-4 py-3 text-right font-bold">To win</th>
                  <th className="px-4 py-3 text-right font-bold">PnL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ position: p, market, current, value, pnl, pnlPct, payout, open }) => (
                  <tr
                    key={p.id}
                    className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/market/${encodeURIComponent(p.marketId)}`}
                        className="block max-w-[280px] font-semibold text-tx transition-colors hover:text-tx"
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
                    {/* $1 per winning share — hidden once resolved. */}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                      {open ? formatMoney(payout) : '—'}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-semibold tabular-nums',
                        pnl > 0 ? 'text-green' : pnl < 0 ? 'text-danger' : 'text-tx'
                      )}
                    >
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {signedMoney(pnl)} ({signedPercent(pnlPct)})
                        {cloudPositions && (
                          <ShareBetButton
                            marketId={p.marketId}
                            positionSide={p.side}
                            preview={positionPreview(p, market, username)}
                            label="Share this position"
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

      {/* v25.46 — the creator's half of the trading fee: what each market
          they funded has earned, and the claim that pays it out without
          waiting on a resolution. Owns its own loading + degraded states. */}
      {tab === 'earnings' && <CreatorEarnings />}

      {/* Receipts — the server's fill log in cloud mode (TradeHistory
          handles its own loading + the degraded local view). */}
      {tab === 'history' && <TradeHistory />}
    </div>
  );
}
