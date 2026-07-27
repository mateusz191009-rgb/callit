import type { Metadata } from 'next';
import { eventMeta } from '@/lib/marketMeta';
import EventDetail from './EventDetail';

/** Server shell for the event page — see app/market/[id]/page.tsx. */

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const meta = await eventMeta(decodeURIComponent(id));
  if (!meta?.title) return { title: 'Event — callitnow' };

  const title = `${meta.title} — callitnow`;
  return {
    title,
    description: meta.description,
    openGraph: {
      title,
      description: meta.description,
      type: 'article',
      images: meta.image ? [{ url: meta.image }] : undefined,
    },
    twitter: {
      card: meta.image ? 'summary_large_image' : 'summary',
      title,
      description: meta.description,
    },
  };
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  return <EventDetail id={decodeURIComponent(id)} />;
}
