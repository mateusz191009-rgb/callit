/**
 * v25.40 — THE SHARE PRIMITIVES: turn an in-app path into a link somebody
 * else can open, and get it out of the browser.
 *
 * Deliberately tiny and dependency-free. Every share surface in the app
 * (market card, detail header, receipt row, portfolio, profile) routes
 * through `shareLink()` so there is exactly one answer to "what does the
 * button do" — and exactly one place to change it.
 *
 * THE BROWSER SPLIT. `navigator.share` is the good path: on a phone it opens
 * the real OS sheet, so the link lands in WhatsApp/iMessage/Signal in one tap.
 * Desktop Chrome and Firefox mostly do not have it, and Safari refuses it
 * outside a user gesture — so the fallback is the clipboard, which is what a
 * desktop user wanted anyway. The caller gets told which one happened
 * (`ShareOutcome`) so it can show the right toast; a share the user dismissed
 * is NOT an error and must not toast like one.
 */

/**
 * The canonical origin for outgoing links.
 *
 * TWO ENV VARS, BECAUSE THE PROJECT ALREADY HAS TWO: `NEXT_PUBLIC_SITE_URL`
 * is what app/layout.tsx feeds `metadataBase`, and `NEXT_PUBLIC_APP_URL` is
 * what the withdrawal e-mails have used since v8. Reading both means a share
 * link is right on a deployment that only ever set one of them — picking one
 * and ignoring the other is how you ship links to the wrong host.
 *
 * The browser's own origin comes next, so a local dev session shares localhost
 * links instead of silently pointing at production.
 */
export function siteOrigin(): string {
  const configured = (
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL
  )
    ?.trim()
    .replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://callitnow.app';
}

/** Absolute URL for an in-app path (`/market/abc` -> `https://…/market/abc`). */
export function absoluteUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${siteOrigin()}${p}`;
}

/** The public link for a market, an event, a profile and a shared bet. */
export function marketUrl(id: string): string {
  return absoluteUrl(`/market/${encodeURIComponent(id)}`);
}

export function eventUrl(id: string): string {
  return absoluteUrl(`/event/${encodeURIComponent(id)}`);
}

export function profileUrl(username: string): string {
  return absoluteUrl(`/u/${encodeURIComponent(username)}`);
}

export function betShareUrl(token: string): string {
  return absoluteUrl(`/bet/${encodeURIComponent(token)}`);
}

/** What `shareLink()` actually managed to do. */
export type ShareOutcome =
  /** The OS share sheet took it. Say nothing — the sheet already did. */
  | 'shared'
  /** Copied to the clipboard. Worth a toast: nothing else was visible. */
  | 'copied'
  /** The user dismissed the sheet. NOT a failure — stay silent. */
  | 'dismissed'
  /** Neither path worked (no clipboard permission, insecure origin, …). */
  | 'failed';

/**
 * Copy text to the clipboard, with the pre-`navigator.clipboard` fallback.
 *
 * The async Clipboard API needs a secure context, so it is missing on a plain
 * http:// LAN origin — which is exactly how this app gets tested on a phone.
 * The hidden-textarea + `execCommand` path is deprecated but still works
 * everywhere, and a share button that silently does nothing on the device the
 * feature was built for is worse than a deprecated call.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    // Off-screen but focusable: `display:none` cannot be selected.
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export interface ShareLinkInput {
  url: string;
  /** Sheet title. Ignored by most targets, but free to provide. */
  title?: string;
  /** The line that rides along with the link in the share sheet. */
  text?: string;
}

/**
 * Share a link the best way this browser can, and report which way that was.
 *
 * MUST be called straight out of a click handler: Safari revokes the user
 * gesture across an `await`, so any token minting the caller needs has to
 * happen either before this call or inside the same tick — see
 * `ShareBetButton`, which pre-warms the token for exactly this reason.
 */
export async function shareLink({ url, title, text }: ShareLinkInput): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ url, title, text });
      return 'shared';
    } catch (e) {
      // AbortError is the user closing the sheet. Anything else (a target
      // that rejected, a permissions policy) still deserves the clipboard.
      if (e instanceof DOMException && e.name === 'AbortError') return 'dismissed';
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}
