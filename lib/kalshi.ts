import { isLiteralYesNo, isTimeBoxedQuestion } from './polymarket';
import type { Category, EventGroup, Market } from './types';
import { clampPrice, generatePriceHistory } from './utils';

/**
 * Kalshi provider (v6) — the second feed behind `lib/feed.ts`.
 *
 * Kalshi's trade-api v2 is PUBLIC and needs no auth for read endpoints. We
 * only ever READ it: prices/metadata are mirrored into our own book and every
 * trade is filled against OUR pool. We never place a bet on their platform.
 *
 * Markets are mirrored as `source: 'polymarket'` (the TS union is unchanged
 * and means "an external feed owns this row" — it drives the "Global" badge)
 * and distinguished by `provider: 'kalshi'`, which is what the settlement
 * poller branches on. See CONTRACTS2.md v6.
 *
 * REQUEST BUDGET (be polite — this is an unauthenticated public API):
 *   PAGES (3) + EXTRA_SERIES (3) = 6 requests per refresh, memoized for
 *   CACHE_MS (5 min) => ~6 req / 5 min, exactly the ceiling. The whole feed
 *   is fetched once and split by category in memory (see the note below).
 *
 * VERIFIED LIVE (2026-07-15) against api.elections.kalshi.com:
 *   - `?category=Sports` on /events is SILENTLY IGNORED — the endpoint returns
 *     the same first page for every value, in every casing, and for
 *     `categories=` too. There is no per-category events query to fan out
 *     over; we page through the feed with `cursor` and bucket by
 *     `event.category` locally.
 *   - `?series_ticker=` on /events IS honored (one value only — a comma list
 *     or a repeated param both return 0 events). This is the ONLY way to
 *     reach some content: see EXTRA_SERIES below.
 *   - `limit` is capped at 200 (300 -> `bad_request`).
 *   - `liquidity_dollars` is "0.0000" on every market, so it is useless as a
 *     depth signal; `open_interest_fp` is the real one (brief agrees).
 *   - `volume_fp` / `open_interest_fp` are decimal STRINGS ("112506.83"),
 *     not integers — parse them as floats, never as fixed-point ints.
 */

const BASE_URL =
  'https://api.elections.kalshi.com/trade-api/v2/events?limit=200&status=open&with_nested_markets=true';

/**
 * Pages of 200 events pulled per refresh (3 => ~600 events / ~3600 markets).
 *
 * The walk is dominated by Elections (~60% of it) and the balancer only ever
 * takes ~60 markets per category, so paging deeper buys nothing and costs
 * requests we'd rather spend on EXTRA_SERIES below. Verified: 3 pages still
 * fills every category the walk is responsible for.
 */
const PAGES = 3;

/**
 * Series the cursor walk NEVER reaches, fetched explicitly.
 *
 * WHY (verified live 2026-07-15): a full 12-page / 2400-event walk of
 * /events returns ZERO markets in Kalshi's `Crypto` category — the daily and
 * yearly crypto series simply are not in that listing. Kalshi HAS ~254 open
 * Crypto series (`/series?category=Crypto`), they are only reachable per
 * `series_ticker`. Since crypto thinness is a named owner complaint, the
 * flagship long-dated ones are pulled by hand.
 *
 * Curated deliberately: the same-day series (KXBTCD/KXETHD — "BTC price on
 * Jul 17 at 5pm", 210 markets) were REJECTED. They expire within hours, so
 * they'd churn the DB mirror daily and fill the Crypto hub with rows that are
 * dead by tomorrow. These three are year-horizon, multi-outcome, and read
 * like a proper event card.
 */
const EXTRA_SERIES = ['KXBTCMAXY', 'KXETHMAXY', 'KXBTCMINY'] as const;

/** Per-request timeout. Matches the Polymarket provider. */
const REQUEST_TIMEOUT_MS = 3000;

/** Whole-refresh budget — a slow upstream must never hold the route open for
 *  PAGES x REQUEST_TIMEOUT_MS. We keep whatever pages arrived before this. */
const TOTAL_BUDGET_MS = 9000;

/** 5 minutes — mirrors CATEGORY_CACHE_MS in lib/polymarket.ts. */
const CACHE_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* Raw upstream shapes (only the fields we actually read)              */
/* ------------------------------------------------------------------ */

interface KalshiRawMarket {
  ticker?: unknown;
  title?: unknown;
  yes_sub_title?: unknown;
  no_sub_title?: unknown;
  market_type?: unknown;
  status?: unknown;
  result?: unknown;
  rules_primary?: unknown;
  close_time?: unknown;
  /** v7 — when the market opened for trading. Verified live: ISO-8601. */
  open_time?: unknown;
  last_price_dollars?: unknown;
  yes_bid_dollars?: unknown;
  yes_ask_dollars?: unknown;
  volume_fp?: unknown;
  open_interest_fp?: unknown;
  mve_collection_ticker?: unknown;
}

interface KalshiRawEvent {
  event_ticker?: unknown;
  series_ticker?: unknown;
  title?: unknown;
  sub_title?: unknown;
  category?: unknown;
  markets?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/* ------------------------------------------------------------------ */
/* Multivariate / combo markets — SKIP                                 */
/* ------------------------------------------------------------------ */

/**
 * Kalshi "multivariate event collections" are combo bets — a single market
 * whose YES needs several independent legs to all land ("yes Lakers, yes
 * over 220.5"). They are unreadable as a standalone Yes/No card and they
 * price nothing our UI can explain, so they are dropped outright.
 *
 * Detected three ways (any hit = skip), per the brief:
 *   1. ticker prefixed `KXMVE`
 *   2. `mve_collection_ticker` present
 *   3. a title enumerating legs: "yes X, yes Y"
 *
 * NOTE (verified 2026-07-15): the live open feed currently contains ZERO of
 * these across ~6000 markets. The guard is kept anyway — it is nearly free
 * and the collections come and go with their parent series.
 */
const MVE_TITLE_RE = /\byes\b[^,]*,\s*\byes\b/i;

function isMultivariate(m: KalshiRawMarket): boolean {
  const ticker = str(m.ticker);
  if (ticker.startsWith('KXMVE')) return true;
  if (str(m.mve_collection_ticker)) return true;
  return MVE_TITLE_RE.test(str(m.title));
}

/* ------------------------------------------------------------------ */
/* In-play                                                             */
/* ------------------------------------------------------------------ */

/**
 * Kalshi live-game series. `in_play_ok` is the ONLY thing that lets a trade
 * land after `end_date` (for 4h — see place_trade), so this stays deliberately
 * strict: a market qualifies only if it is an outcome of a REAL game.
 *
 * VERIFIED LIVE (2026-07-15): Kalshi's open feed exposes NO per-game markets
 * at all. Every one of its 69 Sports events is a future/prop — championship
 * winners, retirements, MLB debut dates, "Championships before 2030" — and
 * not one event title contains "vs". So this predicate currently returns
 * false for the entire Kalshi feed, and `inPlayOk` is false on every Kalshi
 * market. That is the CORRECT outcome, not a gap: nothing in the feed is a
 * live game, so nothing earns post-expiry trading. If Kalshi later ships
 * per-game series (they are conventionally tickered `…GAME`/`…MATCH`), they
 * are picked up here — and each one still has to clear the time-boxed check
 * below before it is allowed to trade in-play.
 */
const GAME_SERIES_RE = /(GAME|MATCH)$/;

function isKalshiGameEvent(ev: KalshiRawEvent): boolean {
  if (str(ev.category) !== 'Sports') return false;
  return GAME_SERIES_RE.test(str(ev.series_ticker));
}

/* ------------------------------------------------------------------ */
/* Category mapping                                                    */
/* ------------------------------------------------------------------ */

/** Kalshi `event.category` -> our built-in hub. Verified live: World,
 *  Elections, Climate and Weather, Science and Technology, Politics, Sports,
 *  Financials, Social, Entertainment, Economics, Health, Companies,
 *  Transportation — plus `Crypto`, which the /events walk never returns but
 *  the EXTRA_SERIES pull does. Anything unlisted falls through to 'custom'. */
const CATEGORY_MAP: Record<string, Category> = {
  Elections: 'politics',
  Politics: 'politics',
  Sports: 'sports',
  Financials: 'economy',
  Economics: 'economy',
  Companies: 'economy',
  Entertainment: 'pop-culture',
  Crypto: 'crypto',
  // v9 — the two hubs Kalshi feeds natively that used to drown in 'custom'.
  // Climate/Health/Transportation stay unmapped on purpose: local-weather
  // and niche rows would dilute the hubs, 'custom' is where they belong.
  'Science and Technology': 'tech-science',
  World: 'world',
};

/** Crypto hints inside the money categories — Kalshi files BTC/ETH markets
 *  under Financials, but they belong in our Crypto hub. */
const CRYPTO_HINTS = [
  'bitcoin',
  'btc',
  'ethereum',
  'crypto',
  'solana',
  'dogecoin',
  'stablecoin',
  'blockchain',
];

/**
 * Soccer hints inside Sports -> our Football hub (which IS soccer: see
 * TAG_CATEGORIES in lib/polymarket.ts).
 *
 * DELIBERATE DEVIATION FROM THE BRIEF: the brief lists a bare `football`
 * hint. On Kalshi that word is AMERICAN football — verified live, KXSBHOST
 * is titled "Who will host the 2031 Pro Football Championship?" (the Super
 * Bowl) and KXSORONDO is "…Summer Olympics Flag Football". Routing those to
 * the soccer hub would be wrong, so bare 'football' is NOT a hint here; the
 * unambiguous competition names below are. American football keeps falling
 * through to the Sports hub, which is where the owner expects it.
 */
const FOOTBALL_HINTS = [
  'soccer',
  'fifa',
  'premier league',
  'uefa',
  'champions league',
  'copa america',
  'la liga',
  'bundesliga',
  'serie a',
  'ligue 1',
  'world cup',
];

function mapKalshiCategory(ev: KalshiRawEvent, marketTitle: string): Category {
  const raw = str(ev.category);
  const base = CATEGORY_MAP[raw] ?? 'custom';
  const hay = `${str(ev.title)} ${str(ev.series_ticker)} ${marketTitle}`.toLowerCase();

  if (base === 'sports' && FOOTBALL_HINTS.some((h) => hay.includes(h))) {
    return 'football';
  }
  if (base === 'economy' && CRYPTO_HINTS.some((h) => hay.includes(h))) {
    return 'crypto';
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

/**
 * One Kalshi market -> our `Market`, or null when it is unusable.
 *
 * Dropped: multivariate combos, non-binary types, anything not 'active'
 * (finalized/settled already have a `result`), and rows we cannot price or
 * date. Price = `last_price_dollars`, falling back to the bid/ask mid.
 */
function mapKalshiMarket(
  raw: unknown,
  ev: KalshiRawEvent,
  opts: { eventId?: string; category?: Category } = {}
): Market | null {
  try {
    const m = raw as KalshiRawMarket;
    const ticker = str(m.ticker);
    const question = str(m.title);
    const endDate = str(m.close_time);
    if (!ticker || !question || !endDate) return null;
    if (!Number.isFinite(new Date(endDate).getTime())) return null;

    if (str(m.market_type) !== 'binary') return null;
    if (str(m.status) !== 'active') return null;
    if (str(m.result)) return null; // already decided upstream
    if (isMultivariate(m)) return null;

    // last trade wins; otherwise the mid of the book. Kalshi quotes dollars
    // as decimal strings ("0.1200").
    let price = num(m.last_price_dollars) ?? NaN;
    if (!Number.isFinite(price) || price <= 0) {
      const bid = num(m.yes_bid_dollars);
      const ask = num(m.yes_ask_dollars);
      if (bid !== undefined && ask !== undefined && (bid > 0 || ask > 0)) {
        price = (bid + ask) / 2;
      }
    }
    if (!Number.isFinite(price) || price <= 0) return null;
    price = clampPrice(price);

    const id = `k-${ticker}`;
    const category = opts.category ?? mapKalshiCategory(ev, question);

    // In-play: a real live game AND not a question that resolves DURING the
    // match. Kalshi currently ships no game series, so this is false feed-wide
    // (see isKalshiGameEvent). Never infer in-play from the category.
    const shortName = str(m.yes_sub_title).trim() || undefined;
    const inPlayOk =
      isKalshiGameEvent(ev) && !isTimeBoxedQuestion(question, shortName);

    // Side display labels — CONSERVATIVE, wrong labels are worse than Yes/No.
    // VERIFIED LIVE (2026-07-16, 1236 open markets): yes_sub_title and
    // no_sub_title are IDENTICAL on 98% of markets — both carry the OUTCOME
    // descriptor ('Klaus Iohannis', 'Mars'), which is already `shortName`
    // above, NOT a pair of side names. Only 23 markets ship a genuine pair
    // ('By 2030' / 'Not By 2030'). So labels are set ONLY when both subtitles
    // exist, genuinely differ, and neither is a literal yes/no; everything
    // else keeps the default Yes/No wording. A lone yes_sub_title never
    // qualifies either — it always equals the title-derived shortName here.
    const ySub = str(m.yes_sub_title).trim();
    const nSub = str(m.no_sub_title).trim();
    const hasSidePair =
      Boolean(ySub && nSub) &&
      ySub.toLowerCase() !== nSub.toLowerCase() &&
      !isLiteralYesNo(ySub) &&
      !isLiteralYesNo(nSub);
    const yesLabel = hasSidePair ? ySub : undefined;
    const noLabel = hasSidePair ? nSub : undefined;

    // v7 — the source's verdict on expiry. Kalshi says it in `status`:
    // anything but 'active' (finalized / settled / closed) means closed.
    // Note this is ALWAYS false on a row that reaches here, because the guard
    // above already dropped every non-active market — that is correct and not
    // redundant: `source_closed` must describe what the source SAID, and this
    // is the single expression of that rule for when the guard changes.
    const sourceClosed = str(m.status) !== 'active';
    const openTime = str(m.open_time);
    const startTime = Number.isFinite(new Date(openTime).getTime())
      ? new Date(openTime).toISOString()
      : undefined;

    return {
      id,
      source: 'polymarket', // "a feed owns this row" — unchanged TS union
      provider: 'kalshi',
      providerRef: ticker,
      question,
      description: str(m.rules_primary) || undefined,
      category,
      endDate,
      resolution: 'oracle',
      yesPrice: price,
      volume: num(m.volume_fp) ?? 0,
      liquidity: Math.max(5_000, num(m.open_interest_fp) ?? 0),
      createdAt: new Date().toISOString(),
      status: 'open',
      priceHistory: generatePriceHistory(id, price, 50, Date.now()),
      icon: undefined, // Kalshi ships no per-market image; UI uses the category icon
      eventId: opts.eventId,
      shortName,
      yesLabel,
      noLabel,
      inPlayOk,
      sourceClosed,
      startTime,
    };
  } catch {
    return null;
  }
}

/** A Kalshi event -> EventGroup, or null when fewer than 3 outcomes survive. */
function mapKalshiEvent(raw: unknown): EventGroup | null {
  try {
    const ev = raw as KalshiRawEvent;
    const eventTicker = str(ev.event_ticker);
    const title = str(ev.title);
    if (!eventTicker || !title) return null;

    const rawMarkets = Array.isArray(ev.markets) ? ev.markets : [];
    if (rawMarkets.length < 3) return null;

    const id = `k-ev-${eventTicker}`;
    // Resolve the category ONCE from the event so its outcomes can never
    // disagree with their own event (same rule as the Gamma mapper).
    const category = mapKalshiCategory(ev, '');

    const markets = rawMarkets
      .map((m) => mapKalshiMarket(m, ev, { eventId: id, category }))
      .filter((m): m is Market => m !== null)
      .sort((a, b) => b.yesPrice - a.yesPrice)
      .slice(0, 8);
    if (markets.length < 3) return null;

    const endDate = markets
      .map((m) => m.endDate)
      .sort()
      .slice(-1)[0];

    return {
      id,
      title,
      icon: undefined,
      category,
      endDate,
      volume: markets.reduce((sum, m) => sum + m.volume, 0),
      markets,
      // Kalshi has no per-game sub-market sections (no game events exist at
      // all), so `groups` stays undefined — the flat outcome list is right.
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Fetch + cache                                                       */
/* ------------------------------------------------------------------ */

/**
 * Page through the events feed with `cursor`.
 *
 * DEVIATION FROM THE BRIEF: the brief asks for `Promise.allSettled` over a
 * handful of category queries. That is not possible — `?category=` is ignored
 * upstream (see the header note), and cursor paging is inherently SEQUENTIAL
 * (page N+1 needs page N's cursor), so there is nothing to fan out over. The
 * same guarantees are kept by other means: a per-request timeout, a total
 * budget, and partial results on failure. A page that fails or times out ends
 * the walk and we keep every page already collected — never throws.
 */
async function fetchKalshiEvents(): Promise<KalshiRawEvent[]> {
  const out: KalshiRawEvent[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let cursor = '';

  for (let page = 0; page < PAGES; page++) {
    if (Date.now() > deadline) break;
    try {
      const url = cursor ? `${BASE_URL}&cursor=${encodeURIComponent(cursor)}` : BASE_URL;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) break;
      const data = (await res.json()) as { events?: unknown; cursor?: unknown };
      const events = Array.isArray(data.events) ? (data.events as KalshiRawEvent[]) : [];
      if (events.length === 0) break;
      out.push(...events);
      cursor = str(data.cursor);
      if (!cursor) break;
    } catch {
      break; // keep whatever we already have
    }
  }
  return out;
}

/**
 * The one place `Promise.allSettled` genuinely applies (the brief asked for it
 * over category queries, which don't exist — these series queries are the real
 * equivalent). Independent, parallel, 3s each; a failed series yields [] and
 * never breaks the others or the walk.
 */
async function fetchSeriesEvents(): Promise<KalshiRawEvent[]> {
  const results = await Promise.allSettled(
    EXTRA_SERIES.map(async (series) => {
      const res = await fetch(`${BASE_URL}&series_ticker=${series}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Kalshi ${res.status} for series ${series}`);
      const data = (await res.json()) as { events?: unknown };
      return Array.isArray(data.events) ? (data.events as KalshiRawEvent[]) : [];
    })
  );
  const out: KalshiRawEvent[] = [];
  for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
  return out;
}

async function loadKalshi(): Promise<{ markets: Market[]; events: EventGroup[] }> {
  // The walk and the series pull are independent — one failing must not cost
  // us the other.
  const [walk, series] = await Promise.all([fetchKalshiEvents(), fetchSeriesEvents()]);

  // Dedupe by event_ticker: a series event could in principle also appear in
  // the walk (today none do, but overlap must never double-count).
  const byTicker = new Map<string, KalshiRawEvent>();
  for (const ev of [...walk, ...series]) {
    const t = str(ev.event_ticker);
    if (t && !byTicker.has(t)) byTicker.set(t, ev);
  }
  const raw = [...byTicker.values()];
  if (raw.length === 0) return { markets: [], events: [] };

  const events: EventGroup[] = [];
  const markets: Market[] = [];
  const seen = new Set<string>();

  for (const ev of raw) {
    const group = mapKalshiEvent(ev);
    if (group) {
      events.push(group);
      for (const m of group.markets) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        markets.push(m);
      }
      continue;
    }
    // Events with < 3 usable outcomes still carry perfectly good standalone
    // binary markets (most of Kalshi is single-market events) — keep them as
    // flat markets rather than throwing them away.
    const rawMarkets = Array.isArray(ev.markets) ? ev.markets : [];
    for (const rm of rawMarkets) {
      const m = mapKalshiMarket(rm, ev);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      markets.push(m);
    }
  }

  return { markets, events };
}

let cache: { at: number; p: Promise<{ markets: Market[]; events: EventGroup[] }> } | null =
  null;

/**
 * Kalshi feed, memoized for CACHE_MS to respect the request budget.
 *
 * NEVER throws: every failure path yields `{ markets: [], events: [] }` and
 * the unified feed falls back to Polymarket alone. An empty cycle is NOT
 * cached, so a transient outage can recover on the next request instead of
 * blanking Kalshi for five minutes (same rule as getCategoryEvents()).
 */
export function getKalshiData(): Promise<{ markets: Market[]; events: EventGroup[] }> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.p;

  const entry = {
    at: now,
    p: loadKalshi().catch(() => ({ markets: [] as Market[], events: [] as EventGroup[] })),
  };
  cache = entry;
  void entry.p.then((data) => {
    if (data.markets.length === 0 && cache === entry) cache = null;
  });
  return entry.p;
}
