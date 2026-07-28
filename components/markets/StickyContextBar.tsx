'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Polymarket-style compact context bar (v24.1): once the page header
 * scrolls away, a small icon + title pill stays pinned under the sticky
 * CategoryBar so you always see WHICH bet you are in.
 *
 * Geometry: fixed Topbar 64px + CategoryBar (36px items + 12px padding +
 * 1px border = 49px) puts the CategoryBar's bottom edge at 113px, and the
 * bar sits flush against it — an 8px gap used to show a stripe of scrolling
 * content between the two, which is what made it read as floating debris
 * rather than as page chrome. The wrapper is h-0 (zero flow height, no
 * layout shift) and lives INSIDE the page's LEFT column, so the bar can
 * never cover the sticky trade rail on the right.
 *
 * `watch` is the header element whose disappearance summons the pill: an
 * IntersectionObserver (viewport shrunk by the same 121px) flips it on when
 * the header's bottom passes above the pill's own resting line.
 */
export default function StickyContextBar({
  watch,
  children,
  className,
}: {
  watch: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Goes on the STICKY wrapper, not the bar — that element has to stay a
   *  direct child of the tall column or `position: sticky` resolves against
   *  a short containing block and the bar unpins immediately. Scope it to a
   *  breakpoint here (`lg:hidden`) rather than wrapping it in a div. */
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const el = watch.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Above the shrunk viewport = scrolled past; the bottom check keeps
        // a header that is merely off-screen BELOW (never on these pages,
        // but cheap) from summoning the pill.
        const next =
          !entry.isIntersecting && entry.boundingClientRect.bottom < 113;
        if (next !== shownRef.current) {
          shownRef.current = next;
          setShown(next);
        }
      },
      { rootMargin: '-113px 0px 0px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);

  return (
    <div className={cn('pointer-events-none sticky top-[113px] z-20 h-0', className)}>
      {/* v25.24 — a BAR, not a floating pill.
          It used to be a rounded pill on bg-ink/90 with a blur, which left
          the outcome row underneath ghosting through it and visible around
          its corners: scrolling the event page looked like a rendering
          fault. Solid background, square edges, full column width and a
          bottom rule — so content passes cleanly under it, which is what
          Polymarket's sticky header does.

          It bleeds to the page gutter with -mx-4 / sm:-mx-6 so nothing can
          appear beside it, and re-pads itself to keep the content aligned
          with the column. */}
      <div
        aria-hidden={!shown}
        className={cn(
          '-mx-4 flex items-center gap-3 border-b border-line bg-ink px-4 py-2.5 transition-all duration-200 sm:-mx-6 sm:px-6',
          shown
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : '-translate-y-1 opacity-0'
        )}
      >
        {children}
      </div>
    </div>
  );
}
