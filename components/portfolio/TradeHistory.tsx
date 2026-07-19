'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Info, Receipt } from 'lucide-react';
import Badge from '@/components/ui/badge';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import { fetchMyTrades, type TradeRow } from '@/lib/history';
import { useMarketMap, usePositions } from '@/lib/useMarkets';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { formatCents, formatMoney } from '@/lib/format';
import type { Side } from '@/lib/types';

/** How many fills to pull — one screenful of scrolling, not a full export. */
const TRADE_LIMIT = 100;

/** A row of the table, from either source (see the two modes below). */
interface HistoryRow {
  key: string;
  marketId: string;
  question?: string;
  /** v19 — settlement state from the book (see TradeRow). Undefined when
   *  the market has no row (local mode / sync gap). */
  status?: 'open' | 'resolved';
  resolvedOutcome?: Side;
  side: Side;
  amount: number;
  shares: number;
  price: number;
  /** `null` in the degraded local view — positions do not record a fee. */
  fee: number | null;
  createdAt: string;
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

function toHistoryRow(t: TradeRow): HistoryRow {
  return {
    key: t.id,
    marketId: t.marketId,
    question: t.question,
    status: t.status,
    resolvedOutcome: t.resolvedOutcome,
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

      <div className="overflow-x-auto rounded-2xl border border-line">
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
              // The book only has a question for markets it stores; Global
              // markets come from the live feed, so fall back to the map.
              const mapped = marketById.get(r.marketId);
              const question = r.question || mapped?.question;
              // v19 — the receipt's verdict. Positions are deleted at
              // payout, so this column is where a settled bet says what
              // happened: every winning share paid $1.
              const status = r.status ?? mapped?.status;
              const outcome = r.resolvedOutcome ?? mapped?.resolvedOutcome;
              const won = status === 'resolved' && outcome !== undefined && outcome === r.side;
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
                      className="block max-w-[280px] font-semibold text-tx transition-colors hover:text-green"
                    >
                      <span className="line-clamp-1">{question ?? 'Unknown market'}</span>
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
                    {status === 'resolved' ? (
                      won ? (
                        <span className="font-semibold tabular-nums text-green">
                          Won +{formatMoney(r.shares)}
                        </span>
                      ) : (
                        <span className="font-semibold text-danger">Lost</span>
                      )
                    ) : status === 'open' ? (
                      <span className="text-tx-mut">Open</span>
                    ) : (
                      <span className="text-tx-mut">—</span>
                    )}
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
