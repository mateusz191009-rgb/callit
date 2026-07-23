'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Polymarket-style compact context bar (v24.1): once the page header
 * scrolls away, a small icon + title pill stays pinned under the sticky
 * CategoryBar so you always see WHICH bet you are in.
 *
 * Geometry: fixed Topbar 64px + CategoryBar (36px items + 12px padding +
 * 1px border = 49px) puts the CategoryBar's bottom edge at 113px; the pill
 * sticks 8px below that. The wrapper is h-0 (zero flow height, no layout
 * shift) and lives INSIDE the page's LEFT column, so the pill can never
 * cover the sticky trade rail on the right.
 *
 * `watch` is the header element whose disappearance summons the pill: an
 * IntersectionObserver (viewport shrunk by the same 121px) flips it on when
 * the header's bottom passes above the pill's own resting line.
 */
export default function StickyContextBar({
  watch,
  children,
}: {
  watch: React.RefObject<HTMLElement | null>;
  children: ReactNode;
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
          !entry.isIntersecting && entry.boundingClientRect.bottom < 121;
        if (next !== shownRef.current) {
          shownRef.current = next;
          setShown(next);
        }
      },
      { rootMargin: '-121px 0px 0px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);

  return (
    <div className="pointer-events-none sticky top-[121px] z-20 h-0">
      <div
        aria-hidden={!shown}
        className={cn(
          'flex items-center gap-3 rounded-xl border border-line bg-ink/90 px-3 py-2 shadow-lg backdrop-blur transition-all duration-200',
          shown
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : '-translate-y-2 opacity-0'
        )}
      >
        {children}
      </div>
    </div>
  );
}
