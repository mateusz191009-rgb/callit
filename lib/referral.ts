/**
 * v10 — referral-link capture. A landing on any page with `?ref=CODE`
 * remembers the code in localStorage so it survives navigation until the
 * visitor opens the sign-up form (the modal prefills from here). The
 * code itself is only validated server-side; this is just transport.
 */

const KEY = 'callit-ref-code';

/** Longest code set_affiliate_code() accepts — anything longer is junk. */
const MAX_LEN = 20;

/** Read `?ref=` from the current URL and remember it. Call on app mount. */
export function captureRefFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const ref = new URLSearchParams(window.location.search).get('ref')?.trim();
    if (ref) window.localStorage.setItem(KEY, ref.slice(0, MAX_LEN));
  } catch {
    // Storage unavailable (private mode) — the sign-up field still works
    // manually; losing the prefill is the acceptable degradation.
  }
}

/** The remembered referral code, or '' when none was captured. */
export function storedRefCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** Forget the remembered code (after a successful sign-up). */
export function clearStoredRefCode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — worst case the prefill shows again next time.
  }
}
