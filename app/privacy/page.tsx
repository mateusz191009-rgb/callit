import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy policy — callitnow',
  description:
    'What data Callitnow collects, why, who processes it, how long it is kept and the rights you have over it.',
};

/** Last substantive revision of the policy below. */
const LAST_UPDATED = 'July 17, 2026';

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
  { id: 'what-we-collect', label: 'What we collect' },
  { id: 'how-we-use-it', label: 'How we use it' },
  { id: 'cookies', label: 'Cookies and local storage' },
  { id: 'processors', label: 'Who else touches your data' },
  { id: 'retention', label: 'How long we keep it' },
  { id: 'security', label: 'Security' },
  { id: 'your-rights', label: 'Your rights' },
  { id: 'children', label: 'Under 18s' },
  { id: 'changes', label: 'Changes to this policy' },
];

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-tx">Privacy policy</h1>
        <p className="mt-1 text-sm text-tx-mut">Last updated {LAST_UPDATED}</p>
        <p className="mt-3 text-sm leading-relaxed text-tx-sec">
          The short version: we collect what a trading platform needs to run —
          your account details, your trades and your money movements — and
          nothing built for advertising. We do not sell your data, and we never
          will.
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
        <Section id="what-we-collect" title="What we collect">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-bold text-tx">Account data</span> — your email
              address, username and password. The password is stored only as a
              hash by our authentication provider; we cannot read it.
            </li>
            <li>
              <span className="font-bold text-tx">Trading data</span> — the markets
              you create, the positions you open and close, your votes on
              community resolutions, and your chat messages.
            </li>
            <li>
              <span className="font-bold text-tx">Payment data</span> — deposit and
              withdrawal requests: amounts, currencies, transaction references
              and the crypto payout addresses you give us. We never see or store
              card numbers or bank credentials — there are none on the platform.
            </li>
            <li>
              <span className="font-bold text-tx">Technical data</span> — your IP
              address and the country it maps to. We use these for rate
              limiting, abuse prevention and the sign-up country check described
              on the{' '}
              <Link href="/about#legal" className="font-bold text-tx hover:text-green">
                about page
              </Link>
              . We do not build browsing profiles.
            </li>
            <li>
              <span className="font-bold text-tx">Support mail</span> — anything you
              email us, so we can answer and keep a record of disputes.
            </li>
          </ul>
        </Section>

        <Section id="how-we-use-it" title="How we use it">
          <p>
            Everything above is used to run the platform: executing and settling
            your trades, reviewing deposits and withdrawals, resolving disputes,
            stopping bots and multi-accounting, enforcing the country
            restriction at sign-up, and sending you transactional email (such as
            a withdrawal confirmation). That is the whole list.
          </p>
          <p>
            We do not sell or rent personal data, we do not share it with
            advertisers, and we do not use it to train recommendation or
            profiling systems.
          </p>
        </Section>

        <Section id="cookies" title="Cookies and local storage">
          <p>
            We use only functional storage: a session token that keeps you
            signed in, and browser local storage for your preferences and
            cached app state. There are no advertising cookies, no third-party
            trackers and no cross-site analytics pixels — which is why there is
            no cookie banner.
          </p>
        </Section>

        <Section id="processors" title="Who else touches your data">
          <p>
            We use a small number of infrastructure providers, each processing
            only what its job requires:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-bold text-tx">Supabase</span> — hosts our
              database and authentication, so account and trading data lives on
              its infrastructure.
            </li>
            <li>
              <span className="font-bold text-tx">Cloudflare Turnstile</span> — the
              captcha at sign-up; Cloudflare sees your IP address and browser
              signals to tell humans from bots.
            </li>
            <li>
              <span className="font-bold text-tx">Resend</span> — delivers our
              transactional email, so it processes your email address and the
              content of those messages.
            </li>
            <li>
              <span className="font-bold text-tx">Market data feeds</span> — Global
              markets are read from the Polymarket and Kalshi public APIs. Data
              flows one way: we read prices from them and send them nothing
              about you.
            </li>
          </ul>
        </Section>

        <Section id="retention" title="How long we keep it">
          <p>
            Account and trading data is kept while your account exists. Records
            of deposits, withdrawals and resolved markets are kept after
            account closure for as long as needed to handle disputes and meet
            record-keeping obligations, then deleted. Rate-limiting data (IP
            hit counts) is short-lived and held in memory only.
          </p>
        </Section>

        <Section id="security" title="Security">
          <p>
            Passwords are hashed, transport is encrypted (HTTPS), database
            access is restricted by row-level security so users can only read
            their own records, and every movement of funds passes a manual
            human review before it executes. No system is unbreachable — if a
            breach ever affects your data, we will tell you what happened and
            what we are doing about it.
          </p>
        </Section>

        <Section id="your-rights" title="Your rights">
          <p>
            You can ask us at any time to show you the personal data we hold
            about you, correct it, export it, or delete your account and its
            data (subject to the retention of financial records described
            above). If you are in a jurisdiction with statutory privacy rights
            such as the GDPR, these requests are how we honour them. Email{' '}
            <span className="font-bold text-tx">support@call-it-now.com</span> — we
            answer within 30 days.
          </p>
        </Section>

        <Section id="children" title="Under 18s">
          <p>
            Callitnow is strictly 18+. We do not knowingly collect data from
            anyone under 18, and an account found to belong to a minor is
            closed and its data deleted.
          </p>
        </Section>

        <Section id="changes" title="Changes to this policy">
          <p>
            If we change what we collect or who processes it, we will update
            this page and announce material changes before they take effect.
            The date at the top always reflects the current version.
          </p>
        </Section>
      </div>

      <div className="rounded-2xl border border-line bg-surface-2 p-5 text-sm text-tx-sec">
        <p>
          Questions about your data? Email{' '}
          <span className="font-bold text-tx">support@call-it-now.com</span>, or read
          the{' '}
          <Link href="/terms" className="font-bold text-tx hover:text-green">
            terms of service
          </Link>{' '}
          for the rules of the platform itself.
        </p>
      </div>
    </div>
  );
}
