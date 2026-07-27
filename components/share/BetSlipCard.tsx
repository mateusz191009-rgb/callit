'use client';

import { CircleSlash2, Clock3, TrendingUp, Trophy, XCircle } from 'lucide-react';
import { Wordmark } from '@/components/brand/Logo';
import { MarketIcon } from '@/components/markets/MarketCard';
import { betVerdict, multipleLabel, sharedSideLabel, type SharedBet } from '@/lib/betShare';
import { formatCents, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * v25.40 — THE BET SLIP. One card, three homes: the share sheet's preview,
 * the /bet/<token> page, and (later) anywhere a receipt wants a face.
 *
 * IT IS BUILT PHONE-FIRST AND FIXED-ASPECT, because the thing it competes
 * with is a screenshot. A screenshot of a table is unreadable in a group
 * chat; this is meant to survive being scaled down to a thumbnail, so the
 * hierarchy is deliberately brutal: the multiple is the hero, the side is the
 * one colour on the card, and the question gets two lines and no more.
 *
 * THE COLOUR IS THE SIDE, not the result — green for Yes, sky for No, the
 * same brand rule as everywhere else (never red for "No"). The RESULT is
 * carried by the status pill and by the payout row, which is where a loss
 * should read from, not from repainting the whole card.
 *
 * `standalone` is the only variant knob: the share page renders the card as
 * its own surface (rounded, bordered, its own background), while the OG image
 * route reimplements this layout in `next/og` primitives — satori supports
 * neither Tailwind nor most of what is used here, so that duplication is
 * deliberate and the two are kept in sync by hand.
 */

const STATUS = {
  open: {
    Icon: Clock3,
    label: 'Live position',
    className: 'border-line text-tx-sec bg-surface-3/60',
  },
  won: {
    Icon: Trophy,
    label: 'Called it',
    className: 'border-green/40 text-green bg-green/10',
  },
  lost: {
    Icon: XCircle,
    label: 'Missed',
    className: 'border-danger/40 text-danger-bright bg-danger/10',
  },
  void: {
    Icon: CircleSlash2,
    label: 'Cancelled — refunded',
    className: 'border-amber/40 text-amber bg-amber/10',
  },
} as const;

export default function BetSlipCard({
  bet,
  standalone = false,
  className,
}: {
  bet: SharedBet;
  standalone?: boolean;
  className?: string;
}) {
  const v = betVerdict(bet);
  const status = STATUS[v.outcome];
  const yes = bet.side === 'yes';
  const sideName = sharedSideLabel(bet);

  return (
    <div
      className={cn(
        'relative isolate flex flex-col gap-3.5 overflow-hidden p-4',
        standalone && 'rounded-2xl border border-line bg-surface-2',
        className
      )}
    >
      {/* The side's colour, as a wash rather than a fill: at thumbnail size a
          solid tint eats the type, and this still reads at 120px wide. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 -top-24 -z-10 h-48 blur-2xl',
          yes ? 'bg-green/20' : 'bg-sky/20'
        )}
      />

      {/* Brand + who called it. The handle is the only thing the card says
          about the person — see the privacy note on public_bet_share(). */}
      <div className="flex items-center justify-between gap-2">
        <Wordmark className="text-sm" />
        <span className="truncate text-xs font-bold text-tx-mut">@{bet.username}</span>
      </div>

      {/* What the call was about */}
      <div className="flex items-start gap-2.5">
        <MarketIcon
          icon={bet.icon}
          category={bet.category}
          className="h-9 w-9 rounded-lg"
          iconClassName="h-4 w-4"
        />
        <p className="line-clamp-2 min-w-0 flex-1 text-sm font-bold leading-snug text-tx">
          {bet.question ?? 'This market'}
        </p>
      </div>

      {/* THE HERO ROW: side on the left, multiple on the right. Everything
          else on the card is support for these two numbers. */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5',
          yes ? 'border-green/30 bg-green/10' : 'border-sky/30 bg-sky/10'
        )}
      >
        <div className="min-w-0">
          <div className="text-nano font-bold uppercase tracking-wide text-tx-mut">
            Called
          </div>
          <div
            className={cn(
              'truncate text-lg font-black leading-tight',
              yes ? 'text-green' : 'text-sky-bright'
            )}
          >
            {sideName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-nano font-bold uppercase tracking-wide text-tx-mut">
            {/* Shared with the OG image so the two cannot disagree — and see
                the note on `multipleLabel` for why "Paid" is won-only. */}
            {multipleLabel(v.outcome)}
          </div>
          <div className="text-lg font-black leading-tight tabular-nums text-tx">
            {v.multiple.toFixed(2)}x
          </div>
        </div>
      </div>

      {/* The receipt line — stake, entry, and what it is worth now. */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure label="Stake" value={formatMoney(bet.stake)} />
        <Figure label="Entry" value={formatCents(bet.avgPrice)} />
        <Figure
          label={v.outcome === 'open' ? 'Now worth' : v.outcome === 'void' ? 'Refunded' : 'Payout'}
          value={formatMoney(v.value)}
          className={
            v.outcome === 'lost'
              ? 'text-danger'
              : v.pnl > 0
                ? 'text-green'
                : undefined
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro font-semibold leading-none',
            status.className
          )}
        >
          <status.Icon className="h-3 w-3" aria-hidden />
          {status.label}
        </span>
        {/* Live markets get the current price: that is what turns a static
            receipt into something worth re-opening the link for. */}
        {v.outcome === 'open' && (
          <span className="inline-flex items-center gap-1 text-micro font-semibold tabular-nums text-tx-mut">
            <TrendingUp className="h-3 w-3" aria-hidden />
            {sideName} now {formatCents(v.currentPrice)}
          </span>
        )}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-3/40 px-1.5 py-1.5">
      <div className="text-nano font-semibold uppercase tracking-wide text-tx-mut">
        {label}
      </div>
      <div className={cn('mt-0.5 text-mini font-bold tabular-nums text-tx', className)}>
        {value}
      </div>
    </div>
  );
}
