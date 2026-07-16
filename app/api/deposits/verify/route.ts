import { verifyDeposit, type ChainCheck } from '@/lib/chain';
import { serviceEnabled, serviceSupabase } from '@/lib/serverSupabase';
import type { DepositCurrency } from '@/lib/types';

/**
 * v7 — ON-CHAIN DEPOSIT VERIFICATION.
 *
 * The owner's ask: "damit muss der mensch noch weniger machen". Before this,
 * a deposit's tx hash was a claim — the admin either trusted it or opened a
 * block explorer and read it by hand. This route reads the chain for them,
 * so Approve is a decision made against facts instead of trust.
 *
 * IT DOES NOT APPROVE ANYTHING, AND THAT IS THE DESIGN. A confirmed tx to
 * our address for the right amount still is not proof that the person who
 * TYPED the hash is the person who SENT it — anyone can copy a hash out of a
 * block explorer and paste it into the deposit form. So this route writes
 * EVIDENCE (`record_deposit_verification`, which cannot touch a balance) and
 * stops. `approve_deposit` remains the only thing that moves money, and
 * remains human.
 *
 * AUTH: admin-triggered only. The caller sends their own Supabase access
 * token; we verify it with the service key and check `profiles.is_admin`
 * (service role bypasses RLS, so a banned/limited row cannot hide the flag).
 * Same pattern as /api/settle. Not open to the public: the route makes
 * outbound calls to rate-limited chain APIs, so an anonymous caller could
 * both burn our Etherscan quota and use us as a free blockchain proxy.
 *
 * POST { depositId: string }  -> ChainCheck + depositId
 * POST { all: true }          -> { checked, verified, results: [...] }
 */

export const dynamic = 'force-dynamic';
// The service-role client + outbound chain calls — never the edge runtime.
export const runtime = 'nodejs';
// 25 deposits x up to 3 chain calls each, some behind an 8s timeout.
export const maxDuration = 60;

/** Ceiling for one `all: true` sweep (the brief's cap). */
const ALL_LIMIT = 25;

/**
 * How many deposits to verify at once in a sweep.
 *
 * Deliberately small. Etherscan's free tier is 5 calls/sec and answers
 * "Max calls per sec rate limit reached" over it (measured, not assumed —
 * it happened while building this). lib/chain.ts survives that by falling
 * through to a public RPC, but every fall-through is a wasted round trip, so
 * the fix belongs here: go slow enough to stay under the limit. 3 keeps a
 * 25-deposit sweep well inside maxDuration while barely touching the cap.
 */
const SWEEP_CONCURRENCY = 3;

/** One deposit's verdict, as the admin panel consumes it. */
interface VerifyResult extends ChainCheck {
  depositId: string;
}

/** The `deposits` columns this route needs (snake_case = DB columns). */
interface DepositRow {
  id: string;
  currency: string;
  tx_hash: string | null;
  status: string;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Bearer token, or null. */
function bearer(req: Request): string | null {
  const raw = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

type AuthResult = { ok: true } | { ok: false; status: 401 | 403; error: string };

/**
 * 401 vs 403 is not cosmetic here: 401 means "your session is stale, sign in
 * again" (the admin panel can act on that), 403 means "you are signed in and
 * you are not an admin" (it cannot). Collapsing both into one status is how
 * you get an admin staring at a button that silently does nothing.
 */
async function requireAdmin(req: Request): Promise<AuthResult> {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in as an admin to verify deposits.' };
  if (!serviceSupabase) return { ok: false, status: 401, error: 'Server auth is unavailable.' };

  const { data, error } = await serviceSupabase.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Your session expired — sign in again.' };
  }

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('is_admin')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profile?.is_admin !== true) {
    return { ok: false, status: 403, error: 'Admins only.' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */

const CURRENCIES: readonly string[] = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL'];

function asCurrency(raw: string): DepositCurrency | null {
  return CURRENCIES.includes(raw) ? (raw as DepositCurrency) : null;
}

/**
 * Verify one row and persist what the chain said.
 *
 * The RPC write is best-effort ON PURPOSE: if recording the evidence fails,
 * the admin still gets the answer on screen for the decision they are making
 * right now. Losing the audit row is worth less than blocking the click.
 */
async function verifyRow(row: DepositRow): Promise<VerifyResult> {
  const currency = asCurrency(row.currency);
  if (!currency) {
    return { depositId: row.id, ok: false, verified: false, error: `Unknown currency: ${row.currency}.` };
  }

  const check = await verifyDeposit(currency, row.tx_hash ?? '');

  // `record_deposit_verification` refuses any caller with an auth.uid(), so
  // it MUST go through the service client — never the admin's own token.
  if (serviceSupabase) {
    const { error } = await serviceSupabase.rpc('record_deposit_verification', {
      p_deposit_id: row.id,
      p_verified: check.verified,
      p_amount: check.amount ?? null,
      p_to: check.to ?? null,
      p_confirmations: check.confirmations ?? null,
      p_error: check.error ?? null,
    });
    if (error) console.error(`[api/deposits/verify] record ${row.id} failed:`, error.message);
  }

  return { depositId: row.id, ...check };
}

/** Verify a list in small batches — see SWEEP_CONCURRENCY. */
async function verifyAll(rows: DepositRow[]): Promise<VerifyResult[]> {
  const out: VerifyResult[] = [];
  for (let i = 0; i < rows.length; i += SWEEP_CONCURRENCY) {
    const batch = rows.slice(i, i + SWEEP_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((r) => verifyRow(r)));
    settled.forEach((s, j) => {
      out.push(
        s.status === 'fulfilled'
          ? s.value
          : { depositId: batch[j].id, ok: false, verified: false, error: 'Verification crashed.' }
      );
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function POST(req: Request): Promise<Response> {
  // 503 before auth: this is a configuration fact, not a permission one, and
  // it costs no lookup to say so.
  if (!serviceEnabled || !serviceSupabase) {
    return Response.json(
      {
        error:
          'Verification is unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured. ' +
          'record_deposit_verification() is service-role only, so this route cannot record without it.',
      },
      { status: 503 }
    );
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  let body: { depositId?: unknown; all?: unknown };
  try {
    body = (await req.json()) as { depositId?: unknown; all?: unknown };
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  /* ---- sweep: every pending deposit that HAS a hash ---- */
  if (body.all === true) {
    const { data, error } = await serviceSupabase
      .from('deposits')
      .select('id, currency, tx_hash, status')
      .eq('status', 'pending')
      .not('tx_hash', 'is', null)
      // Oldest first: the longest-waiting depositor is checked first when
      // there are more than ALL_LIMIT of them.
      .order('created_at', { ascending: true })
      .limit(ALL_LIMIT);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    // A pending row whose hash is an empty string is not a hash. Postgres
    // `not is null` cannot see that; filter it here.
    const rows = ((data ?? []) as DepositRow[]).filter((r) => (r.tx_hash ?? '').trim() !== '');
    const results = await verifyAll(rows);

    return Response.json(
      { checked: results.length, verified: results.filter((r) => r.verified).length, results },
      { headers: { 'cache-control': 'no-store' } }
    );
  }

  /* ---- single ---- */
  const depositId = typeof body.depositId === 'string' ? body.depositId.trim() : '';
  if (!depositId) {
    return Response.json({ error: 'depositId is required.' }, { status: 400 });
  }

  const { data, error } = await serviceSupabase
    .from('deposits')
    .select('id, currency, tx_hash, status')
    .eq('id', depositId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: 'Deposit not found.' }, { status: 404 });

  const row = data as DepositRow;

  // No hash = nothing to look up. Return the amber state WITHOUT recording:
  // `record_deposit_verification` would stamp verified=false + an error,
  // which renders as "the chain says no" — a claim about the chain we never
  // made. "The user gave us nothing to check" is a different fact, and the
  // UI derives it from the empty tx_hash on its own.
  if ((row.tx_hash ?? '').trim() === '') {
    return Response.json(
      { depositId: row.id, ok: false, verified: false, error: 'No tx hash provided.' } satisfies VerifyResult,
      { headers: { 'cache-control': 'no-store' } }
    );
  }

  const result = await verifyRow(row);
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}
