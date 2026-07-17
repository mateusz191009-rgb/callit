import { serviceEnabled, serviceSupabase } from '@/lib/serverSupabase';

/**
 * v8 — WITHDRAWAL EMAIL CONFIRMATION, step 2 of 2.
 *
 * The link in the confirmation email lands on /withdraw/confirm?token=…,
 * and that page POSTs the token here. No auth on purpose: the token IS the
 * proof (unguessable, single-use, server-generated), and the link may well
 * be opened in a browser that has no session.
 *
 * The RPC is SERVICE ROLE ONLY — a user session could never call it, which
 * is exactly why this route exists: the client can neither read its own
 * confirm_token (column grant revoked) nor flip `confirmed` itself.
 *
 * POST { token: string } -> { ok: boolean, id?: string, error?: string }
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Light in-memory IP throttle — token guessing is hopeless (2x uuid hex)
 *  but there is no reason to let anyone try at line rate. Resets on server
 *  restart; per-instance; good enough for this endpoint. */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // unbounded-map guard
  return list.length > MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const headers = { 'cache-control': 'no-store' };

  if (!serviceEnabled || !serviceSupabase) {
    return Response.json(
      {
        ok: false,
        error:
          'Withdrawal confirmation is not available — SUPABASE_SERVICE_ROLE_KEY is not configured on the server.',
      },
      { status: 503, headers }
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) {
    return Response.json(
      { ok: false, error: 'Too many attempts — try again later.' },
      { status: 429, headers }
    );
  }

  let token = '';
  try {
    const body = (await req.json()) as { token?: unknown };
    token = typeof body.token === 'string' ? body.token.trim() : '';
  } catch {
    // fall through to the empty-token 400
  }
  if (!token) {
    return Response.json(
      { ok: false, error: 'Missing confirmation token.' },
      { status: 400, headers }
    );
  }

  const { data, error } = await serviceSupabase.rpc('confirm_withdrawal', {
    p_token: token,
  });
  if (error) {
    // The RPC's own wording ('Invalid or used confirmation link') is the
    // user-facing message; anything else gets a neutral fallback.
    const msg = /invalid or used/i.test(error.message)
      ? 'Invalid or used confirmation link'
      : 'Confirmation failed — try again later.';
    return Response.json({ ok: false, error: msg }, { status: 400, headers });
  }

  return Response.json(
    { ok: true, id: typeof data === 'string' ? data : undefined },
    { headers }
  );
}
