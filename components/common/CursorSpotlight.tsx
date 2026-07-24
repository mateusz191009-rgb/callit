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

    const paint = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>('.spotlight-card').forEach((card) => {
        const r = card.getBoundingClientRect();
        const near =
          px >= r.left - REACH &&
          px <= r.right + REACH &&
          py >= r.top - REACH &&
          py <= r.bottom + REACH;
        if (near) {
          card.style.setProperty('--mx', `${px - r.left}px`);
          card.style.setProperty('--my', `${py - r.top}px`);
        } else if (card.style.getPropertyValue('--mx')) {
          // Park far cards back on the invisible fallback center.
          card.style.removeProperty('--mx');
          card.style.removeProperty('--my');
        }
      });
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

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
      if (raf) cancelAnimationFrame(raf);
      off();
    };
  }, []);

  return null;
}
