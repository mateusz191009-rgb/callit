import { formatMoney } from './format';

/**
 * v8 — EMAIL TEMPLATES (pure string builders, no I/O, no env access).
 *
 * These are safe to import anywhere (they are just functions returning
 * strings), but their only real consumers are SERVER routes sending mail
 * through `sendEmail()` in lib/serverEmail.ts — which is the server-only
 * half of this split and the thing that actually talks to Resend.
 *
 * Design: dark, branded, plain. Inline styles ONLY (email clients strip
 * <style> blocks), table-free single-column layout, one green CTA button
 * where the mail has an action. Colors mirror the app tokens: ink #0B1622,
 * surface #101E2D, line #22364A, green #00E17E, green-ink #04131C,
 * tx #E8F0F7, tx-sec #9FB3C4. No emojis, English copy, USD amounts via
 * formatMoney / prices via formatCents — same law as the UI.
 */

/** A ready-to-send email body. Feed it straight into `sendEmail()`. */
export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

/** Minimal HTML-escape for user-supplied strings (question, address). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The one green CTA button. `href` must be an absolute URL. */
function ctaButton(href: string, label: string): string {
  return (
    `<a href="${esc(href)}" ` +
    `style="display:inline-block;background:#00E17E;color:#04131C;` +
    `font-weight:800;font-size:15px;text-decoration:none;` +
    `padding:12px 28px;border-radius:12px;">${esc(label)}</a>`
  );
}

/**
 * Shared shell: dark card on a dark page, wordmark on top, muted footer.
 * `bodyHtml` is trusted template-internal markup; user strings inside it
 * must already be escaped by the caller.
 */
function shell(bodyHtml: string): string {
  return (
    `<div style="background:#0B1622;padding:32px 16px;font-family:'Nunito','Segoe UI',Arial,sans-serif;">` +
    `<div style="max-width:520px;margin:0 auto;">` +
    `<div style="font-size:22px;font-weight:900;color:#E8F0F7;letter-spacing:-0.5px;padding:0 4px 16px;">` +
    `call<span style="color:#00E17E;">it</span></div>` +
    `<div style="background:#101E2D;border:1px solid #22364A;border-radius:16px;padding:28px 24px;color:#E8F0F7;">` +
    bodyHtml +
    `</div>` +
    `<div style="color:#5E7386;font-size:12px;line-height:1.6;padding:16px 4px 0;">` +
    `You are receiving this because of activity on your Callit account. ` +
    `If this was not you, ignore this email — nothing happens without it.` +
    `</div></div></div>`
  );
}

function heading(text: string): string {
  return `<div style="font-size:19px;font-weight:800;color:#E8F0F7;margin:0 0 12px;">${esc(text)}</div>`;
}

function para(html: string): string {
  return `<div style="font-size:14px;line-height:1.7;color:#9FB3C4;margin:0 0 16px;">${html}</div>`;
}

function bigNumber(text: string): string {
  return `<div style="font-size:28px;font-weight:900;color:#00E17E;margin:0 0 16px;font-variant-numeric:tabular-nums;">${esc(text)}</div>`;
}

/* ------------------------------------------------------------------ */
/* templates                                                           */
/* ------------------------------------------------------------------ */

/**
 * Withdrawal confirmation — the SECURITY email. `url` is the absolute
 * confirm link (`${NEXT_PUBLIC_APP_URL}/withdraw/confirm?token=…`); the
 * click is what proves the account owner, not just the session, wants the
 * money out. Single-use link.
 */
export function withdrawalConfirmEmail(url: string): EmailTemplate {
  return {
    subject: 'Confirm your withdrawal',
    html: shell(
      heading('Confirm your withdrawal') +
        para(
          'A withdrawal was requested from your Callit account. It reaches ' +
            'our review team only after you confirm it — click the button ' +
            'below to do that. The link works once.'
        ) +
        `<div style="margin:0 0 20px;">${ctaButton(url, 'Confirm withdrawal')}</div>` +
        para(
          `If the button does not work, open this link:<br/>` +
            `<a href="${esc(url)}" style="color:#3B9DF8;word-break:break-all;">${esc(url)}</a>`
        ) +
        para(
          '<strong style="color:#E8F0F7;">Did not request this?</strong> ' +
            'Do nothing — the withdrawal cannot be approved without this ' +
            'confirmation, and you can reject it from your wallet page.'
        )
    ),
    text:
      'Confirm your withdrawal\n\n' +
      'A withdrawal was requested from your Callit account. It reaches our ' +
      'review team only after you confirm it. Open this link (works once):\n\n' +
      `${url}\n\n` +
      'Did not request this? Do nothing — the withdrawal cannot be approved ' +
      'without this confirmation.',
  };
}

/** Deposit approved — `amount` is the USD value credited. */
export function depositApprovedEmail(amount: number): EmailTemplate {
  const amt = formatMoney(amount);
  return {
    subject: `Deposit approved — ${amt} credited`,
    html: shell(
      heading('Deposit approved') +
        para('Your deposit was reviewed and approved. Your balance was credited with:') +
        bigNumber(amt) +
        para('The funds are available for trading right away.')
    ),
    text:
      'Deposit approved\n\n' +
      `Your deposit was reviewed and approved. ${amt} was credited to your ` +
      'balance and is available for trading right away.',
  };
}

/** Deposit rejected — no amount: nothing was credited. */
export function depositRejectedEmail(): EmailTemplate {
  return {
    subject: 'Deposit rejected',
    html: shell(
      heading('Deposit rejected') +
        para(
          'Your deposit request was reviewed and could not be approved — ' +
            'usually because the transaction could not be matched to our ' +
            'deposit address, or the amount did not match.'
        ) +
        para(
          'Nothing was credited and nothing was taken. If you believe this ' +
            'is a mistake, submit the deposit again with the exact ' +
            'transaction hash.'
        )
    ),
    text:
      'Deposit rejected\n\n' +
      'Your deposit request was reviewed and could not be approved. Nothing ' +
      'was credited and nothing was taken. If you believe this is a mistake, ' +
      'submit the deposit again with the exact transaction hash.',
  };
}

/** Withdrawal approved — `amount` USD, `address` the payout destination. */
export function withdrawalApprovedEmail(amount: number, address: string): EmailTemplate {
  const amt = formatMoney(amount);
  return {
    subject: `Withdrawal approved — ${amt} on its way`,
    html: shell(
      heading('Withdrawal approved') +
        para('Your withdrawal was reviewed and approved:') +
        bigNumber(amt) +
        para(
          `Destination address:<br/>` +
            `<span style="color:#E8F0F7;font-family:ui-monospace,Consolas,monospace;word-break:break-all;">${esc(address)}</span>`
        ) +
        para('The payout is being processed to that address.')
    ),
    text:
      'Withdrawal approved\n\n' +
      `Your withdrawal of ${amt} was reviewed and approved. The payout is ` +
      `being processed to:\n\n${address}`,
  };
}

/**
 * Market resolved — sent to a winning holder. `outcome` is the winning
 * side, `payout` the USD amount credited to them.
 */
export function marketResolvedEmail(
  question: string,
  outcome: 'yes' | 'no',
  payout: number
): EmailTemplate {
  const amt = formatMoney(payout);
  const outcomeLabel = outcome === 'yes' ? 'Yes' : 'No';
  const outcomeColor = outcome === 'yes' ? '#00E17E' : '#3B9DF8';
  return {
    subject: `Market resolved ${outcomeLabel} — you were paid ${amt}`,
    html: shell(
      heading('You called it') +
        para(
          `<span style="color:#E8F0F7;font-weight:700;">${esc(question)}</span><br/>` +
            `resolved <span style="color:${outcomeColor};font-weight:800;">${outcomeLabel}</span>. ` +
            `Winning shares pay $1 each.`
        ) +
        para('Credited to your balance:') +
        bigNumber(amt)
    ),
    text:
      'Market resolved\n\n' +
      `"${question}" resolved ${outcomeLabel}. Winning shares pay $1 each.\n\n` +
      `${amt} was credited to your balance.`,
  };
}
