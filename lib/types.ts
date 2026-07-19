/** Built-in category values (the fixed union — use for exhaustive maps). */
export type BuiltinCategory =
  | 'politics'
  | 'sports'
  | 'football'
  | 'basketball'
  | 'baseball'
  | 'esports'
  | 'crypto'
  | 'economy'
  | 'tech-science'
  | 'world'
  | 'pop-culture'
  | 'custom';

/**
 * Category value — a built-in OR any custom category slug (v3 dynamic
 * categories). The `string & {}` member keeps literal autocomplete for the
 * built-ins while accepting admin-created slugs, so `Record<Category, T>`
 * consumers gain a string index signature and keep compiling.
 */
export type Category = BuiltinCategory | (string & {});

export type Side = 'yes' | 'no';

export type ResolutionMethod = 'oracle' | 'community' | 'manual';

export interface PricePoint {
  t: number; // unix ms
  yes: number; // yes ∈ (0,1)
}

export interface Market {
  id: string;
  source: 'callit' | 'polymarket';
  question: string;
  description?: string;
  /** Built-in category value or a custom category slug (v3). */
  category: string;
  endDate: string; // ISO
  resolution: ResolutionMethod;
  yesPrice: number; // 0.01–0.99; noPrice = 1 - yesPrice
  volume: number; // USD
  liquidity: number; // USD, drives price impact
  /** Creator username for community markets ('guest' when signed out).
   *  v2 stored a wallet address here; detail pages display
   *  `censorName(createdBy)` (see lib/format.ts). */
  createdBy?: string;
  createdAt: string;
  status: 'open' | 'resolved';
  resolvedOutcome?: Side;
  /** v9 — when the market settled (ISO). Drives the 48h feed grace window;
   *  absent on local rows (fall back to the last priceHistory point). */
  resolvedAt?: string;
  priceHistory: PricePoint[];
  /** Image URL for the market (Polymarket icon). UI falls back to category icon. */
  icon?: string;
  /** Set when this market is one outcome of a multi-outcome EventGroup. */
  eventId?: string;
  /** v20 — the RAW upstream id of the event a flat feed row says it belongs
   *  to (Gamma `events[0].id`). Provider-internal: getPolymarketData() uses
   *  it to adopt the row into its fetched event (category + eventId) and
   *  strips it before the payload; it never reaches the API or the DB. */
  eventRef?: string;
  /** Outcome label within an event (from Gamma groupItemTitle), e.g. "France". */
  shortName?: string;
  /** Display name of the market's FIRST ('yes') side when it has a real one —
   *  'Over' on an O/U market, 'England' on a spread/moneyline. ABSENT means
   *  the literal 'Yes'. Side semantics are UNCHANGED: the 'yes'/'no' ids, the
   *  green/sky colors and all pricing stay exactly as they are — these labels
   *  are presentation only. Render via `sideLabel()` / `shortSideLabel()`
   *  (lib/format.ts), never read them raw in UI. */
  yesLabel?: string;
  /** Display name of the SECOND ('no') side — 'Under', 'Argentina'. ABSENT
   *  means the literal 'No'. May be absent even when `yesLabel` is set (never
   *  invent a counterpart — `sideLabel()` then falls back to 'No'). */
  noLabel?: string;
  /** v6 — who the market comes from. `source` says whether the book owns it
   *  ('callit') or a feed does; `provider` says WHICH feed, and is what the
   *  settlement poller branches on. Defaults to 'polymarket' server-side. */
  provider?: 'callit' | 'polymarket' | 'kalshi';
  /** v6 — the provider's own ticker/id, used to poll for the result. */
  providerRef?: string;
  /** v6 — id of the match/event this market groups under (e.g. one game). */
  groupId?: string;
  /** v6 — the sub-market section label, e.g. 'Moneyline' | 'Spreads' |
   *  'Totals'. Pairs with `groupId`. */
  groupLabel?: string;
  /** v6 — the FEED's verdict on whether this is a genuinely live game.
   *  Never infer in-play from the category: that also unlocked time-boxed
   *  questions like "goal in the first 10 minutes" long after they were
   *  decided. See `isInPlay()` in lib/format.ts.
   *
   *  v7 — THIS IS THE `LIVE` LABEL ONLY. It is NOT a trading gate any more:
   *  requiring it to trade is what blocked the live match the owner reported.
   *  "Can I trade this?" is `!isMarketClosed(m)` (lib/format.ts). */
  inPlayOk?: boolean;
  /** v7 — THE PROVIDER'S OWN VERDICT on whether this market is closed, and
   *  for a feed market the ONLY truth about expiry.
   *
   *  `endDate` is not that truth. Verified live against Gamma: on a game
   *  market `endDate` IS THE KICKOFF ("England vs. Argentina": endDate 19:00
   *  == the event's `startTime` 19:00, still `closed: false` at 20:19 with the
   *  match at minute 83), and on slow real-world questions it is a stale
   *  placeholder ("Next Prime Minister of Ethiopia?": endDate 2026-06-01 long
   *  past, still open upstream). Mirrors `markets.source_closed` (v7 schema),
   *  which is what `place_trade` gates a feed market on. Community markets
   *  ignore it — we own their deadline, so `endDate` rules there. */
  sourceClosed?: boolean;
  /** v7 — the event's real start (kickoff / market open time) when the
   *  provider reports one. Mirrors `markets.start_time`. This — not `endDate`
   *  — is what `isInPlay()` measures the LIVE window from. */
  startTime?: string;
  /** v6 — this market's trading fee in basis points (200 = 2%), locked in
   *  when the market was created. Display via `feeBps / 100` + '%'. */
  feeBps?: number;
  /** v6 — the initial funding (USD) its LP put into the pool. Note that
   *  `liquidity` is now the pool's CURRENT real collateral, not a display
   *  number: it is money that exists. */
  seed?: number;
}

/** v6 — a section of sub-markets under one event, e.g. the 'Spreads' block
 *  of a game. Built from `Market.groupId` / `Market.groupLabel`. */
export interface MarketGroup {
  id: string;
  label: string;
  markets: Market[];
}

/** v21 — one side of a game event, straight from Gamma's `teams` array
 *  (name, flag/crest PNG, home/away). Drives the match header and the
 *  ESPN scoreboard matching (lib/espn.ts). */
export interface EventTeam {
  name: string;
  /** Gamma's short code ('esp', 'cws') — NOT guaranteed to equal ESPN's. */
  abbreviation?: string;
  /** Flag / crest image URL (Polymarket CDN). */
  logo?: string;
  /** Team accent color, e.g. '#aa181d'. */
  color?: string;
  side?: 'home' | 'away';
  /** Gamma league code ('fifwc', 'mlb', 'swe', 'nbasl') — the key
   *  lib/espn.ts maps to an ESPN scoreboard path. */
  league?: string;
}

/* ------------------------------------------------------------------ */
/* Live scores (v21 — /api/scores, lib/espn.ts)                         */
/* ------------------------------------------------------------------ */

/** One competitor's live line in a GameScore. */
export interface ScoreSide {
  name: string;
  abbreviation?: string;
  /** ESPN team logo/flag URL — fallback when the event has no team logos. */
  logo?: string;
  score: number;
  /** Per-period scores (innings / quarters) when the sport has them. */
  linescores?: number[];
}

/** A scoring play on the soccer goal timeline. */
export interface ScoreGoal {
  /** Display minute, e.g. "23'", "45'+2'". */
  minute: string;
  /** Minute as a number (0–120+) for timeline placement. */
  minuteValue?: number;
  side: 'home' | 'away';
  player?: string;
  /** "Goal", "Penalty - Scored", "Own Goal", … */
  type?: string;
}

/** Live state of one game event, matched from the public ESPN scoreboard.
 *  Served by /api/scores as `Record<eventId, GameScore>`. */
export interface GameScore {
  state: 'pre' | 'in' | 'post';
  /** ESPN's human status: "Scheduled", "45'", "Top 5th", "FT". */
  detail: string;
  /** Display clock while in play (soccer: "45'+2'"). */
  clock?: string;
  /** ESPN's own start date for the game (ISO). */
  startDate?: string;
  home: ScoreSide;
  away: ScoreSide;
  /** Soccer scoring plays for the goal timeline. */
  goals?: ScoreGoal[];
  /** Regulation length in minutes when the sport runs a clock (soccer: 90). */
  regulation?: number;
  /** ESPN league path the match was found in, e.g. 'soccer/fifa.world'. */
  league?: string;
}

/** Multi-outcome event (e.g. "2026 World Cup Winner") grouping binary markets. */
export interface EventGroup {
  id: string;
  title: string;
  icon?: string;
  category: Category;
  endDate: string; // ISO
  volume: number; // USD
  /** Outcome markets, sorted by yesPrice desc. Each has `eventId` set. */
  markets: Market[];
  /** v6 — sub-market sections (Moneyline / Spreads / Totals …) for event
   *  pages that render a game rather than a flat outcome list. Optional:
   *  events without grouped sub-markets leave it undefined and keep using
   *  `markets`. */
  groups?: MarketGroup[];
  /** v21 — the two sides of a game event (flags, home/away, league code).
   *  Only set on real games; drives the match header + ESPN score match. */
  teams?: EventTeam[];
}

export type DepositCurrency = 'BTC' | 'ETH' | 'USDT' | 'USDC' | 'BNB' | 'SOL';

export interface Deposit {
  id: string;
  currency: DepositCurrency;
  /** USD value of the deposit (demo denomination). */
  amount: number;
  txHash?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string; // ISO
  userEmail?: string;
  /** Supabase profiles.id of the requester (cloud mode only, v4). */
  userId?: string;
}

export interface Withdrawal {
  id: string;
  currency: DepositCurrency;
  /** USD value to withdraw (demo denomination). */
  amount: number;
  /** Destination address the payout goes to. */
  address: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string; // ISO
  userEmail?: string;
  /** Supabase profiles.id of the requester (cloud mode only, v4). */
  userId?: string;
  /** v8 — has the requester clicked the emailed confirmation link? The
   *  admin can only APPROVE a confirmed withdrawal (reject/refund always
   *  works). Local-mode rows are implicitly confirmed (`undefined` — there
   *  is no email step without Supabase); render the "Confirmed" badge for
   *  `confirmed !== false`. */
  confirmed?: boolean;
}

export interface ChatMessage {
  id: string;
  marketId: string;
  author: string;
  text: string;
  createdAt: string; // ISO
}

export interface AuthUser {
  email: string;
  username: string;
  isAdmin: boolean;
}

export interface Position {
  id: string;
  marketId: string;
  side: Side;
  shares: number;
  avgPrice: number;
  createdAt: string;
}

export interface CreateMarketInput {
  question: string;
  description?: string;
  /** Built-in category value or a custom category slug (v3). */
  category: string;
  endDate: string; // ISO
  resolution: ResolutionMethod;
}

/** The mutable slice of a market that survives reloads via the store. */
export type MarketOverride = Pick<
  Market,
  'yesPrice' | 'volume' | 'liquidity' | 'priceHistory' | 'status' | 'resolvedOutcome'
>;

/** Built-in categories only. For the full list (built-ins + admin-created
 *  custom categories) use `useCategories()` from lib/useMarkets.ts. */
export const CATEGORIES: { value: BuiltinCategory; label: string }[] = [
  { value: 'politics', label: 'Politics' },
  { value: 'sports', label: 'Sports' },
  { value: 'football', label: 'Football' },
  // v12 — split out of Sports for the US audience (NBA / MLB).
  { value: 'basketball', label: 'Basketball' },
  { value: 'baseball', label: 'Baseball' },
  { value: 'esports', label: 'Esports' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'economy', label: 'Economy' },
  { value: 'tech-science', label: 'Tech & Science' },
  { value: 'world', label: 'World' },
  { value: 'pop-culture', label: 'Pop culture' },
  { value: 'custom', label: 'Custom' },
];

/** Resolve a category label against the built-ins plus an optional custom
 *  category list. Unknown values fall back to the raw value. */
export function resolveCategoryLabel(
  value: string,
  customCategories?: readonly { value: string; label: string }[]
): string {
  return (
    CATEGORIES.find((x) => x.value === value)?.label ??
    customCategories?.find((x) => x.value === value)?.label ??
    value
  );
}

/** Built-in label lookup; pass the store's `customCategories` as the second
 *  argument to also resolve custom category labels. */
export function categoryLabel(
  c: string,
  custom?: readonly { value: string; label: string }[]
): string {
  return resolveCategoryLabel(c, custom);
}
