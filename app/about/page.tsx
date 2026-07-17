import type { Metadata } from 'next';
import Link from 'next/link';
import { Globe, Scale, TrendingUp, Users } from 'lucide-react';
import { RESTRICTED_COUNTRIES } from '@/lib/geo';

export const metadata: Metadata = {
  title: 'About — callitnow',
  description:
    'What Callitnow is, how prediction markets work, our legal status and where the platform is available.',
};

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

/** The three-step "how it works" cards under the intro. */
const HOW_IT_WORKS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <TrendingUp className="h-5 w-5" aria-hidden />,
    title: 'Prices are probabilities',
    body: 'Every market is a yes/no question. Shares trade between 1¢ and 99¢, and the price is the market’s live estimate of how likely the event is.',
  },
  {
    icon: <Users className="h-5 w-5" aria-hidden />,
    title: 'You trade the crowd',
    body: 'Callitnow is peer-to-peer: you trade against the market, never against the house. We have no stake in which side wins.',
  },
  {
    icon: <Scale className="h-5 w-5" aria-hidden />,
    title: 'Winners get $1 a share',
    body: 'When a market resolves, every winning share pays exactly $1 and every losing share pays nothing. Simple, and the math always adds up.',
  },
];

export default function AboutPage() {
  const restricted = Object.values(RESTRICTED_COUNTRIES).sort();

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-tx">About Callitnow</h1>
        <p className="mt-3 text-sm leading-relaxed text-tx-sec">
          Callitnow is a prediction market: a place where the odds of real-world
          events — elections, sports, crypto prices, culture — are set by people
          putting real money behind their view, not by pundits. Make the call,
          make the market.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {HOW_IT_WORKS.map((item) => (
          <div key={item.title} className="rounded-2xl border border-line bg-surface-2 p-5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-green/10 text-green">
              {item.icon}
            </div>
            <h3 className="mt-3 text-sm font-extrabold text-tx">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-tx-sec">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="space-y-7">
        <Section id="why" title="Why prediction markets">
          <p>
            A forecast is cheap talk until someone has to pay for being wrong.
            Prediction markets aggregate what thousands of people actually
            believe — weighted by how much they are willing to stake on it —
            into a single live number. That number has repeatedly proven to be
            one of the best forecasts available for elections, sports and
            world events.
          </p>
          <p>
            On Callitnow you can trade markets sourced from global feeds, or
            launch your own market in seconds and let the crowd price it. How
            resolution, fees, deposits and withdrawals work is spelled out in
            the{' '}
            <Link href="/terms" className="font-bold text-tx hover:text-green">
              terms of service
            </Link>{' '}
            and the{' '}
            <Link href="/help" className="font-bold text-tx hover:text-green">
              help center
            </Link>
            .
          </p>
        </Section>

        <Section id="legal" title="Legal status — why Callitnow holds no gambling license">
          <p>
            Callitnow does not hold a traditional gambling license, in the same way
            platforms like Polymarket do not. Our position is that a prediction
            market is not house-banked gambling: there is no house, no bookmaker
            and no odds set against you. Callitnow is never the counterparty to
            your trade — you buy and sell event shares peer-to-peer with other
            users, and the platform&apos;s role is matching trades and settling
            outcomes. Gambling licenses exist to regulate operators who profit
            when their customers lose; we do not.
          </p>
          <p>
            We are transparent about the flip side: regulators do not all agree
            with that view. Financial and gambling authorities in several
            countries — including Spain, the Czech Republic, the Netherlands and
            Germany — classify decentralized event contracts on platforms like
            Polymarket as unlicensed gambling. Where a regulator has taken that
            position, we respect it rather than argue with it:
          </p>
          <div className="rounded-2xl border border-line bg-surface-2 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green/10 text-green">
                <Globe className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-tx">
                  Where you can&apos;t open an account
                </h3>
                <p className="mt-1 text-xs text-tx-mut">
                  Anyone, anywhere can browse markets and prices. But if you are
                  connecting from one of these countries, you cannot create an
                  account — and without an account you cannot trade, deposit or
                  withdraw.
                </p>
              </div>
            </div>
            <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {restricted.map((name) => (
                <li key={name} className="flex items-center gap-2 text-sm text-tx-sec">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                  {name}
                </li>
              ))}
            </ul>
          </div>
          <p>
            This restriction is enforced when you sign up, based on the country
            you connect from. Attempting to evade it (for example with a VPN) is
            a breach of the{' '}
            <Link href="/terms" className="font-bold text-tx hover:text-green">
              terms
            </Link>{' '}
            and can cost you your account and any balance built while evading
            it. Nothing on this page is legal advice — it is your responsibility
            to confirm that using a prediction market is legal where you live.
          </p>
        </Section>

        <Section id="trust" title="What we do to earn trust">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-bold text-tx">Proof of reserves</span> — user
              balances are backed 1:1 and you can check the numbers yourself on
              the{' '}
              <Link href="/reserves" className="font-bold text-tx hover:text-green">
                reserves page
              </Link>
              .
            </li>
            <li>
              <span className="font-bold text-tx">Human-reviewed money movement</span>{' '}
              — every deposit and withdrawal is reviewed by a person before
              funds move.
            </li>
            <li>
              <span className="font-bold text-tx">Written resolution rules</span>{' '}
              — every market states how it resolves before you trade it, and
              disputed markets are voided and refunded rather than guessed.
            </li>
            <li>
              <span className="font-bold text-tx">18+ only, no credit</span> — you
              must be an adult, you trade only what you deposit, and there is no
              leverage and no borrowing.
            </li>
          </ul>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            Questions, press, or a market idea we should feature? Email{' '}
            <span className="font-bold text-tx">support@call-it-now.com</span>. For
            how we handle your data, read the{' '}
            <Link href="/privacy" className="font-bold text-tx hover:text-green">
              privacy policy
            </Link>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
