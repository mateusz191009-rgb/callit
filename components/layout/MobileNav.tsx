'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import Logo from '@/components/brand/Logo';
import Button from '@/components/ui/button';
import { useCallitStore } from '@/lib/store';
import { SidebarNav, SidebarUtilities } from './Sidebar';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Off-canvas drawer for < lg screens. Slides in from the left with a
 * spring, dims the page behind it, locks body scroll while open and
 * closes on backdrop click, Escape or any nav action.
 */
export default function MobileNav() {
  const open = useCallitStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useCallitStore((s) => s.setMobileNavOpen);
  const user = useCallitStore((s) => s.user);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);
  const close = () => setMobileNavOpen(false);
  const drawerRef = useRef<HTMLElement>(null);

  // Auth entry points are hidden on mobile in the Topbar — the drawer is
  // where signed-out users reach the (globally mounted) AuthModal.
  const openAuth = (tab: 'signin' | 'signup') => {
    close();
    openAuthModal(tab);
  };

  // Body scroll lock while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape closes; Tab is trapped inside the drawer (aria-modal).
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 50);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileNavOpen(false);
      if (e.key === 'Tab') {
        const nodes = drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (!drawerRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open, setMobileNavOpen]);

  // Auto-close when the viewport grows past lg (drawer becomes display:none
  // but would otherwise keep the scroll lock with no way to release it).
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open, setMobileNavOpen]);

  // No AnimatePresence exit (broken with React 19.2 — the removed overlay
  // never unmounts and keeps blocking clicks). Spring slide-in + instant
  // unmount on close.
  if (!open) return null;

  return (
    <>
      <motion.div
        key="mobile-nav-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        onClick={close}
        aria-hidden
        className="fixed inset-0 z-[60] bg-ink/70 lg:hidden"
      />
      <motion.aside
          key="mobile-nav-drawer"
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="fixed inset-y-0 left-0 z-[70] flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-surface lg:hidden"
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
            <Link href="/" onClick={close} aria-label="Callit home" className="inline-flex">
              <Logo />
            </Link>
            <button
              type="button"
              onClick={close}
              aria-label="Close navigation menu"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-tx-sec transition-colors hover:bg-surface-3 hover:text-tx"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="shrink-0 border-b border-line px-3 py-3">
            {user ? (
              <Link
                href="/portfolio"
                onClick={close}
                className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-surface-3"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green/15 text-sm font-black text-green"
                >
                  {user.username.charAt(0).toUpperCase() || '?'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-tx">
                    {user.username}
                  </span>
                  <span className="block text-[11px] font-semibold text-tx-mut">
                    View portfolio
                  </span>
                </span>
              </Link>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="md" onClick={() => openAuth('signin')}>
                  Log in
                </Button>
                <Button variant="primary" size="md" onClick={() => openAuth('signup')}>
                  Sign up
                </Button>
              </div>
            )}
          </div>

          <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarNav onNavigate={close} />
          </nav>

          <div className="shrink-0 border-t border-line px-3 py-3">
            <SidebarUtilities />
          </div>
      </motion.aside>
    </>
  );
}
