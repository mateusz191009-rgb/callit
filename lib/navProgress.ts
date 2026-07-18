/**
 * Global navigation-progress signal for the top loading bar.
 *
 * App Router gives no navigation events, so the bar is driven from both
 * ends instead: `startNavProgress` fires when a navigation begins (the
 * TopLoader's document-level link listener, plus the handful of
 * programmatic `router.push` call sites via `startNavProgressTo`), and
 * the TopLoader calls `doneNavProgress` when `usePathname`/
 * `useSearchParams` report the route actually changed. Plain module
 * state — deliberately NOT the zustand store, so a nav flash never
 * touches the persisted snapshot.
 */

type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();
let active = false;

function emit() {
  for (const l of listeners) l(active);
}

/** Begin showing navigation progress (no-op while already running). */
export function startNavProgress() {
  if (active) return;
  active = true;
  emit();
}

/**
 * `startNavProgress` for programmatic `router.push(href)` sites — no-op
 * when `href` is already the current URL, so a same-page push can't
 * strand the bar at 90% waiting for a route change that never comes.
 */
export function startNavProgressTo(href: string) {
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(href, window.location.href);
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
    } catch {
      // Unparseable href — let the bar run; the safety timeout covers it.
    }
  }
  startNavProgress();
}

/** Finish navigation progress (no-op while idle). */
export function doneNavProgress() {
  if (!active) return;
  active = false;
  emit();
}

/** Subscribe to progress changes; the listener is called immediately
 *  with the current state. Returns the unsubscribe function. */
export function subscribeNavProgress(listener: Listener): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}
