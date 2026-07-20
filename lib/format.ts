/** Formatting helpers — prices in Polymarket-style cent notation (62¢),
 *  money with tabular-friendly output, and countdown labels. */

import type { GameScore, Market, Side } from './types';

/**
 * How long past `startTime` a market may still show LIVE.
 *
 * This is a SANITY CAP, not the rule. The rule is that the SOURCE closing the
 * market is what ends it (see `isMarketClosed`) — v6's 4h-past-`endDate`
 * window is gone, because `endDate` turned out to be the kickoff. The cap only
 * exists so a dead feed sync can't leave a match showing LIVE forever: 12h is
 * far past any real fixture (the longest verified upstream is a ~6h Test match
 * session) and only ever fires when the sync itself is broken.
 */
export const IN_PLAY_MAX_MS = 12 * 60 * 60 * 1000;

/**
 * How long past `endDate` a still-open feed market stays tradeable.
 *
 * MIRRORS the safety valve in `place_trade` (v7 schema): a feed market is
 * rejected when `end_date + 30 days < now()` AND `source_closed = false`.
 * Client and server MUST agree here — a Yes/No button the server then rejects
 * is the exact class of bug v7 exists to kill.
 */
export const STALE_FEED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Does a FEED own this market's expiry (as opposed to us)?
 *
 * Mirrors the v7 `place_trade` gate, belt-and-braces included: it branches on
 * `provider`, and also treats `source = 'callit'` as ours no matter what
 * `provider` says. That second check is load-bearing — `provider` was added
 * with `default 'polymarket'`, so every pre-v6 row, community markets
 * INCLUDED, was stamped `'polymarket'`.
 */
function isFeedMarket(market: Pick<Market, 'source' | 'provider'>): boolean {
  if (market.source === 'callit') return false;
  return market.provider !== 'callit';
}

/**
 * IS THIS MARKET CLOSED? — the one predicate the whole UI must ask.
 *
 * v7. Use this EVERYWHERE the UI used to do `endDate <= Date.now()`.
 *
 * - FEED markets (`provider`/`source` is polymarket|kalshi): **the source is
 *   the truth** — closed iff `sourceClosed`. `endDate` is NOT consulted,
 *   because upstream it does not mean what its name says: on a game market it
 *   is the KICKOFF (verified: "England vs. Argentina" endDate 19:00 == the
 *   event's startTime, still `closed: false` at minute 83), and on slow
 *   questions it is a stale placeholder ("Next Prime Minister of Ethiopia?",
 *   endDate 2026-06-01, still open). The old end-date rule therefore stamped
 *   "Ended" on a live game and "Closed — awaiting resolution" on open markets.
 *   The 30-day valve is the ONLY end-date input, and only catches a dead sync.
 * - COMMUNITY markets: `endDate` IS the truth. We own that deadline.
 */
export function isMarketClosed(
  market: Pick<Market, 'source' | 'provider' | 'endDate' | 'sourceClosed'>,
  now: number = Date.now()
): boolean {
  const end = new Date(market.endDate).getTime();

  if (isFeedMarket(market)) {
    if (market.sourceClosed === true) return true;
    // Dead-sync valve — mirrors place_trade. An unparseable date can't be
    // measured against, so it can't be stale either; the source still rules.
    return Number.isFinite(end) && end + STALE_FEED_GRACE_MS < now;
  }

  if (!Number.isFinite(end)) return false;
  return end <= now;
}

/**
 * Is this market a LIVE game right now? — the `LIVE` indicator, and NOTHING
 * else.
 *
 * v7 — READ THIS BEFORE REUSING IT. `isInPlay()` is **not** the trade gate.
 * v6 conflated the two (in-play was what unlocked post-`endDate` trading), and
 * that is precisely why a match in its 83rd minute showed "Ended" with its
 * buttons disabled. "Can I trade this?" is now `!isMarketClosed(market)`.
 * Never hide a trade CTA behind this function.
 *
 * True when: the feed marked it a genuinely live game (`inPlayOk` — category
 * NEVER decides this), the source has not closed it, and we are between the
 * real `startTime` and the IN_PLAY_MAX_MS sanity cap. Measuring from
 * `startTime` rather than `endDate` is the fix: they are the SAME instant
 * upstream, so the old `[endDate, endDate+4h)` window started at kickoff and
 * expired at minute ~240 of a match that had long since ended anyway.
 */
export function isInPlay(
  market: Pick<
    Market,
    | 'status'
    | 'source'
    | 'provider'
    | 'endDate'
    | 'inPlayOk'
    | 'sourceClosed'
    | 'startTime'
    | 'sourceLive'
    | 'sourceEnded'
  >,
  now: number = Date.now()
): boolean {
  if (market.status !== 'open') return false;
  if (!market.inPlayOk) return false;
  // v22 — the SOURCE's own match state outranks the clock window when it
  // reports one (Gamma esports events carry live/ended; see Market types).
  // `ended` flips at the final map while `closed` waits for resolution, so
  // without this a finished BO3 stayed "LIVE" for the rest of the 12h
  // window — esports has no ESPN scoreboard to correct it.
  if (market.sourceEnded === true) return false;
  if (isMarketClosed(market, now)) return false;
  if (!market.startTime) return false;
  const start = new Date(market.startTime).getTime();
  if (!Number.isFinite(start)) return false;
  // Sanity cap holds even against an explicit live flag: a payload that
  // stops refreshing must not pin a LIVE badge forever.
  if (now >= start + IN_PLAY_MAX_MS) return false;
  // A provider that tracks this match decides outright — true covers an
  // early start, false a delayed one. No flag: the window heuristic.
  if (market.sourceLive !== undefined) return market.sourceLive;
  return now >= start;
}

/**
 * v23.2 — the text shown NEXT TO a LiveBadge for an in-play score: the
 * clock when the sport runs one, the provider detail otherwise — and ''
 * when that detail would only repeat the badge ("LIVE Live", the owner's
 * doubled-live report: both the ESPN mapper and gammaScoreOf fall back to
 * a literal 'Live' when the source has nothing better). One rule for
 * every ticker surface (match header, stats panel, event card).
 */
export function liveDetailOf(
  score: Pick<GameScore, 'clock' | 'regulation' | 'detail'>
): string {
  const d = (score.regulation && score.clock ? score.clock : score.detail).trim();
  return /^live$/i.test(d) ? '' : d;
}

/** How long a resolved market stays visible in the feeds — winners should
 *  see the outcome, but a market that settled days ago is dead weight. */
export const RESOLVED_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * v9 — true when a RESOLVED market has outlived its feed grace window and
 * should disappear from home/category/search feeds (it stays reachable via
 * direct URL, portfolio history and the admin tables — feeds are gated,
 * lookups are not).
 *
 * The settle time is `resolvedAt` (cloud rows); local rows fall back to the
 * final priceHistory point, which every resolution path appends. A resolved
 * market with NEITHER timestamp is treated as stale — feeds should never
 * carry an unstamped corpse forever.
 */
export function isStaleResolved(
  market: Pick<Market, 'status' | 'resolvedAt' | 'priceHistory'>,
  graceMs: number = RESOLVED_GRACE_MS
): boolean {
  if (market.status !== 'resolved') return false;
  const stamp = market.resolvedAt
    ? new Date(market.resolvedAt).getTime()
    : market.priceHistory.length > 0
      ? market.priceHistory[market.priceHistory.length - 1].t
      : NaN;
  if (!Number.isFinite(stamp)) return true;
  return Date.now() - stamp > graceMs;
}

export function formatCents(price: number): string {
  return `${Math.round(price * 100)}¢`;
}

/**
 * Display name of a market side — the ONE way the UI names a side.
 *
 * Feed sub-markets often have REAL side names ('Over'/'Under' on a totals
 * market, 'England'/'Argentina' on a spread); `Market.yesLabel`/`noLabel`
 * carry them and this falls back to the literal 'Yes'/'No' when they are
 * absent. Labels are presentation only: the side ids ('yes'/'no'), the
 * green/sky colors and all pricing are untouched by them.
 *
 * When only `yesLabel` exists, the no side stays 'No' — never invent a
 * counterpart label.
 */
export function sideLabel(
  market: Pick<Market, 'yesLabel' | 'noLabel'>,
  side: Side
): string {
  return side === 'yes' ? (market.yesLabel ?? 'Yes') : (market.noLabel ?? 'No');
}

/**
 * `sideLabel()` for tight buttons: labels longer than `max` collapse to an
 * uppercase 3-letter code from the LAST word — 'England' -> 'ENG',
 * 'Manchester City' -> 'CIT'; 'Over'/'Under' fit and stay as they are.
 * Words without enough letters are skipped ('Above 50%' -> 'ABO').
 */
export function shortSideLabel(
  market: Pick<Market, 'yesLabel' | 'noLabel'>,
  side: Side,
  max = 10
): string {
  const label = sideLabel(market, side);
  if (label.length <= max) return label;
  const words = label.trim().split(/\s+/);
  // A negated label ('Not Above 30%', Kalshi's no-side pattern) must keep the
  // negation — abbreviating its last lettered word would produce the SAME
  // code as the opposing side ('ABO' vs 'Above 30%').
  if (words.length > 1 && /^not?$/i.test(words[0])) {
    return words[0].toUpperCase();
  }
  for (let i = words.length - 1; i >= 0; i--) {
    const letters = words[i].replace(/[^A-Za-z]/g, '');
    if (letters.length >= 2) return letters.slice(0, 3).toUpperCase();
  }
  const chars = label.replace(/[^A-Za-z0-9]/g, '');
  return chars ? chars.slice(0, 3).toUpperCase() : label.slice(0, max);
}

export function formatPercent(price: number): string {
  return `${Math.round(price * 100)}%`;
}

/** $1,000.00 for exact amounts, $2.4B / $1.2M / $340K compact for volumes. */
export function formatMoney(
  amount: number,
  opts: { compact?: boolean; decimals?: number } = {}
): string {
  if (opts.compact) {
    if (amount >= 1_000_000_000)
      return `$${(amount / 1_000_000_000).toFixed(amount >= 10_000_000_000 ? 0 : 1)}B`;
    if (amount >= 1_000_000)
      return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(amount >= 100_000 ? 0 : 1)}K`;
    return `$${amount.toFixed(0)}`;
  }
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  })}`;
}

export interface TimeLeft {
  label: string; // "3d 4h" | "5h 12m" | "12m" | "Ended" | "Open"
  ended: boolean;
  urgent: boolean; // < 24h remaining
  /** v7 — past `endDate` yet still OPEN (the stale-placeholder case). `label`
   *  is then a standalone status word, so render it bare rather than after
   *  "Ends in". */
  open: boolean;
}

/**
 * Time remaining, or the market's status when there is none.
 *
 * v7 — pass `opts.open` (i.e. `!isMarketClosed(market)`) for anything whose
 * `endDate` the source does not own. A feed market's `endDate` regularly sits
 * in the past while the market is very much open, and rendering "Ended" on it
 * is a lie the trade buttons right next to it immediately contradict. With
 * `open: true` that case labels "Open" and lets the LIVE indicator (or the
 * source itself) say the rest. Community markets pass nothing: their deadline
 * is real, so a past `endDate` genuinely means Ended.
 */
export function formatTimeLeft(
  endDate: string,
  now: number = Date.now(),
  opts: { open?: boolean } = {}
): TimeLeft {
  const diff = new Date(endDate).getTime() - now;
  if (diff <= 0) {
    return opts.open
      ? { label: 'Open', ended: false, urgent: false, open: true }
      : { label: 'Ended', ended: true, urgent: false, open: false };
  }

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label: string;
  if (days >= 30) label = `${Math.floor(days / 30)}mo ${days % 30}d`;
  else if (days > 0) label = `${days}d ${hours % 24}h`;
  else if (hours > 0) label = `${hours}h ${minutes % 60}m`;
  else label = `${minutes}m`;

  return { label, ended: false, urgent: diff < 24 * 60 * 60 * 1000, open: false };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Jul 18, 7:00 PM" in the viewer's timezone; the year appears only when it
 *  is not the current one. '—' for an unparseable date. Client-side only
 *  (locale + timezone vary per viewer). */
export function formatDateTime(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface MarketEndInfo {
  /** Primary answer to "when does this bet end?". */
  label: string;
  /** Muted secondary line (kickoff time, estimate note). */
  detail?: string;
}

/**
 * WHEN DOES THIS BET END — for display next to a position.
 *
 * `endDate` does not mean the same thing everywhere (see `isMarketClosed`),
 * so this branches the same way the close predicate does:
 *
 * - COMMUNITY markets: we own the deadline — `endDate` is shown verbatim as
 *   an absolute date + time.
 * - FEED game markets (`inPlayOk`): upstream `endDate` IS the kickoff, so the
 *   honest answer is "After the game", with the kickoff time as the detail
 *   line (live / upcoming phrased accordingly).
 * - Other FEED markets: `endDate` is the provider's estimate — shown with an
 *   "Estimated" note while it is in the future; once it is past but the
 *   source still has the market open it is a stale placeholder, so the label
 *   degrades to "When outcome is known" rather than lying with a past date.
 * - Resolved / closed markets short-circuit to their settled state.
 */
export function marketEndInfo(
  market: Pick<
    Market,
    | 'source'
    | 'provider'
    | 'status'
    | 'endDate'
    | 'sourceClosed'
    | 'inPlayOk'
    | 'startTime'
    | 'resolvedAt'
  >,
  now: number = Date.now()
): MarketEndInfo {
  if (market.status === 'resolved') {
    return {
      label: 'Resolved',
      detail: market.resolvedAt ? formatDateTime(market.resolvedAt, now) : undefined,
    };
  }
  if (isMarketClosed(market, now)) {
    return { label: 'Ended', detail: 'Awaiting resolution' };
  }

  if (isFeedMarket(market)) {
    if (market.inPlayOk) {
      // Game market — endDate upstream is the kickoff, never the end.
      const startIso = market.startTime ?? market.endDate;
      const start = new Date(startIso).getTime();
      if (!Number.isFinite(start)) return { label: 'After the game' };
      const when = formatDateTime(startIso, now);
      if (isInPlay(market, now)) {
        return { label: 'After the game', detail: `Live — started ${when}` };
      }
      return {
        label: 'After the game',
        detail: start > now ? `Starts ${when}` : `Started ${when}`,
      };
    }
    const end = new Date(market.endDate).getTime();
    if (Number.isFinite(end) && end > now) {
      return { label: formatDateTime(market.endDate, now), detail: 'Estimated' };
    }
    return { label: 'When outcome is known' };
  }

  return { label: formatDateTime(market.endDate, now) };
}

export function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Privacy-censored display name: first 2 + last 1 characters kept, the
 * middle replaced by '***' — e.g. 'mateusz' -> 'ma***z'. Very short names
 * (<= 3 chars) keep only the first character ('bo' -> 'b***'). Market
 * detail pages display `censorName(market.createdBy)` for the creator.
 */
export function censorName(name: string): string {
  const n = name.trim();
  if (!n) return '***';
  if (n.length <= 3) return `${n.slice(0, 1)}***`;
  return `${n.slice(0, 2)}***${n.slice(-1)}`;
}
