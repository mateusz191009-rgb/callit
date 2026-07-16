import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Optional Supabase backend. When NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are set (see .env.local.example) the app
 * runs in "cloud" mode (real auth + persistence via supabase/schema.sql);
 * otherwise everything falls back to the local demo store.
 */

/**
 * Users often paste the Data API URL (…/rest/v1) or auth URL (…/auth/v1)
 * from the Supabase dashboard instead of the bare Project URL, which makes
 * every auth call 404 (POST …/rest/v1/auth/v1/signup). Normalize: trim,
 * strip trailing slashes, strip a trailing /rest/v1 or /auth/v1 suffix.
 */
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
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon) : null;

export const supabaseEnabled = Boolean(supabase);
