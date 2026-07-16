'use client';

import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { usePolymarketLoader } from '@/lib/useMarkets';

/** How often the cloud profile mirror is refreshed while signed in. */
const PROFILE_REFRESH_MS = 60_000;

/**
 * Client-side app shell: manual zustand rehydration (SSR-safe), the
 * one-time Polymarket fetch, framer-motion reduced-motion handling and
 * the dark, green-accented toaster.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  usePolymarketLoader();

  // Cloud mode: while Supabase is configured AND a user is signed in,
  // refresh the server-owned state every 60s — the profile (balance /
  // banned / isAdmin, v4) and the positions book (v5) — so admin-approved
  // deposits, bans and fills made in another tab propagate without a
  // reload. Both are fetched immediately on sign-in/reload too: in cloud
  // mode the balance and positions are SERVER state, and the store starts
  // with an empty cloud book.
  const signedIn = useCallitStore((s) => Boolean(s.user));
  useEffect(() => {
    if (!supabaseEnabled || !signedIn) return;
    const refresh = () => {
      const s = useCallitStore.getState();
      void s.refreshProfile();
      void s.refreshPositions();
    };
    refresh();
    const id = window.setInterval(refresh, PROFILE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [signedIn]);

  useEffect(() => {
    useCallitStore.persist.rehydrate();
    useCallitStore.getState().setHasHydrated(true);

    // Cross-tab sync: when another tab writes the persisted snapshot,
    // rehydrate so this tab doesn't clobber it with stale state later.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'callit-store-v1') useCallitStore.persist.rehydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#1C2E3C',
            border: '1px solid #2C4356',
            color: '#FFFFFF',
          },
          classNames: {
            success: '[&_svg]:!text-green',
            error: '[&_svg]:!text-danger',
          },
        }}
      />
    </MotionConfig>
  );
}
