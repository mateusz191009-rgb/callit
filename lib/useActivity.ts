import type { Side } from './types';
import { hashString, mulberry32 } from './utils';

/**
 * Shared fake-activity helpers for the social layer (TradePulse chips and
 * the MarketChat Activity tab). All mock data is DETERMINISTIC per market —
 * derived from `hashString(marketId)` — so server and client always agree
 * and reloads show the same "history". Live pulses (TradePulse) are the one
 * exception: they are ephemeral and intentionally random.
 */

const FIRST_NAMES = [
  'Anna',
  'Max',
  'Leo',
  'Mia',
  'Noah',
  'Emma',
  'Ben',
  'Lina',
  'Paul',
  'Sofia',
  'Finn',
  'Clara',
] as const;

const LAST_INITIALS = ['K', 'M', 'S', 'B', 'R', 'L', 'T', 'H', 'W', 'F', 'D', 'J'] as const;

/** Deterministic trader display name from a numeric seed — "Anna K." style. */
export function randomTrader(seed: number): string {
  const rand = mulberry32(seed >>> 0);
  const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
  const initial = LAST_INITIALS[Math.floor(rand() * LAST_INITIALS.length)];
  return `${first} ${initial}.`;
}

/** $5–$500 ticket size skewed heavily toward small trades. `u` ∈ [0,1). */
export function fakeTradeAmount(u: number): number {
  return Math.max(5, Math.round(5 + 495 * Math.pow(u, 2.6)));
}

export interface FakeTrade {
  id: string;
  name: string;
  side: Side;
  amount: number; // USD
  minutesAgo: number;
}

/** Deterministic mock trade feed for a market, newest first. */
export function fakeTradesFor(marketId: string, count: number): FakeTrade[] {
  const rand = mulberry32(hashString(marketId) ^ 0x51ed270b);
  const trades: FakeTrade[] = [];
  let minutes = 0;
  for (let i = 0; i < count; i++) {
    minutes += 1 + Math.floor(rand() * 32);
    trades.push({
      id: `ft-${marketId}-${i}`,
      name: randomTrader(Math.floor(rand() * 0xffffffff)),
      side: rand() < 0.5 ? 'yes' : 'no',
      amount: fakeTradeAmount(rand()),
      minutesAgo: minutes,
    });
  }
  return trades;
}

/** "just now" | "12m ago" | "3h ago" | "2d ago" from a minute count. */
export function minutesAgoLabel(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

/** Relative timestamp for an ISO date — "2m ago" style. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  return minutesAgoLabel(Math.max(0, (now - new Date(iso).getTime()) / 60_000));
}

/** Token-only gradient + text classes for 24px avatars, stable per name. */
const AVATAR_CLASSES = [
  'bg-gradient-to-br from-green to-green-deep text-green-ink',
  'bg-gradient-to-br from-sky to-sky-deep text-white',
  'bg-gradient-to-br from-amber to-green text-green-ink',
  'bg-gradient-to-br from-green to-sky text-green-ink',
  'bg-gradient-to-br from-sky to-green-deep text-white',
  'bg-gradient-to-br from-amber to-sky text-green-ink',
] as const;

export function avatarClass(name: string): string {
  return AVATAR_CLASSES[hashString(name) % AVATAR_CLASSES.length];
}
