import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * SERVER-ONLY Supabase client (v5).
 *
 * Built from SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS and every
 * table grant — it is a full-power admin key. It MUST never reach the
 * browser:
 *   * the variable is deliberately NOT prefixed with NEXT_PUBLIC_, so
 *     Next.js refuses to inline it into client bundles;
 *   * this module must never be imported from a `'use client'` file
 *     (import it only from route handlers / server components);
 *   * the guard below turns an accidental client import into a loud
 *     runtime error instead of a silent key leak.
 *
 * The only current consumer is app/api/polymarket/route.ts, which mirrors
 * the live Polymarket feed into the `markets` table so `place_trade()`
 * has a trusted, server-held price to fill Global markets against (the
 * client never gets to seed a price — see the v5 security notes in
 * supabase/schema.sql and CONTRACTS2.md).
 *
 * Absent key => `serviceSupabase` is null and `serviceEnabled` is false;
 * every consumer must degrade gracefully (the feed still renders, only
 * the DB mirror is skipped).
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/serverSupabase.ts is server-only — do not import it from a client component.'
  );
}

/** Same normalization as lib/supabase.ts: people paste the Data API URL
 *  (…/rest/v1) instead of the bare Project URL. Duplicated on purpose so
 *  this module stays free of any client-side import. */
function sanitizeSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth)\/v1$/i, '')
    .replace(/\/+$/, '');
  return cleaned || undefined;
}

const url = sanitizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

/** Service-role client, or null when the key/URL is missing. */
export const serviceSupabase: SupabaseClient | null =
  url && serviceKey
    ? createClient(url, serviceKey, {
        // No user session on the server: never persist or refresh tokens.
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/** True when the service-role key is configured (server-side sync is on). */
export const serviceEnabled = Boolean(serviceSupabase);
