'use client';

import { useEffect } from 'react';
import Topbar from './Topbar';
import CategoryBar from './CategoryBar';
import Footer from './Footer';
import TradeModal from '@/components/trading/TradeModal';
import AuthModal from '@/components/auth/AuthModal';
import SupportBot from '@/components/support/SupportBot';
import RegisterSW from '@/components/pwa/RegisterSW';
import TopLoader from '@/components/common/TopLoader';
import CursorSpotlight from '@/components/common/CursorSpotlight';
import { useCallitStore } from '@/lib/store';
import { captureRefFromUrl } from '@/lib/referral';

/**
 * App chrome (v12, Polymarket-style): fixed topbar + category strip on
 * every breakpoint — no sidebar, no burger drawer. Secondary destinations
 * (Settings, Help, Leaderboard, …) live in the profile UserMenu. Also
 * mounts the global trade + auth modals so quick-buys and sign-in work
 * from every page.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const authModal = useCallitStore((s) => s.authModal);
  const closeAuthModal = useCallitStore((s) => s.closeAuthModal);

  // v10 — remember `?ref=CODE` from the landing URL so the sign-up form
  // can prefill it later, wherever the visitor opens it from.
  useEffect(() => {
    captureRefFromUrl();
  }, []);

  return (
    <div className="min-h-screen">
      {/* v11 — global progress bar, above the topbar (z-[60] over z-50). */}
      <TopLoader />
      {/* v25 — cursor spotlight: writes --mx/--my onto .spotlight-card
          elements page-wide (desktop pointers only, null on touch). */}
      <CursorSpotlight />
      <Topbar />

      {/* overflow-x-clip (NOT -hidden): guards against any child pushing
          the page sideways on mobile while still not creating a scroll
          container — the lg:sticky rails on market/event pages keep
          sticking to the viewport (overflow-x-hidden would break them). */}
      <main className="overflow-x-clip pt-16">
        <CategoryBar />
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</div>
        <Footer />
      </main>

      <TradeModal />
      {/* Keyed by tab so re-opening on the other tab remounts a fresh form. */}
      <AuthModal
        key={authModal ?? 'closed'}
        open={authModal !== null}
        onClose={closeAuthModal}
        defaultTab={authModal ?? 'signin'}
      />
      <SupportBot />
      {/* PWA service worker — production-only no-op component. */}
      <RegisterSW />
    </div>
  );
}
