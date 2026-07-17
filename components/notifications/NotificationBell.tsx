'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpFromLine, Bell, CheckCheck, Gavel } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { play } from '@/lib/sound';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  getNotificationState,
  getServerNotificationState,
  markAllNotificationsRead,
  startNotificationSync,
  subscribeNotifications,
  type AppNotification,
  type NotificationKind,
  type NotificationTone,
} from './notificationStore';

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  deposit: ArrowDownToLine,
  withdrawal: ArrowUpFromLine,
  resolution: Gavel,
};

const TONE_CLASSES: Record<NotificationTone, string> = {
  green: 'bg-green/10 text-green',
  sky: 'bg-sky/10 text-sky',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-surface-3 text-tx-sec',
};

/** "just now" / "12m ago" / "3h ago" / "2d ago", then an absolute date.
 *  `now` is passed in (never read during render) so the label stays
 *  deterministic — see the mount note in the component. */
function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = now - then;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

function NotificationRow({
  item,
  unread,
  now,
  onNavigate,
}: {
  item: AppNotification;
  unread: boolean;
  now: number | null;
  onNavigate: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className="flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-surface-3"
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
            TONE_CLASSES[item.tone]
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-extrabold text-tx">{item.title}</span>
            {unread && (
              <span
                aria-label="Unread"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-green"
              />
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-tx-sec">
            {item.body}
          </span>
          {now !== null && (
            <span className="mt-1 block text-[11px] tabular-nums text-tx-mut">
              {relativeTime(item.createdAt, now)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Topbar notification bell — the read side of components/notifications/
 * notificationStore.ts, which derives events by diffing the user's own
 * payments and positions every 30s (no schema changes, nothing pushed).
 *
 * Renders for signed-in users only; guests have nothing to be notified
 * about. In local demo mode there is no cloud to poll, so the bell stays
 * an honest empty state rather than disappearing and reshuffling the
 * topbar between modes.
 */
export default function NotificationBell() {
  const user = useCallitStore((s) => s.user);
  const state = useSyncExternalStore(
    subscribeNotifications,
    getNotificationState,
    getServerNotificationState
  );

  const [open, setOpen] = useState(false);
  // Timestamps are relative, so the labels depend on the clock — computing
  // `now` during render would make SSR and the client disagree. It is set
  // on mount (and refreshed while the dropdown is open) instead.
  const [now, setNow] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const userKey = user?.email ?? null;
  const cloud = supabaseEnabled && Boolean(userKey);

  const handleFresh = useCallback((items: AppNotification[]) => {
    // Only toast while the tab is actually being looked at — a stack of
    // toasts fired at a hidden tab is just noise waiting to pop.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const fresh = items.slice(0, 3);
    for (const item of fresh) {
      if (item.tone === 'danger') toast.error(item.title, { description: item.body });
      else toast.success(item.title, { description: item.body });
    }
    // One sound per batch, not per toast — a resolution sweep must not
    // become a drumroll. Good news wins the pick.
    if (fresh.some((i) => i.tone !== 'danger')) play('win');
    else if (fresh.length > 0) play('error');
  }, []);

  // Poll while signed in (cloud mode only). Re-subscribes on account
  // change; the engine wipes the previous account's data on a key change.
  useEffect(() => {
    if (!cloud || !userKey) return;
    return startNotificationSync(userKey, handleFresh);
  }, [cloud, userKey, handleFresh]);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  // Keep relative labels honest while the dropdown sits open.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);

  // Outside-click + Escape close (mirrors UserMenu).
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

  const { notifications, unreadCount } = state;
  const seen = new Set(state.seenIds);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Notifications — ${unreadCount} unread`
            : 'Notifications'
        }
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-tx-sec transition-colors hover:border-line-strong hover:bg-surface-3 hover:text-tx"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-surface-2 bg-green"
          />
        )}
      </button>

      {/* Conditional render only — no exit animation (React 19.2 quirk). */}
      {open && (
        <motion.div
          role="menu"
          aria-label="Notifications"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="absolute right-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface-2 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <span className="text-sm font-extrabold text-tx">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllNotificationsRead}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-tx-mut transition-colors hover:bg-surface-3 hover:text-tx"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-bold text-tx-sec">No notifications yet.</p>
              <p className="mt-1 text-xs text-tx-mut">
                {cloud
                  ? 'Deposit updates and market resolutions show up here.'
                  : 'Sign in with cloud sync enabled to get deposit and resolution updates.'}
              </p>
            </div>
          ) : (
            <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto p-1.5">
              {notifications.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  unread={!seen.has(item.id)}
                  now={now}
                  onNavigate={() => {
                    markAllNotificationsRead();
                    setOpen(false);
                  }}
                />
              ))}
            </ul>
          )}
        </motion.div>
      )}
    </div>
  );
}
