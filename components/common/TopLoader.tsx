'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  doneNavProgress,
  startNavProgress,
  subscribeNavProgress,
} from '@/lib/navProgress';
import { useCallitStore } from '@/lib/store';

/**
 * Global top loading bar (v11) — a thin green progress bar fixed above
 * the topbar. It runs whenever "something is loading":
 *
 *  1. Route navigations — every internal `<Link>` click (document-level
 *     listener, no per-link wiring) plus the programmatic `router.push`
 *     sites (MarketCard / EventCard / SearchOverlay / CreateMarketForm /
 *     Topbar), which call `startNavProgressTo` themselves. The bar
 *     completes when `usePathname`/`useSearchParams` report the new
 *     route, i.e. when opening a bet actually landed on its page.
 *  2. The initial data load — store rehydration + the first Polymarket
 *     feed fetch (`_hasHydrated` / `polyLoaded`), the same flags the
 *     detail pages gate their skeletons on.
 *
 * Progress is the usual optimistic trickle: jump to ~12%, ease toward
 * 90%, snap to 100% and fade out on completion. A safety timeout keeps
 * a cancelled navigation (blocked, same page, error) from stranding the
 * bar forever. Renders nothing on the server — activity only ever
 * starts in effects, so hydration always matches.
 */

/** Trickle tick interval. */
const TRICKLE_MS = 180;
/** Auto-finish a navigation that never completed (cancelled/failed). */
const SAFETY_MS = 8_000;
/** How long the finished bar stays at 100% before fading out. */
const DONE_HOLD_MS = 320;

function TopLoaderBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial data load — the same flags market/event detail pages use
  // for their skeletons: zustand rehydration + the first feed fetch.
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const polyLoaded = useCallitStore((s) => s.polyLoaded);

  const [navActive, setNavActive] = useState(false);
  const [show, setShow] = useState(false);
  const [progress, setProgress] = useState(0);
  const hideTimer = useRef<number | undefined>(undefined);

  const active = navActive || !hydrated || !polyLoaded;

  // Nav signal from lib/navProgress (link clicks + router.push sites).
  useEffect(() => subscribeNavProgress(setNavActive), []);

  // Route committed — finish whatever navigation was in flight.
  useEffect(() => {
    doneNavProgress();
  }, [pathname, searchParams]);

  // Document-level listener: any left-click on an internal link starts
  // the bar — covers every <Link> in the app without touching them.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      // External links do a full page load (the browser shows its own
      // progress); hash/same-page clicks never commit a route change.
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      startNavProgress();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Trickle while active; on finish snap to 100%, hold briefly, fade.
  useEffect(() => {
    if (active) {
      window.clearTimeout(hideTimer.current);
      setShow(true);
      setProgress((p) => (p > 0 && p < 100 ? p : 12));
      const trickle = window.setInterval(() => {
        setProgress((p) => Math.min(90, p + Math.max(0.4, (90 - p) * 0.06)));
      }, TRICKLE_MS);
      const safety = window.setTimeout(() => doneNavProgress(), SAFETY_MS);
      return () => {
        window.clearInterval(trickle);
        window.clearTimeout(safety);
      };
    }
    setProgress((p) => (p > 0 ? 100 : 0));
    hideTimer.current = window.setTimeout(() => {
      setShow(false);
      setProgress(0);
    }, DONE_HOLD_MS);
    return () => window.clearTimeout(hideTimer.current);
  }, [active]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px]"
    >
      <div
        className="h-full rounded-r-full bg-gradient-to-r from-green-deep via-green to-green shadow-glow-green"
        style={{
          width: `${progress}%`,
          opacity: show ? 1 : 0,
          // Width eases with the trickle; opacity fades AFTER the snap
          // to 100% has painted, so the finish reads as "done", not cut.
          transition: show
            ? 'width 200ms ease'
            : 'width 200ms ease, opacity 240ms ease 80ms',
        }}
      />
    </div>
  );
}

export default function TopLoader() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <TopLoaderBar />
    </Suspense>
  );
}
