/**
 * v8 — SIGN-UP GATE: geoblock + rate limiting + (optional) Turnstile.
 *
 * Runs BEFORE `supabase.auth.signUp` — multi-accounting and bot signups are
 * cheapest to stop before an account exists. Three independent layers:
 *
 *  1. GEOBLOCK — refuses sign-up from countries where regulators treat
 *     prediction markets as unlicensed gambling (lib/geo.ts). Browsing is
 *     never blocked — only account creation, which is what gates every
 *     real action. Existing users can still sign in. The ADMIN_EMAIL is
 *     exempt. Responds 451 with code 'geo_blocked' so the UI can show a
 *     dedicated message instead of a generic error.
 *     Country detection: CDN geo header first (Vercel/Cloudflare), then an
 *     ipapi.co lookup for self-hosted deployments that have no such header.
 *     Unknown country (private IP, lookup down) fails OPEN.
 *  2. RATE LIMIT — in-memory sliding windows per IP and per email.
 *     Per-instance and reset on restart: fine for a single-instance MVP;
 *     the production upgrade is a durable store (Postgres/Upstash).
 *  3. CAPTCHA — verified server-side against Cloudflare ONLY when
 *     TURNSTILE_SECRET_KEY is set. Without it (the owner has no keys yet)
 *     this layer is skipped and sign-up proceeds.
 *
 * POST { email, captchaToken? } -> { ok } | 4xx { ok:false, error, code? }
 */

import { ADMIN_EMAIL, RESTRICTED_COUNTRIES, countryFromHeaders } from '@/lib/geo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IP_WINDOW_MS = 10 * 60_000;
const IP_MAX = 5;
const EMAIL_WINDOW_MS = 60 * 60_000;
const EMAIL_MAX = 3;

const ipHits = new Map<string, number[]>();
const emailHits = new Map<string, number[]>();

function hit(map: Map<string, number[]>, key: string, windowMs: number): number {
  const now = Date.now();
  const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  map.set(key, list);
  if (map.size > 10_000) map.clear(); // unbounded-map guard
  return list.length;
}

/** Loopback/private/link-local addresses — nothing to geolocate. */
function isPrivateIp(ip: string): boolean {
  return (
    ip === 'unknown' ||
    ip === '::1' ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(
      ip
    )
  );
}

/** Successful IP→country results only (failures are retried, not cached). */
const ipCountryCache = new Map<string, string>();

/**
 * IP→country fallback for hosts without a CDN geo header (plain
 * `next start` on a VPS). ipapi.co: HTTPS, no key, 30k lookups/month free
 * — plenty for sign-up volume. Any failure (timeout, rate limit, private
 * IP) returns null and the geoblock fails open.
 */
async function countryFromIp(ip: string): Promise<string | null> {
  if (isPrivateIp(ip)) return null;
  const cached = ipCountryCache.get(ip);
  if (cached) return cached;
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country/`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'user-agent': 'callit-signup-geocheck' },
    });
    if (!res.ok) return null;
    const code = (await res.text()).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    if (ipCountryCache.size > 10_000) ipCountryCache.clear(); // unbounded-map guard
    ipCountryCache.set(ip, code);
    return code;
  } catch {
    return null;
  }
}

/** Real Turnstile secrets start with 0x (1x-3x = Cloudflare test keys).
 *  The 'your-…' placeholder from .env.local.example must count as NOT
 *  configured — verifying against a bogus secret always fails and would
 *  brick every sign-up. */
function turnstileSecret(): string {
  const s = process.env.TURNSTILE_SECRET_KEY ?? '';
  return /^[0-3]x[\w-]{8,}$/.test(s) ? s : '';
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = turnstileSecret();
  if (!secret) return true; // captcha not configured — layer disabled
  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(8000),
      }
    );
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    // Cloudflare unreachable: failing OPEN would defeat the captcha the
    // moment an attacker can induce timeouts; failing closed blocks real
    // users during an outage. For sign-up (a retryable, non-money action)
    // we fail CLOSED and let the user try again.
    return false;
  }
}

export async function POST(req: Request) {
  const headers = { 'cache-control': 'no-store' };
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  let email = '';
  let captchaToken = '';
  try {
    const body = (await req.json()) as { email?: unknown; captchaToken?: unknown };
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : '';
  } catch {
    // fall through to the 400
  }
  if (!email) {
    return Response.json(
      { ok: false, error: 'Missing email.' },
      { status: 400, headers }
    );
  }

  // Geoblock — before the rate limiter so a blocked visitor retrying does
  // not burn rate-limit budget and mutate into a misleading 429.
  if (email !== ADMIN_EMAIL.toLowerCase()) {
    const country =
      countryFromHeaders(req.headers) ?? (await countryFromIp(ip));
    const countryName = country ? RESTRICTED_COUNTRIES[country] : undefined;
    if (countryName) {
      return Response.json(
        {
          ok: false,
          code: 'geo_blocked',
          country: countryName,
          error: `Callitnow is not available in ${countryName}.`,
        },
        { status: 451, headers }
      );
    }
  }

  if (
    hit(ipHits, ip, IP_WINDOW_MS) > IP_MAX ||
    hit(emailHits, email, EMAIL_WINDOW_MS) > EMAIL_MAX
  ) {
    return Response.json(
      { ok: false, error: 'Too many attempts — please try again later.' },
      { status: 429, headers }
    );
  }

  if (turnstileSecret()) {
    if (!captchaToken) {
      return Response.json(
        { ok: false, error: 'Please complete the captcha.' },
        { status: 400, headers }
      );
    }
    if (!(await verifyTurnstile(captchaToken, ip))) {
      return Response.json(
        { ok: false, error: 'Captcha verification failed — please try again.' },
        { status: 400, headers }
      );
    }
  }

  return Response.json({ ok: true }, { headers });
}
