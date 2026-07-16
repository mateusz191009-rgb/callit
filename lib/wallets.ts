import type { DepositCurrency } from './types';

/**
 * Deposit wallet config — one receiving address per supported currency.
 * `color` is the official brand color, used for currency dots/tiles
 * (charts and brand dots may use hex constants per CONTRACTS.md).
 */
export interface DepositWallet {
  currency: DepositCurrency;
  label: string;
  network: string;
  address: string;
  color: string;
}

export const WALLETS: DepositWallet[] = [
  {
    currency: 'BTC',
    label: 'Bitcoin',
    network: 'Bitcoin (Native SegWit)',
    address: 'bc1q5xt3mz4we382cufyskx7glf0wmd90kmn7546yh',
    color: '#F7931A',
  },
  {
    currency: 'ETH',
    label: 'Ethereum',
    network: 'ERC20',
    address: '0xe52aDFF42bb070cbbc669eE9626DeDeA57D81E90',
    color: '#8A92B2',
  },
  {
    currency: 'USDT',
    label: 'Tether',
    network: 'ERC20',
    address: '0xe52aDFF42bb070cbbc669eE9626DeDeA57D81E90',
    color: '#26A17B',
  },
  {
    currency: 'USDC',
    label: 'USD Coin',
    network: 'Base',
    address: '0xe52aDFF42bb070cbbc669eE9626DeDeA57D81E90',
    color: '#2775CA',
  },
  {
    currency: 'BNB',
    label: 'BNB',
    network: 'BEP20',
    address: '0xe52aDFF42bb070cbbc669eE9626DeDeA57D81E90',
    color: '#F0B90B',
  },
  {
    currency: 'SOL',
    label: 'Solana',
    network: 'Solana',
    address: '31LVL9AkaLwfRPGWZKeMDd9Qc2TznZRUAwY3hYCyHBHm',
    color: '#9945FF',
  },
];

/** Lookup helper. */
export function walletFor(currency: DepositCurrency): DepositWallet {
  return WALLETS.find((w) => w.currency === currency) ?? WALLETS[0];
}

/** CoinGecko API ids per deposit currency — used by /api/prices. */
export const COINGECKO_IDS: Record<DepositCurrency, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  SOL: 'solana',
};
