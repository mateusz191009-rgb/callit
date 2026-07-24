'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Briefcase,
  ChevronDown,
  CircleHelp,
  Coins,
  Gift,
  Handshake,
  LogOut,
  Medal,
  Plus,
  Settings,
  Shield,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCallitStore } from '@/lib/store';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const itemClasses =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-bold ' +
  'text-tx-sec transition-colors hover:bg-surface-3 hover:text-tx';

const soonChip =
  'ml-auto rounded-full border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber';

/**
 * Topbar chip for the signed-in user: avatar initial + username + chevron.
 * v12: with the sidebar gone this dropdown is THE home for every secondary
 * destination (Polymarket-style) — Portfolio / Wallet / Create market,
 * Leaderboard / Rewards / Affiliates, Settings / Help / Admin, Sign out.
 * Conditional render only — no exit animation (React 19.2 quirk).
 */
export default function UserMenu() {
  const user = useCallitStore((s) => s.user);
  const balance = useCallitStore((s) => s.balance);
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
  const close = () => setOpen(false);

  const handleSignOut = () => {
    setOpen(false);
    signOut();
    toast('Signed out');
  };

  const menuLink = (href: string, icon: React.ReactNode, label: string, badge?: string) => (
    <Link href={href} role="menuitem" onClick={close} className={itemClasses}>
      {icon}
      {label}
      {badge && <span className={soonChip}>{badge}</span>}
    </Link>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 pl-1.5 pr-2.5 text-sm font-bold text-tx transition-colors hover:border-line-strong hover:bg-surface-3"
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
          className="absolute right-0 top-12 max-h-[calc(100vh-5rem)] w-56 overflow-y-auto rounded-xl border border-line bg-surface-2 shadow-xl"
        >
          <div className="border-b border-line px-3 py-2.5">
            <div className="truncate text-sm font-extrabold text-tx">{user.username}</div>
            <div className="truncate text-xs text-tx-mut">{user.email}</div>
            {/* Balance — the Topbar chip is hidden below md, so the menu
                carries it for phones. */}
            <div className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-tx md:hidden">
              <Coins className="h-3.5 w-3.5 text-green" aria-hidden />
              <span className="tabular-nums">{formatMoney(balance)}</span>
              <span className="text-tx-mut">USDC</span>
            </div>
          </div>

          <div className="p-1.5">
            {menuLink('/portfolio', <Briefcase className="h-4 w-4 text-tx-mut" aria-hidden />, 'Portfolio')}
            {menuLink('/wallet', <Wallet className="h-4 w-4 text-tx-mut" aria-hidden />, 'Wallet')}
            {menuLink('/create', <Plus className="h-4 w-4 text-tx-mut" aria-hidden />, 'Create market')}
          </div>

          <div className="border-t border-line p-1.5">
            {menuLink('/leaderboard', <Medal className="h-4 w-4 text-tx-mut" aria-hidden />, 'Leaderboard', 'Soon')}
            {menuLink('/rewards', <Gift className="h-4 w-4 text-tx-mut" aria-hidden />, 'Rewards', 'Soon')}
            {menuLink('/affiliate', <Handshake className="h-4 w-4 text-tx-mut" aria-hidden />, 'Affiliates')}
          </div>

          <div className="border-t border-line p-1.5">
            {menuLink('/settings', <Settings className="h-4 w-4 text-tx-mut" aria-hidden />, 'Settings')}
            {menuLink('/help', <CircleHelp className="h-4 w-4 text-tx-mut" aria-hidden />, 'Help')}
            {user.isAdmin &&
              menuLink('/admin', <Shield className="h-4 w-4 text-tx-mut" aria-hidden />, 'Admin')}
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
