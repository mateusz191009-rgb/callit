'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Coins, Search, X } from 'lucide-react';
import Button from '@/components/ui/button';
import Logo from '@/components/brand/Logo';
import UserMenu from '@/components/auth/UserMenu';
import NotificationBell from '@/components/notifications/NotificationBell';
import SearchOverlay from '@/components/search/SearchOverlay';
import { useCallitStore } from '@/lib/store';
import { formatMoney } from '@/lib/format';
import { startNavProgressTo } from '@/lib/navProgress';
import { cn } from '@/lib/utils';

/**
 * Fixed top bar: logo, global market search with a Cmd/Ctrl+K shortcut,
 * USDC balance chip and auth entry points (Log in / Sign up ->
 * AuthModal, UserMenu when signed in). v12: no burger — the nav lives in
 * the CategoryBar below plus the profile menu, Polymarket-style.
 */
export default function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);

  const searchQuery = useCallitStore((s) => s.searchQuery);
  const setSearchQuery = useCallitStore((s) => s.setSearchQuery);
  const balance = useCallitStore((s) => s.balance);
  const hasHydrated = useCallitStore((s) => s._hasHydrated);
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

  // Below `sm` the field used to share a 390px bar with the logo (78px) and
  // the Log in / Sign up cluster (141px), which left it 115px wide — 59px of
  // usable typing area after `pl-10 pr-4`. The placeholder was truncated and
  // a typed query scrolled out of sight after ~5 characters, on the only
  // route to a specific market. On mobile the field is now revealed by a
  // search button and takes the whole bar for as long as it is in use.
  const [mobileSearch, setMobileSearch] = useState(false);
  useEffect(() => {
    if (mobileSearch) searchRef.current?.focus();
  }, [mobileSearch]);

  const closeSearch = () => {
    setSearchFocused(false);
    setMobileSearch(false);
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
    // v25 liquid glass: translucent + blurred only where backdrop-filter
    // exists, so unsupported browsers keep the solid surface.
    // The `pt`/`h` pair is the status-bar fix: `viewportFit: 'cover'` puts
    // web content under the iOS status bar, so a flat h-16 bar had the clock
    // and battery sitting on the logo and the Sign-up button in the installed
    // app. The horizontal insets are the same problem in landscape, where the
    // notch clipped the logo.
    <header className="fixed inset-x-0 top-0 z-50 h-[var(--topbar-h)] border-b border-line bg-surface pt-[var(--safe-top)] supports-[backdrop-filter]:bg-surface/75 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150">
      <div className="flex h-full items-center gap-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
        {/* Logo lockup — wordmark only on every breakpoint (rebrand rule:
            the green icon never renders on the page itself). Steps aside for
            the expanded mobile search field. */}
        <Link
          href="/"
          aria-label="Callitnow home"
          className={cn('flex shrink-0 items-center', mobileSearch && 'max-sm:hidden')}
        >
          <span className="sm:hidden">
            <Logo textClassName="text-[19px]" />
          </span>
          <span className="hidden sm:inline-flex">
            <Logo />
          </span>
        </Link>

        {/* Global search. The wrapper keeps its flex share on mobile even
            while the field itself is hidden, so the right cluster stays
            right-aligned. */}
        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-4">
          <div className={cn('relative w-full max-w-xl', !mobileSearch && 'hidden sm:block')}>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tx-mut"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur();
                // Typing no longer navigates. It used to push('/') on EVERY
                // keystroke from any other route, which threw away a category
                // hub's rail selection and sort on the first character — and
                // it was redundant, because the results dropdown is already
                // open over whatever page you are on. Enter still takes you
                // to the full filtered grid, but only when nothing in the
                // dropdown is selected (SearchOverlay's own Enter handler
                // runs first and navigates to the highlighted result).
                if (e.key === 'Enter' && pathname !== '/' && !e.defaultPrevented) {
                  startNavProgressTo('/');
                  router.push('/');
                }
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                setSearchFocused(false);
                // Collapse the mobile field again only when nothing was
                // typed. With a live query the bar stays in search mode —
                // the query is still filtering the grid behind it, and the
                // X below is the way out.
                if (!searchQuery.trim()) setMobileSearch(false);
              }}
              placeholder="Search markets…"
              aria-label="Search markets"
              // The dropdown is a real listbox with role="option" children,
              // but nothing tied it to this input, so arrow-key selection was
              // silent to a screen reader. SearchOverlay sets
              // aria-activedescendant here as the selection moves.
              role="combobox"
              aria-expanded={searchOpen}
              aria-controls="search-listbox"
              aria-autocomplete="list"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-xl border border-line bg-surface-2 pl-10 pr-10 text-sm coarse:text-base text-tx transition-colors placeholder:text-tx-mut hover:border-line-strong focus:border-green/60 sm:pr-16"
            />
            {/* Way back out of mobile search mode: clears the query (which
                also un-filters the grid) and restores the logo + auth. */}
            {mobileSearch && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  closeSearch();
                }}
                aria-label="Close search"
                className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-tx-mut transition-colors hover:bg-surface-3 hover:text-tx sm:hidden"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
            <kbd
              aria-hidden
              className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center rounded-md border border-line bg-surface-3 px-1.5 py-0.5 font-sans text-micro font-semibold text-tx-mut sm:flex"
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

        {/* Mobile search trigger — the field it opens is the same input, so
            Cmd/Ctrl+K, the store query and the results dropdown all keep
            working unchanged. 40px square: a real touch target, where the
            old inline field was a 59px-wide typing slot. */}
        {!mobileSearch && (
          <button
            type="button"
            onClick={() => setMobileSearch(true)}
            aria-label="Search markets"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-tx-mut transition-colors hover:border-line-strong hover:text-tx sm:hidden"
          >
            <Search className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}

        {/* Right cluster */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 sm:gap-3',
            mobileSearch && 'max-sm:hidden'
          )}
        >
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
              {/* v12: visible on ALL breakpoints — the mobile drawer that
                  used to carry these entry points is gone. */}
              <Button
                variant="ghost"
                size="md"
                className="px-2.5 sm:px-4"
                onClick={() => openAuthModal('signin')}
              >
                Log in
              </Button>
              <Button
                variant="outline"
                size="md"
                className="px-2.5 sm:px-4"
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
