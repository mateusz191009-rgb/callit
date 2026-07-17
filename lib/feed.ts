import { getKalshiData } from './kalshi';
import { getDeepCategoryEvents, getPolymarketData } from './polymarket';
import type { BuiltinCategory, EventGroup, Market } from './types';

/**
 * The unified feed (v6) — ONE place that decides what the app shows.
 *
 * Merges Polymarket (lib/polymarket.ts) and Kalshi (lib/kalshi.ts) into a
 * single `{ markets, events }` payload, dedupes, and BALANCES the categories
 * so no hub is left empty.
 *
 * WHY THIS EXISTS (owner): "wie bestimmen wir was wir von der polymarket api
 * nehmen weil z.b sind bei crypto markets und events und bei pop culture
 * nicht so viele sachen und auch bei economy". Polymarket's trending feed
 * skews to whatever is hot today, which starves Crypto / Pop culture /
 * Economy. Two fixes, in order:
 *   1. Kalshi covers exactly those gaps — its feed is dense in Financials /
 *      Economics / Companies (-> economy) and Entertainment (-> pop-culture).
 *   2. Anything still short of MIN_PER_CATEGORY triggers a deeper per-tag
 *      Polymarket pull for THAT category only (getDeepCategoryEvents).
 *
 * Neither provider can throw: both return mocks or [] on failure, so the feed
 * degrades to whatever is reachable and never 500s the route.
 *
 * NOTE on the Kalshi side of the top-up: the brief asks for "the equivalent
 * Kalshi category query" for short categories. There isn't one — Kalshi's
 * `?category=` param is silently ignored upstream (verified live; see the
 * header of lib/kalshi.ts). It needs no equivalent: getKalshiData() already
 * pages the WHOLE open feed (~6000 markets) and every category is therefore
 * already in memory before balancing runs. There is nothing left to pull.
 */

/** Hubs we guarantee a minimum for (the brief's list; v9 adds the two hubs
 *  both providers carry natively: Tech & Science and World). */
const BALANCED_CATEGORIES: BuiltinCategory[] = [
  'politics',
  'sports',
  'football',
  'crypto',
  'economy',
  'tech-science',
  'world',
  'pop-culture',
];

/** Categories the Kalshi top-up may fill. 'custom' is included so Kalshi's
 *  Climate / Science / Health / World content has a home, but it is NOT in
 *  BALANCED_CATEGORIES: it is the catch-all, not a hub we promise to fill. */
const FILL_CATEGORIES: string[] = [...BALANCED_CATEGORIES, 'custom'];

/** Below this, a category gets a deeper per-tag pull. 8 fills the grid. */
const MIN_PER_CATEGORY = 8;

/**
 * How many markets a category is topped up TO with Kalshi.
 *
 * THIS CAP IS LOAD-BEARING, not taste. Kalshi's open feed is ~4700 usable
 * markets (3300 of them Elections). Merging it wholesale was measured at
 * **22.7 MB of JSON per response vs 2.8 MB for Polymarket alone**, on a
 * payload every client refetches every 90s, plus ~52 upsert round-trips per
 * 60s DB sync cycle. Uncapped "balance" is really a flood: it would bury the
 * hot Polymarket markets under thousands of long-dated Kalshi ones and blow
 * up the page. Polymarket stays the PRIMARY feed (all of it is kept, so the
 * v5 grid is unchanged); Kalshi fills what Polymarket is thin on — exactly
 * the owner's complaint (crypto / pop-culture / economy).
 */
const TARGET_PER_CATEGORY = 60;

/** Kalshi markets pulled into a category even when Polymarket already meets
 *  TARGET — the owner wants the two feeds MIXED everywhere, not Kalshi only
 *  where Polymarket happens to be short. Small enough to stay cheap. */
const KALSHI_FLOOR_PER_CATEGORY = 8;

/** Our category -> the Polymarket tag_slug that actually carries it.
 *  'football' is Polymarket's `soccer` tag (our Football hub IS soccer). */
const CATEGORY_TAG_SLUG: Record<string, string> = {
  politics: 'politics',
  sports: 'sports',
  football: 'soccer',
  crypto: 'crypto',
  economy: 'economy',
  'tech-science': 'tech',
  world: 'world',
  'pop-culture': 'pop-culture',
};

/** First occurrence of each id wins; input order is preserved. */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cross-provider semantic dedup (v7)                                   */
/* ------------------------------------------------------------------ */

/**
 * THE SAME REAL-WORLD QUESTION, LISTED ON BOTH PLATFORMS, SHOWED TWICE.
 *
 * Owner: "es dürfen sich die sachen von polymarket und kalshi auch nicht
 * doppeln weil das wäre bisschen blöd". `dedupeById` can't see it — the two
 * feeds id their rows differently (`pm-…` vs `k-…`), so identical questions
 * sail through as distinct markets.
 *
 * THE GOVERNING RULE IS "WHEN IN DOUBT, KEEP BOTH." A missed duplicate is a
 * cosmetic annoyance; a wrong merge silently deletes a real, tradeable market
 * from the entire app. Every threshold below is therefore tuned to under-merge,
 * and three independent guards must all agree before anything is dropped:
 *   1. the two rows come from DIFFERENT providers (see `dedupeCrossProvider`),
 *   2. their questions normalize to the same key OR score >= 0.8 Jaccard,
 *   3. their end dates are within 7 days.
 */

/** Both endDates must land inside this window — "…in 2026?" and "…in 2027?"
 *  are different questions no matter how alike they read. */
const DUP_END_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Token-overlap floor for a merge. Deliberately high. */
const DUP_JACCARD_MIN = 0.8;

/** Mirrors the `markets.length < 3` floor both mappers enforce when they build
 *  an EventGroup — an event dropped below it would render as a broken card. */
const MIN_EVENT_MARKETS = 3;

/** Dropped before comparison — pure grammar, carries no meaning. */
const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'be', 'in', 'on', 'by', 'before', 'after',
  'than', 'to', 'at', 'of', 'for',
]);

/** Month names -> their number, so "Dec 31" and "12/31" agree. */
const MONTHS: Record<string, string> = {
  january: '1', jan: '1', february: '2', feb: '2', march: '3', mar: '3',
  april: '4', apr: '4', may: '5', june: '6', jun: '6', july: '7', jul: '7',
  august: '8', aug: '8', september: '9', sep: '9', sept: '9', october: '10',
  oct: '10', november: '11', nov: '11', december: '12', dec: '12',
};

/**
 * House-style differences between the two feeds, collapsed to one spelling:
 * tickers vs names ("BTC" / "Bitcoin"), and the same noun in two parts of
 * speech ("…the Democratic presidential NOMINEE" / "…win the Democratic
 * presidential NOMINATION" — verified live, the two feeds phrase that exact
 * pair differently).
 *
 * ONLY UNAMBIGUOUS SYNONYMS BELONG HERE. Every entry is a licence to merge two
 * markets, so anything with a shade of meaning between the two words (say
 * "win" -> "be") is deliberately absent — that pair would collapse "Will
 * France WIN the World Cup?" into "Will France BE in the World Cup?".
 */
const ALIASES: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  doge: 'dogecoin',
  fomc: 'fed',
  nomination: 'nominee',
};

/** "$150,000" / "150k" / "1.5m" -> a plain integer string. */
function normalizeNumberToken(t: string): string {
  const m = /^\$?([0-9]+(?:\.[0-9]+)?)(k|m|b)?$/.exec(t);
  if (!m) return t;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  const n = parseFloat(m[1]) * mult;
  if (!Number.isFinite(n)) return t;
  // Round ONLY the multiplier forms ("1.5m" -> 1500000). Rounding a bare
  // decimal collapsed 4.6 / 4.9 / 5.2 to "5" — and an equal key is an
  // automatic merge, so threshold siblings (distinct, tradeable markets)
  // would silently delete each other.
  return String(m[2] ? Math.round(n) : n);
}

/** Light plural/verb-s stemmer: "cuts"/"rates" -> "cut"/"rate", which is what
 *  makes "Fed cuts rates in September?" and "Will the Fed cut rates in
 *  September?" normalize identically. Short words and -ss/-us/-is endings are
 *  left alone ("us", "gas", "this"). */
function stem(t: string): string {
  if (t.length <= 3 || !t.endsWith('s')) return t;
  if (/(ss|us|is)$/.test(t)) return t;
  return t.slice(0, -1);
}

/** The comparable token list for a question. */
export function normalizeTokens(q: string): string[] {
  let text = q
    .normalize('NFD')
    // Strip combining marks (é -> e), written as an escape rather than the
    // literal range: those characters are invisible in an editor, unreviewable,
    // and one careless re-save would silently break the normalizer.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  // Thousands separators, repeatedly: "1,150,000" -> "1150000". A loop rather
  // than a lookbehind — this file also has to be safe to run anywhere.
  let prev: string;
  do {
    prev = text;
    text = text.replace(/(\d),(\d{3})/g, '$1$2');
  } while (text !== prev);

  // Comparison operators carry the whole meaning of threshold markets:
  // ">25bps" and "25bps" are mutually exclusive outcomes of the same event
  // with the same end date. Stripping them as punctuation made the keys
  // byte-identical — an automatic merge that deletes a real market. Map
  // them to tokens BEFORE the punctuation pass so they survive.
  text = text
    .replace(/>=|≥/g, ' gte ')
    .replace(/<=|≤/g, ' lte ')
    .replace(/>/g, ' gt ')
    .replace(/</g, ' lt ');

  // Punctuation out; '$' and '.' survive for the number pass.
  text = text.replace(/[^a-z0-9$.]+/g, ' ');

  return text
    .split(' ')
    .map((t) => t.replace(/\.+$/, ''))
    .filter(Boolean)
    .map(normalizeNumberToken)
    .map((t) => MONTHS[t] ?? t)
    // STEM BEFORE ALIASING, so the alias table doesn't need a plural of every
    // entry ("nominations" -> "nomination" -> "nominee").
    .map(stem)
    .map((t) => ALIASES[t] ?? t)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/** Stable key for a question — equal keys are an automatic match. */
export function normalizeQuestion(q: string): string {
  return normalizeTokens(q).join(' ');
}

interface Norm {
  key: string;
  tokens: Set<string>;
  end: number;
}

function normOf(text: string, endDate: string): Norm {
  const tokens = normalizeTokens(text);
  return {
    key: tokens.join(' '),
    tokens: new Set(tokens),
    end: new Date(endDate).getTime(),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** All three guards. Anything unparseable or empty fails closed (keep both). */
function isDuplicate(a: Norm, b: Norm): boolean {
  if (!a.key || !b.key) return false;
  if (!Number.isFinite(a.end) || !Number.isFinite(b.end)) return false;
  if (Math.abs(a.end - b.end) > DUP_END_WINDOW_MS) return false;
  if (a.key === b.key) return true;
  return jaccard(a.tokens, b.tokens) >= DUP_JACCARD_MIN;
}

/** Higher volume wins; a tie goes to Polymarket (deeper liquidity). */
function winnerOf<T extends { volume: number; provider?: string }>(a: T, b: T): [T, T] {
  if (a.volume !== b.volume) return a.volume > b.volume ? [a, b] : [b, a];
  return (a.provider ?? 'polymarket') === 'kalshi' ? [b, a] : [a, b];
}

function isKalshi(x: { provider?: string }): boolean {
  return x.provider === 'kalshi';
}

export interface DedupeReport {
  mergedMarkets: number;
  mergedEvents: number;
  /** A few concrete merged pairs, for the admin/report surface. */
  examples: { kept: string; dropped: string; reason: 'key' | 'similar' }[];
}

/**
 * Drop rows that duplicate a row from the OTHER provider.
 *
 * Same-provider pairs are never compared: one feed does not list the same
 * question twice, but it very much ships whole families of deliberately
 * similar questions (every outcome of one event, every line of one game).
 * Restricting to cross-provider pairs removes that entire class of false
 * positive for free — "England vs Argentina: Team to Advance" and "…:
 * Moneyline" can't be considered against each other at all.
 *
 * EVENT MEMBERS ARE PROTECTED. An event's outcomes are load-bearing: both
 * mappers refuse to build an EventGroup with fewer than 3, so silently pulling
 * one out could leave a card that renders a question with half its answers
 * missing. A member is only ever dropped when its event can spare it;
 * otherwise the pair's other row is dropped instead, and if neither can go,
 * BOTH stay.
 */
function dedupeCrossProvider(
  markets: Market[],
  events: EventGroup[]
): { markets: Market[]; events: EventGroup[]; report: DedupeReport } {
  const report: DedupeReport = { mergedMarkets: 0, mergedEvents: 0, examples: [] };
  const dropped = new Set<string>();

  /* ---- events first: a losing event takes its whole market list with it ---- */
  const eventNorms = new Map<string, Norm>();
  for (const e of events) eventNorms.set(e.id, normOf(e.title, e.endDate));

  const polyEvents = events.filter((e) => !isKalshi(e.markets[0] ?? {}));
  const kalshiEvents = events.filter((e) => isKalshi(e.markets[0] ?? {}));
  const droppedEvents = new Set<string>();

  for (const k of kalshiEvents) {
    const kn = eventNorms.get(k.id);
    if (!kn) continue;
    for (const p of polyEvents) {
      if (droppedEvents.has(p.id)) continue;
      const pn = eventNorms.get(p.id);
      if (!pn || !isDuplicate(kn, pn)) continue;
      const [win, lose] = winnerOf(
        { ...k, provider: 'kalshi' as const },
        { ...p, provider: 'polymarket' as const }
      );
      droppedEvents.add(lose.id);
      for (const m of lose.markets) dropped.add(m.id);
      report.mergedEvents++;
      if (report.examples.length < 3) {
        report.examples.push({
          kept: win.title,
          dropped: lose.title,
          reason: kn.key === pn.key ? 'key' : 'similar',
        });
      }
      break; // this Kalshi event is settled
    }
  }

  const outEvents = events.filter((e) => !droppedEvents.has(e.id));

  /* ---- then markets ---- */
  const live = markets.filter((m) => !dropped.has(m.id));
  const norms = new Map<string, Norm>();
  for (const m of live) norms.set(m.id, normOf(m.question, m.endDate));

  // How many markets each surviving event still has — decremented as we drop.
  const eventSize = new Map<string, number>();
  for (const e of outEvents) eventSize.set(e.id, e.markets.length);

  const canDrop = (m: Market): boolean => {
    if (!m.eventId) return true;
    const size = eventSize.get(m.eventId);
    if (size === undefined) return true; // orphan — its event isn't rendered
    return size - 1 >= MIN_EVENT_MARKETS;
  };
  const commitDrop = (m: Market): void => {
    dropped.add(m.id);
    if (m.eventId && eventSize.has(m.eventId)) {
      eventSize.set(m.eventId, (eventSize.get(m.eventId) ?? 1) - 1);
    }
  };

  const polyMarkets = live.filter((m) => !isKalshi(m));
  const kalshiMarkets = live.filter(isKalshi);

  for (const k of kalshiMarkets) {
    if (dropped.has(k.id)) continue;
    const kn = norms.get(k.id);
    if (!kn) continue;
    for (const p of polyMarkets) {
      if (dropped.has(p.id)) continue;
      const pn = norms.get(p.id);
      if (!pn || !isDuplicate(kn, pn)) continue;

      const [win, lose] = winnerOf(k, p);
      // Prefer dropping the loser; fall back to the winner when the loser is
      // an event outcome its event can't spare; keep both if neither can go.
      const victim = canDrop(lose) ? lose : canDrop(win) ? win : null;
      if (!victim) break;
      commitDrop(victim);
      report.mergedMarkets++;
      if (report.examples.length < 3) {
        report.examples.push({
          kept: (victim.id === lose.id ? win : lose).question,
          dropped: victim.question,
          reason: kn.key === pn.key ? 'key' : 'similar',
        });
      }
      // Always stop here, whichever row went. If this Kalshi question also
      // matched a SECOND Polymarket row, those two Polymarket rows duplicate
      // each other — a same-provider call this pass deliberately does not make.
      // Merging both away on the strength of one Kalshi row would be exactly
      // the over-merge the conservative rule forbids.
      break;
    }
  }

  return {
    markets: live.filter((m) => !dropped.has(m.id)),
    events: outEvents.map((e) =>
      e.markets.some((m) => dropped.has(m.id))
        ? { ...e, markets: e.markets.filter((m) => !dropped.has(m.id)) }
        : e
    ),
    report,
  };
}

/** The last dedupe pass's numbers, for the admin surface. */
let lastDedupe: DedupeReport = { mergedMarkets: 0, mergedEvents: 0, examples: [] };

function countByCategory(markets: Market[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of markets) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  return counts;
}

function groupByCategory<T extends { category: string; volume: number }>(
  items: T[]
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const list = out.get(it.category);
    if (list) list.push(it);
    else out.set(it.category, [it]);
  }
  // Richest first — a top-up should add the markets people actually trade.
  for (const list of out.values()) list.sort((a, b) => b.volume - a.volume);
  return out;
}

/**
 * Unified feed payload. Shape is UNCHANGED (`{ markets, events }`) — the
 * /api/polymarket contract holds and every existing consumer keeps working.
 */
export async function getFeedData(): Promise<{ markets: Market[]; events: EventGroup[] }> {
  // Both providers are independently cached and independently fail-safe.
  const [poly, kalshi] = await Promise.all([getPolymarketData(), getKalshiData()]);

  // Polymarket is the PRIMARY feed and is kept whole — the existing grid,
  // ordering and category hubs are unaffected by anything below.
  let events: EventGroup[] = [...poly.events];
  // Event outcomes first — they win the dedupe because only they carry
  // eventId/groupId/groupLabel/inPlayOk. See getPolymarketData().
  let markets: Market[] = dedupeById([
    ...poly.events.flatMap((e) => e.markets),
    ...poly.markets,
  ]);

  // --- Kalshi top-up, per category, bounded by TARGET_PER_CATEGORY ---
  const kEventsByCat = groupByCategory(kalshi.events);
  // Only STANDALONE Kalshi markets here: an event's outcomes come in with
  // their event, so pulling them individually would orphan them from the
  // event card they belong to.
  const kStandaloneByCat = groupByCategory(kalshi.markets.filter((m) => !m.eventId));

  const polyCounts = countByCategory(markets);

  for (const cat of FILL_CATEGORIES) {
    // Fill the deficit up to TARGET, but always take at least the floor so
    // both feeds are visible in every hub.
    let need = Math.max(
      TARGET_PER_CATEGORY - (polyCounts.get(cat) ?? 0),
      KALSHI_FLOOR_PER_CATEGORY
    );

    // Events first — a multi-outcome card is richer than N loose Yes/No rows.
    for (const ev of kEventsByCat.get(cat) ?? []) {
      if (need <= 0) break;
      events.push(ev);
      markets.push(...ev.markets);
      need -= ev.markets.length;
    }
    for (const m of kStandaloneByCat.get(cat) ?? []) {
      if (need <= 0) break;
      markets.push(m);
      need--;
    }
  }

  events = dedupeById(events);
  markets = dedupeById(markets);

  // --- v7: the SAME question listed on both platforms shows ONCE ---
  // Runs after the merge (so both feeds are present) and BEFORE the shortfall
  // check below, so a category thinned by dedup can still be topped up.
  const deduped = dedupeCrossProvider(markets, events);
  markets = deduped.markets;
  events = deduped.events;
  lastDedupe = deduped.report;

  // --- guarantee: no built-in hub below MIN_PER_CATEGORY ---
  const counts = countByCategory(markets);
  const short = BALANCED_CATEGORIES.filter(
    (c) => (counts.get(c) ?? 0) < MIN_PER_CATEGORY
  );

  if (short.length > 0) {
    const slugs = short.map((c) => CATEGORY_TAG_SLUG[c]).filter(Boolean);
    const extra = await getDeepCategoryEvents(slugs);
    if (extra.length > 0) {
      events = dedupeById([...events, ...extra]);
      markets = dedupeById([...markets, ...extra.flatMap((e) => e.markets)]);
    }
  }

  // Volume desc. Sorting the whole array also sorts every category's
  // subsequence by volume desc (what the brief asks for) while keeping one
  // coherent global order for the home grid.
  markets.sort((a, b) => b.volume - a.volume);
  events.sort((a, b) => b.volume - a.volume);

  return { markets, events };
}

/* ------------------------------------------------------------------ */
/* Stats (admin)                                                        */
/* ------------------------------------------------------------------ */

export interface FeedStats {
  /** Markets per category, e.g. { politics: 42, crypto: 11 }. */
  categories: Record<string, number>;
  /** Markets per provider, e.g. { polymarket: 210, kalshi: 96 }. */
  providers: Record<string, number>;
  /** Built-in hubs still under MIN_PER_CATEGORY after balancing. */
  shortCategories: string[];
  /** Built-in hubs with NOTHING in them — should always be empty. */
  emptyCategories: string[];
  totalMarkets: number;
  totalEvents: number;
  eventsWithGroups: number;
  inPlayMarkets: number;
  /** v7 — cross-provider duplicates removed on the last feed build. Only
   *  populated by `feedStats()`; `computeFeedStats` is pure and cannot know. */
  dedupe?: DedupeReport;
}

/** Pure — derives the stats from an already-fetched payload. */
export function computeFeedStats(data: {
  markets: Market[];
  events: EventGroup[];
}): FeedStats {
  const categories: Record<string, number> = {};
  const providers: Record<string, number> = {};
  let inPlayMarkets = 0;

  for (const m of data.markets) {
    categories[m.category] = (categories[m.category] ?? 0) + 1;
    const p = m.provider ?? 'polymarket';
    providers[p] = (providers[p] ?? 0) + 1;
    if (m.inPlayOk) inPlayMarkets++;
  }

  return {
    categories,
    providers,
    shortCategories: BALANCED_CATEGORIES.filter(
      (c) => (categories[c] ?? 0) < MIN_PER_CATEGORY
    ),
    emptyCategories: BALANCED_CATEGORIES.filter((c) => !categories[c]),
    totalMarkets: data.markets.length,
    totalEvents: data.events.length,
    eventsWithGroups: data.events.filter((e) => e.groups && e.groups.length > 0).length,
    inPlayMarkets,
  };
}

/** Convenience for the admin page — fetches the (cached) feed and reports on
 *  it. Providers are memoized, so calling this is cheap. */
export async function feedStats(): Promise<FeedStats> {
  const data = await getFeedData();
  return { ...computeFeedStats(data), dedupe: lastDedupe };
}
