'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { Market } from '@/lib/types';
import { formatCents, shortSideLabel } from '@/lib/format';
import { CATEGORY_ICONS } from './MarketCard';

/** Tiny market icon: image when available, category icon fallback. */
function TickerIcon({ market }: { market: Market }) {
  const [failed, setFailed] = useState(false);
  const Icon = CATEGORY_ICONS[market.category] ?? Sparkles;

  if (market.icon && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={market.icon}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-4 w-4 shrink-0 rounded-sm object-cover"
      />
    );
  }
  return <Icon className="h-4 w-4 shrink-0 text-green" aria-hidden />;
}

function TickerItems({
  markets,
  ariaHidden,
  className,
}: {
  markets: Market[];
  ariaHidden?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center ${className ?? ''}`} aria-hidden={ariaHidden}>
      {markets.map((m) => (
        <div key={m.id} className="flex items-center">
          <Link
            href={`/market/${m.id}`}
            tabIndex={ariaHidden ? -1 : undefined}
            className="flex items-center gap-2 px-4 py-2.5 transition-colors hover:text-tx"
          >
            <TickerIcon market={m} />
            <span className="max-w-[40ch] truncate text-xs font-semibold text-tx-sec">
              {m.question}
            </span>
            <span className="text-xs font-bold text-green tabular-nums">
              {shortSideLabel(m, 'yes')} {formatCents(m.yesPrice)}
            </span>
          </Link>
          <span className="h-1 w-1 shrink-0 rounded-full bg-line-strong" aria-hidden />
        </div>
      ))}
    </div>
  );
}

export default function MarketTicker({ markets }: { markets: Market[] }) {
  if (markets.length === 0) return null;

  return (
    <div className="ticker-track overflow-hidden rounded-2xl border border-line bg-surface-2/60">
      <div className="animate-marquee flex w-max items-center">
        {/* Content duplicated once for a seamless -50% loop; the copy is
            hidden under prefers-reduced-motion (track scrolls instead) */}
        <TickerItems markets={markets} />
        <TickerItems markets={markets} ariaHidden className="ticker-dup" />
      </div>
    </div>
  );
}
