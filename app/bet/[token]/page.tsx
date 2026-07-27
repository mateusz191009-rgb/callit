import type { Metadata } from 'next';
import { betVerdict, fetchSharedBet, sharedSideLabel } from '@/lib/betShare';
import BetShareView from './BetShareView';

/**
 * v25.40 — SERVER SHELL for a shared bet slip.
 *
 * A share link only works if it PREVIEWS: pasted into a group chat it has to
 * unfurl as the card, not as the generic site title. That needs
 * `generateMetadata`, which needs a server component — same split the market
 * page already uses (app/market/[id]/page.tsx). The interactive half is
 * BetShareView.
 *
 * The read is anon (`public_bet_share`), so this renders for a logged-out
 * recipient — the entire point of the feature.
 */

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const bet = await fetchSharedBet(decodeURIComponent(token));
  // Relative on purpose: Next resolves it against the `metadataBase` set in
  // app/layout.tsx, so the absolute URL an unfurl needs comes from the one
  // place the app already configures its own host.
  const image = `/api/og/bet/${encodeURIComponent(token)}`;

  if (!bet) {
    return {
      title: 'Shared call — callitnow',
      // A dead token must not be indexed: the link still resolves, it just has
      // nothing behind it.
      robots: { index: false, follow: false },
    };
  }

  const v = betVerdict(bet);
  const side = sharedSideLabel(bet);
  const question = bet.question ?? 'a market';
  const title = `@${bet.username} called ${side} — callitnow`;
  const description =
    v.outcome === 'won'
      ? `${side} on "${question}" — paid ${v.multiple.toFixed(2)}x.`
      : v.outcome === 'lost'
        ? `${side} on "${question}" — did not come in.`
        : v.outcome === 'void'
          ? `${side} on "${question}" — the market was cancelled and stakes refunded.`
          : `${side} on "${question}" — live now, ${v.multiple.toFixed(2)}x if it comes in.`;

  return {
    title,
    description,
    // Shared bets are personal links, not site content. They resolve for
    // anyone who has one and stay out of search results.
    robots: { index: false, follow: false },
    openGraph: {
      type: 'article',
      title,
      description,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function SharedBetPage({ params }: Props) {
  const { token } = await params;
  return <BetShareView token={decodeURIComponent(token)} />;
}
