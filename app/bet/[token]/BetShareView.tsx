'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Link2, Receipt, TrendingUp } from 'lucide-react';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import BetSlipCard from '@/components/share/BetSlipCard';
import ShareButton from '@/components/share/ShareButton';
import { fetchSharedBet, type SharedBet } from '@/lib/betShare';
import { betShareUrl } from '@/lib/share';
import { formatDateTime } from '@/lib/format';

/**
 * v25.40 — THE LANDING PAGE FOR A SHARED CALL.
 *
 * Whoever opens this has no account and no context — they were sent a link by
 * a friend. So the page is exactly three things, in this order: the slip, the
 * way into the market it was placed on, and the way into the app. Anything
 * else is a step between a curious recipient and their first trade.
 *
 * It re-reads the token client-side rather than taking a server prop, because
 * a shared bet is LIVE: the market moves, and somebody who opens the link an
 * hour later should see what the position is worth now, not what the unfurl
 * cached. The server half (page.tsx) only needs it for the preview metadata.
 */

type State =
  | { phase: 'loading' }
  | { phase: 'notfound' }
  | { phase: 'ready'; bet: SharedBet };

export default function BetShareView({ token }: { token: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const bet = await fetchSharedBet(token);
      if (!alive) return;
      setState(bet ? { phase: 'ready', bet } : { phase: 'notfound' });
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (state.phase === 'loading') {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  if (state.phase === 'notfound') {
    return (
      <EmptyState
        icon={Receipt}
        title="This call is not available."
        description="The link may be wrong, or the bet is no longer shared."
        actionLabel="Explore markets"
        actionHref="/"
      />
    );
  }

  const { bet } = state;
  const marketHref = `/market/${encodeURIComponent(bet.marketId)}`;

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <BetSlipCard bet={bet} standalone />

      <div className="space-y-2">
        <Link href={marketHref} className="block">
          <Button variant="primary" size="lg" className="w-full">
            <TrendingUp className="h-4 w-4" aria-hidden />
            Trade this market
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Link>
        <ShareButton
          variant="labelled"
          label="Copy this link"
          url={betShareUrl(bet.token)}
          title="A call on callitnow"
          text={bet.question ? `Look at this call: ${bet.question}` : undefined}
          className="h-11 w-full"
        />
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-micro text-tx-mut">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden />
        Placed by{' '}
        <Link
          href={`/u/${encodeURIComponent(bet.username)}`}
          className="font-semibold text-tx-sec transition-colors hover:text-tx"
        >
          @{bet.username}
        </Link>
        {bet.placedAt && <span>· {formatDateTime(bet.placedAt)}</span>}
      </p>
    </div>
  );
}
