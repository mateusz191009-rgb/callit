/**
 * GEOBLOCK — country restrictions for account creation.
 *
 * Callitnow does not hold gambling licenses (see /about#legal). Several
 * regulators classify prediction-market platforms as unlicensed gambling,
 * so we block SIGN-UP (not browsing) from those jurisdictions. The block is
 * deliberately soft: anyone can read markets and prices; taking action
 * (trading, depositing) requires an account, and creating one is what the
 * geoblock stops. Enforced server-side in /api/auth/signup-check.
 *
 * This module is server-safe AND client-safe: pure data + header helpers,
 * no secrets. The About page renders RESTRICTED_COUNTRIES for transparency.
 *
 * The list below is a starting point modeled on jurisdictions that have
 * acted against unlicensed prediction markets (Polymarket-style blocks).
 * It is a business/legal decision, not a technical one — review it with
 * counsel before launch and edit freely; the rest of the code keys off
 * whatever is in this map.
 *
 * Limitation: detection is country-level (ISO 3166-1 alpha-2 from the CDN
 * geo header), so province-level regimes (e.g. Ontario, Canada) cannot be
 * targeted without a paid IP-intelligence provider.
 */

/** The one admin account (case-insensitive match everywhere it is used).
 *  Lives here — not in lib/store.ts — because that module is 'use client'
 *  and server routes need this constant too; the store re-exports it. */
export const ADMIN_EMAIL = 'mateusz191009@gmail.com';

/** ISO 3166-1 alpha-2 code -> display name. Being in this map means:
 *  sign-up from that country is refused. */
export const RESTRICTED_COUNTRIES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  FR: 'France',
  BE: 'Belgium',
  NL: 'Netherlands',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  PT: 'Portugal',
  PL: 'Poland',
  CZ: 'Czech Republic',
  AT: 'Austria',
  CH: 'Switzerland',
  AU: 'Australia',
  SG: 'Singapore',
  TH: 'Thailand',
  TW: 'Taiwan',
};

/**
 * Reads the visitor's country code from whichever CDN geo header is
 * present. Vercel sets `x-vercel-ip-country`, Cloudflare `cf-ipcountry`;
 * `x-country-code` is a common reverse-proxy convention for self-hosting.
 * Returns null when no header is set (local dev, or a host without geo
 * headers) — the sign-up route then falls back to an IP lookup, and if
 * that fails too the geoblock FAILS OPEN, because blocking every sign-up
 * on a misconfigured host is worse than missing a restricted one.
 *
 * GEO_FORCE_COUNTRY (server env, dev/testing only): pretend every visitor
 * comes from that country — e.g. `GEO_FORCE_COUNTRY=DE npm run dev` to see
 * the blocked sign-up flow from localhost, where no geo header exists.
 * Do NOT set it in production: it overrides real detection for everyone.
 */
export function countryFromHeaders(headers: Headers): string | null {
  const forced = process.env.GEO_FORCE_COUNTRY?.trim().toUpperCase();
  if (forced) return /^[A-Z]{2}$/.test(forced) ? forced : null;
  const raw =
    headers.get('x-vercel-ip-country') ??
    headers.get('cf-ipcountry') ??
    headers.get('x-country-code');
  const code = raw?.trim().toUpperCase() ?? '';
  // Cloudflare uses XX for unknown and T1 for Tor exit nodes — neither is
  // a real country, so treat both as undetectable.
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : null;
}
