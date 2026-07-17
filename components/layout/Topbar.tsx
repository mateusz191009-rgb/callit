'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Coins, Menu, Search } from 'lucide-react';
import Button from '@/components/ui/button';
import Logo from '@/components/brand/Logo';
import UserMenu from '@/components/auth/UserMenu';
import NotificationBell from '@/components/notifications/NotificationBell';
import SearchOverlay from '@/components/search/SearchOverlay';
import { useCallitStore } from '@/lib/store';
import { formatMoney } from '@/lib/format';

/**
 * Fixed top bar: burger (mobile) + logo, global market search with a
 * Cmd/Ctrl+K shortcut, demo USDC balance chip and auth entry points
 * (Log in / Sign up -> AuthModal, UserMenu when signed in).
 */
export default function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);

  const searchQuery = useCallitStore((s) => s.searchQuery);
  const setSearchQuery = useCallitStore((s) => s.setSearchQuery);
  const balance = useCallitStore((s) => s.balance);
  const hasHydrated = useCallitStore((s) => s._hasHydrated);
  const mobileNavOpen = useCallitStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useCallitStore((s) => s.setMobileNavOpen);
  const user = useCallitStore((s) => s.user);
  // Global auth modal (mounted once in AppShell) — open via store actions.
  const openAuthModal = useCallitStore((s) => s.openAuthModal);

  // Platform-aware shortcut hint (rendered after mount; "Ctrl K" default).
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  // Search dropdown overlay: open while the input is focused AND has at
  // least 2 chars. Additive — the store query keeps live-filtering the
  // home grid; the overlay only adds jump-to-result on top.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchOpen = searchFocused && searchQuery.trim().length >= 2;
  const closeSearch = () => {
    setSearchFocused(false);
    searchRef.current?.blur();
  };

  // Cmd/Ctrl+K focuses the global search from anywhere — except while a
  // dialog (trade modal, mobile drawer) is open, which would break its
  // focus trap and type into the page behind it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (document.querySelector('[aria-modal="true"]')) return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-line bg-surface">
      <div className="flex h-full items-center gap-2 px-4 sm:gap-3 sm:px-6">
        {/* Burger — mobile only */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileNavOpen}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-tx-sec transition-colors hover:bg-surface-3 hover:text-tx lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>

        {/* Logo lockup — wordmark only on every breakpoint (rebrand rule:
            the green icon never renders on the page itself). */}
        <Link href="/" aria-label="Callitnow home" className="flex shrink-0 items-center">
          <span className="sm:hidden">
            <Logo textClassName="text-[19px]" />
          </span>
          <span className="hidden sm:inline-flex">
            <Logo />
          </span>
        </Link>

        {/* Global search */}
        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-4">
          <div className="relative w-full max-w-xl">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tx-mut"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (pathname !== '/') router.push('/');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search markets…"
              aria-label="Search markets"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-xl border border-line bg-surface-2 pl-10 pr-4 text-sm text-tx transition-colors placeholder:text-tx-mut hover:border-line-strong focus:border-green/60 focus:outline-none sm:pr-16"
            />
            <kbd
              aria-hidden
              className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center rounded-md border border-line bg-surface-3 px-1.5 py-0.5 font-sans text-[11px] font-bold text-tx-mut sm:flex"
            >
              {isMac ? '⌘ K' : 'Ctrl K'}
            </kbd>

            {/* Grouped results dropdown (events + markets) under the input */}
            <SearchOverlay
              open={searchOpen}
              query={searchQuery}
              inputRef={searchRef}
              onClose={closeSearch}
            />
          </div>
        </div>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Balance chip — signed-in users only (guests have no balance) */}
          {hasHydrated && user && (
            <span className="hidden h-10 items-center gap-2 rounded-xl border border-line bg-surface-3 px-3.5 text-sm font-bold text-tx md:inline-flex">
              <Coins className="h-4 w-4 text-green" aria-hidden />
              <span className="tabular-nums">{formatMoney(balance)}</span>
              <span className="text-tx-mut">USDC</span>
            </span>
          )}

          {/* Derived notifications (deposits, withdrawals, resolutions) —
              signed-in users only, gated on hydration like the chip above
              so SSR and the client agree. */}
          {hasHydrated && user && <NotificationBell />}

          {user ? (
            <UserMenu />
          ) : (
            <>
              <Button
                variant="ghost"
                size="md"
                className="hidden md:inline-flex"
                onClick={() => openAuthModal('signin')}
              >
                Log in
              </Button>
              <Button
                variant="outline"
                size="md"
                className="hidden md:inline-flex"
                onClick={() => openAuthModal('signup')}
              >
                Sign up
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
