'use client';

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import Badge from '@/components/ui/badge';
import { formatMoney, shortAddress } from '@/lib/format';
import { cn } from '@/lib/utils';

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
          <Trophy className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <Badge variant="green">Season 1</Badge>
      </div>
      <h2 className="mt-4 text-2xl font-black leading-tight tracking-tight text-tx sm:text-4xl">
        Season 1 starts <span className="text-green">Jan 1, 2027</span>
      </h2>
      <p className="mt-2 max-w-xl text-sm text-tx-sec">
        Climb the ranks with every call — points season launches with real
        prizes.
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

interface LeaderRow {
  rank: number;
  address: string;
  pnl: number;
  winRate: number;
  markets: number;
}

const LEADERS: LeaderRow[] = [
  { rank: 1, address: '0x3F8aD01c5E92bB7a44f6C1e09A8d2E5b71C49c21', pnl: 48210.55, winRate: 71, markets: 132 },
  { rank: 2, address: '0x91Bc44E7aA02d9F31C6e85b20D4f7A6c88E1De04', pnl: 31877.1, winRate: 68, markets: 98 },
  { rank: 3, address: '0x5eA209cB817Ff3D264a90C4E15b8D7f2A3B6f7Aa', pnl: 27430.0, winRate: 64, markets: 214 },
  { rank: 4, address: '0xC47d10B2e6A85F9c03D1b74E28a6C5f0912A3bE8', pnl: 19652.4, winRate: 66, markets: 77 },
  { rank: 5, address: '0x08fE93A1cD5427B6e10F8a2C49b3D6E7501C9d12', pnl: 15208.75, winRate: 61, markets: 120 },
  { rank: 6, address: '0x6bD41F0a92C83e5B74A6d20E18c5B9f3E402A7c5', pnl: 11940.2, winRate: 59, markets: 64 },
  { rank: 7, address: '0xEa25C88b134F7d09A5c3B61e07D2f4A8B93061fB', pnl: 8317.65, winRate: 57, markets: 88 },
  { rank: 8, address: '0x2D90eF6a48B12c7D3f5A08c96E4b1D7a25C8E043', pnl: 5102.3, winRate: 54, markets: 45 },
  { rank: 9, address: '0x7c31A94dE208B5f6C4e12D80a7F9b3C6D145E9a6', pnl: 2874.9, winRate: 52, markets: 59 },
  { rank: 10, address: '0xB58f02C6d91A34E7b8D5f60C23a9E4B70163CdD9', pnl: 1210.45, winRate: 51, markets: 31 },
];

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight text-tx">Leaderboard</h1>

      <SeasonHero />

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black tracking-tight text-tx">Top callers</h2>
        <Badge variant="amber">Preview</Badge>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs uppercase text-tx-mut">
            <tr>
              <th className="px-4 py-3 text-left font-bold">Rank</th>
              <th className="px-4 py-3 text-left font-bold">Trader</th>
              <th className="px-4 py-3 text-right font-bold">PnL</th>
              <th className="px-4 py-3 text-right font-bold">Win rate</th>
              <th className="px-4 py-3 text-right font-bold">Markets</th>
            </tr>
          </thead>
          <tbody>
            {LEADERS.map((row) => (
              <tr
                key={row.rank}
                className="border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-3/40"
              >
                <td
                  className={cn(
                    'px-4 py-3 font-bold tabular-nums',
                    row.rank <= 3 ? 'text-green' : 'text-tx-mut'
                  )}
                >
                  #{row.rank}
                </td>
                <td className="px-4 py-3 font-semibold tabular-nums text-tx">
                  {shortAddress(row.address)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-green">
                  +{formatMoney(row.pnl)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                  {row.winRate}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-tx-sec">
                  {row.markets}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-tx-mut">
        Preview data — the live leaderboard ships with the points season.
      </p>
    </div>
  );
}
