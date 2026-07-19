import type { EventGroup, GameScore, ScoreGoal, ScoreSide } from './types';

/**
 * ESPN live-score provider (v21) — the data behind /api/scores.
 *
 * Uses ESPN's PUBLIC site API (site.api.espn.com — unauthenticated, the
 * same one their own site reads). We only ever READ scoreboards; nothing
 * is written anywhere. Each game event in our feed carries its two teams
 * and a Gamma league code (see EventGroup.teams); this module maps that
 * code to an ESPN scoreboard, fetches the day's games and matches ours by
 * team NAME (normalized) — not abbreviation-first, because the two feeds
 * disagree there (verified live: Gamma 'cws' vs ESPN 'CHW' for the White
 * Sox, while names are byte-identical).
 *
 * REQUEST BUDGET (public API — stay polite): one request per league+day
 * actually on screen, memoized for SCORE_CACHE_MS (30s). A typical cycle
 * is 3-5 leagues => ~0.15 req/s worst case. Failures are silent per
 * league: a broken scoreboard never breaks the others, and the whole
 * module never throws — /api/scores degrades to fewer scores.
 */

/** Gamma league code (EventGroup.teams[].league) -> ESPN scoreboard path.
 *  Unknown codes (esports, niche leagues) simply get no live score. */
const LEAGUE_PATHS: Record<string, string> = {
  // Soccer
  fifwc: 'soccer/fifa.world',
  epl: 'soccer/eng.1',
  laliga: 'soccer/esp.1',
  bundesliga: 'soccer/ger.1',
  seriea: 'soccer/ita.1',
  ligue1: 'soccer/fra.1',
  ucl: 'soccer/uefa.champions',
  uel: 'soccer/uefa.europa',
  mls: 'soccer/usa.1',
  ligamx: 'soccer/mex.1',
  swe: 'soccer/swe.1',
  // US sports
  mlb: 'baseball/mlb',
  nba: 'basketball/nba',
  nbasl: 'basketball/nba',
  wnba: 'basketball/wnba',
  nhl: 'hockey/nhl',
  nfl: 'football/nfl',
};

/** Only games near their kickoff get a scoreboard lookup: from 12h before
 *  (pre-game "Scheduled" state) to 12h after (final whistle + FT display). */
const LOOKUP_BEFORE_MS = 12 * 60 * 60 * 1000;
const LOOKUP_AFTER_MS = 12 * 60 * 60 * 1000;

/** Per-league+day scoreboard cache. 30s: live scores should move with the
 *  match, and one request per league per 30s is far under any public
 *  ceiling. An empty/failed page is NOT cached (transient outage must not
 *  blank the ticker for its whole window). */
const SCORE_CACHE_MS = 30_000;

const REQUEST_TIMEOUT_MS = 4000;

/** Hard cap on distinct scoreboard fetches per getEspnScores call. */
const MAX_BOARDS_PER_CYCLE = 8;

/* ------------------------------------------------------------------ */
/* Raw ESPN shapes (only what we read)                                 */
/* ------------------------------------------------------------------ */

interface EspnTeam {
  id?: unknown;
  displayName?: unknown;
  shortDisplayName?: unknown;
  abbreviation?: unknown;
  logo?: unknown;
}

interface EspnCompetitor {
  homeAway?: unknown;
  score?: unknown;
  team?: EspnTeam;
  linescores?: unknown;
}

interface EspnDetail {
  type?: { text?: unknown };
  clock?: { value?: unknown; displayValue?: unknown };
  team?: { id?: unknown };
  scoringPlay?: unknown;
  athletesInvolved?: unknown;
}

interface EspnCompetition {
  competitors?: unknown;
  status?: { displayClock?: unknown; type?: { state?: unknown; shortDetail?: unknown } };
  details?: unknown;
}

interface EspnEvent {
  date?: unknown;
  name?: unknown;
  competitions?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ */
/* Scoreboard fetch + cache                                            */
/* ------------------------------------------------------------------ */

const boardCache = new Map<string, { at: number; p: Promise<EspnEvent[]> }>();

async function fetchBoard(path: string, yyyymmdd: string): Promise<EspnEvent[]> {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${yyyymmdd}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${path}`);
  const data = (await res.json()) as { events?: unknown };
  return Array.isArray(data.events) ? (data.events as EspnEvent[]) : [];
}

function getBoard(path: string, yyyymmdd: string): Promise<EspnEvent[]> {
  const key = `${path}|${yyyymmdd}`;
  const now = Date.now();
  const hit = boardCache.get(key);
  if (hit && now - hit.at < SCORE_CACHE_MS) return hit.p;
  const entry = { at: now, p: fetchBoard(path, yyyymmdd).catch((): EspnEvent[] => []) };
  boardCache.set(key, entry);
  void entry.p.then((events) => {
    if (events.length === 0 && boardCache.get(key) === entry) boardCache.delete(key);
  });
  return entry.p;
}

/* ------------------------------------------------------------------ */
/* Team matching                                                       */
/* ------------------------------------------------------------------ */

/** Normalize a team name for comparison: lowercase, ASCII, single spaces. */
export function normTeamName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does OUR team name refer to this ESPN competitor? Exact normalized name
 * first (the common case — national teams and MLB clubs match verbatim),
 * then abbreviation, then a token-subset test ("Man City" ⊂ "Manchester
 * City" fails tokenwise, but "Athletics" ⊂ "Oakland Athletics" holds; the
 * subset side must be at least one real token).
 */
function teamMatches(ourName: string, ourAbbr: string | undefined, c: EspnCompetitor): boolean {
  const t = c.team ?? {};
  const ours = normTeamName(ourName);
  if (!ours) return false;
  const names = [str(t.displayName), str(t.shortDisplayName)].map(normTeamName);
  if (names.some((n) => n && n === ours)) return true;
  const abbr = str(t.abbreviation).toLowerCase();
  if (ourAbbr && abbr && ourAbbr.toLowerCase() === abbr) return true;
  // Token subset either way (min 1 token, each token len >= 3).
  const ourTokens = ours.split(' ').filter((x) => x.length >= 3);
  for (const n of names) {
    if (!n) continue;
    const theirs = new Set(n.split(' '));
    if (ourTokens.length > 0 && ourTokens.every((x) => theirs.has(x))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Mapping one ESPN event -> GameScore                                 */
/* ------------------------------------------------------------------ */

function mapSide(c: EspnCompetitor): ScoreSide {
  const t = c.team ?? {};
  const linescores = Array.isArray(c.linescores)
    ? (c.linescores as { value?: unknown }[]).map((x) => num(x?.value))
    : undefined;
  return {
    name: str(t.displayName) || str(t.shortDisplayName) || 'Team',
    abbreviation: str(t.abbreviation) || undefined,
    logo: str(t.logo) || undefined,
    score: num(c.score),
    linescores: linescores && linescores.length > 0 ? linescores : undefined,
  };
}

function mapGoals(
  details: EspnDetail[],
  homeId: string,
  awayId: string
): ScoreGoal[] | undefined {
  const goals: ScoreGoal[] = [];
  for (const d of details) {
    if (d?.scoringPlay !== true) continue;
    const teamId = str(d.team?.id);
    const side: 'home' | 'away' | null =
      teamId && teamId === homeId ? 'home' : teamId && teamId === awayId ? 'away' : null;
    if (!side) continue;
    const clockSeconds = num(d.clock?.value);
    const athletes = Array.isArray(d.athletesInvolved)
      ? (d.athletesInvolved as { athlete?: { displayName?: unknown }; displayName?: unknown }[])
      : [];
    const player =
      str(athletes[0]?.athlete?.displayName) || str(athletes[0]?.displayName) || undefined;
    goals.push({
      minute: str(d.clock?.displayValue) || `${Math.round(clockSeconds / 60)}'`,
      minuteValue: clockSeconds > 0 ? clockSeconds / 60 : undefined,
      side,
      player,
      type: str(d.type?.text) || undefined,
    });
  }
  return goals.length > 0 ? goals : undefined;
}

function mapEspnEvent(e: EspnEvent, leaguePath: string): GameScore | null {
  const comp = (Array.isArray(e.competitions) ? e.competitions[0] : undefined) as
    | EspnCompetition
    | undefined;
  if (!comp) return null;
  const competitors = Array.isArray(comp.competitors)
    ? (comp.competitors as EspnCompetitor[])
    : [];
  const home = competitors.find((c) => str(c.homeAway) === 'home');
  const away = competitors.find((c) => str(c.homeAway) === 'away');
  if (!home || !away) return null;

  const rawState = str(comp.status?.type?.state);
  const state: GameScore['state'] =
    rawState === 'in' ? 'in' : rawState === 'post' ? 'post' : 'pre';
  const isSoccer = leaguePath.startsWith('soccer/');
  const details = Array.isArray(comp.details) ? (comp.details as EspnDetail[]) : [];

  return {
    state,
    detail: str(comp.status?.type?.shortDetail) || (state === 'in' ? 'Live' : state === 'post' ? 'Final' : 'Scheduled'),
    clock: str(comp.status?.displayClock) || undefined,
    startDate: str(e.date) || undefined,
    home: mapSide(home),
    away: mapSide(away),
    goals: isSoccer
      ? mapGoals(details, str(home.team?.id), str(away.team?.id))
      : undefined,
    regulation: isSoccer ? 90 : undefined,
    league: leaguePath,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** The kickoff a game event's markets agree on. */
function kickoffOf(e: EventGroup): number {
  const t = e.markets.find((m) => m.startTime)?.startTime;
  const n = t ? new Date(t).getTime() : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Live scores for every game event in the feed that is near its kickoff,
 * keyed by OUR event id. Never throws; unmatched games are simply absent.
 */
export async function getEspnScores(
  events: EventGroup[]
): Promise<Record<string, GameScore>> {
  const now = Date.now();

  // Candidates: game events with two known teams and a mapped league,
  // inside the lookup window around their kickoff.
  const candidates: { event: EventGroup; path: string; day: string; kickoff: number }[] = [];
  for (const e of events) {
    if (!e.groups?.length || !e.teams || e.teams.length < 2) continue;
    const league = e.teams[0].league ?? e.teams[1].league;
    const path = league ? LEAGUE_PATHS[league] : undefined;
    if (!path) continue;
    const kickoff = kickoffOf(e);
    if (!Number.isFinite(kickoff)) continue;
    if (kickoff < now - LOOKUP_AFTER_MS || kickoff > now + LOOKUP_BEFORE_MS) continue;
    candidates.push({ event: e, path, day: utcDayOf(kickoff), kickoff });
  }
  if (candidates.length === 0) return {};

  // One fetch per distinct league+day, capped.
  const boardKeys = [...new Set(candidates.map((c) => `${c.path}|${c.day}`))].slice(
    0,
    MAX_BOARDS_PER_CYCLE
  );
  const boards = new Map<string, EspnEvent[]>();
  await Promise.all(
    boardKeys.map(async (key) => {
      const [path, day] = key.split('|');
      boards.set(key, await getBoard(path, day));
    })
  );

  const out: Record<string, GameScore> = {};
  for (const c of candidates) {
    const board = boards.get(`${c.path}|${c.day}`);
    if (!board || board.length === 0) continue;
    const [a, b] = c.event.teams as [
      { name: string; abbreviation?: string },
      { name: string; abbreviation?: string },
    ];
    for (const espn of board) {
      const comp = (Array.isArray(espn.competitions) ? espn.competitions[0] : undefined) as
        | EspnCompetition
        | undefined;
      const competitors = Array.isArray(comp?.competitors)
        ? (comp!.competitors as EspnCompetitor[])
        : [];
      if (competitors.length < 2) continue;
      // Both of our teams must match two DIFFERENT competitors.
      const ia = competitors.findIndex((x) => teamMatches(a.name, a.abbreviation, x));
      if (ia < 0) continue;
      const ib = competitors.findIndex(
        (x, i) => i !== ia && teamMatches(b.name, b.abbreviation, x)
      );
      if (ib < 0) continue;
      // Same match, not just same fixture name: dates within 24h.
      const espnDate = new Date(str(espn.date)).getTime();
      if (Number.isFinite(espnDate) && Math.abs(espnDate - c.kickoff) > 24 * 60 * 60 * 1000) {
        continue;
      }
      const score = mapEspnEvent(espn, c.path);
      if (score) out[c.event.id] = score;
      break;
    }
  }
  return out;
}
