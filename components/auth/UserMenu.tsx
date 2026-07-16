'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Briefcase, ChevronDown, LogOut, Shield, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useCallitStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const itemClasses =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-bold ' +
  'text-tx-sec transition-colors hover:bg-surface-3 hover:text-tx';

/**
 * Topbar chip for the signed-in user: avatar initial + username + chevron.
 * Dropdown with Portfolio / Wallet / Admin (admins only) / Sign out.
 * Conditional render only — no exit animation (React 19.2 quirk).
 */
export default function UserMenu() {
  const user = useCallitStore((s) => s.user);
  const signOut = useCallitStore((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const initial = user.username.charAt(0).toUpperCase() || '?';

  const handleSignOut = () => {
    setOpen(false);
    signOut();
    toast('Signed out');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="glow-hover flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 pl-1.5 pr-2.5 text-sm font-bold text-tx transition-colors hover:border-line-strong hover:bg-surface-3"
      >
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-green/15 text-xs font-black text-green"
        >
          {initial}
        </span>
        <span className="hidden max-w-[10ch] truncate sm:inline">{user.username}</span>
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 text-tx-mut transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <motion.div
          role="menu"
          aria-label="Account"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="absolute right-0 top-12 w-52 rounded-xl border border-line bg-surface-2 shadow-xl"
        >
          <div className="border-b border-line px-3 py-2.5">
            <div className="truncate text-sm font-extrabold text-tx">{user.username}</div>
            <div className="truncate text-xs text-tx-mut">{user.email}</div>
          </div>

          <div className="p-1.5">
            <Link
              href="/portfolio"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemClasses}
            >
              <Briefcase className="h-4 w-4 text-tx-mut" aria-hidden />
              Portfolio
            </Link>
            <Link
              href="/wallet"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemClasses}
            >
              <Wallet className="h-4 w-4 text-tx-mut" aria-hidden />
              Wallet
            </Link>
            {user.isAdmin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={itemClasses}
              >
                <Shield className="h-4 w-4 text-tx-mut" aria-hidden />
                Admin
              </Link>
            )}
          </div>

          <div className="border-t border-line p-1.5">
            <button type="button" role="menuitem" onClick={handleSignOut} className={itemClasses}>
              <LogOut className="h-4 w-4 text-tx-mut" aria-hidden />
              Sign out
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
