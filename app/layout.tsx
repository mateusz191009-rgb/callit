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

export const metadata: Metadata = {
  title: 'callitnow — Make the call. Make the market.',
  description:
    'Trade real-world events — or launch your own prediction market in seconds. No permission needed.',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0E1C28',
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
