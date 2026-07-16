'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import Button from '@/components/ui/button';
import { useCallitStore } from '@/lib/store';
import { fetchMarketVotes } from '@/lib/cloud';
import { isMarketClosed } from '@/lib/format';
import { cloudFeedEnabled } from '@/lib/useMarkets';
import { cn } from '@/lib/utils';
import type { Market, Side } from '@/lib/types';

/**
 * Community-resolution ballot for a market. Renders ONLY when the market
 * resolves by community vote, has ended, and is still unresolved — otherwise
 * renders nothing, so it can be mounted unconditionally on the detail page.
 */
export default function VotePanel({ market }: { market: Market }) {
  const user = useCallitStore((s) => s.user);
  // Subscribe to this market's ballots so the tally re-renders on new votes.
  const ballots = useCallitStore((s) => s.communityVotes[market.id]);
  const getVoteTally = useCallitStore((s) => s.getVoteTally);
  const castVote = useCallitStore((s) => s.castVote);
  const finalizeCommunityMarket = useCallitStore((s) => s.finalizeCommunityMarket);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);

  // "Ended" depends on Date.now() — gate rendering behind a mounted flag to
  // avoid an SSR/client hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Cloud mode: ballots live in `community_votes`, not in the store.
  const [cloudTally, setCloudTally] = useState<{ yes: number; no: number } | null>(null);
  // The tally query returns counts only — remember this session's ballot
  // locally so the "You voted …" line still works in cloud mode.
  const [cloudVote, setCloudVote] = useState<Side | null>(null);

  const ballotOpen =
    market.resolution === 'community' && market.status === 'open';

  const loadTally = useCallback(async () => {
    if (!cloudFeedEnabled || !ballotOpen) return;
    // Voting opens only once the market has closed — don't poll before.
    // Community markets only reach here, and we own their deadline, so
    // `isMarketClosed` is `endDate <= now`; it is used anyway so this panel
    // asks the same question as the rest of the app.
    if (!isMarketClosed(market)) return;
    setCloudTally(await fetchMarketVotes(market.id));
  }, [market, ballotOpen]);

  useEffect(() => {
    void loadTally();
  }, [loadTally]);

  if (!mounted) return null;
  if (!ballotOpen) return null;
  if (!isMarketClosed(market)) return null;

  const tally = cloudFeedEnabled
    ? (cloudTally ?? { yes: 0, no: 0 })
    : getVoteTally(market.id);
  const total = tally.yes + tally.no;
  const yesPct = total > 0 ? (tally.yes / total) * 100 : 0;
  const noPct = total > 0 ? (tally.no / total) * 100 : 0;
  const myVote: Side | undefined = cloudFeedEnabled
    ? (cloudVote ?? undefined)
    : user
      ? ballots?.[user.email]
      : undefined;

  const handleVote = async (side: Side) => {
    const ok = await castVote(market.id, side);
    if (ok) {
      toast.success(side === 'yes' ? 'Vote recorded — Yes.' : 'Vote recorded — No.');
      setCloudVote(side);
      void loadTally();
    } else {
      toast.error(
        useCallitStore.getState().lastActionError ?? 'Could not record your vote.'
      );
    }
  };

  const handleFinalize = async () => {
    const ok = await finalizeCommunityMarket(market.id);
    if (ok) {
      toast.success('Market resolved to the community majority.');
    } else {
      toast.error(
        useCallitStore.getState().lastActionError ?? 'No majority yet — votes are tied.'
      );
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-5">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-green" aria-hidden />
        <h2 className="text-sm font-bold text-tx">Community resolution</h2>
      </div>
      <p className="mt-1 text-xs text-tx-mut">
        This market has ended — the community decides the outcome.
      </p>

      {/* Tally bars */}
      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-green">Yes</span>
            <span className="tabular-nums text-tx-sec">
              {tally.yes} {tally.yes === 1 ? 'vote' : 'votes'}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-green transition-[width] duration-300"
              style={{ width: `${yesPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-sky">No</span>
            <span className="tabular-nums text-tx-sec">
              {tally.no} {tally.no === 1 ? 'vote' : 'votes'}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-sky transition-[width] duration-300"
              style={{ width: `${noPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Your vote / vote actions */}
      {user ? (
        <>
          {myVote && (
            <p className="mt-4 text-xs font-bold text-tx-sec">
              You voted{' '}
              <span className={myVote === 'yes' ? 'text-green' : 'text-sky'}>
                {myVote === 'yes' ? 'Yes' : 'No'}
              </span>
              {' '}— voting again replaces your ballot.
            </p>
          )}
          <div className={cn('flex gap-2', myVote ? 'mt-2' : 'mt-4')}>
            <Button
              variant="yes-tint"
              size="sm"
              className={cn('flex-1', myVote === 'yes' && 'border-green/60 bg-green/20')}
              onClick={() => void handleVote('yes')}
            >
              {myVote === 'yes' ? 'Voted Yes' : 'Vote Yes'}
            </Button>
            <Button
              variant="no-tint"
              size="sm"
              className={cn('flex-1', myVote === 'no' && 'border-sky/60 bg-sky/20')}
              onClick={() => void handleVote('no')}
            >
              {myVote === 'no' ? 'Voted No' : 'Vote No'}
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="primary"
          size="sm"
          className="mt-4 w-full"
          onClick={() => openAuthModal('signin')}
        >
          Log in to vote
        </Button>
      )}

      <p className="mt-3 text-xs text-tx-mut">
        (one vote per account, majority decides)
      </p>

      {user?.isAdmin && (
        <Button variant="primary" size="sm" className="mt-4 w-full" onClick={() => void handleFinalize()}>
          Finalize (majority)
        </Button>
      )}
    </div>
  );
}
