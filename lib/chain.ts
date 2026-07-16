import type { DepositCurrency } from './types';
import { walletFor } from './wallets';

/**
 * lib/chain.ts — SERVER-ONLY on-chain deposit verification (v7).
 *
 * THE POINT, in the owner's words: "damit muss der mensch noch weniger
 * machen". A user types a tx hash into the deposit form; until now the
 * admin's only options were to trust it or to open a block explorer in
 * another tab and read it by hand. This module does that reading: given a
 * hash, it asks the chain itself who was paid, how much, and how deep the
 * tx is buried.
 *
 * WHAT THIS IS NOT: proof of ownership. A confirmed tx to our address for
 * the right amount still is not evidence that the person who TYPED the hash
 * is the person who SENT it — anyone can copy a hash out of a block
 * explorer and claim it. That is why nothing here touches a balance and why
 * `record_deposit_verification` does not either (see supabase/schema.sql).
 * Verification is EVIDENCE that makes the admin's decision informed;
 * `approve_deposit` stays the thing that moves money, and stays human.
 *
 * ── DESIGN RULES ────────────────────────────────────────────────────
 * * SERVER-ONLY. The Etherscan key lives here; a client import is a leak,
 *   so the guard below turns one into a loud error instead.
 * * NEVER THROWS. Every path returns a ChainCheck. A dead RPC endpoint
 *   must degrade to `{ ok: false, error }` and let the admin fall back to
 *   judgement — it must never 500 the admin panel.
 * * NEVER HARDCODES AN ADDRESS. The expected recipient always comes from
 *   lib/wallets.ts, so rotating a deposit address is a one-file change and
 *   cannot leave this module verifying against a stale one.
 * * NEVER TRUSTS ONE ENDPOINT. Mainnet reads try Etherscan, then two
 *   public RPCs. (llamarpc was down the day this was written; single
 *   points of failure in a verification path fail silently and look like
 *   "the user lied".)
 *
 * ── ENDPOINTS (all probed live before this was written) ─────────────
 * | currency | source                        | key?          |
 * | BTC      | blockstream.info/api          | no            |
 * | SOL      | api.mainnet-beta.solana.com   | no            |
 * | ETH/USDT | Etherscan v2 chainid=1 -> RPC | ETHERSCAN_API_KEY |
 * | USDC     | mainnet.base.org (Base)       | no            |
 * | BNB      | bsc-dataseed.binance.org      | no            |
 *
 * The free Etherscan key answers "Free API access is not supported for this
 * chain" on Base (8453) and BSC (56) — those two MUST use their own public
 * RPCs, which is why `EVM_CHAINS` carries the endpoint list per chain
 * instead of pointing everything at Etherscan.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/chain.ts is server-only — do not import it from a client component.'
  );
}

/* ------------------------------------------------------------------ */
/* Public shape                                                        */
/* ------------------------------------------------------------------ */

/**
 * The result of one on-chain lookup.
 *
 * `ok` and `verified` are DIFFERENT questions, and conflating them is the
 * bug to avoid:
 *   * `ok: false`      — we could not read the chain (network, bad hash,
 *                        endpoint down). We know NOTHING. Not evidence
 *                        against the depositor.
 *   * `ok: true, verified: false` — we read the chain and it does NOT back
 *                        the claim (wrong recipient, wrong token, too
 *                        shallow, reverted). That IS evidence.
 *   * `ok: true, verified: true`  — the chain shows a confirmed payment to
 *                        our address. Still not proof of ownership.
 */
export interface ChainCheck {
  /** Did the lookup itself succeed? False = we could not read the chain. */
  ok: boolean;
  /** Confirmed payment to OUR address, non-zero, deep enough? */
  verified: boolean;
  /** Amount paid to our address, in the COIN's own unit (0.0043 = BTC, not USD). */
  amount?: number;
  /** The destination the chain actually shows (ours, or whoever was really paid). */
  to?: string;
  /** Confirmations at the time of the check. */
  confirmations?: number;
  /** Why `ok` is false, or why `verified` is false. Written for the admin. */
  error?: string;
}

/**
 * How deep before we call it verified. Not a risk model — the admin still
 * decides — just enough that a tx cannot be un-mined between the check and
 * the click. BTC/SOL: 1 (a Bitcoin block is ~10 minutes and a Solana tx
 * returned by `getTransaction` is already finalized). EVM: 3.
 */
const MIN_CONFIRMATIONS: Record<DepositCurrency, number> = {
  BTC: 1,
  SOL: 1,
  ETH: 3,
  USDT: 3,
  USDC: 3,
  BNB: 3,
};

/** Every network call's ceiling. The admin is waiting on this. */
const TIMEOUT_MS = 8_000;

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * JSON fetch with a hard timeout. Throws on timeout / non-2xx / non-JSON —
 * every caller is inside a try/catch that turns it into a ChainCheck.
 */
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

/** Plain-text fetch with the same timeout (blockstream's tip height). */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).trim();
}

/** Never let an upstream error string reach the admin raw — it can carry
 *  a URL with our API key in it. Keep the shape, drop the payload. */
function safeMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  if (/timeouterror|aborted|timed out/i.test(raw)) return 'Timed out reading the chain.';
  if (/^HTTP \d+$/.test(raw)) return `Chain endpoint returned ${raw}.`;
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Unit math                                                           */
/* ------------------------------------------------------------------ */

/**
 * Integer base units -> a decimal number, without going through Number()
 * on the raw bigint. 1 ETH in wei is 1e18, which is far past Number's
 * 2^53 integer range: `Number(1000000000000000001n)` silently loses the
 * tail. Split whole/fraction first, so only human-sized values are
 * converted.
 */
function unitsToNumber(value: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** Hex quantity ('0x1f') -> bigint. Tolerates a missing prefix and ''. */
function hexToBigInt(hex: unknown): bigint {
  if (typeof hex !== 'string' || hex.trim() === '') return 0n;
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex : `0x${hex}`;
  try {
    return BigInt(h);
  } catch {
    return 0n;
  }
}

/** Case-insensitive address compare (EVM is case-insensitive; bech32 is
 *  lowercase by construction; base58 is NOT — see `eqAddressExact`). */
function eqAddress(a: string | undefined, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Solana addresses are base58 — case IS significant, compare exactly. */
function eqAddressExact(a: string | undefined, b: string): boolean {
  return typeof a === 'string' && a.trim() === b.trim();
}

/* ------------------------------------------------------------------ */
/* Hash shape guards                                                   */
/* ------------------------------------------------------------------ */

const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
const BTC_HASH = /^[0-9a-fA-F]{64}$/;
// base58 (no 0, O, I, l), 64-88 chars — a Solana signature is 64 raw bytes.
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/* ------------------------------------------------------------------ */
/* Bitcoin — blockstream.info                                          */
/* ------------------------------------------------------------------ */

interface BlockstreamVout {
  scriptpubkey_address?: string;
  value?: number; // satoshis
}
interface BlockstreamTx {
  vout?: BlockstreamVout[];
  status?: { confirmed?: boolean; block_height?: number };
}

/**
 * BTC is UTXO, not account-based: one tx pays MANY outputs at once. So the
 * question is not "is `to` our address" but "how many sats did the outputs
 * to OUR address add up to" — a payment can legitimately arrive alongside a
 * change output back to the sender, and summing only our vouts is what
 * makes that read correctly.
 */
async function verifyBtc(txHash: string, ours: string): Promise<ChainCheck> {
  if (!BTC_HASH.test(txHash)) {
    return { ok: false, verified: false, error: 'Not a Bitcoin txid (expect 64 hex characters).' };
  }

  let tx: BlockstreamTx;
  try {
    tx = (await fetchJson(`https://blockstream.info/api/tx/${txHash}`)) as BlockstreamTx;
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'HTTP 404') {
      return { ok: true, verified: false, error: 'Transaction not found on Bitcoin mainnet.' };
    }
    return { ok: false, verified: false, error: safeMessage(e, 'Could not reach blockstream.info.') };
  }

  const vouts = Array.isArray(tx.vout) ? tx.vout : [];
  const sats = vouts
    .filter((v) => eqAddress(v.scriptpubkey_address, ours))
    .reduce((sum, v) => sum + (Number(v.value) || 0), 0);

  // Who the chain says was paid: our address when it appears, otherwise the
  // biggest output — the admin needs to SEE the wrong destination, not just
  // be told "no".
  const biggest = [...vouts].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))[0];
  const to = sats > 0 ? ours : biggest?.scriptpubkey_address;

  let confirmations = 0;
  if (tx.status?.confirmed && typeof tx.status.block_height === 'number') {
    try {
      const tip = Number(await fetchText('https://blockstream.info/api/blocks/tip/height'));
      if (Number.isFinite(tip)) confirmations = Math.max(0, tip - tx.status.block_height + 1);
    } catch {
      // Tip unreadable: the tx is mined, we just cannot say how deep. Report
      // 1 (mined) rather than 0 (which reads as "in the mempool") — and note
      // it, so the admin knows the depth is a floor, not a measurement.
      confirmations = 1;
    }
  }

  const amount = sats / 1e8;
  return finalize('BTC', { ok: true, verified: false, amount, to, confirmations }, ours);
}

/* ------------------------------------------------------------------ */
/* Solana — public RPC                                                 */
/* ------------------------------------------------------------------ */

const SOL_RPC = 'https://api.mainnet-beta.solana.com';

interface SolAccountKey {
  pubkey?: string;
}
interface SolTx {
  slot?: number;
  meta?: {
    err?: unknown;
    preBalances?: number[];
    postBalances?: number[];
  };
  transaction?: { message?: { accountKeys?: SolAccountKey[] } };
}

async function solRpc(method: string, params: unknown[]): Promise<unknown> {
  const json = (await fetchJson(SOL_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? 'Solana RPC error');
  return json.result ?? null;
}

/**
 * SOL is account-based but a tx has no single `to`: it is a list of
 * instructions over a list of accounts. The reliable read is the BALANCE
 * DELTA — `postBalances[i] - preBalances[i]` for our account index. That
 * catches a plain transfer, a transfer nested in an inner instruction, and
 * a multi-instruction tx alike, where parsing only the top-level transfer
 * instruction would miss the last two.
 */
async function verifySol(signature: string, ours: string): Promise<ChainCheck> {
  if (!SOL_SIG.test(signature)) {
    return { ok: false, verified: false, error: 'Not a Solana signature (expect base58).' };
  }

  let tx: SolTx | null;
  let currentSlot: number | null = null;
  try {
    tx = (await solRpc('getTransaction', [
      signature,
      { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' },
    ])) as SolTx | null;
  } catch (e) {
    return { ok: false, verified: false, error: safeMessage(e, 'Could not reach the Solana RPC.') };
  }

  // getTransaction defaults to `finalized` commitment: a null result means
  // "not finalized (yet) or does not exist", never "still confirming".
  if (!tx) {
    return { ok: true, verified: false, error: 'Transaction not found (or not yet finalized) on Solana.' };
  }
  if (tx.meta?.err) {
    return { ok: true, verified: false, error: 'The Solana transaction failed on-chain.' };
  }

  const keys = tx.transaction?.message?.accountKeys ?? [];
  const idx = keys.findIndex((k) => eqAddressExact(k?.pubkey, ours));
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];

  if (idx < 0 || typeof pre[idx] !== 'number' || typeof post[idx] !== 'number') {
    return {
      ok: true,
      verified: false,
      error: 'Our deposit address is not part of this Solana transaction.',
    };
  }

  const lamports = post[idx] - pre[idx];
  const amount = lamports / 1e9;

  try {
    const slot = await solRpc('getSlot', []);
    if (typeof slot === 'number') currentSlot = slot;
  } catch {
    currentSlot = null;
  }

  // A finalized tx IS confirmed — depth is the slot delta. Floor at 1 so a
  // finalized tx never reads as unconfirmed just because getSlot was down.
  const confirmations =
    currentSlot !== null && typeof tx.slot === 'number'
      ? Math.max(1, currentSlot - tx.slot)
      : 1;

  return finalize('SOL', { ok: true, verified: false, amount, to: ours, confirmations }, ours);
}

/* ------------------------------------------------------------------ */
/* EVM — transports                                                    */
/* ------------------------------------------------------------------ */

/** One way to ask an EVM chain a JSON-RPC question. */
type EvmCall = (method: string, params: unknown[]) => Promise<unknown>;

/** Standard JSON-RPC over POST (Base, BSC, and the mainnet fallbacks). */
function rpcTransport(url: string): EvmCall {
  return async (method, params) => {
    const json = (await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })) as { result?: unknown; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'RPC error');
    return json.result ?? null;
  };
}

/**
 * Etherscan v2's `module=proxy` speaks JSON-RPC over GET, so it slots in as
 * one more transport rather than a special case.
 *
 * The key travels as a query param because that is the only auth Etherscan
 * offers. It is server-side only and never logged: `safeMessage` deliberately
 * refuses to pass an upstream error string through, because Etherscan echoes
 * the request URL — key included — in some of them.
 */
function etherscanTransport(chainId: number, apiKey: string): EvmCall {
  return async (method, params) => {
    const url = new URL('https://api.etherscan.io/v2/api');
    url.searchParams.set('chainid', String(chainId));
    url.searchParams.set('module', 'proxy');
    url.searchParams.set('action', method);
    if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') {
      url.searchParams.set('txhash', String(params[0] ?? ''));
    }
    url.searchParams.set('apikey', apiKey);

    const json = (await fetchJson(url.toString())) as {
      status?: string;
      message?: string;
      result?: unknown;
      error?: { message?: string };
    };

    // Plan/rate-limit refusals ("Free API access is not supported for this
    // chain", "Max rate limit reached") come back as status:'0' + NOTOK, not
    // as an HTTP error. Throw so the caller falls through to the next
    // transport instead of reading the refusal as "tx not found".
    if (json.status === '0' || json.message === 'NOTOK') {
      throw new Error('Etherscan refused the request');
    }
    if (json.error) throw new Error(json.error.message ?? 'Etherscan RPC error');
    return json.result ?? null;
  };
}

interface EvmChainSpec {
  /** Human name for messages ('Ethereum mainnet'). */
  label: string;
  transports: EvmCall[];
}

/**
 * Built per call, not at module load: `process.env` is read at request time
 * in Next, and a module-level read would bake in whatever was set when the
 * server booted.
 */
function evmChain(chain: 'mainnet' | 'base' | 'bsc'): EvmChainSpec {
  if (chain === 'base') {
    // Etherscan's free key rejects chainid 8453 outright ("Free API access is
    // not supported for this chain"), so Base's own public RPC is primary —
    // by necessity, and confirmed working by measurement.
    return {
      label: 'Base',
      transports: [
        rpcTransport('https://mainnet.base.org'),
        rpcTransport('https://base-rpc.publicnode.com'),
      ],
    };
  }
  if (chain === 'bsc') {
    // Same story on chainid 56.
    return {
      label: 'BNB Smart Chain',
      transports: [
        rpcTransport('https://bsc-dataseed.binance.org'),
        rpcTransport('https://bsc-rpc.publicnode.com'),
      ],
    };
  }

  const key = process.env.ETHERSCAN_API_KEY?.trim();
  return {
    label: 'Ethereum mainnet',
    transports: [
      ...(key ? [etherscanTransport(1, key)] : []),
      // Fallback order is MEASURED, not guessed (probed while writing this):
      //   * publicnode  — answers every method we need. The real fallback.
      //   * cloudflare  — serves getTransactionByHash/Receipt but answers
      //     "Cannot fulfill request" to eth_blockNumber, so it can identify a
      //     tx but never date it. Last, and only useful because callEvm falls
      //     through PER METHOD: a chain that cannot count blocks still beats
      //     no chain at all for the tx read.
      //   * ankr        — REMOVED. It now 401s every keyless call
      //     ("You must authenticate your request with an API key"), so as a
      //     fallback it was pure latency: three seconds of retry before the
      //     same failure. llamarpc is likewise out (HTTP 521, still down).
      rpcTransport('https://ethereum-rpc.publicnode.com'),
      rpcTransport('https://cloudflare-eth.com'),
    ],
  };
}

/**
 * Ask every transport in turn until one answers.
 *
 * A `null` result is treated as "this endpoint has no answer" and falls
 * through to the next, because a lagging node returns null for a tx that a
 * healthy one can see — reading that as "not found" would call an honest
 * deposit a lie. Only when EVERY transport says null do we return null.
 */
async function callEvm(spec: EvmChainSpec, method: string, params: unknown[]): Promise<unknown> {
  let lastError: unknown = new Error('No endpoint configured');
  for (const transport of spec.transports) {
    try {
      const result = await transport(method, params);
      if (result !== null && result !== undefined) return result;
      lastError = null; // a real "no answer", not a failure
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError === null) return null;
  throw lastError;
}

/* ------------------------------------------------------------------ */
/* EVM — native transfers (ETH, BNB)                                   */
/* ------------------------------------------------------------------ */

interface EvmTx {
  to?: string | null;
  value?: string;
  blockNumber?: string | null;
}
interface EvmReceipt {
  status?: string;
  blockNumber?: string | null;
  logs?: EvmLog[];
}
interface EvmLog {
  address?: string;
  topics?: string[];
  data?: string;
}

/** Confirmations from a mined block number, or 0 when still pending. */
async function evmConfirmations(spec: EvmChainSpec, blockNumber: unknown): Promise<number> {
  if (typeof blockNumber !== 'string' || blockNumber === '') return 0;
  const mined = hexToBigInt(blockNumber);
  if (mined === 0n) return 0;
  const tip = hexToBigInt(await callEvm(spec, 'eth_blockNumber', []));
  if (tip === 0n) return 0;
  const depth = tip - mined + 1n;
  return depth > 0n ? Number(depth) : 0;
}

/** Fetch tx + receipt together — every EVM path needs both. */
async function evmTxAndReceipt(
  spec: EvmChainSpec,
  txHash: string
): Promise<{ tx: EvmTx | null; receipt: EvmReceipt | null }> {
  const [tx, receipt] = await Promise.all([
    callEvm(spec, 'eth_getTransactionByHash', [txHash]) as Promise<EvmTx | null>,
    callEvm(spec, 'eth_getTransactionReceipt', [txHash]) as Promise<EvmReceipt | null>,
  ]);
  return { tx, receipt };
}

/**
 * KNOWN LIMITATION — internal transfers.
 *
 * This reads `tx.to` / `tx.value`, which is the top-level call. If a
 * CONTRACT forwarded the ETH to us (some exchange withdrawal flows do this),
 * `tx.to` is that contract and this reports "paid <contract>, not our
 * address" — a false NEGATIVE. Seeing it requires tracing internal calls
 * (`debug_traceTransaction`, unavailable on these public endpoints, or
 * Etherscan's `txlistinternal`, which is another rate-limited call per
 * deposit and does not exist for Base/BSC on the free key).
 *
 * It is left as-is deliberately: the failure is VISIBLE (the admin reads
 * "paid 0xSomeContract" and can open the explorer), it is safe in the
 * direction that matters (a false negative costs a manual check; a false
 * positive would credit money), and nothing here auto-approves anyway. A
 * plain wallet-to-wallet send — what a depositor actually does — is the
 * top-level call and reads correctly.
 */
async function verifyEvmNative(
  currency: 'ETH' | 'BNB',
  chain: 'mainnet' | 'bsc',
  txHash: string,
  ours: string
): Promise<ChainCheck> {
  if (!EVM_HASH.test(txHash)) {
    return { ok: false, verified: false, error: 'Not an EVM tx hash (expect 0x + 64 hex characters).' };
  }
  const spec = evmChain(chain);

  let tx: EvmTx | null;
  let receipt: EvmReceipt | null;
  try {
    ({ tx, receipt } = await evmTxAndReceipt(spec, txHash));
  } catch (e) {
    return { ok: false, verified: false, error: safeMessage(e, `Could not reach ${spec.label}.`) };
  }

  if (!tx) {
    return { ok: true, verified: false, error: `Transaction not found on ${spec.label}.` };
  }
  // tx present, receipt absent = still in the mempool. Real state, not an error.
  if (!receipt) {
    return {
      ok: true,
      verified: false,
      amount: unitsToNumber(hexToBigInt(tx.value), 18),
      to: tx.to ?? undefined,
      confirmations: 0,
      error: 'Still pending — not mined yet.',
    };
  }
  // A reverted tx is mined and looks perfectly real in an explorer's URL
  // bar. It moved nothing. Check status BEFORE reading `value`.
  if (receipt.status !== undefined && hexToBigInt(receipt.status) !== 1n) {
    return { ok: true, verified: false, to: tx.to ?? undefined, error: 'The transaction reverted on-chain.' };
  }

  let confirmations = 0;
  try {
    confirmations = await evmConfirmations(spec, receipt.blockNumber ?? tx.blockNumber);
  } catch {
    confirmations = 0;
  }

  const amount = unitsToNumber(hexToBigInt(tx.value), 18);
  return finalize(currency, { ok: true, verified: false, amount, to: tx.to ?? undefined, confirmations }, ours);
}

/* ------------------------------------------------------------------ */
/* EVM — ERC20 transfers (USDT mainnet, USDC Base)                     */
/* ------------------------------------------------------------------ */

/** keccak256('Transfer(address,address,uint256)') — topic[0] of every ERC20 transfer. */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

interface TokenSpec {
  chain: 'mainnet' | 'base';
  contract: string;
  decimals: number;
}

/**
 * The contract is half of the token's identity. Without pinning it, a
 * worthless token that names itself "USDT" emits a Transfer log with the
 * same topic and the same shape — and would verify. The address below is
 * what makes "1000 USDT" mean the real thing.
 */
const TOKENS: Record<'USDT' | 'USDC', TokenSpec> = {
  USDT: { chain: 'mainnet', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDC: { chain: 'base', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
};

/** topic[2] is the recipient, left-padded to 32 bytes: strip to 20. */
function topicToAddress(topic: string | undefined): string | undefined {
  if (typeof topic !== 'string' || topic.length < 42) return undefined;
  return `0x${topic.slice(-40)}`;
}

/**
 * A token transfer does NOT show up in `tx.to`/`tx.value`: `tx.to` is the
 * TOKEN CONTRACT and `tx.value` is 0. The payment only exists in the
 * receipt's Transfer log. Reading `tx.to` here — the obvious mistake —
 * would reject every real USDT deposit ever made.
 */
async function verifyErc20(
  currency: 'USDT' | 'USDC',
  txHash: string,
  ours: string
): Promise<ChainCheck> {
  if (!EVM_HASH.test(txHash)) {
    return { ok: false, verified: false, error: 'Not an EVM tx hash (expect 0x + 64 hex characters).' };
  }
  const token = TOKENS[currency];
  const spec = evmChain(token.chain);

  let receipt: EvmReceipt | null;
  let tx: EvmTx | null;
  try {
    ({ tx, receipt } = await evmTxAndReceipt(spec, txHash));
  } catch (e) {
    return { ok: false, verified: false, error: safeMessage(e, `Could not reach ${spec.label}.`) };
  }

  if (!tx && !receipt) {
    return { ok: true, verified: false, error: `Transaction not found on ${spec.label}.` };
  }
  if (!receipt) {
    return { ok: true, verified: false, confirmations: 0, error: 'Still pending — not mined yet.' };
  }
  if (receipt.status !== undefined && hexToBigInt(receipt.status) !== 1n) {
    return { ok: true, verified: false, error: 'The transaction reverted on-chain.' };
  }

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const transfers = logs.filter(
    (l) => eqAddress(l.topics?.[0], TRANSFER_TOPIC) && (l.topics?.length ?? 0) >= 3
  );

  // Transfers of OUR token, to OUR address. One tx can carry several
  // (a router splitting a payment), so sum them.
  const mine = transfers.filter(
    (l) => eqAddress(l.address, token.contract) && eqAddress(topicToAddress(l.topics?.[2]), ours)
  );

  let confirmations = 0;
  try {
    confirmations = await evmConfirmations(spec, receipt.blockNumber ?? tx?.blockNumber);
  } catch {
    confirmations = 0;
  }

  if (mine.length === 0) {
    // Distinguish the three real failures — "not verified" alone tells the
    // admin nothing they can act on.
    const toUsWrongToken = transfers.find((l) => eqAddress(topicToAddress(l.topics?.[2]), ours));
    if (toUsWrongToken) {
      return {
        ok: true,
        verified: false,
        to: ours,
        confirmations,
        error: `A token was sent to our address, but it is not ${currency} (contract ${toUsWrongToken.address ?? 'unknown'}).`,
      };
    }
    const ourToken = transfers.find((l) => eqAddress(l.address, token.contract));
    if (ourToken) {
      return {
        ok: true,
        verified: false,
        to: topicToAddress(ourToken.topics?.[2]),
        amount: unitsToNumber(hexToBigInt(ourToken.data), token.decimals),
        confirmations,
        error: `This ${currency} transfer went to a different address.`,
      };
    }
    return {
      ok: true,
      verified: false,
      confirmations,
      error: `No ${currency} transfer in this transaction.`,
    };
  }

  const raw = mine.reduce((sum, l) => sum + hexToBigInt(l.data), 0n);
  const amount = unitsToNumber(raw, token.decimals);
  return finalize(currency, { ok: true, verified: false, amount, to: ours, confirmations }, ours);
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

/**
 * The single place `verified` is decided — so no chain can accidentally
 * ship its own, looser rule. Every branch above hands its findings here
 * with `verified: false` and lets this apply the three conditions:
 * right recipient, non-zero amount, deep enough.
 */
function finalize(currency: DepositCurrency, found: ChainCheck, ours: string): ChainCheck {
  const amount = found.amount ?? 0;
  const confirmations = found.confirmations ?? 0;
  const min = MIN_CONFIRMATIONS[currency];

  const toUs = currency === 'SOL' ? eqAddressExact(found.to, ours) : eqAddress(found.to, ours);

  if (!toUs) {
    return {
      ...found,
      verified: false,
      error: found.to
        ? `Paid ${found.to} — not our ${currency} deposit address.`
        : `No payment to our ${currency} deposit address in this transaction.`,
    };
  }
  if (amount <= 0) {
    return {
      ...found,
      verified: false,
      error: `The transaction touches our address but moves no ${currency} into it.`,
    };
  }
  if (confirmations < min) {
    return {
      ...found,
      verified: false,
      error:
        confirmations === 0
          ? 'Not confirmed yet — still pending.'
          : `Only ${confirmations} of ${min} confirmations — check again shortly.`,
    };
  }

  return { ok: true, verified: true, amount, to: found.to, confirmations };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ask the chain what really happened.
 *
 * `amount` comes back in the COIN's unit (0.0043 BTC, 250 USDT) — never
 * USD. The deposit row stores a USD value the USER typed, and converting
 * here would bake a moving price into a permanent evidence record. The
 * admin compares the two.
 *
 * NEVER THROWS: every failure is a ChainCheck with `ok: false`.
 */
export async function verifyDeposit(
  currency: DepositCurrency,
  txHash: string
): Promise<ChainCheck> {
  const hash = (txHash ?? '').trim();
  if (!hash) return { ok: false, verified: false, error: 'No transaction hash provided.' };

  const wallet = walletFor(currency);
  // walletFor() falls back to WALLETS[0] (BTC) for an unknown currency —
  // verifying an ETH deposit against the BTC address would be nonsense, so
  // refuse rather than inherit the fallback.
  if (wallet.currency !== currency) {
    return { ok: false, verified: false, error: `No deposit wallet configured for ${currency}.` };
  }
  const ours = wallet.address;

  try {
    switch (currency) {
      case 'BTC':
        return await verifyBtc(hash, ours);
      case 'SOL':
        return await verifySol(hash, ours);
      case 'ETH':
        return await verifyEvmNative('ETH', 'mainnet', hash, ours);
      case 'BNB':
        return await verifyEvmNative('BNB', 'bsc', hash, ours);
      case 'USDT':
        return await verifyErc20('USDT', hash, ours);
      case 'USDC':
        return await verifyErc20('USDC', hash, ours);
      default:
        return { ok: false, verified: false, error: `Unsupported currency: ${String(currency)}.` };
    }
  } catch (e) {
    // The contract is "never throws". Anything that escapes the per-chain
    // handlers lands here.
    return { ok: false, verified: false, error: safeMessage(e, 'Could not read the chain.') };
  }
}
