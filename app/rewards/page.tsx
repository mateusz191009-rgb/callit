'use client';

import { useEffect, useState } from 'react';
import { Gift, Percent, Sparkles, Users2, type LucideIcon } from 'lucide-react';
import Badge from '@/components/ui/badge';

/** Season 1 opens Jan 1, 2027 — countdown runs to the last second of 2026 (local time). */
const SEASON_START = new Date(2026, 11, 31, 23, 59, 59).getTime();

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Ticks every second after mount; null pre-mount (placeholders avoid a
 *  hydration mismatch, since the remaining time depends on Date.now()). */
function useSeasonCountdown(): CountdownParts | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return null;
  const totalSeconds = Math.max(0, Math.floor((SEASON_START - now) / 1000));
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function CountdownTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-[76px] flex-1 rounded-2xl border border-line bg-surface-3/60 px-4 py-4 text-center sm:flex-none sm:min-w-[96px]">
      <div className="text-3xl font-black tabular-nums tracking-tight text-tx sm:text-4xl">
        {value}
      </div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-tx-mut">
        {label}
      </div>
    </div>
  );
}

function SeasonHero() {
  const countdown = useSeasonCountdown();

  return (
    <div className="hero-glow relative overflow-hidden rounded-2xl border border-line bg-surface-2 p-6 sm:p-10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-green/10 text-green">
          <Sparkles className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <Badge variant="green">Season 1</Badge>
      </div>
      <h2 className="mt-4 text-2xl font-black leading-tight tracking-tight text-tx sm:text-4xl">
        Season 1 starts <span className="text-green">Jan 1, 2027</span>
      </h2>
      <p className="mt-2 max-w-xl text-sm text-tx-sec">
        Trading rewards, creator fees and referrals go live with the points
        season — every call you make counts.
      </p>
      <div className="mt-6 flex flex-wrap gap-3" role="timer" aria-label="Time until Season 1">
        <CountdownTile value={countdown ? String(countdown.days) : '--'} label="Days" />
        <CountdownTile value={countdown ? pad(countdown.hours) : '--'} label="Hours" />
        <CountdownTile value={countdown ? pad(countdown.minutes) : '--'} label="Minutes" />
        <CountdownTile value={countdown ? pad(countdown.seconds) : '--'} label="Seconds" />
      </div>
    </div>
  );
}

interface RewardCard {
  icon: LucideIcon;
  title: string;
  copy: string;
}

const CARDS: RewardCard[] = [
  {
    icon: Gift,
    title: 'Trading rewards',
    copy: 'Earn points for every call you make.',
  },
  {
    icon: Percent,
    title: 'Creator fees',
    copy: 'Collect a share of volume on markets you launch.',
  },
  {
    icon: Users2,
    title: 'Referrals',
    copy: 'Invite friends, split the upside.',
  },
];

export default function RewardsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-tx">Rewards</h1>

      <SeasonHero />

      <p className="max-w-xl text-sm text-tx-sec">
        Get paid for calling it right — and for building the markets everyone
        trades.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {CARDS.map(({ icon: Icon, title, copy }) => (
          <div
            key={title}
            className="rounded-2xl border border-line bg-surface-2 p-6"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green/10 text-green">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <h2 className="mt-4 text-base font-bold text-tx">{title}</h2>
            <p className="mt-1.5 text-sm text-tx-sec">{copy}</p>
          </div>
        ))}
      </div>

      <p className="text-sm text-tx-mut">Rewards go live with Season 1.</p>
    </div>
  );
}
