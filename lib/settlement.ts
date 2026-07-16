import type { Side } from './types';

/**
 * v6/v7 — READ A FEED MARKET'S STATE FROM ITS SOURCE: is it still open, and
 * if it is done, who won?
 *
 * The owner's question was: can Polymarket and Kalshi tell us who won, so
 * the admin only has to look at community markets, deposits and
 * withdrawals? They can, and this module is the reading half of that.
 *
 * v7 WIDENED THE JOB, AND THIS IS THE MONEY-CRITICAL PART. `place_trade`
 * gates a feed market on `markets.source_closed` — not on `end_date` (see
 * the v7 notes: upstream, `endDate` is the KICKOFF on a game). Nothing
 * else in the app can ever set that flag TRUE:
 *
 *   - the discovery feed (lib/polymarket.ts / lib/kalshi.ts) is queried with
 *     `closed=false&active=true`, and BOTH mappers drop closed rows before
 *     they would compute the flag. When a market closes upstream it simply
 *     VANISHES from that payload;
 *   - so the DB row keeps `source_closed = false` forever, and a market
 *     whose result the source already knows stays tradeable at a stale
 *     price. That is someone buying a known outcome.
 *
 * The fix is this module: poll the markets WE TRACK, BY ID, and let the
 * source answer for each one. Absence from the discovery feed is NOT an
 * answer — that feed is a top-100-by-volume window, so "missing" almost
 * always just means "not trending", and freezing those would break live
 * markets.
 *
 * PURE: no DB access, no service key, no side effects. It takes the market
 * rows a caller already selected and reports only what a source actually
 * said. `app/api/settle/route.ts` owns the DB half (select -> here ->
 * `source_closed` write + `settle_feed_market` RPC).
 *
 * THE CONTRACT THAT MATTERS: this function NEVER throws and NEVER guesses.
 * Both of the things it reports move real money in one direction only —
 * freezing a market stops trade on it, settling one pays a pool out and
 * cannot be undone — so anything less than certain is simply OMITTED. A
 * market we skip is retried on the next run 15 minutes later, which costs
 * nothing. A market we freeze wrong is a live market nobody can trade; a
 * market we settle wrong costs the funder their collateral.
 *
 * **A FAILED LOOKUP IS NEVER REPORTED AS CLOSED.** Every network failure
 * (timeout, 500, garbage JSON, one bad chunk) is contained to its own chunk
 * via `Promise.allSettled` and yields no entry at all, so a Kalshi outage
 * can never stop Polymarket markets from settling — and can never freeze a
 * Kalshi market either.
 */

/** A market to look up: our id + where it came from. */
export interface SettlementCandidate {
  id: string;
  /** v6 `markets.provider`. Only 'polymarket' and 'kalshi' are pollable —
   *  'callit' markets are decided by people, not an API. */
  provider: string | null | undefined;
  /** v6 `markets.provider_ref` — the source's own id/slug/ticker. */
  providerRef: string | null | undefined;
}

/**
 * What a source SAID about one of our markets.
 *
 * An entry exists only when a provider answered for that market. No entry =
 * "still open, not sure, or the source did not answer" — and all three mean
 * the same thing to the caller: change nothing, ask again next cycle.
 */
export interface SourceState {
  id: string;
  /** The provider's own verdict, mirrored to `markets.source_closed`.
   *
   *  Only ever `true` on POSITIVE evidence (Gamma returned the row under
   *  `closed=true`; Kalshi reported a non-active `status`). Polymarket rows
   *  can never report `false` here — see `polymarketStates()` — so treat a
   *  missing entry as "no news", never as "open". */
  sourceClosed: boolean;
  /** Set ONLY when the source's result is unambiguous. A closed market with
   *  no confident outcome yet reports `sourceClosed: true` and no outcome:
   *  freeze it now, settle it once the source makes up its mind. */
  outcome?: Side;
}

/** Per-request timeout. The poller runs on a cron, so a slow source should
 *  be dropped and retried next cycle rather than hold the route open. */
const FETCH_TIMEOUT_MS = 5_000;

/** Gamma takes repeated `id=`/`slug=` params; keep URLs short and payloads
 *  small. Chunked so one bad id cannot poison a whole run. */
const POLYMARKET_CHUNK = 25;

/** Kalshi batches via a comma-joined `tickers=`. Tickers are long (~55
 *  chars), so 20 keeps the URL well under any sane length limit. */
const KALSHI_CHUNK = 20;

const GAMMA_MARKETS_URL = 'https://gamma-api.polymarket.com/markets';
const KALSHI_MARKETS_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets';

/**
 * Price at/above this on the Yes side = the source is paying Yes $1.
 * Resolved Polymarket markets report an exact "0"/"1", so this is a
 * tolerance for float noise, NOT a confidence threshold: 0.97 is a market
 * that is nearly certain but still TRADING, and must never be settled.
 */
const RESOLVED_YES = 0.99;
const RESOLVED_NO = 0.01;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Index a chunk's candidates by the SOURCE's ref -> every one of OUR market
 * ids using it.
 *
 * One ref can legitimately back several of our rows (the same upstream
 * market mirrored both as a flat market and as an event outcome, a
 * re-imported row, a Kalshi ticker reused across groupings). Nothing in the
 * schema makes `provider_ref` unique, so a plain `Map<ref, id>` would let
 * the last candidate silently overwrite the others and leave those markets
 * unsettled forever — with the run still reporting success.
 */
function indexByRef(group: { id: string; ref: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of group) {
    const ids = map.get(c.ref);
    if (ids) ids.push(c.id);
    else map.set(c.ref, [c.id]);
  }
  return map;
}

/** JSON fetch that resolves `null` instead of throwing — on timeout, a
 *  non-2xx, or a body that is not JSON. */
async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

/* ------------------------------------------------------------------ */
/* Polymarket                                                          */
/* ------------------------------------------------------------------ */

/**
 * `outcomePrices` arrives JSON-encoded (`'["0", "1"]'`), and index 0 is the
 * Yes side. That indexing is not a guess: `mapGammaMarket()` in
 * lib/polymarket.ts sets our `yesPrice` from `outcomePrices[0]` too, so
 * index 0 is by construction the side our book calls Yes — including for
 * event outcomes whose labels are ["France", "Spain"] rather than
 * ["Yes", "No"].
 */
function parseYesPrice(raw: unknown): number | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const p = parseFloat(String(value[0]));
  return Number.isFinite(p) ? p : null;
}

/**
 * A Polymarket row -> a confident outcome, or null.
 *
 * ALL THREE conditions must hold: the market is `closed`, UMA says
 * `resolved`, and the winning side is paying a full dollar. A market that
 * is closed but still in UMA's dispute window has real prices and no final
 * answer — settling it would front-run the source's own arbitration.
 */
function polymarketOutcome(row: Record<string, unknown>): Side | null {
  if (row.closed !== true) return null;

  const uma = typeof row.umaResolutionStatus === 'string' ? row.umaResolutionStatus : '';
  if (uma.toLowerCase() !== 'resolved') return null;

  const yes = parseYesPrice(row.outcomePrices ?? row.outcome_prices);
  if (yes === null) return null;

  if (yes >= RESOLVED_YES) return 'yes';
  if (yes <= RESOLVED_NO) return 'no';
  // Anything in between is ambiguous (a "resolved to Other"/50-50 payout,
  // or a mid-arbitration snapshot). Skip it — an admin can settle by hand.
  return null;
}

/**
 * Gamma's `?id=` / `?slug=` filters DEFAULT TO `closed=false`, so querying
 * a market by id returns an empty array once it closes unless `closed=true`
 * is passed explicitly. RE-VERIFIED against the live API while writing v7's
 * source-state refresher:
 *
 *   ?id=<closed>              -> []            (0 rows — the default filter)
 *   ?id=<closed>&closed=true  -> the row, closed=true, uma=resolved
 *   ?id=<open>                -> the row, closed=false
 *   ?id=<open>&closed=true    -> []
 *
 * This is why the refresher CANNOT simply "poll by id without a closed
 * filter" and read `closed` off the row: with no filter, a closed market is
 * indistinguishable from a deleted one — both are zero rows.
 *
 * So the query IS the question. `closed=true` asks "which of these are
 * closed?", and a row coming back is POSITIVE evidence of closure. Markets
 * that do not come back are reported as nothing at all, never as open: an
 * empty response is also what a 500, a timeout or a bad id looks like, and
 * "the source did not answer" must never freeze or settle anything.
 */
async function polymarketStates(
  candidates: { id: string; ref: string }[]
): Promise<SourceState[]> {
  // Gamma matches numeric refs on `id` and everything else on `slug`.
  const byId = candidates.filter((c) => /^\d+$/.test(c.ref));
  const bySlug = candidates.filter((c) => !/^\d+$/.test(c.ref));

  const requests: { param: 'id' | 'slug'; group: { id: string; ref: string }[] }[] = [
    ...chunk(byId, POLYMARKET_CHUNK).map((group) => ({ param: 'id' as const, group })),
    ...chunk(bySlug, POLYMARKET_CHUNK).map((group) => ({ param: 'slug' as const, group })),
  ];

  const settled = await Promise.allSettled(
    requests.map(async ({ param, group }) => {
      // De-dupe the refs themselves: several of our ids can share one ref,
      // and asking Gamma for the same id twice would waste the chunk budget.
      const ours = indexByRef(group);
      const refs = [...ours.keys()];
      const query = refs.map((ref) => `${param}=${encodeURIComponent(ref)}`).join('&');
      const url = `${GAMMA_MARKETS_URL}?closed=true&limit=${refs.length}&${query}`;
      const data = await fetchJson(url);
      if (!Array.isArray(data)) return [];

      const states: SourceState[] = [];
      for (const raw of data) {
        const row = asRecord(raw);
        if (!row) continue;
        const ref = param === 'id' ? String(row.id ?? '') : String(row.slug ?? '');
        const marketIds = ours.get(ref);
        if (!marketIds) continue;
        // Trust the ROW, not the query string. If Gamma ever loosens that
        // filter, an open market must not be frozen because of the URL we
        // happened to send.
        if (row.closed !== true) continue;
        // Closed is enough to FREEZE. The outcome is a separate, stricter
        // question (`polymarketOutcome` also demands UMA `resolved` and a
        // full-dollar price) and stays undefined until the source is
        // unambiguous — a market in UMA's dispute window freezes now and
        // settles later.
        const outcome = polymarketOutcome(row) ?? undefined;
        for (const id of marketIds) states.push({ id, sourceClosed: true, outcome });
      }
      return states;
    })
  );

  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/* ------------------------------------------------------------------ */
/* Kalshi                                                              */
/* ------------------------------------------------------------------ */

/** Kalshi is explicit: a market is done when `status` is finalized/settled
 *  AND `result` is 'yes'/'no'. An open market carries `result: ''`, and a
 *  voided one reports something other than yes/no — both are skipped. */
function kalshiOutcome(row: Record<string, unknown>): Side | null {
  const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
  if (status !== 'finalized' && status !== 'settled') return null;

  const result = typeof row.result === 'string' ? row.result.toLowerCase() : '';
  if (result === 'yes') return 'yes';
  if (result === 'no') return 'no';
  return null;
}

/**
 * Kalshi is the easy one: `?tickers=a,b,c` returns rows of ANY status, so a
 * single query answers both questions at once. Verified live — a batch of
 * one `active` + one `finalized` ticker returns both, with their real
 * `status`/`result`.
 *
 * That makes Kalshi the only provider here that can report `sourceClosed:
 * false` POSITIVELY ("we asked, it is still active"), rather than by
 * staying silent.
 *
 * Also verified live, and the reason the silence rule is absolute: asking
 * for 3 active tickers returned only 2. These markets churn by the minute,
 * and a row can vanish between one call and the next. A missing ticker is
 * NOT a closed ticker.
 */
async function kalshiStates(
  candidates: { id: string; ref: string }[]
): Promise<SourceState[]> {
  const settled = await Promise.allSettled(
    chunk(candidates, KALSHI_CHUNK).map(async (group) => {
      const ours = indexByRef(group);
      const url = `${KALSHI_MARKETS_URL}?tickers=${encodeURIComponent([...ours.keys()].join(','))}`;
      const data = asRecord(await fetchJson(url));
      const rows = data?.markets;
      if (!Array.isArray(rows)) return [];

      const states: SourceState[] = [];
      for (const raw of rows) {
        const row = asRecord(raw);
        if (!row) continue;
        const marketIds = ours.get(String(row.ticker ?? ''));
        if (!marketIds) continue;
        // No readable status = the row told us nothing. Say nothing back:
        // defaulting a blank to "not active" would freeze it.
        const status = typeof row.status === 'string' ? row.status.toLowerCase() : '';
        if (!status) continue;
        // Kalshi's own words: anything but 'active' (finalized / settled /
        // closed / determined) means it is done trading upstream.
        const sourceClosed = status !== 'active';
        const outcome = kalshiOutcome(row) ?? undefined;
        for (const id of marketIds) states.push({ id, sourceClosed, outcome });
      }
      return states;
    })
  );

  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ask each provider about the markets we track: which are closed upstream,
 * and which of those have a result we can act on?
 *
 * This is the ONE network primitive behind both halves of the settle job —
 * the same lookup answers "freeze it?" and "settle it?", so asking twice
 * would only double the request budget. Callers act on `sourceClosed` and
 * `outcome` independently.
 *
 * Returns ONLY what a source actually said. A market missing from the
 * return value means "still open, not sure, or the source did not answer",
 * and all three mean the same thing to the caller: change nothing and ask
 * again next cycle. Never throws.
 */
export async function fetchSourceState(
  markets: SettlementCandidate[]
): Promise<SourceState[]> {
  const polymarket: { id: string; ref: string }[] = [];
  const kalshi: { id: string; ref: string }[] = [];

  // De-dupe by our market id: a duplicated row would otherwise produce two
  // RPC calls, and the second would raise 'This market is already resolved'
  // and be counted as an error on a run that actually went perfectly.
  const seen = new Set<string>();
  for (const m of markets) {
    const ref = m.providerRef?.trim();
    if (!m?.id || !ref || seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.provider === 'polymarket') polymarket.push({ id: m.id, ref });
    else if (m.provider === 'kalshi') kalshi.push({ id: m.id, ref });
    // 'callit' and unknown providers have no result API — not our job.
  }

  // One provider being down must not hide the other's answers.
  const [pm, kx] = await Promise.allSettled([
    polymarket.length ? polymarketStates(polymarket) : Promise.resolve([]),
    kalshi.length ? kalshiStates(kalshi) : Promise.resolve([]),
  ]);

  return [
    ...(pm.status === 'fulfilled' ? pm.value : []),
    ...(kx.status === 'fulfilled' ? kx.value : []),
  ];
}
