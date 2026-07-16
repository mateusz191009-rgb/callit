import type { Market } from './types';
import { generatePriceHistory } from './utils';

/**
 * Pre-seeded community markets (source: 'callit') so the platform feels
 * alive on first launch. Price histories are deterministic so SSR and
 * client always render the same data.
 */

interface SeedDef {
  id: string;
  question: string;
  description: string;
  category: Market['category'];
  endDate: string;
  resolution: Market['resolution'];
  yesPrice: number;
  volume: number;
  liquidity: number;
  createdBy: string;
  createdAt: string;
}

const DEFS: SeedDef[] = [
  {
    id: 'cl-btc-150k',
    question: 'Will Bitcoin close above $150,000 on Dec 31, 2026?',
    description:
      'Resolves YES if the BTC/USD close on Coinbase at 23:59 UTC on Dec 31, 2026 is strictly above $150,000. Price source: Coinbase Pro daily candle.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    resolution: 'oracle',
    yesPrice: 0.44,
    volume: 284_000,
    liquidity: 42_000,
    createdBy: '0x3aB1e99C04d2f6bB8823Fb7A1cE5D2a4E8f19c40',
    createdAt: '2026-04-02T10:15:00.000Z',
  },
  {
    id: 'cl-eth-flippening',
    question: 'Will Ethereum flip Bitcoin by market cap before 2028?',
    description:
      'Resolves YES if ETH total market capitalization exceeds BTC market capitalization on CoinGecko for at least 24 consecutive hours before Jan 1, 2028.',
    category: 'crypto',
    endDate: '2027-12-31T23:59:00.000Z',
    resolution: 'community',
    yesPrice: 0.09,
    volume: 96_500,
    liquidity: 18_000,
    createdBy: '0x91cD44eA02b7A5b1FF60a83Ce2D9A17c8B34De55',
    createdAt: '2026-03-11T18:40:00.000Z',
  },
  {
    id: 'cl-cl-final-english',
    question: 'Will an English club win the 2026/27 Champions League?',
    description:
      'Resolves YES if the winner of the 2026/27 UEFA Champions League final is a club from the English Premier League.',
    category: 'football',
    endDate: '2027-06-05T21:00:00.000Z',
    resolution: 'community',
    yesPrice: 0.38,
    volume: 152_000,
    liquidity: 25_000,
    createdBy: '0x5FeA02cD913Bb7a44E80D1c66aF2B9E3D7c81A02',
    createdAt: '2026-06-20T09:00:00.000Z',
  },
  {
    id: 'cl-messi-retire',
    question: 'Will Lionel Messi announce retirement before the 2027 season?',
    description:
      'Resolves YES if Lionel Messi officially announces his retirement from professional club football before March 1, 2027, via club or personal channels.',
    category: 'football',
    endDate: '2027-03-01T00:00:00.000Z',
    resolution: 'manual',
    yesPrice: 0.27,
    volume: 61_000,
    liquidity: 12_000,
    createdBy: '0x7fA3bC21d94E05Aa1B6f3D8cE47a20F1B3D59c21',
    createdAt: '2026-05-30T14:25:00.000Z',
  },
  {
    id: 'cl-fed-below-3',
    question: 'Will the Fed funds rate be below 3.00% by June 2027?',
    description:
      'Resolves YES if the upper bound of the federal funds target range is below 3.00% after any scheduled FOMC meeting before June 30, 2027.',
    category: 'economy',
    endDate: '2027-06-30T20:00:00.000Z',
    resolution: 'oracle',
    yesPrice: 0.31,
    volume: 118_000,
    liquidity: 30_000,
    createdBy: '0x22D80cE1f5A9b34D7C6aE05B18F2d94A3cB761F0',
    createdAt: '2026-02-14T11:00:00.000Z',
  },
  {
    id: 'cl-ai-nobel',
    question: 'Will an AI-assisted discovery win a Nobel Prize in 2026?',
    description:
      'Resolves YES if any 2026 Nobel Prize committee explicitly credits AI/ML methods as instrumental to the awarded discovery in the official announcement.',
    category: 'custom',
    endDate: '2026-10-15T12:00:00.000Z',
    resolution: 'community',
    yesPrice: 0.56,
    volume: 74_000,
    liquidity: 15_000,
    createdBy: '0x91cD44eA02b7A5b1FF60a83Ce2D9A17c8B34De55',
    createdAt: '2026-01-22T16:45:00.000Z',
  },
  {
    id: 'cl-taylor-tour',
    question: 'Will Taylor Swift announce a new world tour in 2026?',
    description:
      'Resolves YES if Taylor Swift or her official management announces a multi-country concert tour with dates in 2026 or 2027 before Dec 31, 2026.',
    category: 'pop-culture',
    endDate: '2026-12-31T23:59:00.000Z',
    resolution: 'manual',
    yesPrice: 0.63,
    volume: 88_000,
    liquidity: 16_500,
    createdBy: '0x5FeA02cD913Bb7a44E80D1c66aF2B9E3D7c81A02',
    createdAt: '2026-06-01T08:30:00.000Z',
  },
  {
    id: 'cl-mars-sample',
    question: 'Will NASA return Mars samples to Earth before 2030?',
    description:
      'Resolves YES if the NASA/ESA Mars Sample Return (or successor program) lands collected Martian samples on Earth before Jan 1, 2030.',
    category: 'custom',
    endDate: '2027-12-31T23:59:00.000Z',
    resolution: 'community',
    yesPrice: 0.18,
    volume: 43_000,
    liquidity: 9_500,
    createdBy: '0x3aB1e99C04d2f6bB8823Fb7A1cE5D2a4E8f19c40',
    createdAt: '2026-05-05T19:10:00.000Z',
  },
  {
    id: 'cl-us-recession',
    question: 'Will the US enter a recession before the end of 2026?',
    description:
      'Resolves YES if NBER declares a US recession with a start date in 2026, or if two consecutive quarters of negative real GDP growth are reported for 2026.',
    category: 'economy',
    endDate: '2026-12-31T23:59:00.000Z',
    resolution: 'community',
    yesPrice: 0.22,
    volume: 132_000,
    liquidity: 28_000,
    createdBy: '0x22D80cE1f5A9b34D7C6aE05B18F2d94A3cB761F0',
    createdAt: '2026-03-28T13:55:00.000Z',
  },
  {
    id: 'cl-nba-record',
    question: 'Will any NBA team win 70+ games in the 2026/27 season?',
    description:
      'Resolves YES if at least one NBA team finishes the 2026/27 regular season with 70 or more wins.',
    category: 'sports',
    endDate: '2027-04-15T04:00:00.000Z',
    resolution: 'oracle',
    yesPrice: 0.12,
    volume: 57_000,
    liquidity: 11_000,
    createdBy: '0x7fA3bC21d94E05Aa1B6f3D8cE47a20F1B3D59c21',
    createdAt: '2026-06-27T21:05:00.000Z',
  },
];

export const seedMarkets: Market[] = DEFS.map((d) => ({
  ...d,
  source: 'callit',
  status: 'open',
  priceHistory: generatePriceHistory(d.id, d.yesPrice, 52, 1783987200000), // anchored mid-2026
}));
