import { serviceEnabled, serviceSupabase } from '@/lib/serverSupabase';
import {
  appBaseUrl,
  emailEnabled,
  sendTemplate,
  withdrawalConfirmEmail,
} from '@/lib/serverEmail';

/**
 * v8 — WITHDRAWAL EMAIL CONFIRMATION, step 1 of 2.
 *
 * Called by the client right after `request_withdrawal` reserved the funds
 * (lib/cloud.ts sendWithdrawalConfirmation — fire-and-forget). This route is
 * the ONLY thing that may read `confirm_token`: no user role can (column
 * grant revoked), because a hijacked session must not be able to confirm
 * its own withdrawal by reading the token out of its own row.
 *
 * GRACEFUL DEGRADATION (the owner has no RESEND_API_KEY yet): when email is
 * not configured, the withdrawal AUTO-CONFIRMS server-side so the flow
 * still completes — the email step is a security layer, never a blocker.
 *
 * POST { id: string } + Authorization: Bearer <caller's access token>
 *   -> { ok, skipped?, confirmed?, error? }
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const headers = { 'cache-control': 'no-store' };

  if (!serviceEnabled || !serviceSupabase) {
    return Response.json(
      {
        ok: false,
        error:
          'Email confirmation is not available — SUPABASE_SERVICE_ROLE_KEY is not configured.',
      },
      { status: 503, headers }
    );
  }

  // Caller identity — same pattern as /api/deposits/verify: validate their
  // own access token with the service key.
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!bearer) {
    return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401, headers });
  }
  const { data: userData, error: userErr } = await serviceSupabase.auth.getUser(bearer);
  const uid = userData?.user?.id;
  if (userErr || !uid) {
    return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401, headers });
  }

  let id = '';
  try {
    const body = (await req.json()) as { id?: unknown };
    id = typeof body.id === 'string' ? body.id.trim() : '';
  } catch {
    // fall through
  }
  if (!id) {
    return Response.json(
      { ok: false, error: 'Missing withdrawal id.' },
      { status: 400, headers }
    );
  }

  // Service read — the only role that may see confirm_token.
  const { data: row, error: rowErr } = await serviceSupabase
    .from('withdrawals')
    .select('id, user_id, status, confirmed, confirm_token')
    .eq('id', id)
    .maybeSingle();
  // Not found AND not-your-row are the same 404 on purpose: a 403 would
  // confirm to a prober that someone else's withdrawal id exists.
  if (rowErr || !row || row.user_id !== uid) {
    return Response.json(
      { ok: false, error: 'Withdrawal not found.' },
      { status: 404, headers }
    );
  }
  if (row.status !== 'pending') {
    return Response.json(
      { ok: false, error: 'This withdrawal is no longer pending.' },
      { status: 400, headers }
    );
  }
  if (row.confirmed === true) {
    return Response.json({ ok: true, confirmed: true }, { headers }); // idempotent
  }
  if (!row.confirm_token) {
    // Pre-v8 row (repaired to confirmed=true) should never get here, but a
    // clear message beats a null-token email link.
    return Response.json(
      { ok: false, error: 'This withdrawal has no confirmation token.' },
      { status: 400, headers }
    );
  }

  // No email configured -> auto-confirm so the flow never dead-ends.
  if (!emailEnabled()) {
    const { error: rpcErr } = await serviceSupabase.rpc('confirm_withdrawal', {
      p_token: row.confirm_token,
    });
    if (rpcErr) {
      return Response.json(
        { ok: false, error: 'Auto-confirmation failed — try again.' },
        { status: 500, headers }
      );
    }
    return Response.json({ ok: true, skipped: true, confirmed: true }, { headers });
  }

  // Email path: look up the caller's address and send the link.
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('email')
    .eq('id', uid)
    .maybeSingle();
  const to = profile?.email;
  if (!to) {
    return Response.json(
      { ok: false, error: 'No email address on file for this account.' },
      { status: 400, headers }
    );
  }

  const url = `${appBaseUrl()}/withdraw/confirm?token=${encodeURIComponent(row.confirm_token)}`;
  const sent = await sendTemplate(to, withdrawalConfirmEmail(url));
  if (!sent.ok) {
    // Key is set but the send failed — leave the row unconfirmed so the
    // wallet page can offer a resend.
    return Response.json(
      { ok: false, error: sent.error ?? 'Could not send the confirmation email.' },
      { status: 502, headers }
    );
  }

  await serviceSupabase
    .from('withdrawals')
    .update({ confirm_sent_at: new Date().toISOString() })
    .eq('id', id);

  return Response.json({ ok: true }, { headers });
}
