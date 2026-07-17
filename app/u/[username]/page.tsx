'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarDays, LayoutGrid, TrendingUp, UserX } from 'lucide-react';
import Skeleton from '@/components/ui/skeleton';
import MarketCard from '@/components/markets/MarketCard';
import EmptyState from '@/components/common/EmptyState';
import StatChip from '@/components/common/StatChip';
import {
  fetchCreatorMarkets,
  fetchPublicProfile,
  type PublicProfile,
} from '@/lib/cloud';
import { formatMoney } from '@/lib/format';
import { hashString } from '@/lib/utils';
import type { Market } from '@/lib/types';

/**
 * v8 — PUBLIC creator profile at /u/<username>.
 *
 * Everything on this page is public BY CONSTRUCTION: `public_profile()`
 * returns only username, join date, market count and traded volume —
 * never email, balance, admin status or any uuid (its SQL select list is
 * the privacy boundary). Unknown and banned users render the same
 * not-found state on purpose.
 */

const AVATAR_HUES = [150, 200, 100, 170, 130, 210];

function avatarStyle(username: string): React.CSSProperties {
  const hue = AVATAR_HUES[hashString(username) % AVATAR_HUES.length];
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 38%), hsl(${hue + 30} 70% 24%))`,
  };
}

function joinLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';
}

type State =
  | { phase: 'loading' }
  | { phase: 'notfound' }
  | { phase: 'ready'; profile: PublicProfile; markets: Market[] };

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? '').trim();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    if (!username) {
      setState({ phase: 'notfound' });
      return;
    }
    void (async () => {
      const profile = await fetchPublicProfile(username);
      if (!alive) return;
      if (!profile) {
        setState({ phase: 'notfound' });
        return;
      }
      const markets = await fetchCreatorMarkets(profile.username);
      if (!alive) return;
      setState({ phase: 'ready', profile, markets });
    })();
    return () => {
      alive = false;
    };
  }, [username]);

  if (state.phase === 'loading') {
    return (
      <div className="space-y-6">
        <Skeleton className="h-36 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (state.phase === 'notfound') {
    return (
      <EmptyState
        icon={UserX}
        title="No such user"
        description="This profile does not exist — or it is not public."
        actionLabel="Back to markets"
        actionHref="/"
      />
    );
  }

  const { profile, markets } = state;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-line bg-surface-2 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-2xl font-black text-white"
            style={avatarStyle(profile.username)}
            aria-hidden
          >
            {profile.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black tracking-tight text-tx">
              @{profile.username}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-tx-mut">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
              Member since {joinLabel(profile.joinedAt)}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <StatChip
            label="Markets created"
            value={String(profile.marketsCreated)}
            className="min-w-[130px]"
          />
          <StatChip
            label="Volume on their markets"
            value={formatMoney(profile.marketsVolume, { compact: true })}
            className="min-w-[130px]"
          />
        </div>
      </div>

      {/* Their markets */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-tx">
          <LayoutGrid className="h-4 w-4 text-green" aria-hidden />
          Markets by @{profile.username}
        </h2>
        {markets.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No open markets right now."
            description="Markets this creator launches will show up here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {markets.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
