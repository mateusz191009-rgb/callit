'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import EmptyState from '@/components/common/EmptyState';
import { useCallitStore } from '@/lib/store';
import { supabaseEnabled } from '@/lib/supabase';
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
 * Cosmetic preference switch persisted to a localStorage key. Purely
 * visual in this build — nothing reads the flags yet.
 */
function PrefToggle({
  storageKey,
  label,
  description,
  defaultOn = true,
}: {
  storageKey: string;
  label: string;
  description: string;
  defaultOn?: boolean;
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
        Manage your account and how Callit behaves on this device.
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
          description="Account details, preferences and session tools are tied to your Callit account."
          actionLabel="Log in"
          onAction={() => openAuthModal('signin')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {header}

      <SectionCard title="Account" description="Your Callit identity.">
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
            description="Play a soft tick on fills and confirmations."
          />
          <PrefToggle
            storageKey="callit-pref-notifications"
            label="Notifications"
            description="Show resolution and deposit updates while you browse."
          />
        </div>
      </SectionCard>

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
