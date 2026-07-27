'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Link2, Share2 } from 'lucide-react';
import { shareLink, type ShareLinkInput } from '@/lib/share';
import { cn } from '@/lib/utils';

/**
 * v25.40 — THE COPY/SHARE BUTTON, used everywhere a link leaves the app.
 *
 * One component so every share surface behaves identically: OS sheet on a
 * phone, clipboard on a desktop, and a toast ONLY when the clipboard was the
 * path taken — a native sheet already told the user what happened, and a
 * dismissed sheet is not a failure and must stay silent.
 *
 * `stopPropagation` on the click is load-bearing: this sits inside MarketCard,
 * whose whole surface is a navigation handler. Without it, sharing a card also
 * opens it.
 */

export type ShareButtonVariant =
  /** Bare icon, for tight rows (a card footer, a receipt line). */
  | 'icon'
  /** Icon + label, for page headers and the portfolio. */
  | 'labelled';

export interface ShareButtonProps extends ShareLinkInput {
  variant?: ShareButtonVariant;
  /** Label for the `labelled` variant, and the a11y name for both. */
  label?: string;
  /** Toast copy on the clipboard path. */
  copiedMessage?: string;
  className?: string;
  /** Run before sharing — e.g. mint a share token. Return false to abort. */
  onBeforeShare?: () => boolean | Promise<boolean>;
}

export default function ShareButton({
  url,
  title,
  text,
  variant = 'icon',
  label = 'Share',
  copiedMessage = 'Link copied — paste it anywhere.',
  className,
  onBeforeShare,
}: ShareButtonProps) {
  // Doubles as the "it worked" tick: on desktop the toast is easy to miss if
  // three cards are shared in a row, and the icon swap is local to the button
  // the user actually pressed.
  const [done, setDone] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    // The card underneath is a navigation surface — see the note above.
    e.preventDefault();
    e.stopPropagation();

    if (onBeforeShare && !(await onBeforeShare())) return;

    const outcome = await shareLink({ url, title, text });
    if (outcome === 'copied') {
      toast.success(copiedMessage);
    } else if (outcome === 'failed') {
      // Nothing was copied and no sheet opened — the user has to be told,
      // because the button otherwise looks like it did nothing.
      toast.error('Could not share that link — copy it from the address bar.');
      return;
    } else if (outcome === 'dismissed') {
      return;
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };

  const Icon = done ? Check : variant === 'icon' ? Link2 : Share2;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handle}
        aria-label={label}
        title={label}
        className={cn(
          // `-my-1` cancels the padding's contribution to the ROW height: the
          // 4px of padding is there for the hover chip, and without this the
          // 22px button set the height of a 16px footer line and put ~6px back
          // on every card in the grid.
          'relative -my-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors',
          'text-tx-mut hover:bg-surface-3 hover:text-tx',
          // THE TOUCH TARGET IS A PSEUDO-ELEMENT, not padding. This button
          // lives in a CARD FOOTER, and the card height was deliberately
          // tightened twice (v25.18, v25.19) — growing the button to 44px
          // would have put ~6px back on every card in the grid. `-inset-2.5`
          // makes the tappable box ~42px without occupying a single pixel of
          // layout.
          "after:absolute after:-inset-2.5 after:content-['']",
          done && 'text-green',
          className
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-xs font-bold transition-colors',
        'h-8 coarse:h-10',
        done
          ? 'border-green/40 bg-green/10 text-green'
          : 'border-line bg-transparent text-tx-sec hover:border-line-strong hover:bg-surface-3 hover:text-tx',
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {done ? 'Copied' : label}
    </button>
  );
}
