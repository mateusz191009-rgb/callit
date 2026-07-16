/**
 * Payment limits (v6 backlog — the withdrawal audit).
 *
 * Manual review costs a human a few minutes per request, so a $2
 * withdrawal costs more to process than it moves. These are the floors the
 * wallet validates against before it ever calls an RPC; the server stays
 * the authority on the balance itself (`request_withdrawal` reserves
 * atomically and raises 'Insufficient balance').
 */

/** Smallest deposit we credit — USD value. */
export const MIN_DEPOSIT = 10;

/** Smallest withdrawal we pay out — USD value. */
export const MIN_WITHDRAWAL = 20;

/** Inline copy for a below-minimum deposit. */
export const MIN_DEPOSIT_COPY = `Minimum deposit is $${MIN_DEPOSIT}.`;

/** Inline copy for a below-minimum withdrawal. */
export const MIN_WITHDRAWAL_COPY = `Minimum withdrawal is $${MIN_WITHDRAWAL}.`;
