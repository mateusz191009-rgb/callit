'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Dark, token-styled modal: portal + backdrop blur + spring entrance,
 * Esc/backdrop close, scroll lock and a simple focus trap.
 */
export default function Modal({ open, onClose, title, children, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  /**
   * THE KEYBOARD FIX.
   *
   * The sheet is `position: fixed` over a pinned body, sized with `dvh`.
   * Neither of those shrinks when the on-screen keyboard opens: `dvh` tracks
   * the LAYOUT viewport, and a fixed element stays anchored to it. So on a
   * 390x844 phone the trade sheet's "Call it now" sat at y=743-791 with the
   * iOS keyboard starting at ~508 — 235px underneath it, with nothing to
   * scroll because the panel still believed it had the full screen.
   *
   * `visualViewport` is the only thing that reports the space actually left
   * above the keyboard. Binding the overlay's height and top offset to it
   * makes the sheet shrink into that space, which in turn makes its inner
   * scroller overflow — and TradePanel's CTA sticks to the bottom of it.
   */
  const [vv, setVv] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vp = typeof window === 'undefined' ? null : window.visualViewport;
    if (!open || !vp) return;
    const sync = () => setVv({ height: vp.height, top: vp.offsetTop });
    sync();
    vp.addEventListener('resize', sync);
    vp.addEventListener('scroll', sync);
    return () => {
      vp.removeEventListener('resize', sync);
      vp.removeEventListener('scroll', sync);
      setVv(null);
    };
  }, [open]);

  // Keep whatever is being typed into visible as the sheet resizes around
  // it — the amount field is at the top of a now-short panel.
  useEffect(() => {
    if (!vv) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && panelRef.current?.contains(active)) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [vv]);

  // Focus trap + Esc + restore focus
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // `overflow: hidden` alone is ignored by iOS Safari for touch-drags —
    // the page behind the sheet still rubber-band scrolls, and dismissing
    // then drops you at a different scroll position. Pinning the body and
    // restoring the offset on close is the fix that works on both.
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    const focusFirst = () => {
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      (nodes?.[0] ?? panelRef.current)?.focus();
    };
    const t = setTimeout(focusFirst, 50);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        // Focus escaped the panel (e.g. click on padding) — pull it back in.
        if (!panelRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      body.style.overflow = '';
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      // `focus()` can scroll its target into view, so the offset is restored
      // after it — otherwise focus wins and the restore is undone.
      previous?.focus({ preventScroll: true });
      window.scrollTo(0, scrollY);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined' || !open) return null;

  // No AnimatePresence exit here on purpose: with React 19.2 its exit
  // completion never fires, leaving an invisible full-screen overlay that
  // blocks every click. Spring entrance + instant unmount is reliable.
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      // Height is explicit rather than `inset-0` so the visualViewport
      // override below has something to replace; the dvh fallback covers
      // browsers without the API (and SSR).
      className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] items-end justify-center p-0 sm:items-center sm:p-4"
      style={vv ? { height: vv.height, top: vv.top } : undefined}
    >
      <div
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className={cn(
          // max-h-full, not a dvh calc: the overlay above is the one that
          // knows how much room the keyboard left.
          'relative flex max-h-full w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface-2 shadow-2xl',
          'sm:rounded-2xl',
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div id={titleId} className="text-sm font-bold text-tx">
            {title}
          </div>
          {/* 28x28 at rest — under the 44px touch minimum, on every dialog
              including Trade. Grows on touch only, so the desktop header
              keeps its proportions. */}
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1.5 inline-flex items-center justify-center rounded-lg p-1.5 text-tx-mut transition-colors coarse:h-11 coarse:w-11 coarse:p-0 hover:bg-surface-3 hover:text-tx"
          >
            <X className="h-4 w-4 coarse:h-5 coarse:w-5" />
          </button>
        </div>
        {/* Bottom-sheet mode reaches the screen edge, so the last control in
            the sheet would otherwise sit under the iPhone home indicator. */}
        {/* overscroll-contain: without it, flicking past the end of the
            sheet's own scroll chains to the page behind it. */}
        <div className="overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5">
          {children}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
