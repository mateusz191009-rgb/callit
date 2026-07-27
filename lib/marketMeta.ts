import { getCachedFeedData } from './feed';
import { serviceSupabase } from './serverSupabase';

/**
 * Server-side lookup of the one thing a shared link needs: what this page is
 * about.
 *
 * Every market, event, category and profile page used to be a client
 * component, so none of them could export `generateMetadata` and every one
 * of them inherited the root title. In practice that meant a link to a $2M
 * election market and a link to a Tuesday-night tennis prop previewed
 * identically, everywhere they were pasted.
 *
 * NO NEW UPSTREAM CALL. `getCachedFeedData()` is the same in-memory feed the
 * API routes already serve, so this costs a map lookup. Community markets
 * are not in it and come from the DB instead; both misses degrade to the
 * generic title rather than blocking the render.
 */

export interface PageMeta {
  title: string;
  description?: string;
  /** Remote icon, used as the OG image when the market has one. */
  image?: string;
}

/** Trim to something that reads as a description rather than a wall. */
function clip(s: string | undefined | null, max = 200): string | undefined {
  const t = s?.trim();
  if (!t) return undefined;
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export async function marketMeta(id: string): Promise<PageMeta | null> {
  try {
    const data = await getCachedFeedData();
    const m =
      data.markets.find((x) => x.id === id) ??
      data.events.flatMap((e) => e.markets).find((x) => x.id === id);
    if (m) {
      return {
        title: m.question,
        description: clip(m.description) ?? clip(`Trade this market on Callitnow.`),
        image: m.icon,
      };
    }
  } catch {
    /* fall through to the DB, then to the generic title */
  }

  if (!serviceSupabase) return null;
  try {
    const { data } = await serviceSupabase
      .from('markets')
      .select('question, description, icon')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return {
      title: String(data.question ?? ''),
      description: clip(data.description as string | null),
      image: (data.icon as string | null) ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function eventMeta(id: string): Promise<PageMeta | null> {
  try {
    const data = await getCachedFeedData();
    const e = data.events.find((x) => x.id === id);
    if (!e) return null;
    // An event has no prose of its own, so the description is built from
    // what it actually contains — which is the useful thing to preview.
    const count = e.markets.length;
    return {
      title: e.title,
      description: `${count} outcome${count === 1 ? '' : 's'} · live odds on Callitnow.`,
      image: e.icon,
    };
  } catch {
    return null;
  }
}
