'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Market, Side } from '@/lib/types';
import {
  formatCents,
  formatMoney,
  isInPlay,
  isMarketClosed,
  sideLabel,
} from '@/lib/format';
import { fetchMarketPool } from '@/lib/cloud';
import { DEFAULT_FEE_BPS, previewBuy, type PoolReserves } from '@/lib/pricing';
import { play } from '@/lib/sound';
import { useCallitStore } from '@/lib/store';
import { cloudFeedEnabled, useBannedMarketIds } from '@/lib/useMarkets';
import Button from '@/components/ui/button';
import { MarketIcon } from '@/components/markets/MarketCard';
import AmountInput from './AmountInput';

export interface TradePanelProps {
  market: Market;
  defaultSide?: Side;
  variant?: 'panel' | 'modal';
  onTraded?: () => void;
}

/** An average fill this much worse than the quote is worth calling out. */
const SLIPPAGE_WARN_PCT = 1;

/** `200` -> `'2%'`, `250` -> `'2.5%'`. */
function feeLabel(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** Core trading UX — shared by the trade modal and the detail-page
 *  sticky panels. Polymarket-style, buy-only: market header row,
 *  Yes/No price buttons, big amount display, live preview and the
 *  "Call it now" CTA. */
export default function TradePanel({
  market,
  defaultSide = 'yes',
  variant = 'panel',
  onTraded,
}: TradePanelProps) {
  const [side, setSide] = useState<Side>(defaultSide);
  const [amount, setAmount] = useState<number | ''>('');
  // In cloud mode the trade is a round-trip to the server; without this
  // a double-click would fire two place_trade calls and spend twice.
  const [pending, setPending] = useState(false);
  // The market's live FPMM pool — what place_trade actually fills against.
  // See the effect below for why the feed's own numbers can't be used.
  const [pool, setPool] = useState<PoolReserves>();
  const [poolFeeBps, setPoolFeeBps] = useState<number>();
  // The market's OWN split (`markets.platform_fee_bps` / `lp_fee_bps`) — what
  // place_trade actually charges. See `poolSplit` below.
  const [poolSplit, setPoolSplit] = useState<{ platform: number; lp: number } | null>(null);
  // Bumped after a fill: the trade moved the curve, so re-quote it.
  const [poolNonce, setPoolNonce] = useState(0);

  const balance = useCallitStore((s) => s.balance);
  const trade = useCallitStore((s) => s.trade);
  const user = useCallitStore((s) => s.user);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);
  const platformSettings = useCallitStore((s) => s.platformSettings);
  const refreshPlatformSettings = useCallitStore((s) => s.refreshPlatformSettings);
  const bannedMarketIds = useBannedMarketIds();

  // The v7 fee split as CONFIGURED — i.e. what a market created right now
  // would get. Both halves, or nothing: a pre-v7 database (or a failed column
  // read) leaves these null and we simply don't claim to know the breakdown.
  //
  // NOT automatically this market's split — see `split` below.
  const configSplit =
    platformSettings?.platformFeeBps != null && platformSettings?.lpFeeBps != null
      ? { platform: platformSettings.platformFeeBps, lp: platformSettings.lpFeeBps }
      : null;

  /**
   * THIS MARKET's split, and only this market's.
   *
   * The market's own row wins outright: `place_trade` charges
   * `platform_fee_bps + lp_fee_bps` off the MARKET, locked in at creation, and
   * the live config is only what NEW markets get.
   *
   * The config is NOT a fallback for it. A market funded under the v6 deal
   * carries platform 0 / lp = its whole fee, while the config says 100/100 —
   * the SAME total, split differently. So "the totals agree" (the old guard)
   * cannot tell those two apart, and quoting the config there tells the trader
   * 1% goes to the platform when in truth 0% does. Unknown split => say
   * nothing specific.
   */
  const split = poolSplit;

  // The configured TOTAL, derived from the split (v7) rather than the
  // deprecated `platform_settings.fee_bps`, which is no longer read at
  // market creation and would misreport the fee once the two drift apart.
  const settingsFeeBps = configSplit
    ? configSplit.platform + configSplit.lp
    : platformSettings?.feeBps;

  // The real fee, not a hardcoded 2%. A LIVE market charges its OWN
  // fee_bps (locked in at creation, so an admin changing the global config
  // cannot retro-price it) — platform_settings is only the fallback for a
  // market whose row we haven't read.
  const feeBps = poolFeeBps ?? market.feeBps ?? settingsFeeBps ?? DEFAULT_FEE_BPS;

  // Explain the split ONLY when it is THIS market's split AND it adds up to
  // the total actually being charged. Both halves matter: the first makes the
  // destinations true, the second makes the arithmetic true.
  const feeHint =
    split && split.platform + split.lp === feeBps
      ? `${feeLabel(split.platform)} platform fee, ${feeLabel(split.lp)} to the market's liquidity provider.`
      : "Split between the platform and the market's liquidity provider.";

  // Load the config once per session: it is a single global row, and a
  // market's real fee comes from its OWN row anyway (`poolFeeBps`), so
  // this is only a fallback + the Global seed. Concurrent panels share one
  // request via the store's in-flight guard. No-op in local mode.
  useEffect(() => {
    if (platformSettings) return;
    void refreshPlatformSettings();
  }, [platformSettings, refreshPlatformSettings]);

  /**
   * Read the pool the server will fill from.
   *
   * Global markets render from the /api/polymarket payload, whose
   * `liquidity` is POLYMARKET's depth (often tens of thousands) — but OUR
   * pool is seeded with `global_seed` (default $25). Quoting the feed
   * number would preview a $100 order at ~0 slippage against a curve that
   * doesn't exist. When this read fails (or in local mode) previewBuy
   * falls back to its synthetic pool, which is the documented degraded
   * path — never a blocker.
   */
  useEffect(() => {
    if (!cloudFeedEnabled) return;
    let alive = true;
    void (async () => {
      const p = await fetchMarketPool(market.id);
      if (!alive) return;
      setPool(p ? { yesReserve: p.yesReserve, noReserve: p.noReserve } : undefined);
      setPoolFeeBps(p?.feeBps);
      // Both halves or nothing — half a split cannot be rendered honestly.
      setPoolSplit(
        p && p.platformFeeBps !== null && p.lpFeeBps !== null
          ? { platform: p.platformFeeBps, lp: p.lpFeeBps }
          : null
      );
    })();
    return () => {
      alive = false;
    };
  }, [market.id, poolNonce]);

  const yesPrice = market.yesPrice;
  const noPrice = 1 - market.yesPrice;
  // Real side names when the market has them ('Over'/'Under', team names) —
  // literal Yes/No otherwise. Colors stay green/sky regardless of the label.
  const yesName = sideLabel(market, 'yes');
  const noName = sideLabel(market, 'no');
  const selectedName = side === 'yes' ? yesName : noName;

  // v7 — THE TRADE GATE, and it must be the SERVER'S gate. `isMarketClosed`
  // is the mirror of `place_trade`'s provider-aware expiry check: a feed
  // market is closed iff the SOURCE closed it (its `endDate` is the kickoff),
  // a community market iff its own `endDate` has passed. The old
  // `ended && !inPlay` rule is what disabled the buttons on a match at minute
  // 83 and on every open market carrying a stale upstream date — trades the
  // server would happily have accepted.
  //
  // `isInPlay` is now the LIVE indicator ONLY and never gates the CTA; it is
  // already false whenever the market is closed.
  const inPlay = isInPlay(market);
  // Admin-banned markets are untradeable even via direct URL.
  const banned = bannedMarketIds.includes(market.id);
  const closed = banned || market.status === 'resolved' || isMarketClosed(market);

  const amountNum = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;

  // Buy preview — the v6 FPMM quote, mirroring place_trade: fee first,
  // then walk the curve. `avgPrice` is the fill AVERAGE, not the tick.
  const preview = previewBuy(market, side, amountNum, { feeBps, pool });
  const positiveReturn = amountNum > 0 && preview.returnPct > 0;
  const showSlippage = amountNum > 0 && preview.slippagePct > SLIPPAGE_WARN_PCT;
  const buyDisabled = !(amountNum > 0 && amountNum <= balance) || closed || pending;

  const handleBuy = async () => {
    if (pending) return;
    setPending(true);
    try {
      const fill = await trade(market.id, side, amountNum);
      if (fill) {
        play('fill');
        toast.success('Position opened — you called it.');
        setAmount('');
        // The fill moved the curve — re-read the pool so the next quote
        // prices against it, not against the pre-trade reserves.
        setPoolNonce((n) => n + 1);
        onTraded?.();
      } else {
        play('error');
        // Cloud mode: the server's own wording ('Insufficient balance',
        // 'This market has ended', …). Local mode leaves it null.
        toast.error(
          useCallitStore.getState().lastActionError ?? 'Trade could not be executed'
        );
      }
    } finally {
      setPending(false);
    }
  };

  const content = (
    <div className="space-y-4">
      {/* Market header: icon + question + selected side */}
      <div className="flex items-center gap-3">
        <MarketIcon
          icon={market.icon}
          category={market.category}
          className="h-10 w-10 rounded-lg"
          iconClassName="h-5 w-5"
        />
        <div className="min-w-0">
          <p className="line-clamp-1 text-sm font-bold leading-snug text-tx">
            {market.question}
          </p>
          <p
            className={cn(
              'truncate text-xs font-extrabold',
              side === 'yes' ? 'text-green' : 'text-sky'
            )}
          >
            {selectedName}
          </p>
        </div>
      </div>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Pick a side">
        <button
          type="button"
          aria-pressed={side === 'yes'}
          onClick={() => setSide('yes')}
          className={cn(
            'flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-bold tabular-nums transition-colors glow-hover',
            side === 'yes'
              ? 'border-green bg-green font-extrabold text-green-ink'
              : 'border-green/25 bg-green/10 text-green hover:border-green/40 hover:bg-green/20'
          )}
        >
          <span className="truncate">{yesName}</span>
          <span className="shrink-0">{formatCents(yesPrice)}</span>
        </button>
        <button
          type="button"
          aria-pressed={side === 'no'}
          onClick={() => setSide('no')}
          className={cn(
            'flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-bold tabular-nums transition-colors glow-hover-sky',
            side === 'no'
              ? 'border-sky bg-sky font-extrabold text-white'
              : 'border-sky/25 bg-sky/10 text-sky hover:border-sky/40 hover:bg-sky/20'
          )}
        >
          <span className="truncate">{noName}</span>
          <span className="shrink-0">{formatCents(noPrice)}</span>
        </button>
      </div>

      {/* Amount + live preview — signed-in users only */}
      {user && (
        <>
          <AmountInput value={amount} onChange={setAmount} max={balance} showBalance />

          <div className="space-y-1.5 rounded-xl border border-line bg-surface-3/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-tx-mut">Shares</span>
              <span className="font-bold text-tx tabular-nums">{preview.shares.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-tx-mut">Avg. price</span>
              <span className="font-bold text-tx tabular-nums">
                {formatCents(preview.avgPrice)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-tx-mut">Fee ({feeLabel(feeBps)})</span>
              <span className="font-bold text-tx tabular-nums">{formatMoney(preview.fee)}</span>
            </div>
            {/* Where that fee actually goes — the whole point of showing it. */}
            <p className="-mt-0.5 text-xs leading-snug text-tx-mut">{feeHint}</p>
            <div className="flex items-center justify-between">
              <span className="text-tx-mut">Potential payout</span>
              <span className="font-bold text-tx tabular-nums">{formatMoney(preview.payout)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-tx-mut">Return</span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  positiveReturn ? 'text-green' : 'text-tx'
                )}
              >
                {positiveReturn ? '+' : ''}
                {preview.returnPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </>
      )}

      {/* CTA — guests get a login prompt instead of the trade button */}
      {!user ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full glow-green text-base font-black"
          onClick={() => openAuthModal('signin')}
        >
          Log in to trade
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          className="w-full glow-green text-base font-black"
          disabled={buyDisabled}
          onClick={() => void handleBuy()}
        >
          Call it now
        </Button>
      )}

      {/* Big orders walk the curve — say so before the click, not after */}
      {user && showSlippage && (
        <p className="text-xs text-tx-mut">
          Large order — your average price is worse than the quoted price.
        </p>
      )}

      {/* Single contextual line: LIVE while in-play, muted when closed */}
      {inPlay ? (
        <div className="flex items-center gap-2 text-xs font-bold text-green">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
          </span>
          <span>LIVE — in-play trading, odds update with the game.</span>
        </div>
      ) : closed ? (
        <p className="text-xs text-tx-mut">
          {banned ? 'Market unavailable.' : 'Market closed.'}
        </p>
      ) : null}
    </div>
  );

  if (variant === 'modal') return content;

  return <div className="rounded-2xl border border-line bg-surface-2 p-5">{content}</div>;
}
