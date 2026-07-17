'use client';

import { useEffect } from 'react';

/**
 * v8 — registers the PWA service worker. PRODUCTION ONLY: a SW on
 * localhost would cache dev bundles and fight HMR, so this is a hard
 * no-op in development.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Install-ability is progressive enhancement — never surface this.
    });
  }, []);
  return null;
}
