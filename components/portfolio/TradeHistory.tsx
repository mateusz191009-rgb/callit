'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Info, Receipt } from 'lucide-react';
import Badge from '@/components/ui/badge';
import Skeleton from '@/components/ui/skeleton';
import { RecordCard, RecordField, RecordFields } from '@/components/ui/record';
import EmptyState from '@/components/common/EmptyState';
import ShareBetButton from '@/components/share/ShareBetButton';
import type { SharedBet } from '@/lib/betShare';
import { fetchMyTrades, type TradeRow } from '@/lib/history';
import { useMarketMap, usePositions } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { formatCents, formatMoney } from '@/lib/format';
import type { Market, Side } from '@/lib/types';

/** How many fills to pull — one screenful of scrolling, not a full export. */
const TRADE_LIMIT = 100;

/** A row of the table, from either source (see the two modes below). */
interface HistoryRow {
  key: string;
  /** v25.40 — the `trades` row id, and therefore the thing that can be
   *  SHARED. Cloud mode only: local demo rows are position summaries, and
   *  there is no fill for the server to point a share token at. */
  tradeId?: string;
  marketId: string;
  question?: string;
  /** v19 — settlement state from the book (see TradeRow). Undefined when
   *  the market has no row (local mode / sync gap). */
  status?: 'open' | 'resolved';
  resolvedOutcome?: Side;
  /** v25.17 — the market was cancelled upstream and the stake refunded.
   *  Without this the row read "Lost", which is the opposite of true. */
  voided?: boolean;
  side: Side;
  amount: number;
  shares: number;
  price: number;
  /** `null` in the degraded local view — positions do not record a fee. */
  fee: number | null;
  createdAt: string;
}

/**
 * What a row's market did, resolved once against the row and the live map.
 *
 * The book only has a question for markets it stores; Global markets come
 * from the live feed, so the map fills the gaps. Extracted because the
 * phone card and the table both need the same verdict, and two copies of
 * this ternary chain would drift.
 */
function verdictOf(
  r: HistoryRow,
  mapped: Market | undefined
): { question?: string; status?: string; won: boolean; voided: boolean } {
  const status = r.status ?? mapped?.status;
  const outcome = r.resolvedOutcome ?? mapped?.resolvedOutcome;
  // v25.17 — a voided market has no winner and no loser: the source
  // cancelled the question and the stake came back.
  const voided = (r.voided ?? mapped?.voided) === true;
  return {
    question: r.question || mapped?.question,
    status,
    voided,
    won: status === 'resolved' && !voided && outcome !== undefined && outcome === r.side,
  };
}

/** v19 — the receipt's verdict: every winning share paid $1. */
function ResultLabel({
  row,
  verdict,
}: {
  row: HistoryRow;
  verdict: ReturnType<typeof verdictOf>;
}) {
  if (verdict.status === 'resolved') {
    // Cost basis, not `amount`: the refund is what the shares cost (shares
    // x fill price), which is the stake minus the fee the market already
    // took — exactly what void_feed_market() pays back.
    if (verdict.voided) {
      return (
        <span className="whitespace-nowrap font-semibold tabular-nums text-amber">
          Refunded {formatMoney(row.shares * row.price)}
        </span>
      );
    }
    if (verdict.won) {
      return (
        <span className="whitespace-nowrap font-semibold tabular-nums text-green">
          Won +{formatMoney(row.shares)}
        </span>
      );
    }
    return <span className="font-semibold text-danger">Lost</span>;
  }
  return <span className="text-tx-mut">{verdict.status === 'open' ? 'Open' : '—'}</span>;
}

/** Date + time: two fills on one market on one day must be tellable apart. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * v25.40 — the row + the live market, projected into the shape the share
 * sheet renders. It is a PREVIEW only: the sheet replaces it with the
 * server's own `public_bet_share()` payload as soon as the token is minted,
 * so nothing here can put a number on a shared page that the server would
 * not also produce. Its job is purely to keep the sheet from opening on a
 * spinner.
 */
function sharePreview(
  r: HistoryRow,
  m: Market | undefined,
  username: string
): SharedBet | undefined {
  if (!r.tradeId) return undefined;
  const v = verdictOf(r, m);
  return {
    token: '',
    username,
    placedAt: r.createdAt,
    marketId: r.marketId,
    question: v.question,
    icon: m?.icon,
    category: m?.category ?? 'custom',
    source: m?.source ?? 'polymarket',
    yesLabel: m?.yesLabel,
    noLabel: m?.noLabel,
    endDate: m?.endDate,
    side: r.side,
    stake: r.amount,
    shares: r.shares,
    avgPrice: r.price,
    marketStatus: v.status === 'resolved' ? 'resolved' : 'open',
    resolvedOutcome: r.resolvedOutcome ?? m?.resolvedOutcome,
    voided: v.voided,
    yesPrice: m?.yesPrice ?? 0.5,
    // A receipt IS one fill — that is what makes it a receipt.
    isPosition: false,
    fills: 1,
  };
}

function toHistoryRow(t: TradeRow): HistoryRow {
  return {
    key: t.id,
    tradeId: t.id,
    marketId: t.marketId,
    question: t.question,
    status: t.status,
    resolvedOutcome: t.resolvedOutcome,
    voided: t.voided,
    side: t.side,
    amount: t.amount,
    shares: t.shares,
    price: t.price,
    fee: t.fee,
    createdAt: t.createdAt,
  };
}

/**
 * Receipts — the signed-in user's fills, newest first.
 *
 * CLOUD: the real thing. `trades` is the server's immutable fill log, so
 * every buy is one row with the stake, the shares, the average fill price
 * and the fee the market took.
 *
 * LOCAL demo mode: there is no fill log — nothing writes one. The closest
 * honest thing is the position list, which is a per-market SUMMARY (one
 * row per side at the weighted average price), not a per-trade history. It
 * is rendered as a degraded view with a note saying so, rather than
 * pretending the aggregate is a receipt.
 */
export default function TradeHistory() {
  const { map: marketById } = useMarketMap();
  const user = useCallitStore((s) => s.user);
  const positions = usePositions();

  const cloud = supabaseEnabled && Boolean(user);
  // Only used for the share sheet's instant preview — the server's own
  // projection replaces it the moment the token is minted.
  const username = user?.username ?? 'you';

  const [trades, setTrades] = useState<TradeRow[] | null>(null);

  useEffect(() => {
    if (!cloud) {
      setTrades(null);
      return;
    }
    let cancelled = false;
    setTrades(null);
    void fetchMyTrades(TRADE_LIMIT).then((rows) => {
      if (!cancelled) setTrades(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [cloud]);

  const rows = useMemo<HistoryRow[]>(() => {
    if (cloud) return (trades ?? []).map(toHistoryRow);
    return [...positions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({
        key: p.id,
        marketId: p.marketId,
        side: p.side,
        // Cost basis — the closest local stand-in for a stake.
        amount: p.shares * p.avgPrice,
        shares: p.shares,
        price: p.avgPrice,
        fee: null,
        createdAt: p.createdAt,
      }));
  }, [cloud, trades, positions]);

  if (cloud && trades === null) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No trades yet."
        description="Every call you make is receipted here — stake, shares, fill price and fee."
        actionLabel="Explore markets"
        actionHref="/"
      />
    );
  }

  return (
    <div className="space-y-3">
      {!cloud && (
        <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs text-tx-mut">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Local demo mode has no fill log. This is your open positions summarised — one
            row per market and side at your average price, not a per-trade receipt.
          </span>
        </div>
      )}

      {/* Phone: one card per fill. Eight columns do not fit a 390px screen,
          and Result — the column that says what happened — was the one
          furthest off the right edge. See components/ui/record.tsx. */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((r) => {
          const market = marketById.get(r.marketId);
          const v = verdictOf(r, market);
          return (
            <RecordCard key={r.key}>
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/market/${encodeURIComponent(r.marketId)}`}
                  className="min-w-0 flex-1 text-mini font-semibold leading-snug text-tx"
                >
                  <span className="line-clamp-2">{v.question ?? 'Unknown market'}</span>
                </Link>
                <Badge variant={r.side === 'yes' ? 'green' : 'sky'}>
                  {r.side === 'yes' ? 'Yes' : 'No'}
                </Badge>
                {/* v25.40 — the receipt is where a bet gets shared: it is the
                    one list that still holds a SETTLED call, and "look what I
                    called" is the whole feature. Cloud mode only — a local
                    demo row is a position summary with no fill behind it. */}
                {r.tradeId && (
                  <ShareBetButton
                    tradeId={r.tradeId}
                    preview={sharePreview(r, market, username)}
                    label="Share this call"
                  />
                )}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-bold tabular-nums text-tx">
                  {formatMoney(r.amount)}
                </span>
                <ResultLabel row={r} verdict={v} />
              </div>
              <RecordFields>
                <RecordField label="Shares" value={r.shares.toFixed(2)} />
                <RecordField label="Avg." value={formatCents(r.price)} />
                <RecordField label="Fee" value={r.fee === null ? '—' : formatMoney(r.fee)} />
              </RecordFields>
              <div className="text-nano tabular-nums text-tx-mut">
                {formatStamp(r.createdAt)}
              </div>
            </RecordCard>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
            <tr>
              <th className="px-4 py-3 text-left font-bold">Date</th>
              <th className="px-4 py-3 text-left font-bold">Market</th>
              <th className="px-4 py-3 text-left font-bold">Side</th>
              <th className="px-4 py-3 text-right font-bold">Amount</th>
              <th className="px-4 py-3 text-right font-bold">Shares</th>
              <th className="px-4 py-3 text-right font-bold">Avg. price</th>
              <th className="px-4 py-3 text-right font-bold">Fee</th>
              <th className="px-4 py-3 text-right font-bold">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const market = marketById.get(r.marketId);
              const v = verdictOf(r, market);
              return (
                <tr
                  key={r.key}
                  className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40"
                >
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-tx-sec">
                    {formatStamp(r.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/market/${encodeURIComponent(r.marketId)}`}
                      className="block max-w-[280px] font-semibold text-tx transition-colors hover:text-tx"
                    >
                      <span className="line-clamp-1">{v.question ?? 'Unknown market'}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={r.side === 'yes' ? 'green' : 'sky'}>
                      {r.side === 'yes' ? 'Yes' : 'No'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-tx">
                    {formatMoney(r.amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                    {r.shares.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                    {formatCents(r.price)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-tx-mut">
                    {r.fee === null ? '—' : formatMoney(r.fee)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <ResultLabel row={r} verdict={v} />
                      {r.tradeId && (
                        <ShareBetButton
                          tradeId={r.tradeId}
                          preview={sharePreview(r, market, username)}
                          label="Share this call"
                        />
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
