import type { Category, EventTeam } from './types';

/**
 * v25.6 — THE SPORT HUB. One "Sports" tab in the category bar instead of
 * four, with the individual sports as filter chips inside it.
 *
 * WHY THE HUB AND NOT A POLYMARKET-STYLE LEAGUE SIDEBAR: measured against
 * the live book while this was written — 51 sport events in total, split
 * Baseball 17 / Basketball 15 / Soccer 11 / Tennis 4 / UFC 1. Polymarket
 * can afford a sidebar because each of its rows holds a full day's slate
 * (MLB 126, UFC 25); at our size a fixed 8-row sidebar would average ~7
 * events per row with several at 1, and sub-navigation that leads to empty
 * pages makes a small book feel smaller. Chips that only render for sports
 * that HAVE something degrade gracefully in both directions: they stay
 * honest at 51 events and still work at 500.
 *
 * Esports deliberately keeps its own hub — it is not a sport bucket here
 * (Polymarket splits it out too), and at 15 events it carries a tab.
 */

/** The categories the Sports hub aggregates. `sports` itself is the hub's
 *  own route, so it heads the list. Order is only used for tie-breaks. */
export const SPORT_HUB_CATEGORIES: readonly Category[] = [
  'sports',
  'football',
  'basketball',
  'baseball',
];

/** The hub's route — `/category/sports`. */
export const SPORT_HUB: Category = 'sports';

export function isSportHubCategory(c: string): boolean {
  return (SPORT_HUB_CATEGORIES as readonly string[]).includes(c);
}

/** A chip. `all` is the unfiltered hub and is always first. */
export type SportKey =
  | 'all'
  | 'baseball'
  | 'basketball'
  | 'soccer'
  | 'tennis'
  | 'ufc'
  | 'cricket'
  | 'nfl'
  | 'nhl'
  | 'motorsport'
  | 'golf'
  | 'boxing'
  | 'other';

export const SPORT_LABELS: Record<SportKey, string> = {
  all: 'All',
  baseball: 'Baseball',
  basketball: 'Basketball',
  soccer: 'Football',
  tennis: 'Tennis',
  ufc: 'UFC',
  cricket: 'Cricket',
  nfl: 'NFL',
  nhl: 'NHL',
  motorsport: 'Motorsport',
  golf: 'Golf',
  boxing: 'Boxing',
  other: 'Other',
};

/**
 * Gamma league codes -> our sport, for the ones that actually appear on
 * `EventTeam.league`. Enumerated from the live feed rather than guessed:
 * mlb, ufc, atp, wta plus the soccer country codes (chi, kor, mls, swe).
 *
 * Soccer codes are NOT listed — they are open-ended country/competition
 * slugs and a new one appears whenever a league is added. `category` already
 * answers soccer authoritatively (Gamma's own `soccer`/league tags drive it,
 * see TAG_CATEGORIES), so this map only has to split the `sports` leftover.
 */
const LEAGUE_SPORTS: Record<string, SportKey> = {
  mlb: 'baseball',
  nba: 'basketball',
  wnba: 'basketball',
  nbasl: 'basketball',
  ufc: 'ufc',
  atp: 'tennis',
  wta: 'tennis',
  nfl: 'nfl',
  nhl: 'nhl',
};

/**
 * Last-resort title matching, and ONLY for the `sports` leftover bucket —
 * never for an event whose category already names its sport.
 *
 * The vocabulary is taken from the project's own `TAG_CATEGORIES` entry for
 * `sports` (lib/polymarket.ts: nfl, nhl, tennis, ufc, mma, boxing, f1, golf,
 * cricket) so the two lists cannot drift apart: every sport Gamma can tag
 * into this bucket has a way back out of it.
 *
 * Cricket earns its patterns from real rows — 'ODI Series Sri Lanka vs
 * Pakistan', 'T20 Series Zimbabwe vs India', 'The Hundred, Women' were all
 * sitting in "Other" before this list existed.
 */
const TITLE_SPORTS: [SportKey, RegExp][] = [
  ['ufc', /\b(ufc|mma|bellator)\b/i],
  ['cricket', /\b(cricket|odi|t20|the hundred|test series)\b/i],
  ['nfl', /\b(nfl|super bowl)\b/i],
  ['nhl', /\b(nhl|stanley cup)\b/i],
  // 'indycar' earned its slot when the `motorsports` tag pull went live:
  // "NTT IndyCar Series: 2026 Champion" matched nothing else here.
  ['motorsport', /\b(f1|formula 1|formula one|grand prix|nascar|motogp|indycar)\b/i],
  ['golf', /\b(golf|pga|masters tournament|ryder cup)\b/i],
  ['boxing', /\b(boxing|heavyweight title)\b/i],
  ['tennis', /\b(tennis|wimbledon|us open|roland garros|australian open|atp|wta)\b/i],
  ['basketball', /\b(nba|wnba|basketball)\b/i],
  ['baseball', /\b(mlb|baseball|world series)\b/i],
  ['soccer', /\b(soccer|premier league|bundesliga|la liga|serie a|uefa|fifa)\b/i],
];

/**
 * Which sport does this event / market belong to?
 *
 * ORDER MATTERS, and it is deliberately most-trustworthy-first:
 *
 *  1. `category` for the three sports that have their own — Gamma's event
 *     TAGS drive those (`nba`, `mlb`, `epl`, …), which is the strongest
 *     signal available and the only one that survives an event with no
 *     teams. That is not a rare case: 24 of the 51 hub events are futures
 *     ("NBA: LeBron James Next Team", "Ballon d'Or Winner 2026") and carry
 *     `teams: []`, so a teams-first rule would drop half the book into
 *     "Other".
 *  2. `teams[].league` to split what is left in the generic `sports`
 *     bucket, where tennis (atp/wta) and UFC live with no category of
 *     their own.
 *  3. The title, last, and only for that same leftover.
 *
 * Everything unresolved is 'other' rather than a guess — the chip only
 * appears when something is actually in it.
 */
export function sportOf(item: {
  category: string;
  teams?: readonly EventTeam[];
  /** Event title or market question. */
  text?: string;
}): SportKey {
  switch (item.category) {
    case 'baseball':
      return 'baseball';
    case 'basketball':
      return 'basketball';
    case 'football':
      return 'soccer';
    default:
      break;
  }

  for (const t of item.teams ?? []) {
    const hit = t.league ? LEAGUE_SPORTS[t.league.toLowerCase().trim()] : undefined;
    if (hit) return hit;
  }

  const text = item.text ?? '';
  if (text) {
    for (const [sport, re] of TITLE_SPORTS) {
      if (re.test(text)) return sport;
    }
  }

  return 'other';
}

/**
 * The chips to render, counted over everything in the hub and sorted by
 * size, with 'all' pinned first and 'other' pinned last.
 *
 * A sport with nothing in it produces NO chip — that is the whole point of
 * doing this dynamically rather than hard-coding a sidebar.
 */
export function sportChips(
  items: readonly { category: string; teams?: readonly EventTeam[]; text?: string }[]
): { key: SportKey; label: string; count: number }[] {
  const counts = new Map<SportKey, number>();
  for (const item of items) {
    const key = sportOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const chips = [...counts.entries()]
    .map(([key, count]) => ({ key, label: SPORT_LABELS[key], count }))
    .sort((a, b) => {
      // 'other' is a catch-all, never a headline — it sits at the end
      // regardless of how big it gets.
      if ((a.key === 'other') !== (b.key === 'other')) return a.key === 'other' ? 1 : -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });

  // The "All" chip is pointless when there is only one real sport to show.
  if (chips.length < 2) return chips;
  return [{ key: 'all' as const, label: SPORT_LABELS.all, count: items.length }, ...chips];
}
