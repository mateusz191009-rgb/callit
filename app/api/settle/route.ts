import { timingSafeEqual } from 'node:crypto';
import { fetchSourceState, type SettlementCandidate } from '@/lib/settlement';
import { serviceEnabled, serviceSupabase } from '@/lib/serverSupabase';
import type { Side } from '@/lib/types';

/**
 * v6/v7 — THE SOURCE-STATE REFRESHER AND AUTOMATIC SETTLEMENT OF FEED
 * MARKETS. These are the same job: one lookup answers both.
 *
 * The point of this route, in the owner's words: the admin should only have
 * to look at community events, deposits and withdrawals. Global markets
 * come from Polymarket/Kalshi, both of which publish their own results, so
 * nobody should be reading a scoreboard and clicking Settle by hand.
 *
 * ── WHY THIS ROUTE IS WHAT MAKES THE v7 TRADE GATE REAL ───────────────
 * `place_trade` refuses a feed market when `markets.source_closed` is true,
 * and consults `end_date` for community markets ONLY (v7: upstream,
 * `endDate` is the KICKOFF on a game — gating on it closed live matches).
 *
 * NOTHING ELSE IN THE APP CAN SET `source_closed = true`. The feed sync in
 * `app/api/polymarket/route.ts` does write the column, but it only ever
 * writes `false`: its payload comes from a `closed=false&active=true`
 * discovery query, and both mappers drop closed rows before the flag is
 * computed. A market that closes upstream just VANISHES from that payload,
 * so its row keeps `source_closed = false` forever — leaving a market whose
 * result the source already knows tradeable at a stale price. That is
 * someone buying a known outcome, which is why this runs on a cron.
 *
 * Absence from the discovery feed is deliberately NOT treated as closed:
 * that feed is a top-100-by-volume window, so "missing" nearly always means
 * "not trending", and freezing those would break live markets. Instead this
 * route polls the markets WE TRACK, BY ID, and only ever acts on what a
 * source actually said (lib/settlement.ts).
 *
 * FLOW: select open, non-banned feed markets -> ask each source for their
 * state (confident answers only) -> write `source_closed = true` on the
 * closed ones -> `settle_feed_market` RPC for the ones with a result.
 *
 * FREEZE BEFORE PAYOUT, on purpose: marking `source_closed` is what stops
 * new trades against a known outcome, so it happens first. If the RPC then
 * fails, the market is at least no longer tradeable.
 *
 * The RPC is service_role-only (it refuses any caller with an `auth.uid()`,
 * admins included), which is why this must be a server route holding
 * SUPABASE_SERVICE_ROLE_KEY and never a browser call. The `source_closed`
 * write is a plain service-role UPDATE rather than an RPC — see the note on
 * `markSourceClosed()`.
 *
 * IDEMPOTENT: the `source_closed` write is a no-op once the flag is set (it
 * filters on `source_closed = false`), and an already-resolved market is
 * rejected by the RPC and counted as skipped, not failed. Running this
 * twice in a row changes nothing, so a cron that overlaps or retries cannot
 * double-pay a pool.
 *
 * ── HOW TO AUTOMATE ──────────────────────────────────────────────────
 * Call it every ~15 minutes. Both GET and POST run the same job (GET
 * exists because most cron runners only issue GETs).
 *
 *   Vercel Cron — vercel.json, plus SETTLE_SECRET set in the project's
 *   env. Vercel sends `Authorization: Bearer $CRON_SECRET`, which this
 *   route accepts when it equals SETTLE_SECRET:
 *     { "crons": [{ "path": "/api/settle", "schedule": "*\/15 * * * *" }] }
 *
 *   Anything else (cron-job.org, GitHub Actions, a box with crontab):
 *     curl -X POST https://<host>/api/settle -H "x-settle-secret: <secret>"
 *
 * 15 minutes is a deliberate floor, not a limit: each run costs a handful
 * of upstream requests, and a prediction market that pays out 15 minutes
 * after the source published is indistinguishable from instant to a user.
 */

export const dynamic = 'force-dynamic';
// node:crypto + the service-role client — never the edge runtime.
export const runtime = 'nodejs';
// A large backlog does ~200 RPCs; the default 10s window is not enough.
export const maxDuration = 60;

/**
 * How many tracked markets one run POLLS.
 *
 * DELIBERATELY GENEROUS, and the reason is the whole point of v7's gate: a
 * market this run does not look at is a market that can still be traded
 * against a known outcome for another 15 minutes. The live book holds ~1000
 * feed rows, and the selection is oldest-`end_date`-first WITHOUT rotation
 * (there is no `last_checked_at` column), so a low cap does not "drain" —
 * it permanently starves every market past the cap. A market that never
 * closes upstream (a long-dated question) would sit at the front of that
 * queue forever and hold the slot.
 *
 * It stays cheap because the cost is chunked, not per-market: ~1000 markets
 * is ~40 upstream requests (Gamma chunks of 25, Kalshi of 20), all issued
 * in parallel with a 5s timeout. That is ~40 requests per 15 minutes =
 * 0.04 req/s against two public APIs — less than the main feed already
 * spends per client (2 req/90s). Raise it if the book outgrows it.
 */
const SWEEP_LIMIT = 1000;

/**
 * How many `settle_feed_market` RPCs one run may issue.
 *
 * This is the half that actually costs wall-clock time (each RPC takes row
 * locks and walks every position on the market, and they run sequentially),
 * so it gets its own, much lower ceiling. Oldest-first, so a payout backlog
 * drains deterministically over consecutive runs instead of one request
 * timing out forever.
 *
 * Splitting the two limits is what lets the money gate have full coverage
 * every single run while payouts stay bounded: freezing is one batched
 * UPDATE, settling is N round-trips.
 */
const SETTLE_LIMIT = 100;

/** Rows per `source_closed` UPDATE — keeps the `in (…)` list sane. */
const UPDATE_CHUNK = 100;

interface SettleReport {
  /** Open feed markets polled this run. */
  checked: number;
  /** Markets frozen this run — `source_closed` flipped false -> true. This
   *  is the number that makes the trade gate real; `0` on a steady-state
   *  run just means nothing new closed upstream. */
  closedMarked: number;
  /** Markets actually paid out. */
  settled: number;
  /** Markets this run took no action on: still open upstream, no confident
   *  result yet, or the source did not answer. Retried next run. */
  skipped: number;
  /** Markets the source called, but the write/RPC refused. */
  errors: { id: string; error: string }[];
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Constant-time compare that tolerates unequal lengths (timingSafeEqual
 *  throws on those) — a plain `===` on a secret leaks it a byte at a time
 *  to anyone who can measure the response. */
function secretMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Bearer token, or null. */
function bearer(req: Request): string | null {
  const raw = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Is this the cron? `x-settle-secret`, `?secret=`, or an
 * `Authorization: Bearer` equal to the secret (that last form is what
 * Vercel Cron sends).
 */
function isCronCaller(req: Request, secret: string): boolean {
  const url = new URL(req.url);
  const candidates = [
    req.headers.get('x-settle-secret'),
    url.searchParams.get('secret'),
    bearer(req),
  ];
  return candidates.some((c) => typeof c === 'string' && secretMatches(c, secret));
}

/**
 * Is this a signed-in ADMIN clicking "Run settlement now" in /admin?
 *
 * The admin panel is a client component and can never hold SETTLE_SECRET —
 * shipping it to the browser would publish it. So the button sends the
 * user's own Supabase access token instead, and we verify it server-side
 * and check `profiles.is_admin` with the service key (which bypasses RLS,
 * so a banned/limited row cannot hide the flag).
 *
 * This does NOT give the admin the RPC: `settle_feed_market` still refuses
 * anyone with an `auth.uid()`. The admin is only allowed to TRIGGER the
 * run; the settlement itself still happens under the service key, off the
 * sources' own published results.
 */
async function isAdminCaller(req: Request): Promise<boolean> {
  const token = bearer(req);
  if (!token || !serviceSupabase) return false;

  const { data, error } = await serviceSupabase.auth.getUser(token);
  if (error || !data.user) return false;

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('is_admin')
    .eq('id', data.user.id)
    .maybeSingle();

  return profile?.is_admin === true;
}

/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */

/** `markets` row shape the poller needs (snake_case = DB columns). */
interface CandidateRow {
  id: string;
  provider: string | null;
  provider_ref: string | null;
}

/**
 * Freeze the markets the source says are closed.
 *
 * A plain service-role UPDATE, NOT an RPC — deliberately. `source_closed`
 * already has exactly one writer pattern in this codebase: the feed sync in
 * `app/api/polymarket/route.ts` upserts it with the same service key. A
 * `record_source_state()` RPC would add a SECOND, inconsistent write path
 * for one boolean and force the owner to re-run supabase/schema.sql before
 * this fix did anything. This way FIX 1 needs no schema change at all.
 *
 * Filtered on `source_closed = false` so it only ever touches rows that
 * actually change, which makes `closedMarked` an honest count (and every
 * subsequent run a no-op) rather than a re-write of the same rows forever.
 *
 * Chunked, and one failing chunk never stops the others: a market we could
 * not freeze is reported and retried next run.
 */
async function markSourceClosed(
  ids: string[],
  report: SettleReport,
  frozen: Set<string>
): Promise<void> {
  if (!serviceSupabase || ids.length === 0) return;

  for (const batch of chunk(ids, UPDATE_CHUNK)) {
    const { data, error } = await serviceSupabase
      .from('markets')
      .update({ source_closed: true })
      .in('id', batch)
      .eq('source_closed', false)
      .select('id');

    if (error) {
      // Almost always "column source_closed does not exist" = supabase/
      // schema.sql is not at v7 yet. Name the batch rather than spamming one
      // identical entry per market.
      const scope = batch.length > 1 ? `${batch[0]} +${batch.length - 1} more` : batch[0];
      report.errors.push({ id: scope, error: error.message });
      console.error('[api/settle] source_closed write failed:', error.message);
      continue;
    }

    for (const row of (data ?? []) as { id: string }[]) {
      report.closedMarked += 1;
      frozen.add(row.id);
    }
  }
}

async function runSettlement(): Promise<SettleReport | { error: string }> {
  if (!serviceSupabase) return { error: 'Service role key is not configured.' };

  // EVERY open, non-banned feed market carrying the ref we need to ask
  // about — NOT just the expired ones (v7: `end_date` says nothing about a
  // feed market's real state, so an unexpired market can be closed upstream
  // and an expired one can still be trading). Banned markets are excluded:
  // their pool is already voided, so there is nothing to freeze or pay.
  //
  // Oldest first: the longest-overdue markets are both the likeliest to be
  // closed and the likeliest to owe a payout.
  const { data, error } = await serviceSupabase
    .from('markets')
    .select('id, provider, provider_ref')
    .eq('status', 'open')
    .eq('banned', false)
    .in('provider', ['polymarket', 'kalshi'])
    .not('provider_ref', 'is', null)
    .order('end_date', { ascending: true })
    .limit(SWEEP_LIMIT);

  if (error) return { error: error.message };

  const rows = (data ?? []) as CandidateRow[];
  const report: SettleReport = {
    checked: rows.length,
    closedMarked: 0,
    settled: 0,
    skipped: rows.length,
    errors: [],
  };
  if (rows.length === 0) return report;

  const candidates: SettlementCandidate[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    providerRef: r.provider_ref,
  }));

  // What the sources actually said. Confident answers only — anything
  // pending, ambiguous or unanswered never comes back from here and simply
  // stays as it is. This call cannot throw.
  const states = await fetchSourceState(candidates);

  // Re-impose the selection's order (oldest end_date first). `states` comes
  // back grouped by provider, and both the freeze list and the settle cap
  // below should follow the same oldest-first priority the query promised.
  const byId = new Map(states.map((s) => [s.id, s]));
  const ordered = rows.flatMap((r) => {
    const s = byId.get(r.id);
    return s ? [s] : [];
  });

  // Ids we changed something on, so `skipped` counts markets we truly left
  // alone. A market that is frozen AND settled in the same run counts once.
  const acted = new Set<string>();

  // 1. FREEZE FIRST — this is the money gate. Uncapped: it is one batched
  //    UPDATE per 100 rows, and a market left tradeable against a known
  //    outcome is the exact bug this route exists to close.
  await markSourceClosed(
    ordered.filter((s) => s.sourceClosed).map((s) => s.id),
    report,
    acted
  );

  // 2. THEN PAY OUT — capped, since each of these is a round-trip.
  const settleTargets = ordered.filter((s) => s.outcome).slice(0, SETTLE_LIMIT);

  // Sequential on purpose: payout_market() takes row locks and walks every
  // position on the market. A parallel burst buys nothing on a cron job and
  // makes lock contention (and the failure mode) worse.
  for (const target of settleTargets) {
    const outcome = target.outcome;
    if (!outcome) continue;

    const { error: rpcError } = await serviceSupabase.rpc('settle_feed_market', {
      p_market_id: target.id,
      p_outcome: outcome satisfies Side,
    });

    if (!rpcError) {
      report.settled += 1;
      acted.add(target.id);
      continue;
    }

    // Already resolved = another run (or an admin) got there first. That is
    // the idempotency guarantee working, not a failure.
    if (/already resolved/i.test(rpcError.message)) continue;

    report.errors.push({ id: target.id, error: rpcError.message });
    console.error(`[api/settle] ${target.id} -> ${outcome} failed:`, rpcError.message);
  }

  report.skipped = report.checked - acted.size;
  return report;
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

async function handle(req: Request): Promise<Response> {
  const secret = process.env.SETTLE_SECRET?.trim();

  // No secret configured = the endpoint is not armed. Fail CLOSED: a
  // missing env var must never mean "let everyone settle markets".
  if (!secret) {
    return Response.json(
      { error: 'SETTLE_SECRET is not configured — settlement endpoint disabled.' },
      { status: 401 }
    );
  }

  const authorized = isCronCaller(req, secret) || (await isAdminCaller(req));
  if (!authorized) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Authorized, but there is no service key to settle WITH. 503 + a message
  // that names the missing variable.
  if (!serviceEnabled) {
    return Response.json(
      {
        error:
          'Settlement is unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured. ' +
          'settle_feed_market() is service-role only, so this route cannot settle without it.',
      },
      { status: 503 }
    );
  }

  const result = await runSettlement();
  if ('error' in result) {
    return Response.json(result, { status: 500 });
  }
  return Response.json(result, {
    headers: { 'cache-control': 'no-store' },
  });
}

/** Cron runners that only issue GETs (Vercel Cron included). Same job. */
export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
