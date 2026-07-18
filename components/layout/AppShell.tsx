'use client';

import { useEffect } from 'react';
import Topbar from './Topbar';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import MobileCategoryBar from './MobileCategoryBar';
import Footer from './Footer';
import TradeModal from '@/components/trading/TradeModal';
import AuthModal from '@/components/auth/AuthModal';
import SupportBot from '@/components/support/SupportBot';
import RegisterSW from '@/components/pwa/RegisterSW';
import { useCallitStore } from '@/lib/store';
import { captureRefFromUrl } from '@/lib/referral';
import { cn } from '@/lib/utils';

/**
 * App chrome: fixed topbar, desktop sidebar (collapsible), mobile drawer
 * and the global trade + auth modals so quick-buys and sign-in work from
 * every page (Topbar buttons AND the mobile drawer). Main content shifts
 * with the sidebar width via a smooth padding transition.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useCallitStore((s) => s.sidebarCollapsed);
  const authModal = useCallitStore((s) => s.authModal);
  const closeAuthModal = useCallitStore((s) => s.closeAuthModal);

  // v10 — remember `?ref=CODE` from the landing URL so the sign-up form
  // can prefill it later, wherever the visitor opens it from.
  useEffect(() => {
    captureRefFromUrl();
  }, []);

  return (
    <div className="min-h-screen">
      <Topbar />
      <Sidebar />
      <MobileNav />

      <main
        className={cn(
          // overflow-x-clip (NOT -hidden): guards against any child pushing
          // the page sideways on mobile while still not creating a scroll
          // container — the lg:sticky rails on market/event pages keep
          // sticking to the viewport (overflow-x-hidden would break them).
          'overflow-x-clip pt-16 transition-[padding] duration-300 ease-in-out',
          collapsed ? 'lg:pl-[72px]' : 'lg:pl-[256px]'
        )}
      >
        {/* Mobile only — categories reachable without the burger drawer. */}
        <MobileCategoryBar />
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
