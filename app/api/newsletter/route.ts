import { getFeedData } from '@/lib/feed';
import { serviceSupabase } from '@/lib/serverSupabase';
import {
  appBaseUrl,
  emailEnabled,
  newEventsEmail,
  newsletterUnsubscribeSig,
  sendEmail,
  type NewsletterEventItem,
} from '@/lib/serverEmail';
import { formatPercent, isSourceResolved } from '@/lib/format';
import type { EventGroup } from '@/lib/types';

/**
 * v23.8 — THE NEWSLETTER, admin-triggered and NOTHING else.
 *
 * GET  = preview: how many opted-in recipients, which events the digest
 *        would contain. The /admin card renders this before the button.
 * POST = send that digest to every profile with `marketing_opt_in = true`
 *        (and not banned), one Resend call per recipient, sequentially —
 *        Resend's free tier allows 2 req/s and 100 mails/day, which at
 *        this product's size is never the constraint.
 *
 * Both verbs authenticate the same way as the admin trigger on
 * /api/settle: the browser sends the ADMIN'S OWN Supabase access token
 * (never a shared secret — anything a client bundle can read is public),
 * and we resolve it to a user + `profiles.is_admin` under the service
 * key. There is deliberately NO cron calling this route: a human decides
 * when a digest is worth sending, by pressing the button.
 *
 * Every mail carries a per-recipient one-click unsubscribe link (HMAC
 * over the user id — see newsletterUnsubscribeSig); consent lives in
 * `profiles.marketing_opt_in`, default false (migration v23.8).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Digest size cap — an email, not a catalog. */
const DIGEST_CAP = 6;
/** "New" = the event's earliest market was created inside this window. */
const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() || null : null;
}

/** Same admin check as /api/settle: token -> user -> profiles.is_admin. */
async function isAdminCaller(req: Request): Promise<boolean> {
  const token = bearer(req);
  if (!token || !serviceSupabase) return false;

  const { data, error } = await serviceSupabase.auth.getUser(token);
  if (error || !data.user) return false;

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('is_admin')
    .eq('id', data.user.id)
    .maybeSingle();

  return profile?.is_admin === true;
}

/** When was this event listed? The earliest of its markets' createdAt. */
function eventCreatedAt(e: EventGroup): number {
  let min = Infinity;
  for (const m of e.markets) {
    const t = new Date(m.createdAt).getTime();
    if (Number.isFinite(t) && t < min) min = t;
  }
  return min;
}

/**
 * The digest: fresh events (listed inside the window) by volume; when
 * the feed has fewer than 3 fresh ones, top-volume events fill in so the
 * button never sends an empty mail on a quiet week.
 */
function digestEvents(events: EventGroup[], now: number): EventGroup[] {
  const fresh = events.filter((e) => now - eventCreatedAt(e) < FRESH_WINDOW_MS);
  const pool = fresh.length >= 3 ? fresh : events;
  return [...pool].sort((a, b) => b.volume - a.volume).slice(0, DIGEST_CAP);
}

function digestItems(events: EventGroup[]): NewsletterEventItem[] {
  const base = appBaseUrl();
  return events.map((e) => {
    // The favorite: an early-resolved winner (v23.5, price 1) IS the
    // story ("decided: Wembanyama"), so no filtering — top price wins.
    const fav = [...e.markets].sort((a, b) => b.yesPrice - a.yesPrice)[0];
    const label = fav?.shortName ?? fav?.question ?? '';
    return {
      title: e.title,
      url: `${base}/event/${encodeURIComponent(e.id)}`,
      favorite: fav && isSourceResolved(fav) ? `${label} (resolved)` : label,
      pct: fav ? formatPercent(fav.yesPrice) : '',
    };
  });
}

interface RecipientRow {
  id: string;
  email: string;
}

/** Opted-in, not banned. Maps the missing-column case to a clear hint. */
async function recipients(): Promise<{ rows?: RecipientRow[]; error?: string; status?: number }> {
  if (!serviceSupabase) {
    return { error: 'Service role key is not configured.', status: 503 };
  }
  const { data, error } = await serviceSupabase
    .from('profiles')
    .select('id,email')
    .eq('marketing_opt_in', true)
    .eq('banned', false);
  if (error) {
    if (error.message.includes('marketing_opt_in')) {
      return {
        error: 'Column profiles.marketing_opt_in is missing — run supabase/migration-v23.8-newsletter.sql first.',
        status: 503,
      };
    }
    return { error: error.message, status: 500 };
  }
  return { rows: (data ?? []) as RecipientRow[] };
}

export async function GET(req: Request) {
  if (!(await isAdminCaller(req))) {
    return Response.json({ error: 'Admin access token required.' }, { status: 401 });
  }
  const rec = await recipients();
  if (rec.error) return Response.json({ error: rec.error }, { status: rec.status });

  const { events } = await getFeedData();
  const items = digestItems(digestEvents(events, Date.now()));
  return Response.json({
    recipients: rec.rows!.length,
    emailEnabled: emailEnabled(),
    events: items,
  });
}

export async function POST(req: Request) {
  if (!(await isAdminCaller(req))) {
    return Response.json({ error: 'Admin access token required.' }, { status: 401 });
  }
  if (!emailEnabled()) {
    return Response.json(
      { error: 'RESEND_API_KEY is not configured — nothing can be sent.' },
      { status: 503 }
    );
  }
  const rec = await recipients();
  if (rec.error) return Response.json({ error: rec.error }, { status: rec.status });
  if (rec.rows!.length === 0) {
    return Response.json({ recipients: 0, sent: 0, errors: [] });
  }

  const { events } = await getFeedData();
  const digest = digestItems(digestEvents(events, Date.now()));
  if (digest.length === 0) {
    return Response.json({ error: 'The feed returned no events to send.' }, { status: 409 });
  }

  const base = appBaseUrl();
  let sent = 0;
  const errors: string[] = [];
  for (const r of rec.rows!) {
    const sig = newsletterUnsubscribeSig(r.id);
    const unsubscribeUrl = sig
      ? `${base}/api/newsletter/unsubscribe?uid=${encodeURIComponent(r.id)}&sig=${sig}`
      : `${base}/settings`;
    const template = newEventsEmail(digest, base, unsubscribeUrl);
    const res = await sendEmail({ to: r.email, ...template });
    if (res.ok) sent += 1;
    else errors.push(`${r.email}: ${res.error ?? 'skipped'}`);
  }

  return Response.json({ recipients: rec.rows!.length, sent, errors });
}
