'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import { play } from '@/lib/sound';
import { useCallitStore } from '@/lib/store';
import { supabase, supabaseEnabled } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/** The zustand persist key — "Reset local data" wipes exactly this. */
const STORE_KEY = 'callit-store-v1';

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface-2 p-5 sm:p-6">
      <h2 className="text-base font-extrabold text-tx">{title}</h2>
      {description && <p className="mt-1 text-sm text-tx-mut">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-tx-mut">
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * Preference switch persisted to a localStorage key. The sound flag
 * ('callit-pref-sound') is read by lib/sound.ts on every play() call;
 * the notifications flag is still cosmetic. `onToggle` fires after the
 * new value is persisted — used to preview the sound when enabling it.
 */
function PrefToggle({
  storageKey,
  label,
  description,
  defaultOn = true,
  onToggle,
}: {
  storageKey: string;
  label: string;
  description: string;
  defaultOn?: boolean;
  onToggle?: (on: boolean) => void;
}) {
  const [on, setOn] = useState(defaultOn);

  // Read after mount — the pref lives in localStorage only.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setOn(stored === '1');
    } catch {
      // Storage unavailable (private mode) — keep the default.
    }
  }, [storageKey]);

  const toggle = () => {
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // Best-effort persistence only.
      }
      onToggle?.(next);
      return next;
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-bold text-tx">{label}</div>
        <div className="mt-0.5 text-xs text-tx-mut">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={toggle}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          on ? 'border-green/60 bg-green' : 'border-line bg-surface-3'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform',
            on ? 'translate-x-5 bg-green-ink' : 'translate-x-0 bg-tx-sec'
          )}
        />
      </button>
    </div>
  );
}

/**
 * v23.8 — the newsletter opt-in. Unlike PrefToggle this is DB-backed
 * (profiles.marketing_opt_in): consent must survive devices and be
 * readable by the admin send route. Reads the flag off the caller's own
 * profile row; writes go through the set_marketing_opt_in RPC because
 * direct profile UPDATEs are revoked (schema section 7). While the
 * v23.8 migration hasn't been run yet the read errors — the toggle then
 * renders a muted "not available" note instead of a dead switch.
 */
function NewsletterToggle() {
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'unavailable'>('loading');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) {
        setState('unavailable');
        return;
      }
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) {
        setState('unavailable');
        return;
      }
      const { data: row, error } = await supabase
        .from('profiles')
        .select('marketing_opt_in')
        .eq('id', uid)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState('unavailable');
        return;
      }
      setState(row?.marketing_opt_in === true ? 'on' : 'off');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    if (!supabase || saving || (state !== 'on' && state !== 'off')) return;
    const next = state === 'off';
    setSaving(true);
    const { error } = await supabase.rpc('set_marketing_opt_in', { p_on: next });
    setSaving(false);
    if (error) {
      toast.error('Could not save your preference — try again.');
      return;
    }
    setState(next ? 'on' : 'off');
    toast.success(next ? 'Email updates on.' : 'Email updates off.');
  };

  if (state === 'unavailable') {
    return (
      <p className="py-3 text-xs text-tx-mut">
        Email updates are not available right now.
      </p>
    );
  }

  const on = state === 'on';
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-bold text-tx">New markets newsletter</div>
        <div className="mt-0.5 text-xs text-tx-mut">
          Occasional email when fresh markets go live. Every mail has a
          one-click unsubscribe link.
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="New markets newsletter"
        aria-busy={state === 'loading' || saving}
        disabled={state === 'loading' || saving}
        onClick={() => void toggle()}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-60',
          on ? 'border-green/60 bg-green' : 'border-line bg-surface-3'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform',
            on ? 'translate-x-5 bg-green-ink' : 'translate-x-0 bg-tx-sec'
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const hydrated = useCallitStore((s) => s._hasHydrated);
  const user = useCallitStore((s) => s.user);
  const signOut = useCallitStore((s) => s.signOut);
  const openAuthModal = useCallitStore((s) => s.openAuthModal);

  // Two-step confirm for the destructive reset; auto-disarms after 5s.
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      confirmTimer.current = window.setTimeout(() => setConfirmReset(false), 5000);
      return;
    }
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // Storage unavailable — the reload still gives a clean session.
    }
    window.location.reload();
  };

  const handleSignOut = () => {
    signOut();
    toast.success('Signed out');
  };

  const header = (
    <div>
      <h1 className="text-3xl font-black tracking-tight text-tx">Settings</h1>
      <p className="mt-1 text-sm text-tx-sec">
        Manage your account and how Callitnow behaves on this device.
      </p>
    </div>
  );

  if (!hydrated) {
    return (
      <div className="max-w-2xl space-y-6">
        {header}
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl space-y-6">
        {header}
        <EmptyState
          icon={UserRound}
          title="Sign in to manage your account"
          description="Account details, preferences and session tools are tied to your Callitnow account."
          actionLabel="Log in"
          onAction={() => openAuthModal('signin')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {header}

      <SectionCard title="Account" description="Your Callitnow identity.">
        <div className="space-y-4">
          <FieldRow label="Username">
            <div className="flex items-center gap-2">
              <Input readOnly value={user.username} className="cursor-default opacity-80" />
              {user.isAdmin && <Badge variant="green">Admin</Badge>}
            </div>
            <p className="mt-1.5 text-xs text-tx-mut">
              Contact support to change your username.
            </p>
          </FieldRow>
          <FieldRow label="Email">
            <Input readOnly value={user.email} className="cursor-default opacity-80" />
          </FieldRow>
          <p className="text-xs text-tx-mut">
            {supabaseEnabled
              ? 'Cloud account — synced via Supabase.'
              : 'Local mode — your account is stored in this browser.'}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Preferences"
        description="Stored on this device only."
      >
        <div className="divide-y divide-line">
          <PrefToggle
            storageKey="callit-pref-sound"
            label="Sound effects"
            description="Soft chimes on fills, wins and confirmations."
            // Preview on enable — the flag is already persisted when this
            // fires, so play() passes its own pref check.
            onToggle={(on) => on && play('success')}
          />
          <PrefToggle
            storageKey="callit-pref-notifications"
            label="Notifications"
            description="Show resolution and deposit updates while you browse."
          />
        </div>
      </SectionCard>

      {supabaseEnabled && (
        <SectionCard
          title="Email updates"
          description="Synced to your account — applies on every device."
        >
          <NewsletterToggle />
        </SectionCard>
      )}

      <SectionCard
        title="Danger zone"
        description="These affect your whole session on this device."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="outline" size="md" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </Button>
          <Button variant="danger" size="md" onClick={handleReset}>
            {confirmReset ? 'Click again to confirm' : 'Reset local data'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-tx-mut">
          Reset wipes everything stored locally — balance, positions, markets,
          accounts and chat — then reloads the app with a fresh start.
        </p>
      </SectionCard>
    </div>
  );
}
