import type { Metadata } from 'next';
import { marketMeta } from '@/lib/marketMeta';
import MarketDetail from './MarketDetail';

/**
 * Server shell for the market page.
 *
 * The whole page used to be a client component, which meant it could not
 * export `generateMetadata` — so every market link previewed with the
 * generic root title, no matter which market it pointed at. The interactive
 * part is untouched and now lives in MarketDetail.tsx; this file exists so
 * the route has a server half at all.
 */

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const meta = await marketMeta(decodeURIComponent(id));
  if (!meta?.title) return { title: 'Market — callitnow' };

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

export default async function MarketPage({ params }: Props) {
  const { id } = await params;
  return <MarketDetail id={decodeURIComponent(id)} />;
}
