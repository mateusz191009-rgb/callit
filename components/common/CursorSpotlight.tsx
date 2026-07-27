'use client';

import { useEffect } from 'react';

/**
 * Global cursor spotlight (v25): one rAF-throttled document listener that
 * writes card-local --mx/--my custom properties onto every .spotlight-card
 * near the pointer, so the masked border ring in globals.css lights up
 * across neighboring cards — no per-grid wiring. Mounted once in AppShell.
 *
 * Fine pointers only: touch devices never match the media query (and touch
 * pointermoves are ignored as a second guard), so mobile pays zero cost.
 */

// How far past a card's edge the light still reaches. Matches the largest
// gradient radius in globals.css (480px sheen) — beyond that the gradient
// is invisible, so we skip the style write entirely.
const REACH = 480;

export default function CursorSpotlight() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const root = document.documentElement;
    let raf = 0;
    let px = 0;
    let py = 0;

    /**
     * Card geometry in DOCUMENT space, cached.
     *
     * Two things made the old version expensive: it re-ran
     * `querySelectorAll` + `getBoundingClientRect()` on every card on every
     * frame, and it interleaved those reads with `style.setProperty` writes
     * — so each card's measurement forced a synchronous layout to flush the
     * previous card's write. With a 20-card grid that ran on every
     * pointermove AND every scroll frame.
     *
     * Document coordinates are the other half: viewport rects change with
     * scroll and would need re-measuring, document rects do not. Scrolling
     * now only shifts the pointer position.
     */
    type Spot = { el: HTMLElement; left: number; top: number; right: number; bottom: number };
    let spots: Spot[] = [];
    let dirty = true;
    let measuredAt = 0;
    /** Don't re-measure more than this often, however noisy the DOM is. */
    const REMEASURE_MS = 200;

    // READ pass — nothing in this loop writes, so the layout is computed once.
    const measure = () => {
      const sx = window.scrollX;
      const sy = window.scrollY;
      spots = Array.from(document.querySelectorAll<HTMLElement>('.spotlight-card')).map(
        (el) => {
          const r = el.getBoundingClientRect();
          return {
            el,
            left: r.left + sx,
            top: r.top + sy,
            right: r.right + sx,
            bottom: r.bottom + sy,
          };
        }
      );
      dirty = false;
      measuredAt = performance.now();
    };

    // WRITE pass — every rect it needs was read above.
    const paint = () => {
      raf = 0;
      if (dirty && performance.now() - measuredAt > REMEASURE_MS) measure();
      const gx = px + window.scrollX;
      const gy = py + window.scrollY;
      for (const s of spots) {
        const near =
          gx >= s.left - REACH &&
          gx <= s.right + REACH &&
          gy >= s.top - REACH &&
          gy <= s.bottom + REACH;
        if (near) {
          s.el.style.setProperty('--mx', `${gx - s.left}px`);
          s.el.style.setProperty('--my', `${gy - s.top}px`);
        } else if (s.el.style.getPropertyValue('--mx')) {
          // Park far cards back on the invisible fallback center.
          s.el.style.removeProperty('--mx');
          s.el.style.removeProperty('--my');
        }
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    // Cards arrive and leave constantly (filters, "show more", the feed
    // poll), so the cache is invalidated rather than rebuilt — the next
    // frame that actually paints re-measures, at most every REMEASURE_MS.
    const invalidate = () => {
      dirty = true;
    };
    const observer = new MutationObserver(invalidate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', invalidate);

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      px = e.clientX;
      py = e.clientY;
      root.setAttribute('data-spotlight', '');
      schedule();
    };
    // Keep the light aligned when the page scrolls under a resting pointer.
    const onScroll = () => {
      if (root.hasAttribute('data-spotlight')) schedule();
    };
    const off = () => root.removeAttribute('data-spotlight');

    document.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', off);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('blur', off);
    return () => {
      document.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', off);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('blur', off);
      window.removeEventListener('resize', invalidate);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      off();
    };
  }, []);

  return null;
}
