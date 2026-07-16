import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Deterministic PRNG (mulberry32) — used to generate reproducible mock
 *  price histories so server and client always agree. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Random-walk price history around (and ending exactly at) `endPrice`. */
export function generatePriceHistory(
  seedKey: string,
  endPrice: number,
  points = 50,
  endT: number = 1767225600000, // fixed anchor: 2026-01-01, real data appends after
  stepMs: number = 6 * 60 * 60 * 1000
): { t: number; yes: number }[] {
  const rand = mulberry32(hashString(seedKey));
  // Walk backwards from the end price so the series lands on it.
  const prices: number[] = [endPrice];
  let p = endPrice;
  for (let i = 1; i < points; i++) {
    const drift = (rand() - 0.5) * 0.045;
    p = Math.min(0.97, Math.max(0.03, p - drift));
    prices.push(p);
  }
  prices.reverse();
  return prices.map((yes, i) => ({
    t: endT - (points - 1 - i) * stepMs,
    yes: Math.round(yes * 1000) / 1000,
  }));
}

export function clampPrice(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}
