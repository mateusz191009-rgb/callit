import type { Category, EventGroup, Market, MarketGroup } from './types';
import { clampPrice, generatePriceHistory } from './utils';

/**
 * Polymarket provider — tries the public Gamma API first (3s timeout),
 * falls back to realistic mocks. Both paths return the same shapes
 * (`Market` with `source: 'polymarket'`, `EventGroup`), so the provider
 * is swappable.
 *
 * REQUEST BUDGET (Gamma is public + unauthenticated — stay polite):
 *   main feed  : 2 requests per cycle (/markets + /events). The route is
 *                `force-dynamic` but sends `cache-control: max-age=60`
 *                and clients refresh every 90s, so ~2 req/90s per client.
 *   category   : 12 requests (one per tag slug) at most once per 2 MINUTES
 *   top-up       — memoized in `categoryCache` below, so the 60s client
 *                refresh never re-fetches the tags. Worst case adds
 *                ~12 req/2min = 0.1 req/s — far under Gamma's documented
 *                ~4000 req/10s ceiling.
 *
 * LIMIT CEILINGS (verified live 2026-07-17): /markets hard-caps at 100 rows
 * per request no matter what `limit` says (200 and 500 both return 100) —
 * more flat markets would need offset paging, which we skip because the
 * event outcomes below already carry the depth. /events honors limit=50.
 */

const MARKETS_URL =
  'https://gamma-api.polymarket.com/markets?limit=100&order=volume24hr&ascending=false&closed=false&active=true';

const EVENTS_URL =
  'https://gamma-api.polymarket.com/events?limit=50&order=volume24hr&ascending=false&closed=false&active=true';

/** Per-tag top-up feed. `tag_slug` is appended per request. v14: 8 -> 15
 *  events per hub ("so viele sachen wie geht") — affordable because the
 *  API payload no longer ships the generated priceHistory (see the
 *  mapper), which was half its bytes. */
const CATEGORY_EVENTS_URL =
  'https://gamma-api.polymarket.com/events?limit=15&closed=false&active=true&order=volume24hr&ascending=false';

/**
 * Tag slugs pulled for the category top-up — one per built-in hub (plus
 * `soccer`, which feeds the Football hub). All verified to return events
 * against the live Gamma API.
 *
 * NOTE: `entertainment` is NOT here — it returns 0 events upstream;
 * `pop-culture` is the slug that actually carries that content.
 */
const CATEGORY_TAG_SLUGS = [
  'politics',
  'crypto',
  'sports',
  'soccer',
  'economy',
  'pop-culture',
  // v9 — the two new hubs. Both verified live: `tech` and `world` each
  // return a full page of events against the Gamma API.
  'tech',
  'world',
  // v12 — the US-sports hubs. Both verified live against the Gamma API
  // (nba: LeBron retirement etc., mlb: World Series champion etc.).
  'nba',
  'mlb',
  // v13 — owner: "bei uns sind die wetten für die summer league nicht da
  // und bei polymarket schon / bei esports hat poly mehr". Both verified
  // live: `esports` returns a full page of match events (LoL/CS2/Dota/
  // Valorant, 30-40 sub-markets each) that the trending feed rarely
  // carries, and Summer League games live ONLY under `nba-summer-league`
  // (the top-25 of the `nba` tag has none — they are single-moneyline
  // events with tiny volume, see the game rule in mapGammaEvent).
  'esports',
  'nba-summer-league',
] as const;

export async function getTrendingMarkets(): Promise<Market[]> {
  try {
    const res = await fetch(MARKETS_URL, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Gamma API ${res.status}`);
    const data = (await res.json()) as unknown[];
    const mapped = (Array.isArray(data) ? data : [])
      .map((raw) => mapGammaMarket(raw))
      .filter((m): m is Market => m !== null);
    if (mapped.length < 4) throw new Error('Gamma API returned too few usable markets');
    return mapped;
  } catch {
    return getMockPolymarkets();
  }
}

/** Trending multi-outcome events. Only events with >= 3 usable binary
 *  outcome markets survive the mapping; falls back to mock events. */
export async function getTrendingEvents(): Promise<EventGroup[]> {
  try {
    const res = await fetch(EVENTS_URL, {
      signal: AbortSignal.timeout(3000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Gamma API ${res.status}`);
    const data = (await res.json()) as unknown[];
    const events = (Array.isArray(data) ? data : [])
      .map(mapGammaEvent)
      .filter((e): e is EventGroup => e !== null);
    if (events.length < 2) throw new Error('Gamma API returned too few usable events');
    return events;
  } catch {
    return getMockEvents();
  }
}

/* ------------------------------------------------------------------ */
/* Category top-up                                                      */
/* ------------------------------------------------------------------ */

/** v14: 5 -> 2 minutes. THE STALE-ODDS WINDOW, not politeness, is what this
 *  number buys (owner: "damit es nicht irgendwelche alten quoten gibt beim
 *  wetten die ausgenutzt werden können"): a tag-pulled market's price can be
 *  this old before the route even sees it. 12 slugs / 2 min = 0.1 req/s,
 *  still nothing against Gamma's documented ~4000 req/10s ceiling. */
const CATEGORY_CACHE_MS = 2 * 60_000;

let categoryCache: { at: number; p: Promise<EventGroup[]> } | null = null;

/** One `/events?tag_slug=…` fetch per slug, 3s timeout EACH, all in
 *  parallel. A slow or broken tag is skipped, never awaited by the others
 *  and never fatal — the trending feed alone still renders. */
async function fetchCategoryEvents(): Promise<EventGroup[]> {
  const results = await Promise.allSettled(
    CATEGORY_TAG_SLUGS.map(async (slug) => {
      const res = await fetch(`${CATEGORY_EVENTS_URL}&tag_slug=${slug}`, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Gamma API ${res.status} for tag ${slug}`);
      const data = (await res.json()) as unknown[];
      return (Array.isArray(data) ? data : [])
        .map(mapGammaEvent)
        .filter((e): e is EventGroup => e !== null);
    })
  );

  const out: EventGroup[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
  }
  return out;
}

/**
 * Extra events pulled per category tag so every hub has content — the
 * trending feed alone skews hard to whatever is hot today.
 *
 * Memoized for CATEGORY_CACHE_MS. A cycle that yields nothing at all is
 * NOT cached: a transient outage shouldn't leave the hubs empty for five
 * minutes when the next request could recover them.
 */
export function getCategoryEvents(): Promise<EventGroup[]> {
  const now = Date.now();
  if (categoryCache && now - categoryCache.at < CATEGORY_CACHE_MS) {
    return categoryCache.p;
  }
  const entry = {
    at: now,
    p: fetchCategoryEvents().catch((): EventGroup[] => []),
  };
  categoryCache = entry;
  void entry.p.then((events) => {
    if (events.length === 0 && categoryCache === entry) categoryCache = null;
  });
  return entry.p;
}

/* ------------------------------------------------------------------ */
/* Deep per-category top-up (v6 — used by lib/feed.ts)                  */
/* ------------------------------------------------------------------ */

/** Same per-tag feed as CATEGORY_EVENTS_URL but pulled DEEPER (limit 25 vs
 *  8). Only issued for a category the merged feed left short, so the extra
 *  requests are proportional to the actual deficit, not paid every cycle. */
const DEEP_CATEGORY_EVENTS_URL =
  'https://gamma-api.polymarket.com/events?limit=25&closed=false&active=true&order=volume24hr&ascending=false';

/** Per-slug cache, same 5-minute window as the shallow top-up. Keyed by slug
 *  so a category that recovers doesn't re-fetch the ones that were fine. */
const deepCache = new Map<string, { at: number; p: Promise<EventGroup[]> }>();

async function fetchDeepCategory(slug: string): Promise<EventGroup[]> {
  const res = await fetch(`${DEEP_CATEGORY_EVENTS_URL}&tag_slug=${slug}`, {
    signal: AbortSignal.timeout(3000),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Gamma API ${res.status} for tag ${slug}`);
  const data = (await res.json()) as unknown[];
  return (Array.isArray(data) ? data : [])
    .map(mapGammaEvent)
    .filter((e): e is EventGroup => e !== null);
}

/**
 * Deeper per-tag pull for categories the balancer found short. One request
 * per slug, all in parallel, 3s each; a failed slug yields [] and never
 * breaks the others. Memoized for CATEGORY_CACHE_MS; an empty result is not
 * cached so the next cycle can recover.
 */
export async function getDeepCategoryEvents(slugs: string[]): Promise<EventGroup[]> {
  const now = Date.now();
  const results = await Promise.allSettled(
    slugs.map((slug) => {
      const hit = deepCache.get(slug);
      if (hit && now - hit.at < CATEGORY_CACHE_MS) return hit.p;
      const entry = { at: now, p: fetchDeepCategory(slug).catch((): EventGroup[] => []) };
      deepCache.set(slug, entry);
      void entry.p.then((events) => {
        if (events.length === 0 && deepCache.get(slug) === entry) deepCache.delete(slug);
      });
      return entry.p;
    })
  );
  const out: EventGroup[] = [];
  for (const r of results) if (r.status === 'fulfilled') out.push(...r.value);
  return out;
}

/**
 * Combined payload used by the /api/polymarket route.
 *
 * Merges the trending feed with the per-category top-up. Trending wins on
 * an event id collision (it is the primary, freshest feed and its ordering
 * drives the home grid). Outcome markets of every surviving event are
 * merged into `markets` so category hubs can find them — both consumers
 * (app/page.tsx, app/category/[cat]/page.tsx) already hide outcomes whose
 * event card is on screen, so this can't double-render.
 *
 * Shape is unchanged (`{ markets, events }`) — the API contract holds.
 */
export async function getPolymarketData(): Promise<{
  markets: Market[];
  events: EventGroup[];
}> {
  const [markets, trending, topUp] = await Promise.all([
    getTrendingMarkets(),
    getTrendingEvents(),
    getCategoryEvents(),
  ]);

  const events = dedupeById([...trending, ...topUp]);

  // ORDER IS LOAD-BEARING: event outcomes come FIRST so they win the dedupe.
  // The same market can arrive twice — once flat from /markets and once
  // nested in its event — and the two mappings are NOT equivalent. Only the
  // nested one knows its event, so only it carries `eventId`, the tag-derived
  // category, and (v6) `groupId` / `groupLabel` / `inPlayOk`.
  //
  // v5 listed the flat rows first, which silently shadowed all of that. It
  // hurt exactly the markets it could least afford to: a live game's
  // moneyline is high-volume, so it is always in the trending flat feed, so
  // it always lost — and would have been mirrored to the DB with
  // `in_play_ok = false`, making the marquee in-play market (who wins the
  // match) untradeable while the match is being played.
  const mergedMarkets = dedupeById([
    ...events.flatMap((e) => e.markets),
    ...markets,
  ]);

  return { markets: mergedMarkets, events };
}

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

/** Synchronous mock payload — client-side fallback when /api/polymarket
 *  is unreachable. Same shape as `getPolymarketData()`. */
export function getMockPolymarketData(): { markets: Market[]; events: EventGroup[] } {
  return { markets: getMockPolymarkets(), events: getMockEvents() };
}

/* ------------------------------------------------------------------ */
/* Gamma API mapping                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Games, sub-market grouping and in-play (v6)                          */
/* ------------------------------------------------------------------ */

/**
 * Is this Gamma event a REAL game (two teams playing a match)?
 *
 * `gameId` ALONE IS NOT ENOUGH — verified live 2026-07-15: the event "PGA
 * Tour: The Open Championship Winner" carries `gameId: 692` but has no
 * `teams` and no `sport`; it is a week-long tournament, not a match. Every
 * genuine match ("England vs. Argentina", gameId 90087008) carries a `teams`
 * array of two. Requiring `teams` is what keeps a golf tournament from being
 * treated as a live game and unlocking post-expiry trading on it.
 */
function isGameEvent(r: Record<string, unknown>): boolean {
  if (!r.gameId) return false;
  return Array.isArray(r.teams) && r.teams.length >= 2;
}

/**
 * Questions that resolve DURING a match, not at its final whistle.
 *
 * THE RULE (owner): in-play trading exists so you can trade a live game while
 * it plays. A market like "goal in the first 10 minutes" is DECIDED at minute
 * 10 — leaving it tradeable for the 4h post-`end_date` in-play window would
 * let someone buy a result they already know. So a market is in-play-eligible
 * only if it is an outcome of a real game AND its question is not time-boxed
 * to a sub-window of that game. Everything else defaults to `inPlayOk: false`.
 *
 * Shared with lib/kalshi.ts — one rule, one place, so the two feeds can never
 * drift apart on a safety gate.
 */
const TIME_BOXED_RE = [
  /first \d+ minutes?/,
  /before halftime/,
  /in the \w+ half/,
  /\d+(st|nd|rd|th) (half|quarter|period|inning)/,
  /first goal/,
  /first team to score/,
  /next goal/,
  /first scorer/,
  /anytime scorer/,
  // Sub-unit of a series — VERIFIED HOLE, not in the brief's list. A
  // best-of-3 ships markets like "Game 2: Any Player Penta Kill?" whose
  // `endDate` is the SERIES end, not game 2's. 57 such markets were live at
  // implementation time. Once game 2 is over they are decided, yet the
  // series (and so the 4h in-play window) runs on — the exact "trading a
  // known result" hole this rule exists to close. Any question naming a
  // specific game/map/set/round number is scoped to a sub-window of its
  // event and is therefore never in-play eligible.
  /\b(game|map|set|round)\s*[1-9]\b/,
];

export function isTimeBoxedQuestion(question: string, label?: string): boolean {
  const hay = `${question} ${label ?? ''}`.toLowerCase();
  return TIME_BOXED_RE.some((re) => re.test(hay));
}

/**
 * The same rule expressed STRUCTURALLY, against Gamma's own
 * `sportsMarketType` taxonomy — stronger than a text regex because it does
 * not depend on how a question happens to be phrased. Verified live: these
 * all resolve mid-match (`soccer_halftime_result`, `first_half_totals`,
 * `both_teams_to_score_first_half`, `tennis_first_set_winner`,
 * `first_blood_game`, `round_handicap_game_1`, …).
 *
 * Both checks run; either one is enough to disqualify a market.
 */
const TIME_BOXED_SMT_RE =
  /(first_half|second_half|halftime|first_to_score|first_corner|first_blood|first_set|_game_[123]$)/;

/** Gamma sub-market types that map to a house name our UI already uses.
 *  Everything else is humanized from the raw type (see `humanizeType`), which
 *  keeps new upstream types readable instead of dumping them into 'Other'. */
const GROUP_LABEL_EXACT: Record<string, string> = {
  moneyline: 'Moneyline',
  child_moneyline: 'Moneyline',
  spreads: 'Spreads',
  totals: 'Totals',
  map_handicap: 'Map Handicap',
  soccer_team_totals: 'Team Totals',
};

/** Sport prefixes stripped before humanizing — the section sits inside a game
 *  that already says which sport it is. */
const SPORT_PREFIX_RE = /^(soccer|tennis|cricket|dota2|lol|basketball|baseball)_/;

const SMALL_WORDS = new Set(['to', 'the', 'of', 'a', 'and', 'in', 'on', 'or']);

function humanizeType(t: string): string {
  return t
    .replace(SPORT_PREFIX_RE, '')
    .split('_')
    .filter(Boolean)
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join(' ');
}

/**
 * Human section name for a game sub-market: 'Moneyline', 'Spreads',
 * 'Totals', 'Team to Advance'… Falls back to the event title when Gamma
 * ships no `sportsMarketType` (per the brief).
 */
function groupLabelFor(
  m: Record<string, unknown>,
  eventTitle: string
): string | undefined {
  const t = typeof m.sportsMarketType === 'string' ? m.sportsMarketType.trim() : '';
  if (!t) return eventTitle || undefined;
  return GROUP_LABEL_EXACT[t] ?? humanizeType(t);
}

/**
 * Sub-market sections for a game event, in upstream order (which is already
 * section-coherent) — NOT price order, which would interleave unrelated bets.
 * This is what lets the event page render 'Moneyline' / 'Spreads' / 'Totals'
 * blocks instead of one flat pile of Yes/No rows.
 */
function buildGroups(markets: Market[]): MarketGroup[] | undefined {
  const byLabel = new Map<string, MarketGroup>();
  for (const m of markets) {
    if (!m.groupLabel || !m.groupId) continue;
    let g = byLabel.get(m.groupLabel);
    if (!g) {
      g = {
        id: `${m.groupId}-${slugify(m.groupLabel)}`,
        label: m.groupLabel,
        markets: [],
      };
      byLabel.set(m.groupLabel, g);
    }
    g.markets.push(m);
  }
  return byLabel.size > 0 ? [...byLabel.values()] : undefined;
}

interface MapOpts {
  /** Set on outcome markets nested inside an EventGroup. */
  eventId?: string;
  /** Drop the market instead of defaulting to 0.5 when prices are missing. */
  requirePrices?: boolean;
  /** endDate fallback (nested event markets sometimes omit their own). */
  fallbackEndDate?: string;
  /** Category resolved by the parent event — wins over the keyword guess so
   *  an event's outcomes can never disagree with their own event. */
  category?: Category;
  /** v6 — set when the parent event is a real game: the game key shared by
   *  every sub-market of that match (`pm-game-<gameId>`). */
  groupId?: string;
  /** v6 — parent event title, used as the section label fallback. */
  eventTitle?: string;
  /** v7 — the parent EVENT's `startTime` (the real kickoff). Nested markets
   *  carry their own `gameStartTime` today; this is the backstop. */
  fallbackStartTime?: string;
}

/**
 * The market's real START (kickoff / open time), or undefined.
 *
 * `gameStartTime` is the one to trust: verified live, all 45 sub-markets of
 * "England vs. Argentina" carry it, as `"2026-07-15 19:00:00+00"` — a
 * SPACE-separated, non-ISO string that `new Date()` still parses correctly.
 *
 * DELIBERATE DEVIATION FROM THE BRIEF: the brief's chain is
 * `gameStartTime ?? startTime ?? startDate`. `startDate` is NOT in it here,
 * because on this API it is not a start at all — VERIFIED: the market's
 * `startDate` (2026-07-12T10:32:23Z) is its CREATION, ~2 minutes after
 * `createdAt` (10:30:06), three days before the 19:00 kickoff. Feeding that to
 * `isInPlay()` would mark every market LIVE from the moment it was listed. The
 * parent event's `startTime` IS the kickoff (19:00, verified), so it is the
 * fallback instead. Markets have no `startTime` field of their own — that key
 * exists only on events — so this reads both and lets the event supply it.
 */
function startTimeOf(
  r: Record<string, unknown>,
  fallback?: string
): string | undefined {
  for (const v of [r.gameStartTime, r.startTime, fallback]) {
    if (typeof v === 'string' && v.trim() && Number.isFinite(new Date(v).getTime())) {
      return new Date(v).toISOString();
    }
  }
  return undefined;
}

function mapGammaMarket(raw: unknown, opts: MapOpts = {}): Market | null {
  try {
    const r = raw as Record<string, unknown>;
    const question = String(r.question ?? '');
    const endDate = String(r.endDate ?? r.end_date_iso ?? opts.fallbackEndDate ?? '');
    if (!question || !endDate) return null;
    // THE DROP RULE, UNCHANGED — and note what it is NOT: a passed `endDate`
    // is not a reason to drop anything. Upstream that date is the kickoff on a
    // game and a stale placeholder on slow questions; the source's own
    // `closed`/`active` flags are the only thing that retires a market.
    if (r.closed === true || r.active === false) return null;

    // outcomePrices arrives as a JSON-encoded string array, e.g. '["0.62","0.38"]'
    let yesPrice = NaN;
    const op = r.outcomePrices ?? r.outcome_prices;
    if (typeof op === 'string') {
      const arr = JSON.parse(op) as string[];
      yesPrice = parseFloat(arr?.[0]);
    } else if (Array.isArray(op)) {
      yesPrice = parseFloat(String(op[0]));
    }
    if (!isFinite(yesPrice)) {
      if (opts.requirePrices) return null;
      yesPrice = 0.5;
    }
    yesPrice = clampPrice(yesPrice);

    // `outcomes` uses the SAME encoding as outcomePrices (JSON string array,
    // e.g. '["Over","Under"]', '["England","Argentina"]', usually
    // '["Yes","No"]') and the SAME ordering: outcomes[0] names OUR 'yes'
    // side (whose price is outcomePrices[0]), outcomes[1] our 'no' side.
    // Labels are set only for a real pair of names — a literal Yes/No pair
    // (or anything containing a bare yes/no, e.g. a flipped pair) stays
    // unset so the UI keeps its default wording. Guarded inner parse: a
    // malformed `outcomes` must not drop an otherwise good market.
    const { yesLabel, noLabel } = parseOutcomeLabels(r.outcomes ?? r.outcome);

    const volume = num(r.volumeNum ?? r.volume) ?? 50_000;
    const liquidity = num(r.liquidityNum ?? r.liquidity) ?? 20_000;
    const id = `pm-${String(r.id ?? r.slug ?? question.slice(0, 24))}`;

    // Nested outcome markets inherit their event's (tag-resolved) category.
    // Flat /markets rows have no usable tags of their own — Gamma returns
    // `events[].tags` empty on that endpoint — so they keep the keyword
    // path: match across category, event title/slug AND the question.
    let category = opts.category;
    if (!category) {
      const ev = Array.isArray(r.events)
        ? (r.events[0] as Record<string, unknown>)
        : undefined;
      const categoryText = [r.category, ev?.title, ev?.slug, question]
        .filter((x) => typeof x === 'string')
        .join(' ');
      category = mapCategory(categoryText);
    }

    const icon =
      typeof r.icon === 'string' && r.icon
        ? r.icon
        : typeof r.image === 'string' && r.image
          ? r.image
          : undefined;

    // Gamma's groupItemTitle is the outcome label within an event
    // ("France", "Kevin Hassett", …) — far better than any heuristic.
    const shortName =
      typeof r.groupItemTitle === 'string' && r.groupItemTitle.trim()
        ? r.groupItemTitle.trim()
        : undefined;

    // v6 grouping + in-play. `groupId` is only ever set by a game event, so a
    // standalone market can never claim a section or in-play eligibility.
    const groupId = opts.groupId;
    const groupLabel = groupId
      ? groupLabelFor(r, opts.eventTitle ?? '')
      : undefined;
    const smt = typeof r.sportsMarketType === 'string' ? r.sportsMarketType : '';
    const inPlayOk = Boolean(
      groupId &&
        !TIME_BOXED_SMT_RE.test(smt) &&
        !isTimeBoxedQuestion(question, shortName)
    );

    return {
      id,
      source: 'polymarket',
      provider: 'polymarket',
      providerRef: typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : undefined,
      groupId,
      groupLabel,
      inPlayOk,
      // v7 — the SOURCE's verdict, and the only truth about a feed market's
      // expiry. Default false: we got the row from an `active=true&closed=false`
      // feed, so silence means open.
      sourceClosed: r.closed === true,
      startTime: startTimeOf(r, opts.fallbackStartTime),
      question,
      description: typeof r.description === 'string' ? r.description : undefined,
      category,
      endDate,
      resolution: 'oracle',
      yesPrice,
      volume,
      liquidity: Math.max(5_000, liquidity),
      createdAt: String(r.createdAt ?? r.created_at ?? new Date().toISOString()),
      status: 'open',
      // v14 — EMPTY ON PURPOSE. The decorative random-walk history was half
      // the API payload (~3.7 of 7.3 MB); it is deterministic from (id,
      // yesPrice), so the client regenerates it on ingest instead
      // (setPolymarkets in lib/store.ts). Server-side consumers never read
      // a feed row's history: the DB mirror skips price_history and
      // isStaleResolved only runs on resolved rows, which a live feed
      // (closed=false) never carries.
      priceHistory: [],
      icon,
      eventId: opts.eventId,
      shortName,
      yesLabel,
      noLabel,
    };
  } catch {
    return null;
  }
}

/** Is this string just a literal side word? Case-insensitive.
 *  Shared with lib/kalshi.ts — one rule for what counts as a "real" label. */
export function isLiteralYesNo(s: string): boolean {
  const t = s.toLowerCase();
  return t === 'yes' || t === 'no';
}

/**
 * Side display labels out of a Gamma `outcomes` value (JSON-encoded string
 * array or a real array). Both labels or neither: a lone name is an outcome
 * descriptor, not a side pair, and wrong labels are worse than Yes/No.
 */
export function parseOutcomeLabels(raw: unknown): {
  yesLabel?: string;
  noLabel?: string;
} {
  let arr: unknown[] = [];
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      return {};
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  }
  const first = typeof arr[0] === 'string' ? arr[0].trim() : '';
  const second = typeof arr[1] === 'string' ? arr[1].trim() : '';
  if (!first || !second) return {};
  if (isLiteralYesNo(first) || isLiteralYesNo(second)) return {};
  return { yesLabel: first, noLabel: second };
}

function mapGammaEvent(raw: unknown): EventGroup | null {
  try {
    const r = raw as Record<string, unknown>;
    const title = String(r.title ?? '');
    const endDate = String(r.endDate ?? r.end_date ?? '');
    if (!title || !endDate) return null;

    const id = `pm-ev-${String(r.id ?? r.slug ?? title.slice(0, 24))}`;

    // Resolve the category ONCE, here, and hand it to every outcome.
    // Gamma's event `tags` are authoritative and beat any title keyword:
    // "England vs. Argentina - More Markets" carries soccer/fifa-world-cup
    // but reads as pure noise to a keyword matcher.
    const categoryText = [r.title, r.slug]
      .filter((x): x is string => typeof x === 'string')
      .join(' ');
    const category = categoryFromTags(parseTags(r.tags)) ?? mapCategory(categoryText);

    // v6 — a real match (two teams) groups its sub-markets into sections.
    const isGame = isGameEvent(r);
    const groupId = isGame ? `pm-game-${String(r.gameId)}` : undefined;

    const rawMarkets = Array.isArray(r.markets) ? r.markets : [];
    const mapped = rawMarkets
      .map((m) =>
        mapGammaMarket(m, {
          eventId: id,
          requirePrices: true,
          fallbackEndDate: endDate,
          category,
          groupId,
          eventTitle: title,
          fallbackStartTime: typeof r.startTime === 'string' ? r.startTime : undefined,
        })
      )
      .filter((m): m is Market => m !== null);

    // Sections are built from UPSTREAM order (section-coherent) before any
    // price sort, and only for games. Standalone events keep `groups`
    // undefined and their existing flat outcome list.
    const groups = isGame ? buildGroups(mapped.slice(0, GAME_MARKET_CAP)) : undefined;

    // A game event's sub-markets are NOT ranked outcomes of one question —
    // slicing the top 8 by price would silently drop whole sections (a match
    // ships ~45 of them). Keep them all (bounded) so every section renders;
    // non-game events keep the historical top-8 behavior exactly.
    const markets = isGame
      ? mapped.slice(0, GAME_MARKET_CAP).sort((a, b) => b.yesPrice - a.yesPrice)
      : mapped.sort((a, b) => b.yesPrice - a.yesPrice).slice(0, 8);
    // v13 — a REAL game survives with a single market: an NBA Summer League
    // game ships exactly one moneyline (verified live) and was silently
    // dropped by the old `< 3` rule — the owner's "Summer League fehlt"
    // complaint. Non-game events keep the >= 3 bar: a one-market "event"
    // that isn't a match is upstream noise, not a multi-outcome question.
    if (markets.length < (isGame ? 1 : 3)) return null;

    const icon =
      typeof r.icon === 'string' && r.icon
        ? r.icon
        : typeof r.image === 'string' && r.image
          ? r.image
          : undefined;
    const volume =
      num(r.volume ?? r.volumeNum) ?? markets.reduce((sum, m) => sum + m.volume, 0);

    return {
      id,
      title,
      icon,
      category,
      endDate,
      volume,
      markets,
      groups,
    };
  } catch {
    return null;
  }
}

/** Upper bound on sub-markets kept for one game event. The busiest live match
 *  verified upstream ships 45; this leaves headroom without letting a
 *  pathological event flood the feed or the DB sync. */
const GAME_MARKET_CAP = 60;

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return isFinite(n) ? n : undefined;
}

/* ------------------------------------------------------------------ */
/* Categorization                                                       */
/* ------------------------------------------------------------------ */

/**
 * Gamma event tag slugs -> our category, MOST SPECIFIC FIRST (first hit
 * wins). Order is the whole point: a World Cup match event is tagged
 * `sports`, `games`, `soccer` AND `fifa-world-cup` — football has to be
 * checked before the generic sports bucket claims it.
 */
const TAG_CATEGORIES: [Category, string[]][] = [
  // v11 — esports FIRST, even before football: esports events are also
  // tagged 'sports'/'games' (and an "Esports World Cup" would match the
  // 'world-cup' slug), so the specific gaming tags must claim them first.
  [
    'esports',
    ['esports', 'esports-world-cup', 'dota', 'dota-2', 'csgo', 'cs2', 'counter-strike', 'lol', 'league-of-legends', 'valorant', 'overwatch', 'starcraft', 'rocket-league', 'call-of-duty'],
  ],
  [
    'football',
    ['soccer', 'fifa-world-cup', 'epl', 'uefa-champions-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1', 'world-cup'],
  ],
  // v12 — the two US-sports hubs, before the generic sports bucket so
  // NBA/MLB events land in their own hubs (both slugs verified live).
  ['basketball', ['nba', 'nba-summer-league', 'wnba', 'basketball', 'ncaab', 'march-madness']],
  ['baseball', ['mlb', 'baseball', 'world-series']],
  [
    'sports',
    ['sports', 'games', 'nfl', 'nhl', 'tennis', 'ufc', 'mma', 'boxing', 'f1', 'formula-1', 'golf', 'cricket'],
  ],
  ['crypto', ['crypto', 'bitcoin', 'ethereum', 'solana', 'defi', 'memecoins']],
  // v9 — 'world' BEFORE 'politics', deliberately: international affairs
  // (invasions, foreign elections, world leaders — verified live, that is
  // exactly what the world/geopolitics tags carry) move from the politics
  // hub to the World hub. Politics keeps everything domestic.
  // NOT here: 'world-elections' / 'global-elections' — verified live,
  // Polymarket sticks those on US presidential races too, which would pull
  // domestic politics into the World hub.
  ['world', ['world', 'geopolitics', 'world-politics', 'foreign-policy', 'nato', 'united-nations']],
  ['politics', ['politics', 'elections', 'us-politics', 'trump']],
  ['economy', ['economy', 'business', 'fed', 'inflation', 'macro', 'stocks', 'earnings']],
  ['pop-culture', ['pop-culture', 'movies', 'music', 'celebrities', 'tv', 'awards', 'gaming-culture']],
  // v9 — tech-science LAST on purpose: it only claims events none of the
  // original hubs wanted, so nothing that used to land in economy / sports
  // moves. Its fill comes from the dedicated 'tech' tag pull plus Kalshi's
  // native 'Science and Technology' category.
  ['tech-science', ['tech', 'science', 'ai', 'artificial-intelligence', 'space', 'spacex', 'nasa', 'openai']],
];

/** Coerce Gamma's `tags: [{id,label,slug}]` out of unknown JSON. */
function parseTags(raw: unknown): { slug?: string; label?: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    if (!t || typeof t !== 'object') return [];
    const rec = t as Record<string, unknown>;
    const slug = typeof rec.slug === 'string' ? rec.slug : undefined;
    const label = typeof rec.label === 'string' ? rec.label : undefined;
    return slug || label ? [{ slug, label }] : [];
  });
}

/**
 * Category from an event's Gamma tags — AUTHORITATIVE, tried before any
 * title keyword. Returns null when no tag matches so the caller can fall
 * back to `mapCategory`.
 */
export function categoryFromTags(
  tags: { slug?: string; label?: string }[]
): Category | null {
  if (tags.length === 0) return null;
  const slugs = new Set(
    tags
      .map((t) => t.slug?.toLowerCase().trim())
      .filter((s): s is string => Boolean(s))
  );
  if (slugs.size === 0) return null;
  for (const [category, tagSlugs] of TAG_CATEGORIES) {
    if (tagSlugs.some((s) => slugs.has(s))) return category;
  }
  return null;
}

const CATEGORY_KEYWORDS: [Category, string[]][] = [
  // Esports FIRST: titles like "Dota 2 ... Esports World Cup" must map to
  // esports (its own hub since v11) before the 'world cup' keyword pulls
  // them into football.
  [
    'esports',
    ['esport', 'dota', 'counter-strike', 'cs2', 'league of legends', 'valorant', 'starcraft', 'overwatch', 'rocket league', 'call of duty'],
  ],
  [
    'football',
    ['football', 'soccer', 'world cup', 'fifa', 'champions league', 'premier league', 'uefa', 'la liga', 'bundesliga', 'messi', 'ronaldo'],
  ],
  // v12 — US-sports hubs before the generic sports bucket.
  [
    'basketball',
    ['basketball', 'nba', 'wnba', 'march madness', 'ncaa tournament'],
  ],
  [
    'baseball',
    ['baseball', 'mlb', 'world series', 'home run'],
  ],
  [
    'sports',
    ['sport', 'nfl', 'nhl', 'super bowl', 'olympic', 'tennis', 'ufc', 'boxing', 'f1', 'grand slam', 'playoff'],
  ],
  [
    'politics',
    ['politic', 'election', 'president', 'senate', 'congress', 'house', 'governor', 'mayor', 'nomination', 'nominee', 'minister', 'parliament', 'trump', 'supreme court', 'impeach', 'cabinet'],
  ],
  [
    'crypto',
    ['crypto', 'bitcoin', 'btc', 'ethereum', ' eth ', 'solana', 'token', 'defi', 'stablecoin', 'blockchain', 'airdrop'],
  ],
  [
    'economy',
    ['econom', 'fed ', 'fed?', 'fed chair', 'fomc', 'rate cut', 'rate hike', 'inflation', 'cpi', 'gdp', 'recession', 'tariff', 'jobs report', 'unemployment', 'treasury', 's&p', 'stock market'],
  ],
  [
    'pop-culture',
    ['pop culture', 'culture', 'entertainment', 'movie', 'box office', 'best picture', 'album', 'grammy', 'oscar', 'emmy', 'netflix', 'taylor swift', 'gta', 'video game', 'spotify', 'billboard', 'celebrity', 'tiktok'],
  ],
  // v9 — new hubs last (same minimal-disruption rule as TAG_CATEGORIES):
  // deliberately conservative keyword sets, since every hit here reroutes a
  // row that used to land in 'custom'.
  [
    'tech-science',
    ['openai', 'chatgpt', 'artificial intelligence', ' ai ', 'spacex', 'starship', 'nasa', 'space launch', 'quantum comput', 'self-driving', 'robotaxi'],
  ],
  [
    'world',
    ['geopolit', 'ceasefire', 'nato', 'united nations', 'peace deal', 'territor', 'annex'],
  ],
];

/** Match-up titles: "England vs. Argentina", "Team A v Team B". */
const MATCHUP_RE = /\bvs\.?\b|\sv\s/;

/**
 * Keyword fallback — only reached when tags gave us nothing (flat /markets
 * rows, or an event whose tags are all unknown to us).
 */
function mapCategory(raw: string): Category {
  const c = ` ${raw.toLowerCase()} `;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((k) => c.includes(k))) return category;
  }
  // Last resort before 'custom': an "X vs. Y" title is essentially always
  // a sports match-up, and 'sports' beats dumping it in the Custom hub.
  if (MATCHUP_RE.test(c)) return 'sports';
  return 'custom';
}

/* ------------------------------------------------------------------ */
/* Mock fallback — looks like real Polymarket data                      */
/* ------------------------------------------------------------------ */

interface MockDef {
  id: string;
  question: string;
  description: string;
  category: Category;
  endDate: string;
  yesPrice: number;
  volume: number;
  liquidity: number;
}

const MOCKS: MockDef[] = [
  {
    id: 'pm-fed-sept-cut',
    question: 'Will the Fed cut rates at the September 2026 FOMC meeting?',
    description:
      'Resolves YES if the FOMC lowers the federal funds target range at its September 2026 meeting.',
    category: 'economy',
    endDate: '2026-09-16T18:00:00.000Z',
    yesPrice: 0.71,
    volume: 24_800_000,
    liquidity: 1_400_000,
  },
  {
    id: 'pm-btc-200k-2026',
    question: 'Will Bitcoin hit $200,000 in 2026?',
    description:
      'Resolves YES if BTC/USD trades at or above $200,000 on any major exchange before Jan 1, 2027.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.19,
    volume: 18_300_000,
    liquidity: 950_000,
  },
  {
    id: 'pm-eth-10k-2026',
    question: 'Will Ethereum reach $10,000 by end of 2026?',
    description:
      'Resolves YES if ETH/USD trades at or above $10,000 on Coinbase or Binance before Jan 1, 2027.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.13,
    volume: 9_600_000,
    liquidity: 620_000,
  },
  {
    id: 'pm-dem-midterms',
    question: 'Will Democrats win the House in the 2026 midterms?',
    description:
      'Resolves YES if the Democratic Party holds a majority of seats in the US House of Representatives after the 2026 midterm elections.',
    category: 'politics',
    endDate: '2026-11-03T23:59:00.000Z',
    yesPrice: 0.62,
    volume: 21_500_000,
    liquidity: 1_800_000,
  },
  {
    id: 'pm-gop-senate',
    question: 'Will Republicans keep the Senate in 2026?',
    description:
      'Resolves YES if the Republican Party holds a majority of US Senate seats after the 2026 midterm elections.',
    category: 'politics',
    endDate: '2026-11-03T23:59:00.000Z',
    yesPrice: 0.78,
    volume: 14_200_000,
    liquidity: 1_100_000,
  },
  {
    id: 'pm-cl-winner-real',
    question: 'Will Real Madrid win the 2026/27 Champions League?',
    description:
      'Resolves YES if Real Madrid CF wins the 2026/27 UEFA Champions League final.',
    category: 'football',
    endDate: '2027-06-05T21:00:00.000Z',
    yesPrice: 0.17,
    volume: 6_900_000,
    liquidity: 480_000,
  },
  {
    id: 'pm-superbowl-chiefs',
    question: 'Will the Chiefs win Super Bowl LXI?',
    description:
      'Resolves YES if the Kansas City Chiefs win Super Bowl LXI in February 2027.',
    category: 'sports',
    endDate: '2027-02-07T23:59:00.000Z',
    yesPrice: 0.14,
    volume: 8_100_000,
    liquidity: 560_000,
  },
  {
    id: 'pm-wc-host-attendance',
    question: 'Will the 2026 World Cup final draw 90k+ attendance?',
    description:
      'Resolves YES if official FIFA attendance for the 2026 World Cup final at MetLife Stadium is 90,000 or higher.',
    category: 'football',
    endDate: '2026-07-31T23:59:00.000Z',
    yesPrice: 0.55,
    volume: 3_400_000,
    liquidity: 240_000,
  },
  {
    id: 'pm-gta6-2026',
    question: 'Will GTA VI release before December 2026?',
    description:
      'Resolves YES if Grand Theft Auto VI is publicly available for purchase on at least one platform before Dec 1, 2026.',
    category: 'pop-culture',
    endDate: '2026-11-30T23:59:00.000Z',
    yesPrice: 0.34,
    volume: 12_700_000,
    liquidity: 780_000,
  },
  {
    id: 'pm-avatar3-box',
    question: 'Will Avatar 3 gross $2B worldwide?',
    description:
      'Resolves YES if Avatar: Fire and Ash exceeds $2 billion in worldwide box office gross per Box Office Mojo before Dec 31, 2026.',
    category: 'pop-culture',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.47,
    volume: 2_900_000,
    liquidity: 210_000,
  },
  {
    id: 'pm-us-cpi-3pct',
    question: 'Will US inflation stay below 3% through 2026?',
    description:
      'Resolves YES if every monthly YoY CPI print for 2026 released by the BLS is below 3.0%.',
    category: 'economy',
    endDate: '2027-01-15T13:30:00.000Z',
    yesPrice: 0.41,
    volume: 5_800_000,
    liquidity: 390_000,
  },
  {
    id: 'pm-recession-2026',
    question: 'US recession declared in 2026?',
    description:
      'Resolves YES if NBER declares a US recession with a start date in calendar year 2026.',
    category: 'economy',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.18,
    volume: 7_300_000,
    liquidity: 510_000,
  },
  {
    id: 'pm-spacex-starship-mars',
    question: 'Will SpaceX launch an uncrewed Mars mission by 2027?',
    description:
      'Resolves YES if SpaceX launches a Starship on a Mars transfer trajectory before Jan 1, 2028.',
    category: 'custom',
    endDate: '2027-12-31T23:59:00.000Z',
    yesPrice: 0.25,
    volume: 4_100_000,
    liquidity: 300_000,
  },
  {
    id: 'pm-openai-ipo',
    question: 'Will OpenAI announce an IPO before 2028?',
    description:
      'Resolves YES if OpenAI publicly files for or announces an initial public offering before Jan 1, 2028.',
    category: 'crypto',
    endDate: '2027-12-31T23:59:00.000Z',
    yesPrice: 0.29,
    volume: 3_800_000,
    liquidity: 260_000,
  },
  {
    id: 'pm-oscars-hosted-2027',
    question: 'Will the 2027 Oscars have a solo host?',
    description:
      'Resolves YES if the 99th Academy Awards ceremony is hosted by exactly one primary host.',
    category: 'pop-culture',
    endDate: '2027-03-15T23:59:00.000Z',
    yesPrice: 0.66,
    volume: 950_000,
    liquidity: 85_000,
  },
  {
    id: 'pm-england-wc-2026',
    question: 'Will England win the 2026 World Cup?',
    description:
      'Resolves YES if the England national team wins the 2026 FIFA World Cup final on July 19, 2026.',
    category: 'football',
    endDate: '2026-07-31T23:59:00.000Z',
    yesPrice: 0.21,
    volume: 16_400_000,
    liquidity: 1_250_000,
  },
  /* ----- v2 additions — keeps the fallback grid full ----- */
  {
    id: 'pm-sol-500-2026',
    question: 'Will Solana hit $500 in 2026?',
    description:
      'Resolves YES if SOL/USD trades at or above $500 on any major exchange before Jan 1, 2027.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.27,
    volume: 6_200_000,
    liquidity: 430_000,
  },
  {
    id: 'pm-eth-staking-etf',
    question: 'Will an ETH staking ETF be approved in 2026?',
    description:
      'Resolves YES if the SEC approves a spot Ethereum ETF with staking enabled before Jan 1, 2027.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.63,
    volume: 4_700_000,
    liquidity: 350_000,
  },
  {
    id: 'pm-doge-1usd',
    question: 'Will Dogecoin reach $1 in 2026?',
    description:
      'Resolves YES if DOGE/USD trades at or above $1.00 on any major exchange before Jan 1, 2027.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.09,
    volume: 3_100_000,
    liquidity: 220_000,
  },
  {
    id: 'pm-stablecoin-bill',
    question: 'Will a US stablecoin bill become law in 2026?',
    description:
      'Resolves YES if comprehensive federal stablecoin legislation is signed into law before Jan 1, 2027.',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.57,
    volume: 2_600_000,
    liquidity: 190_000,
  },
  {
    id: 'pm-us-china-trade',
    question: 'Will the US and China sign a new trade deal in 2026?',
    description:
      'Resolves YES if the United States and China sign a formal bilateral trade agreement before Jan 1, 2027.',
    category: 'politics',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.31,
    volume: 9_800_000,
    liquidity: 640_000,
  },
  {
    id: 'pm-uk-election-2026',
    question: 'Will the UK hold a general election before 2027?',
    description:
      'Resolves YES if a UK general election takes place before Jan 1, 2027.',
    category: 'politics',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.12,
    volume: 2_200_000,
    liquidity: 170_000,
  },
  {
    id: 'pm-ukraine-ceasefire',
    question: 'Russia-Ukraine ceasefire in 2026?',
    description:
      'Resolves YES if Russia and Ukraine agree to and implement a formal ceasefire before Jan 1, 2027.',
    category: 'politics',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.35,
    volume: 31_200_000,
    liquidity: 2_100_000,
  },
  {
    id: 'pm-nvda-5t',
    question: 'Will Nvidia close above a $5T market cap in 2026?',
    description:
      'Resolves YES if NVDA closes a trading day with a market capitalization at or above $5 trillion before Jan 1, 2027.',
    category: 'economy',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.44,
    volume: 8_900_000,
    liquidity: 610_000,
  },
  {
    id: 'pm-sp500-7000',
    question: 'Will the S&P 500 close above 7,000 in 2026?',
    description:
      'Resolves YES if the S&P 500 index closes a trading session at or above 7,000 before Jan 1, 2027.',
    category: 'economy',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.52,
    volume: 11_400_000,
    liquidity: 790_000,
  },
  {
    id: 'pm-oil-100-2026',
    question: 'Will WTI oil trade above $100 in 2026?',
    description:
      'Resolves YES if the front-month WTI crude futures contract trades at or above $100/barrel before Jan 1, 2027.',
    category: 'economy',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.15,
    volume: 4_300_000,
    liquidity: 310_000,
  },
  {
    id: 'pm-messi-last-wc',
    question: 'Will Messi play in the 2026 World Cup?',
    description:
      'Resolves YES if Lionel Messi appears in at least one match for Argentina at the 2026 FIFA World Cup.',
    category: 'football',
    endDate: '2026-07-31T23:59:00.000Z',
    yesPrice: 0.81,
    volume: 7_600_000,
    liquidity: 520_000,
  },
  {
    id: 'pm-haaland-golden-boot',
    question: 'Will Haaland win the 2026/27 Premier League Golden Boot?',
    description:
      'Resolves YES if Erling Haaland finishes the 2026/27 Premier League season as top scorer (outright).',
    category: 'football',
    endDate: '2027-05-23T18:00:00.000Z',
    yesPrice: 0.36,
    volume: 1_900_000,
    liquidity: 140_000,
  },
  {
    id: 'pm-verstappen-2026',
    question: 'Will Max Verstappen win the 2026 F1 championship?',
    description:
      'Resolves YES if Max Verstappen wins the 2026 FIA Formula One World Drivers Championship.',
    category: 'sports',
    endDate: '2026-12-06T23:59:00.000Z',
    yesPrice: 0.41,
    volume: 5_400_000,
    liquidity: 380_000,
  },
  {
    id: 'pm-lakers-title-2027',
    question: 'Will the Lakers win the 2027 NBA Finals?',
    description:
      'Resolves YES if the Los Angeles Lakers win the 2026/27 NBA championship.',
    category: 'sports',
    endDate: '2027-06-20T23:59:00.000Z',
    yesPrice: 0.08,
    volume: 2_800_000,
    liquidity: 200_000,
  },
  {
    id: 'pm-taylor-album-2026',
    question: 'Will Taylor Swift release a new album in 2026?',
    description:
      'Resolves YES if Taylor Swift releases a new full-length studio album (not a re-recording) before Jan 1, 2027.',
    category: 'pop-culture',
    endDate: '2026-12-31T23:59:00.000Z',
    yesPrice: 0.72,
    volume: 3_600_000,
    liquidity: 250_000,
  },
  {
    id: 'pm-ai-oscar-2028',
    question: 'Will an AI-generated film be nominated for an Oscar by 2028?',
    description:
      'Resolves YES if a film primarily generated by AI receives an Academy Award nomination in any category before the end of the 2028 ceremony.',
    category: 'pop-culture',
    endDate: '2028-03-31T23:59:00.000Z',
    yesPrice: 0.11,
    volume: 1_400_000,
    liquidity: 110_000,
  },
];

export function getMockPolymarkets(): Market[] {
  return MOCKS.map((d) => ({
    id: d.id,
    source: 'polymarket' as const,
    question: d.question,
    description: d.description,
    category: d.category,
    endDate: d.endDate,
    resolution: 'oracle' as const,
    yesPrice: d.yesPrice,
    volume: d.volume,
    liquidity: d.liquidity,
    createdAt: '2026-01-05T00:00:00.000Z',
    status: 'open' as const,
    priceHistory: generatePriceHistory(d.id, d.yesPrice, 56, 1783987200000),
    // icon intentionally undefined for mocks — UI falls back to category icon
  }));
}

/* ------------------------------------------------------------------ */
/* Mock events — multi-outcome fallback                                 */
/* ------------------------------------------------------------------ */

interface MockEventDef {
  id: string; // short key; final id = pm-ev-mock-<id>
  title: string;
  category: Category;
  endDate: string;
  volume: number;
  /** question template — <X> replaced by outcome name */
  question: string;
  outcomes: { name: string; yes: number }[];
}

const MOCK_EVENTS: MockEventDef[] = [
  {
    id: 'wc26',
    title: '2026 World Cup Winner',
    category: 'football',
    endDate: '2026-07-31T23:59:00.000Z',
    volume: 2_400_000_000,
    question: 'Will <X> win the 2026 World Cup?',
    outcomes: [
      { name: 'France', yes: 0.39 },
      { name: 'England', yes: 0.22 },
      { name: 'Spain', yes: 0.21 },
      { name: 'Argentina', yes: 0.17 },
      { name: 'Brazil', yes: 0.12 },
      { name: 'Germany', yes: 0.09 },
    ],
  },
  {
    id: 'cl27',
    title: '2026/27 Champions League Winner',
    category: 'football',
    endDate: '2027-06-05T21:00:00.000Z',
    volume: 310_000_000,
    question: 'Will <X> win the 2026/27 Champions League?',
    outcomes: [
      { name: 'Real Madrid', yes: 0.24 },
      { name: 'Man City', yes: 0.22 },
      { name: 'Arsenal', yes: 0.18 },
      { name: 'Bayern', yes: 0.15 },
      { name: 'Barcelona', yes: 0.13 },
      { name: 'PSG', yes: 0.11 },
    ],
  },
  {
    id: 'dem28',
    title: '2028 Democratic Presidential Nominee',
    category: 'politics',
    endDate: '2028-08-31T23:59:00.000Z',
    volume: 890_000_000,
    question: 'Will <X> win the 2028 Democratic presidential nomination?',
    outcomes: [
      { name: 'Gavin Newsom', yes: 0.31 },
      { name: 'Gretchen Whitmer', yes: 0.19 },
      { name: 'Josh Shapiro', yes: 0.16 },
      { name: 'Pete Buttigieg', yes: 0.12 },
      { name: 'Alexandria Ocasio-Cortez', yes: 0.09 },
    ],
  },
  {
    id: 'gop28',
    title: '2028 Republican Presidential Nominee',
    category: 'politics',
    endDate: '2028-08-31T23:59:00.000Z',
    volume: 540_000_000,
    question: 'Will <X> win the 2028 Republican presidential nomination?',
    outcomes: [
      { name: 'JD Vance', yes: 0.42 },
      { name: 'Ron DeSantis', yes: 0.14 },
      { name: 'Marco Rubio', yes: 0.12 },
      { name: 'Nikki Haley', yes: 0.08 },
    ],
  },
  {
    id: 'fedchair',
    title: 'Next Fed Chair',
    category: 'economy',
    endDate: '2026-12-15T23:59:00.000Z',
    volume: 160_000_000,
    question: 'Will <X> be the next Fed Chair?',
    outcomes: [
      { name: 'Kevin Hassett', yes: 0.33 },
      { name: 'Kevin Warsh', yes: 0.27 },
      { name: 'Christopher Waller', yes: 0.18 },
      { name: 'Scott Bessent', yes: 0.11 },
    ],
  },
  {
    id: 'oscars27',
    title: 'Best Picture 2027',
    category: 'pop-culture',
    endDate: '2027-03-15T23:59:00.000Z',
    volume: 12_000_000,
    question: 'Will <X> win Best Picture at the 2027 Oscars?',
    outcomes: [
      { name: 'The Odyssey', yes: 0.29 },
      { name: 'Dune: Part Three', yes: 0.24 },
      { name: 'Project Hail Mary', yes: 0.14 },
      { name: 'Wuthering Heights', yes: 0.1 },
    ],
  },
  /* ----- v5 additions — every hub gets events in offline/mock mode ----- */
  {
    id: 'nba27',
    title: '2027 NBA Championship Winner',
    category: 'sports',
    endDate: '2027-06-20T23:59:00.000Z',
    volume: 420_000_000,
    question: 'Will the <X> win the 2027 NBA Championship?',
    outcomes: [
      { name: 'Oklahoma City Thunder', yes: 0.28 },
      { name: 'Boston Celtics', yes: 0.19 },
      { name: 'Denver Nuggets', yes: 0.15 },
      { name: 'New York Knicks', yes: 0.11 },
      { name: 'Los Angeles Lakers', yes: 0.08 },
    ],
  },
  {
    id: 'f126',
    title: '2026 F1 Drivers Championship',
    category: 'sports',
    endDate: '2026-12-06T23:59:00.000Z',
    volume: 95_000_000,
    question: 'Will <X> win the 2026 F1 Drivers Championship?',
    outcomes: [
      { name: 'Max Verstappen', yes: 0.41 },
      { name: 'Lando Norris', yes: 0.23 },
      { name: 'Charles Leclerc', yes: 0.16 },
      { name: 'Oscar Piastri', yes: 0.12 },
    ],
  },
  {
    id: 'btc2026',
    title: 'Bitcoin Price on Dec 31, 2026',
    category: 'crypto',
    endDate: '2026-12-31T23:59:00.000Z',
    volume: 680_000_000,
    question: 'Will Bitcoin close 2026 <X>?',
    outcomes: [
      { name: '$100k–$150k', yes: 0.34 },
      { name: '$150k–$200k', yes: 0.26 },
      { name: 'Above $200k', yes: 0.19 },
      { name: 'Below $100k', yes: 0.17 },
    ],
  },
  {
    id: 'topcoin27',
    title: 'Largest Altcoin by Market Cap End of 2027',
    category: 'crypto',
    endDate: '2027-12-31T23:59:00.000Z',
    volume: 74_000_000,
    question: 'Will <X> be the largest altcoin by market cap end of 2027?',
    outcomes: [
      { name: 'Ethereum', yes: 0.58 },
      { name: 'Solana', yes: 0.21 },
      { name: 'XRP', yes: 0.11 },
      { name: 'BNB', yes: 0.06 },
    ],
  },
  {
    id: 'grammy27',
    title: 'Album of the Year 2027',
    category: 'pop-culture',
    endDate: '2027-02-07T23:59:00.000Z',
    volume: 8_400_000,
    question: 'Will <X> win Album of the Year at the 2027 Grammys?',
    outcomes: [
      { name: 'Taylor Swift', yes: 0.26 },
      { name: 'Kendrick Lamar', yes: 0.22 },
      { name: 'Billie Eilish', yes: 0.17 },
      { name: 'Olivia Rodrigo', yes: 0.13 },
      { name: 'SZA', yes: 0.09 },
    ],
  },
  {
    id: 'agi',
    title: 'First Lab to Announce AGI',
    category: 'custom',
    endDate: '2028-12-31T23:59:00.000Z',
    volume: 46_000_000,
    question: 'Will <X> be the first lab to announce AGI?',
    outcomes: [
      { name: 'OpenAI', yes: 0.31 },
      { name: 'Anthropic', yes: 0.24 },
      { name: 'Google DeepMind', yes: 0.22 },
      { name: 'Meta AI', yes: 0.07 },
    ],
  },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getMockEvents(): EventGroup[] {
  return MOCK_EVENTS.map((e) => {
    const eventId = `pm-ev-mock-${e.id}`;
    const markets: Market[] = e.outcomes
      .slice()
      .sort((a, b) => b.yes - a.yes)
      .map((o, i) => {
        const id = `${eventId}-${slugify(o.name)}`;
        return {
          id,
          source: 'polymarket' as const,
          question: e.question.replace('<X>', o.name),
          description: `Resolves YES if ${o.name} wins. Part of the "${e.title}" event.`,
          category: e.category,
          endDate: e.endDate,
          resolution: 'oracle' as const,
          yesPrice: o.yes,
          volume: Math.round(e.volume * (0.34 - i * 0.04)),
          liquidity: Math.max(50_000, Math.round(e.volume / 400)),
          createdAt: '2026-01-05T00:00:00.000Z',
          status: 'open' as const,
          priceHistory: generatePriceHistory(id, o.yes, 56, 1783987200000),
          eventId,
          shortName: o.name,
        };
      });
    return {
      id: eventId,
      title: e.title,
      category: e.category,
      endDate: e.endDate,
      volume: e.volume,
      markets,
    };
  });
}
