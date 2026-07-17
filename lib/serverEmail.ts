/**
 * v8 — SERVER-ONLY EMAIL SENDER.
 *
 * `sendEmail()` posts to the Resend API (https://resend.com — the free tier
 * is enough for this product's volume) when RESEND_API_KEY is configured,
 * and DEGRADES TO A NO-OP when it is not: it resolves
 * `{ ok: false, skipped: true }` and logs one console.info. It NEVER
 * throws — an email must never be able to break the flow that triggered it
 * (a withdrawal request completes whether or not the mail went out; the
 * route then handles the skipped case, see CONTRACTS2.md ## v8).
 *
 * SERVER ONLY: RESEND_API_KEY is a secret (no NEXT_PUBLIC_ prefix, so Next
 * refuses to inline it into client bundles), and the window-guard below
 * turns an accidental client import into a loud error instead of a silent
 * always-skipped sender. Import this only from route handlers / server
 * components. The pure template builders live in lib/email.ts (re-exported
 * here for convenience) and are importable anywhere.
 *
 * Env (all optional — see .env.local.example):
 *   RESEND_API_KEY      — activates real sending.
 *   EMAIL_FROM          — sender identity; default 'Callitnow <noreply@call-it-now.com>'.
 *                         Must be a Resend-verified domain to deliver.
 *   NEXT_PUBLIC_APP_URL — absolute origin for links in emails (appBaseUrl()).
 */

import type { EmailTemplate } from './email';

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/serverEmail.ts is server-only — do not import it from a client component.'
  );
}

/** Re-exported so a route can `import { sendEmail, withdrawalConfirmEmail }`
 *  from one place. The builders themselves are pure (lib/email.ts). */
export {
  depositApprovedEmail,
  depositRejectedEmail,
  marketResolvedEmail,
  withdrawalApprovedEmail,
  withdrawalConfirmEmail,
  type EmailTemplate,
} from './email';

/** Outcome of a send. `skipped: true` = no RESEND_API_KEY configured (the
 *  documented graceful degradation, not a failure of anything you did). */
export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8_000;

/** True when real sending is configured (routes can branch UX copy on it). */
/** Real Resend keys always start with `re_`. Anything else — above all the
 *  'your-…' placeholder from .env.local.example — must count as NOT
 *  configured: a bogus key makes every send fail, which would leave
 *  withdrawals stuck (neither emailed nor auto-confirmed). */
function resendKey(): string {
  const k = process.env.RESEND_API_KEY?.trim() ?? '';
  return k.startsWith('re_') ? k : '';
}

export function emailEnabled(): boolean {
  return Boolean(resendKey());
}

/**
 * Absolute app origin for building links that leave the app (email CTAs).
 * Trailing slashes stripped; defaults to the dev origin so local flows
 * produce clickable links out of the box.
 */
export function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (raw ? raw.replace(/\/+$/, '') : '') || 'http://localhost:3013';
}

/**
 * Send one email. Never throws; 8s timeout; no retries (callers that care
 * about delivery — the withdrawal-confirm route — expose a resend action
 * instead, which is honest about what actually happened).
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = resendKey();
  if (!apiKey) {
    console.info(
      '[email] RESEND_API_KEY not set (or placeholder) — skipping',
      `(${input.subject})`
    );
    return { ok: false, skipped: true };
  }

  const to = input.to.trim();
  if (!to || !to.includes('@')) {
    return { ok: false, error: 'Invalid recipient address.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM?.trim() || 'Callitnow <noreply@call-it-now.com>',
        to: [to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Resend answers JSON errors; keep it short and never throw on a
      // malformed body.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) detail = body.message;
      } catch {
        /* body was not JSON — the status code is the message */
      }
      console.warn('[email] send failed:', detail);
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'AbortError'
        ? 'Email send timed out.'
        : e instanceof Error
          ? e.message
          : 'Email send failed.';
    console.warn('[email] send failed:', msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience: send a prebuilt template to one recipient. */
export async function sendTemplate(
  to: string,
  template: EmailTemplate
): Promise<SendEmailResult> {
  return sendEmail({ to, ...template });
}
