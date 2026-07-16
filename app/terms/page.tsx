import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Terms of service — callit',
  description:
    'The rules of the platform: eligibility, market resolution, deposits and withdrawals, fees, prohibited use and responsible trading.',
};

/** Last substantive revision of the terms below. */
const LAST_UPDATED = 'July 15, 2026';

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-2">
      <h2 className="text-lg font-extrabold tracking-tight text-tx">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-tx-sec">{children}</div>
    </section>
  );
}

const SECTIONS: { id: string; label: string }[] = [
  { id: 'what-callit-is', label: 'What Callit is' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'no-advice', label: 'No financial advice' },
  { id: 'resolution', label: 'Market resolution and disputes' },
  { id: 'payments', label: 'Deposits and withdrawals' },
  { id: 'fees', label: 'Fees' },
  { id: 'prohibited', label: 'Prohibited use' },
  { id: 'suspension', label: 'Account suspension' },
  { id: 'liability', label: 'Limitation of liability' },
  { id: 'responsible', label: 'Responsible trading' },
];

/** Self-check list — the standard "is this still fun?" questions. */
const SELF_CHECK: string[] = [
  'Are you trading with money you can afford to lose entirely?',
  'Are you trading to make back something you already lost?',
  'Have you borrowed money, or used money meant for bills, to fund your balance?',
  'Do you trade to escape stress, boredom or a bad mood?',
  'Have you hidden how much you trade from people close to you?',
  'Have you tried to cut back and found that you could not?',
];

export default function TermsPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-tx">Terms of service</h1>
        <p className="mt-1 text-sm text-tx-mut">Last updated {LAST_UPDATED}</p>
        <p className="mt-3 text-sm leading-relaxed text-tx-sec">
          These terms cover your use of Callit. They are written to be read — if
          something here is unclear, ask support before you trade.
        </p>
      </div>

      {/* Jump list */}
      <nav aria-label="Sections" className="rounded-2xl border border-line bg-surface-2 p-4">
        <h2 className="text-xs font-black uppercase tracking-wide text-tx-mut">Contents</h2>
        <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-sm text-tx-sec transition-colors hover:text-green"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-7">
        <Section id="what-callit-is" title="What Callit is">
          <p>
            Callit is a prediction market platform. Markets ask a yes/no question about a
            real-world event. Shares in each side are priced in cents between 1¢ and 99¢,
            and the Yes and No price always add up to $1. A price of 62¢ means the market
            currently prices the event at roughly 62% likely.
          </p>
          <p>
            When a market resolves, every share on the winning side pays $1 and every
            share on the losing side pays nothing. Buying moves the price: larger orders
            fill at a worse average price than the number on the card, because your own
            order is part of what moves it.
          </p>
          <p>
            Some markets are launched by users of the platform. Others are Global markets
            sourced from a third-party feed. Callit is not the counterparty to a bet
            against you — you trade against the market.
          </p>
        </Section>

        <Section id="eligibility" title="Eligibility (18+)">
          <p>
            You must be at least 18 years old to hold an account. By creating one, you
            confirm you are 18 or older and that using a prediction market is legal where
            you live.
          </p>
          <p>
            One account per person. Accounts are personal: do not share yours, do not
            trade on behalf of somebody else, and do not let anyone under 18 use it.
          </p>
        </Section>

        <Section id="no-advice" title="No financial advice">
          <p>
            Nothing on Callit is financial, investment, legal or tax advice. Prices,
            charts, leaderboards, market descriptions and anything said in chat are
            information and opinion, not a recommendation.
          </p>
          <p>
            We are not licensed advisers and no one here is assessing whether a trade
            suits your circumstances. Trading is risky and you can lose your entire
            balance. Decisions you make are yours.
          </p>
        </Section>

        <Section id="resolution" title="Market resolution and disputes">
          <p>Every market states how it resolves when it is created:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-bold text-tx">Oracle</span> — Global markets settle to
              the outcome reported by the feed they came from.
            </li>
            <li>
              <span className="font-bold text-tx">Community vote</span> — after the end
              date, signed-in users vote and the majority decides. A tied vote is not
              settled automatically; it goes to review.
            </li>
            <li>
              <span className="font-bold text-tx">Manual</span> — the market&apos;s creator
              resolves it themselves after the end date, and pays a flat fee to do so.
            </li>
          </ul>
          <p>
            Resolution follows the question and the resolution criteria in the market
            description as written, not what the creator meant to write. Write your
            criteria precisely: an ambiguous question is a bad market and may be voided.
          </p>
          <p>
            <span className="font-bold text-tx">Disputes.</span> If you believe a market
            was resolved incorrectly, contact support within 7 days of resolution with the
            market and your reasoning. We can void a market and refund every open position
            at cost where a question was ambiguous, the source was wrong, or the outcome
            was manipulated. Where the outcome is genuinely unclear, refunding at cost is
            the default — we would rather void a market than guess. Our decision on a
            disputed market is final.
          </p>
        </Section>

        <Section id="payments" title="Deposits and withdrawals">
          <p>
            Deposits and withdrawals are reviewed manually by a human before funds move.
            That review is a deliberate second pair of eyes, and it means requests are not
            instant.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Minimum deposit <span className="font-bold tabular-nums text-tx">$10</span>.
              Minimum withdrawal{' '}
              <span className="font-bold tabular-nums text-tx">$20</span>.
            </li>
            <li>
              Send only the selected currency on the network shown. Funds sent on another
              network cannot be recovered.
            </li>
            <li>
              A withdrawal reserves the amount from your balance as soon as you request it.
              If it is rejected, the full amount is refunded to your balance.
            </li>
            <li>
              Money in open positions is not part of your balance and cannot be withdrawn
              until those markets resolve.
            </li>
            <li>
              Withdrawals go to an address you control. We may ask you to verify ownership
              of an account or address before paying out.
            </li>
          </ul>
        </Section>

        <Section id="fees" title="Fees">
          <p>
            Each market states its own trading fee, taken from your stake when a trade
            fills — the shares and average price you see quoted are already net of it.
            Markets created before per-market fees existed trade fee-free.
          </p>
          <p>
            Resolving your own market manually costs a flat{' '}
            <span className="font-bold tabular-nums text-tx">$10</span>, charged when you
            resolve it. Community and oracle resolution are free. There is no fee to
            deposit, to withdraw, or to be paid out on a winning position.
          </p>
        </Section>

        <Section id="prohibited" title="Prohibited use">
          <p>The following will cost you your account:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-bold text-tx">Market manipulation</span> — trading to
              move a price rather than to express a view, wash trading between accounts,
              or coordinating trades with others to move a market.
            </li>
            <li>
              <span className="font-bold text-tx">Self-resolution abuse</span> — creating a
              market, taking a position in it and resolving it in your own favour;
              resolving against the criteria you published; or creating a market whose
              outcome you alone control.
            </li>
            <li>
              <span className="font-bold text-tx">Multi-accounting</span> — running more
              than one account, or using someone else&apos;s, including to swing a
              community vote.
            </li>
            <li>
              Trading on an outcome you can cause, or on non-public information you have a
              duty not to use.
            </li>
            <li>
              Markets on assassination, terrorism, or the death or injury of a named
              private person; markets designed to harass someone; illegal content.
            </li>
            <li>
              Automated abuse: scraping at a rate that degrades the service, probing for
              vulnerabilities, or attempting to bypass limits, bans or the review process.
            </li>
          </ul>
        </Section>

        <Section id="suspension" title="Account suspension">
          <p>
            We may suspend an account, freeze a balance, void trades or ban a market where
            we reasonably believe these terms have been broken, where required by law, or
            while we investigate a suspected breach.
          </p>
          <p>
            A ban stops trading, market creation and withdrawal requests. Where a
            suspension is upheld, positions may be voided and refunded at cost. Where a
            balance was built by manipulation or multi-accounting, we may withhold the
            proceeds of that activity. You can contact support to contest a suspension.
          </p>
          <p>You can stop using Callit at any time. Withdraw first — a closed account cannot request a payout.</p>
        </Section>

        <Section id="liability" title="Limitation of liability">
          <p>
            Callit is provided &quot;as is&quot;. We do not guarantee that the platform is
            uninterrupted, that prices or third-party market data are accurate or current,
            or that a market will resolve on any particular schedule.
          </p>
          <p>
            To the fullest extent the law allows, we are not liable for trading losses, for
            lost profit or opportunity, for outages or delays, for errors in third-party
            data or feeds, or for funds sent to the wrong address or network. Where
            liability cannot be excluded, it is limited to the fees you paid us in the 12
            months before the claim.
          </p>
          <p>Nothing here limits liability for fraud or for anything that cannot lawfully be limited.</p>
        </Section>

        <Section id="responsible" title="Responsible trading">
          <p>
            Prediction markets are speculative. Prices move against you, losses are real,
            and a run of wins is not skill compounding — it is a sample. Trade with money
            you can afford to lose, and treat a losing streak as information rather than
            something to chase.
          </p>

          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green/10 text-green">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-tx">A quick self-check</h3>
                <p className="mt-1 text-xs text-tx-mut">
                  Answering yes to any of these is a reason to stop and take a break.
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {SELF_CHECK.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-tx-sec">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-green"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p>
            Tools that help: set yourself a deposit budget before you start, check the
            History tab in your{' '}
            <Link href="/portfolio" className="font-bold text-tx hover:text-green">
              portfolio
            </Link>{' '}
            to see what you have actually staked rather than what you remember staking, and
            step away after a loss instead of sizing up. If you want your account
            suspended, support can do that — ask.
          </p>
          <p>
            If trading has stopped being fun, free and confidential help is available.
            BeGambleAware offers advice and support 24/7:
          </p>
          <p>
            <a
              href="https://www.begambleaware.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold text-green transition-colors hover:text-tx"
            >
              begambleaware.org
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </p>
        </Section>
      </div>

      <div className="rounded-2xl border border-line bg-surface-2 p-5 text-sm text-tx-sec">
        <p>
          Questions about these terms? Email{' '}
          <span className="font-bold text-tx">support@callit.app</span> or read the{' '}
          <Link href="/help" className="font-bold text-tx hover:text-green">
            Help center
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-tx-mut">
          We may update these terms as the platform changes. Material changes will be
          announced before they take effect, and the date at the top of this page always
          reflects the current version.
        </p>
      </div>
    </div>
  );
}
