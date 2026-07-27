'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, Link2, Loader2, Share2 } from 'lucide-react';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import BetSlipCard from './BetSlipCard';
import {
  createBetShare,
  fetchSharedBet,
  type CreateBetShareInput,
  type SharedBet,
} from '@/lib/betShare';
import { betShareUrl, copyText, shareLink } from '@/lib/share';
import { cn } from '@/lib/utils';

/**
 * v25.40 — "SHARE THIS BET": mint the token, show the slip, hand it over.
 *
 * WHY A SHEET AND NOT A ONE-TAP SHARE. The user is about to publish a claim
 * about their own money to a group chat. Showing them exactly what the
 * recipient will see, before it leaves, is the difference between a feature
 * people use twice and one they trust. It also solves a real browser problem:
 * `navigator.share` must be called inside a user gesture, and minting the
 * token is an async round-trip that would eat it. The sheet splits them —
 * opening it mints, the button inside it shares, and that button press is its
 * own fresh gesture.
 *
 * `preview` is the caller's local copy of the same fill (the receipt row has
 * it already). It renders the card instantly and is replaced by the server's
 * version the moment `public_bet_share` answers, so the sheet is never a
 * spinner when it does not have to be — and never shows numbers the shared
 * page would contradict.
 */

export interface ShareBetButtonProps extends CreateBetShareInput {
  /** Local copy of the fill, for an instant preview (optional). */
  preview?: SharedBet;
  /** `icon` for a receipt row, `labelled` for a panel or a page header. */
  variant?: 'icon' | 'labelled';
  label?: string;
  className?: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'ready'; token: string }
  | { kind: 'error' };

export default function ShareBetButton({
  tradeId,
  marketId,
  preview,
  variant = 'icon',
  label = 'Share bet',
  className,
}: ShareBetButtonProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [bet, setBet] = useState<SharedBet | null>(preview ?? null);

  // Mint on open, once. Everything after this point works off `token`, which
  // the server guarantees is stable per fill — re-opening the sheet for the
  // same bet hands out the same link, so a re-share never orphans one already
  // sent.
  useEffect(() => {
    if (!open || phase.kind !== 'idle') return;
    let alive = true;
    setPhase({ kind: 'minting' });
    void (async () => {
      const token = await createBetShare({ tradeId, marketId });
      if (!alive) return;
      if (!token) {
        setPhase({ kind: 'error' });
        return;
      }
      setPhase({ kind: 'ready', token });
      // The server's own projection wins over the local preview: it carries
      // the CURRENT market price and the settled outcome, which a receipt row
      // captured at fill time cannot know.
      const fresh = await fetchSharedBet(token);
      if (alive && fresh) setBet(fresh);
    })();
    return () => {
      alive = false;
    };
  }, [open, phase.kind, tradeId, marketId]);

  const url = phase.kind === 'ready' ? betShareUrl(phase.token) : '';
  const imageUrl =
    phase.kind === 'ready' ? `/api/og/bet/${encodeURIComponent(phase.token)}` : '';

  const handleShare = useCallback(async () => {
    if (!url) return;
    const outcome = await shareLink({
      url,
      title: 'My call on callitnow',
      text: bet?.question ? `I called it: ${bet.question}` : 'I called it.',
    });
    if (outcome === 'copied') toast.success('Link copied — paste it anywhere.');
    if (outcome === 'failed') toast.error('Could not share that link.');
    if (outcome !== 'dismissed' && outcome !== 'failed') setOpen(false);
  }, [url, bet?.question]);

  const handleCopy = useCallback(async () => {
    if (!url) return;
    if (await copyText(url)) toast.success('Link copied — paste it anywhere.');
    else toast.error('Could not copy that link.');
  }, [url]);

  const trigger =
    variant === 'icon' ? (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          // Receipt rows and cards are navigation surfaces of their own.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center rounded-md p-1 text-tx-mut transition-colors',
          'hover:bg-surface-3 hover:text-tx',
          // Same pseudo-element touch target as ShareButton — this one sits in
          // a receipt row, where a 44px control would restretch the list.
          "after:absolute after:-inset-2.5 after:content-['']",
          className
        )}
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    ) : (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>
    );

  return (
    <>
      {trigger}
      <Modal open={open} onClose={() => setOpen(false)} title="Share this call">
        <div className="space-y-4">
          {bet ? (
            <BetSlipCard bet={bet} standalone />
          ) : phase.kind === 'error' ? (
            <p className="rounded-xl border border-line bg-surface-3/40 p-4 text-sm text-tx-sec">
              We couldn&apos;t build a link for that bet. Sign in again and retry — if it
              keeps failing, the bet may have been placed before sharing existed.
            </p>
          ) : (
            <Skeleton className="h-64 w-full rounded-2xl" />
          )}

          {phase.kind !== 'error' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleShare}
                  disabled={!url}
                  className="col-span-2"
                >
                  {phase.kind === 'minting' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Share2 className="h-4 w-4" aria-hidden />
                  )}
                  Share link
                </Button>
                <Button variant="outline" size="md" onClick={handleCopy} disabled={!url}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  Copy link
                </Button>
                {/* Same-origin, so `download` actually downloads instead of
                    navigating. On a phone it opens the PNG, which is what a
                    long-press-to-save expects. */}
                <a
                  href={imageUrl || undefined}
                  download={phase.kind === 'ready' ? `callitnow-${phase.token}.png` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!imageUrl}
                  className={cn(
                    'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line text-sm font-bold text-tx transition-colors',
                    imageUrl
                      ? 'hover:border-line-strong hover:bg-surface-3'
                      : 'pointer-events-none opacity-45'
                  )}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Save image
                </a>
              </div>
              <p className="text-micro leading-relaxed text-tx-mut">
                Anyone with this link sees this one call — the market, your side, your
                stake and how it is doing. Nothing else from your account.
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
