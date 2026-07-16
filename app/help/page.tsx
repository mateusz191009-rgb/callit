'use client';

import { ChevronDown, MessageCircle } from 'lucide-react';
import Button from '@/components/ui/button';

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

/** Native details/summary accordion — no JS state, chevron rotates via
 *  the `group-open:` variant. */
function FaqItem({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-sm font-bold text-tx transition-colors hover:text-green [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-tx-mut transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 border-t border-line px-5 py-4 text-sm leading-relaxed text-tx-sec">
        {children}
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HelpPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-tx">Help</h1>
        <p className="mt-1 text-sm text-tx-sec">
          Everything you need to know about trading, deposits and how markets
          resolve.
        </p>
      </div>

      <div className="space-y-3">
        <FaqItem question="How does trading work?">
          <p>
            Every market has a Yes side and a No side, priced in cents. A price
            of 62¢ means the market thinks the event is 62% likely to happen.
            Yes and No prices always add up to $1.
          </p>
          <p>
            When you buy shares, each share pays out exactly $1 if your side
            wins — buy Yes at 62¢ and you make 38¢ per share when the market
            resolves Yes. Buying also moves the price: the more you buy, the
            more the odds shift toward your side. You can sell your shares back
            at the current price any time while the market is open.
          </p>
        </FaqItem>

        <FaqItem question="How do deposits and withdrawals work?">
          <p>
            Deposits: open the Wallet page, pick a currency (BTC, ETH, USDT,
            USDC, BNB or SOL), send funds to the address shown and submit a
            deposit request with the amount. Every deposit is reviewed manually
            by our team and credited to your balance once approved.
          </p>
          <p>
            Withdrawals: choose a currency, enter the amount and your payout
            address. The amount is reserved from your balance immediately and
            the request goes into manual review — if it is rejected, the funds
            are refunded in full.
          </p>
        </FaqItem>

        <FaqItem question="How do markets resolve?">
          <p>Markets resolve one of three ways, set when the market is created:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-bold text-tx">Chainlink Oracle</span> — the
              outcome is pulled automatically from a decentralized oracle.
            </li>
            <li>
              <span className="font-bold text-tx">Community vote</span> — once
              the market ends, signed-in users vote Yes or No and the majority
              side wins.
            </li>
            <li>
              <span className="font-bold text-tx">Manual</span> — the creator
              resolves the market themselves. Manual resolution costs a flat
              $10 fee, deducted from the resolver&apos;s balance.
            </li>
          </ul>
          <p>At resolution, every winning share pays out $1.</p>
        </FaqItem>

        <FaqItem question="How do I create a market?">
          <p>
            Hit Create new market in the sidebar. Write a clear yes/no question
            (10–140 characters), add resolution criteria in the description,
            pick a category, set an end date and choose a resolution method.
            Your market goes live instantly — no permission needed.
          </p>
          <p>
            If you pick manual resolution, remember that you resolve it
            yourself after the end date and the $10 resolution fee applies.
          </p>
        </FaqItem>

        <FaqItem question="What are the fees?">
          <p>
            Trading is fee-free — no commission on buys, sells or payouts. The
            only charge on the platform is the flat $10 fee for manually
            resolving your own market. Oracle and community resolutions are
            free.
          </p>
        </FaqItem>

        <FaqItem question="Is my money safe?">
          <p>
            Callit is an educational platform. Balances, trades and payouts are
            simulated values used to learn how prediction markets work — they are
            not real funds, and nothing here is financial advice. Your data
            lives in your browser (or your account when cloud sync is
            enabled), and you can wipe it any time from Settings.
          </p>
        </FaqItem>
      </div>

      {/* Contact */}
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-2 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-green/10 text-green">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-tx">Still need help?</h2>
            <p className="mt-1 text-sm text-tx-sec">
              Chat with our support bot — the green bubble in the bottom-right
              corner — or email{' '}
              <span className="font-bold text-tx">support@callit.app</span>.
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          onClick={() => window.dispatchEvent(new Event('callit:open-support'))}
        >
          Chat with support
        </Button>
      </div>
    </div>
  );
}
