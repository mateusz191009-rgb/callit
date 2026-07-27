'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Is the sticky header currently pinned? (v25.34)
 *
 * READ THIS BEFORE REUSING IT. v25.30 had a hook like this driving a header
 * that SHRANK on pin — icon 48→28, title 30px→14px — and the owner's verdict
 * was "buggy und laggt": animating font-size and box size relayouts the whole
 * column on every frame, and a headline that changes size mid-scroll is a jolt
 * by construction. That header is gone and is not coming back.
 *
 * What this drives instead is PAINT ONLY: a hairline under the bar fading from
 * transparent to `line`. The border is always present at 1px, so nothing
 * reflows, nothing shifts, and the worst case if the observer fires late is a
 * hairline arriving a frame after the pin.
 *
 * Callback ref, not an object ref: both detail pages render a skeleton until
 * their data lands, so at first-effect time the sentinel does not exist yet —
 * an object-ref effect would observe null once and never again.
 *
 * The sentinel belongs at the TOP EDGE of the sticky element's wrapper and
 * must be absolutely positioned: as a normal-flow sibling it would collect a
 * `space-y` margin and fire a full gap early.
 */
export function usePinned(topPx = 113): [(node: HTMLElement | null) => void, boolean] {
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const ioRef = useRef<IntersectionObserver | null>(null);

  const attach = useCallback(
    (node: HTMLElement | null) => {
      ioRef.current?.disconnect();
      ioRef.current = null;
      if (!node || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        ([entry]) => {
          const next =
            !entry.isIntersecting && entry.boundingClientRect.bottom <= topPx;
          if (next !== pinnedRef.current) {
            pinnedRef.current = next;
            setPinned(next);
          }
        },
        { rootMargin: `-${topPx}px 0px 0px 0px` }
      );
      io.observe(node);
      ioRef.current = io;
    },
    [topPx]
  );

  return [attach, pinned];
}
