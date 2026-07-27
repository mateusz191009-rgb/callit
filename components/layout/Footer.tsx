'use client';

import Link from 'next/link';
import Logo from '@/components/brand/Logo';
import { useCallitStore } from '@/lib/store';


const LINK_CLASSES = 'text-sm text-tx-sec transition-colors hover:text-tx';

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-tx-mut">{title}</h3>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

/**
 * Site footer: brand blurb, link columns, accepted-currency tiles and the
 * legal bottom bar. Lives inside <main> so it aligns with the content
 * area next to the sidebar.
 */
export default function Footer() {
  const setHomeTab = useCallitStore((s) => s.setHomeTab);

  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        {/* Link columns */}
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <Link href="/" aria-label="callitnow — home" className="inline-flex">
              <Logo iconSize={26} textClassName="text-[20px]" />
            </Link>
            <p className="max-w-xs text-sm text-tx-sec">
              Prediction markets on politics, sports, crypto and culture — trade
              the news or launch your own market in seconds.
            </p>
          </div>

          <FooterColumn title="Markets">
            <li>
              <Link href="/" className={LINK_CLASSES}>
                Home
              </Link>
            </li>
            <li>
              <Link href="/" className={LINK_CLASSES} onClick={() => setHomeTab('trending')}>
                Trending
              </Link>
            </li>
            <li>
              <Link href="/create" className={LINK_CLASSES}>
                Create a market
              </Link>
            </li>
            <li>
              <Link href="/portfolio" className={LINK_CLASSES}>
                Portfolio
              </Link>
            </li>
          </FooterColumn>

          <FooterColumn title="Company">
            <li>
              <Link href="/about" className={LINK_CLASSES}>
                About
              </Link>
            </li>
            <li>
              <Link href="/help" className={LINK_CLASSES}>
                Help center
              </Link>
            </li>
            <li>
              <Link href="/settings" className={LINK_CLASSES}>
                Settings
              </Link>
            </li>
            <li>
              <a
                href="/docs/RESOLUTION.md"
                target="_blank"
                rel="noopener"
                className={LINK_CLASSES}
              >
                Resolution docs
              </a>
            </li>
            <li>
              <Link href="/reserves" className={LINK_CLASSES}>
                Proof of reserves
              </Link>
            </li>
          </FooterColumn>

          <FooterColumn title="Legal">
            <li>
              <Link href="/terms" className={LINK_CLASSES}>
                Terms of service
              </Link>
            </li>
            <li>
              <Link href="/privacy" className={LINK_CLASSES}>
                Privacy policy
              </Link>
            </li>
            <li>
              <Link href="/about#legal" className={LINK_CLASSES}>
                Legal status
              </Link>
            </li>
            <li>
              {/* Responsible trading is a section of the terms, not its own
                  page — link straight to it. */}
              <Link href="/terms#responsible" className={LINK_CLASSES}>
                Responsible trading
              </Link>
            </li>
          </FooterColumn>
        </div>

        {/* Bottom bar */}
        <div className="mt-6 flex flex-col gap-1.5 border-t border-line pt-6 text-xs text-tx-mut sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <span>&copy; 2026 callitnow</span>
          <span className="hidden sm:inline" aria-hidden>
            &middot;
          </span>
          {/* The app pulls Global markets from BOTH feeds — naming only
              Polymarket under-credits Kalshi. This is the ONLY place either
              brand is named; keep attribution here, not in the UI copy. */}
          <span>Market data via the Polymarket and Kalshi public APIs</span>
          <span className="hidden sm:inline" aria-hidden>
            &middot;
          </span>
          <span>18+ Trade responsibly.</span>
        </div>
      </div>
    </footer>
  );
}
