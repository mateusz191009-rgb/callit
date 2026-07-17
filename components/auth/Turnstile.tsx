'use client';

import { useEffect, useRef } from 'react';

/**
 * v8 — Cloudflare Turnstile widget (free, privacy-friendly captcha).
 *
 * GRACEFUL DEGRADATION: without NEXT_PUBLIC_TURNSTILE_SITE_KEY this renders
 * NOTHING and immediately reports `onToken(null)` meaning "captcha not
 * required" — sign-up proceeds captcha-less until the owner adds the keys.
 * Cloudflare's script is only ever loaded when the key exists.
 */

// Real Turnstile site keys start with 0x (1x/2x/3x are Cloudflare's test
// keys — also valid). Anything else — especially the 'your-…' placeholder
// from .env.local.example — must count as NOT CONFIGURED: a bogus sitekey
// renders a permanently-failing widget and locks sign-up shut.
const RAW_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SITE_KEY = /^[0-3]x[\w-]{8,}$/.test(RAW_SITE_KEY) ? RAW_SITE_KEY : '';
const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** True when the deployment has captcha configured — exported so the form
 *  knows whether a token is required before submit. */
export const turnstileRequired = Boolean(SITE_KEY);

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: 'dark' | 'light';
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptLoading) {
    scriptLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => resolve(); // degraded: form falls back to "no token"
      document.head.appendChild(s);
    });
  }
  return scriptLoading;
}

export default function Turnstile({
  onToken,
}: {
  /** Called with a fresh token, or null when the token expired/errored
   *  (and once immediately when captcha is not configured at all). */
  onToken: (token: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!SITE_KEY) {
      onToken(null);
      return;
    }
    let widgetId: string | null = null;
    let alive = true;
    void loadScript().then(() => {
      if (!alive || !hostRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(hostRef.current, {
        sitekey: SITE_KEY,
        theme: 'dark',
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    });
    return () => {
      alive = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
    // onToken is intentionally captured once — the modal recreates this
    // component per open (keyed), so a stable ref is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={hostRef} className="min-h-[65px]" />;
}
