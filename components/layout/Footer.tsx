'use client';

import Link from 'next/link';
import Logo from '@/components/brand/Logo';
import { useCallitStore } from '@/lib/store';
import { WALLETS } from '@/lib/wallets';
import type { DepositCurrency } from '@/lib/types';

const LINK_CLASSES = 'text-sm text-tx-sec transition-colors hover:text-tx';

/**
 * Hand-drawn currency monograms for the "We accept" row — simple white
 * glyphs on brand-colored circles (colors from lib/wallets.ts). Inline
 * SVG only, no external images. White glyph hex mirrors the brand SVG
 * convention in components/brand/Logo.tsx.
 */
const MONOGRAMS: Record<DepositCurrency, React.ReactNode> = {
  // ₿-style B: bold B with serif ticks poking out top and bottom.
  BTC: (
    <g fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5.6v12.8" />
      <path d="M9 5.6h4.3a2.6 2.6 0 0 1 0 5.2H9" />
      <path d="M9 10.8h5a2.8 2.8 0 0 1 0 5.6H9" />
      <path d="M10.7 3.4v2.2M13.3 3.4v2.2M10.7 18.4v2.2M13.3 18.4v2.2" />
    </g>
  ),
  // Ether diamond with the midline split.
  ETH: (
    <g fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.2 17.4 12 12 20.8 6.6 12 12 3.2Z" />
      <path d="M6.6 12h10.8" />
    </g>
  ),
  // Tether T.
  USDT: <path fill="#FFFFFF" d="M6 5.5h12v3.2h-4.4v9.8h-3.2V8.7H6z" />,
  // Dollar sign: S-curve with the vertical bar ends.
  USDC: (
    <g fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round">
      <path d="M15.6 8.4c-.6-1.2-1.9-1.9-3.6-1.9-2.1 0-3.6 1-3.6 2.7 0 1.6 1.4 2.3 3.6 2.8 2.2.5 3.6 1.2 3.6 2.8 0 1.7-1.5 2.7-3.6 2.7-1.7 0-3-.7-3.6-1.9" />
      <path d="M12 4.2v2.3M12 17.5v2.3" />
    </g>
  ),
  // BNB diamond with a solid diamond core.
  BNB: (
    <g>
      <path
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M12 6.8 17.2 12 12 17.2 6.8 12 12 6.8Z"
      />
      <path fill="#FFFFFF" d="M12 10.6 13.4 12 12 13.4 10.6 12 12 10.6Z" />
    </g>
  ),
  // Solana: three slanted bars, middle one mirrored.
  SOL: (
    <g fill="#FFFFFF">
      <path d="M8.1 5.8h9.6l-2.3 2.7H5.8z" />
      <path d="M5.8 10.6h9.6l2.3 2.7H8.1z" />
      <path d="M8.1 15.5h9.6l-2.3 2.7H5.8z" />
    </g>
  ),
};

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-black uppercase tracking-wide text-tx-mut">{title}</h3>
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
            <p className="text-sm font-extrabold text-tx">
              Make the call. Make the <span className="text-green">market</span>.
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

        {/* Accepted currencies */}
        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-6">
          <span className="text-xs font-black uppercase tracking-wide text-tx-mut">
            We accept
          </span>
          <ul className="flex flex-wrap items-center gap-2">
            {WALLETS.map((w) => (
              <li key={w.currency}>
                <span
                  title={`${w.label} (${w.currency})`}
                  className="flex h-7 w-7 items-center justify-center rounded-full"
                  style={{ backgroundColor: w.color }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-[18px] w-[18px]"
                    aria-hidden="true"
                  >
                    {MONOGRAMS[w.currency]}
                  </svg>
                  <span className="sr-only">{w.label}</span>
                </span>
              </li>
            ))}
          </ul>
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
