'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, LayoutGrid, TrendingUp, UserX } from 'lucide-react';
import Skeleton from '@/components/ui/skeleton';
import MarketCard from '@/components/markets/MarketCard';
import EmptyState from '@/components/common/EmptyState';
import StatChip from '@/components/common/StatChip';
import ShareButton from '@/components/share/ShareButton';
import {
  fetchCreatorMarkets,
  fetchPublicProfile,
  winRateOf,
  type PublicProfile,
} from '@/lib/cloud';
import { formatMoney } from '@/lib/format';
import { profileUrl } from '@/lib/share';
import { hashString } from '@/lib/utils';
import type { Market } from '@/lib/types';

/**
 * v8 — PUBLIC creator profile at /u/<username>.
 *
 * Everything on this page is public BY CONSTRUCTION: `public_profile()`
 * returns only the username, join date, creator counts and — since v25.40 —
 * the BETTING AGGREGATES, never email, balance, admin status, any uuid, or a
 * single identifiable position. Its SQL select list is the privacy boundary.
 * Unknown and banned users render the same not-found state on purpose.
 *
 * v25.40 — this is also a SHARE TARGET now ("share my user"), so it carries
 * its own share button and a server shell (page.tsx) that gives the link a
 * real preview card.
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

export default function ProfileView({ username }: { username: string }) {
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
  const rate = winRateOf(profile);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card-surface p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-2xl font-black text-white"
            style={avatarStyle(profile.username)}
            aria-hidden
          >
            {profile.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight text-tx">
              @{profile.username}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-tx-mut">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
              Member since {joinLabel(profile.joinedAt)}
            </p>
          </div>
          <ShareButton
            variant="labelled"
            label="Share profile"
            url={profileUrl(profile.username)}
            title={`@${profile.username} on callitnow`}
            text={`@${profile.username} on callitnow`}
            copiedMessage="Profile link copied."
          />
        </div>

        {/* v25.40 — THE RECORD, first: it is what somebody following a shared
            profile link came to see. Aggregates only (see the module note).
            `betsResolved === 0` renders as "—" rather than 0%, because a
            trader with nothing settled has no record, not a bad one. */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip
            label="Win rate"
            value={rate === null ? '—' : `${Math.round(rate * 100)}%`}
          />
          <StatChip
            label="Bets settled"
            value={
              profile.betsResolved > 0
                ? `${profile.betsWon}/${profile.betsResolved}`
                : String(profile.betsPlaced)
            }
          />
          <StatChip
            label="Volume traded"
            value={formatMoney(profile.volumeTraded, { compact: true })}
          />
          <StatChip
            label="Best call"
            value={profile.bestMultiple > 0 ? `${profile.bestMultiple.toFixed(2)}x` : '—'}
          />
        </div>

        {/* The creator stats keep their own row — a market someone launched and
            a bet they placed are different claims about them. */}
        <div className="mt-3 flex flex-wrap gap-3">
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
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-tx">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {markets.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
