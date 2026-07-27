import type { Metadata } from 'next';
import { fetchPublicProfile, winRateOf } from '@/lib/cloud';
import ProfileView from './ProfileView';

/**
 * v25.40 — SERVER SHELL for the public profile.
 *
 * The page was a client component, so it could not export `generateMetadata`
 * and every /u/<username> link previewed with the generic root title — which
 * made "share my user" a link nobody would click. Same split as the market
 * page: this file is the server half, ProfileView.tsx is the interactive one.
 *
 * The read here is the same anon `public_profile()` the page uses, so nothing
 * reaches the preview that is not already on the page.
 */

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const name = decodeURIComponent(username).trim();
  const profile = await fetchPublicProfile(name);
  // Relative: resolved against `metadataBase` (app/layout.tsx) — see the same
  // note on the shared-bet shell.
  const image = `/api/og/profile/${encodeURIComponent(name)}`;

  if (!profile) return { title: 'Profile — callitnow' };

  const rate = winRateOf(profile);
  const title = `@${profile.username} — callitnow`;
  const description =
    profile.betsResolved > 0 && rate !== null
      ? `${Math.round(rate * 100)}% win rate across ${profile.betsResolved} settled call${
          profile.betsResolved === 1 ? '' : 's'
        } on callitnow.`
      : `@${profile.username} trades real-world events on callitnow.`;

  return {
    title,
    description,
    openGraph: {
      type: 'profile',
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

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  return <ProfileView username={decodeURIComponent(username).trim()} />;
}
