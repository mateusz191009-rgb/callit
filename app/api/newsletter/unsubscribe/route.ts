import { timingSafeEqual } from 'node:crypto';
import { serviceSupabase } from '@/lib/serverSupabase';
import { newsletterUnsubscribeSig } from '@/lib/serverEmail';

/**
 * v23.8 — ONE-CLICK UNSUBSCRIBE, no login.
 *
 * The link in every newsletter lands here: `?uid=<profile id>&sig=<hmac>`.
 * The sig (newsletterUnsubscribeSig — HMAC over the scoped user id) is
 * the whole authentication: only the server can mint it, so possession
 * of the link proves it came out of a mail we sent to that user. On a
 * valid pair we flip `marketing_opt_in` off under the service key and
 * show a tiny confirmation page; anything invalid gets a 400 page with
 * zero detail (no oracle for guessing ids). GET on purpose — mail
 * clients prefetch POST forms poorly and the action is idempotent and
 * harmless: the worst a prefetch can do is unsubscribe, never the
 * reverse.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimal dark brand page — inline styles only, no app shell. */
function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"/>` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"/>` +
      `<title>${title} — Callitnow</title></head>` +
      `<body style="margin:0;background:#0B1622;font-family:'Nunito','Segoe UI',Arial,sans-serif;">` +
      `<div style="max-width:460px;margin:0 auto;padding:64px 20px;">` +
      `<div style="font-size:22px;font-weight:900;color:#E8F0F7;letter-spacing:-1px;">` +
      `callit<span style="color:#00E17E;">now</span></div>` +
      `<div style="background:#101E2D;border:1px solid #22364A;border-top:3px solid #00E17E;` +
      `border-radius:16px;padding:26px 24px;margin-top:18px;">` +
      `<div style="font-size:18px;font-weight:800;color:#E8F0F7;">${title}</div>` +
      `<div style="font-size:14px;line-height:1.7;color:#9FB3C4;padding-top:8px;">${body}</div>` +
      `</div></div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const uid = url.searchParams.get('uid') ?? '';
  const sig = url.searchParams.get('sig') ?? '';

  const expected = uid && UUID_RE.test(uid) ? newsletterUnsubscribeSig(uid) : null;
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected ?? '', 'utf8');
  const valid = expected !== null && a.length === b.length && timingSafeEqual(a, b);

  if (!valid || !serviceSupabase) {
    return page(
      'Link not valid',
      'This unsubscribe link is invalid or expired. You can also turn off email updates in your account settings.',
      400
    );
  }

  const { error } = await serviceSupabase
    .from('profiles')
    .update({ marketing_opt_in: false })
    .eq('id', uid);

  if (error) {
    return page(
      'Something went wrong',
      'We could not update your preference. Please try again, or turn off email updates in your account settings.',
      500
    );
  }

  return page(
    'You are unsubscribed',
    'You will not receive market-update emails anymore. Changed your mind? Re-enable them anytime under Settings → Email updates.'
  );
}
