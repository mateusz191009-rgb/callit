'use client';

import { useEffect, useId, useRef } from 'react';
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

  // Focus trap + Esc + restore focus
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

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
      document.body.style.overflow = '';
      previous?.focus();
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
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
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
          'relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface-2 shadow-2xl',
          'sm:rounded-2xl',
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
          <div id={titleId} className="text-sm font-extrabold text-tx">
            {title}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-tx-mut transition-colors hover:bg-surface-3 hover:text-tx"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
