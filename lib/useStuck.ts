'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Has the sentinel scrolled up past the app chrome? (v25.30)
 *
 * The signal behind the Polymarket-style collapsing page header: a sentinel
 * element ABOVE the sticky header (right under the back link) is observed,
 * and the header renders compact from the moment the sentinel's bottom
 * passes the chrome line (64px Topbar + 49px CategoryBar = 113px). Watching
 * a sentinel rather than the header itself is what keeps the state stable —
 * the header changes its own height when it collapses, and an element cannot
 * be the measure of its own move.
 *
 * Returns a CALLBACK ref, not an object ref, and that is load-bearing: both
 * detail pages render a skeleton until their data lands, so at first-effect
 * time the sentinel does not exist yet — an object-ref effect would observe
 * null once and never again. The callback ref attaches the observer at the
 * moment the real sentinel mounts, however late that is.
 */
export function useStuck(
  topPx = 113
): [(node: HTMLElement | null) => void, boolean] {
  const [stuck, setStuck] = useState(false);
  const stuckRef = useRef(false);
  const ioRef = useRef<IntersectionObserver | null>(null);

  const attach = useCallback(
    (node: HTMLElement | null) => {
      ioRef.current?.disconnect();
      ioRef.current = null;
      if (!node || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        ([entry]) => {
          const next =
            !entry.isIntersecting && entry.boundingClientRect.bottom < topPx;
          if (next !== stuckRef.current) {
            stuckRef.current = next;
            setStuck(next);
          }
        },
        { rootMargin: `-${topPx}px 0px 0px 0px` }
      );
      io.observe(node);
      ioRef.current = io;
    },
    [topPx]
  );

  return [attach, stuck];
}
