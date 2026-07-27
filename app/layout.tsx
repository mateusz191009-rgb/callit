import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';
import Providers from '@/components/common/Providers';
import AppShell from '@/components/layout/AppShell';

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://callitnow.app';
const SITE_DESCRIPTION =
  'Trade real-world events — or launch your own prediction market in seconds. No permission needed.';

export const metadata: Metadata = {
  // Required for the per-page openGraph images to resolve to absolute URLs.
  metadataBase: new URL(SITE_URL),
  title: 'callitnow — Make the call. Make the market.',
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'callitnow',
    title: 'callitnow — Make the call. Make the market.',
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'callitnow — Make the call. Make the market.',
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  // Installed to an iOS home screen this is what gives the standalone
  // window a dark status bar; without it the bar renders light-on-light
  // over the #0E1C28 chrome.
  appleWebApp: {
    capable: true,
    title: 'Callitnow',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#0E1C28',
  // Required before any env(safe-area-inset-*) resolves to a non-zero
  // value. Without it the bottom sheet's CTA and the support button sit
  // under the iPhone home indicator.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      {/* suppressHydrationWarning: browser extensions inject data-* attributes
          into <body> before React hydrates, causing spurious mismatch warnings. */}
      <body className="font-sans" suppressHydrationWarning>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
