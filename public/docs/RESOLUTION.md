# Callitnow — Resolution Fairness Design

Resolution is the moment a prediction market pays out — and the moment it is
most vulnerable to abuse. This document describes how Callitnow resolves markets
today, why the naive approach is unsafe for real money, and the pipeline we
propose to make resolution credibly neutral. It ends with an MVP rollout plan
mapped to the current codebase.

## 1. Current resolution methods

`lib/types.ts` defines `ResolutionMethod = 'oracle' | 'community' | 'manual'`,
chosen at creation time via `ResolutionPicker`:

| Method | UI copy | Actual behavior today |
| --- | --- | --- |
| `oracle` | "Resolved automatically by a decentralized oracle" | Label only — no oracle is wired up in the demo. |
| `community` | "Token holders vote on the outcome" | Label only — no voting mechanism exists yet. |
| `manual` | "You resolve the market yourself" | Fully functional: the creator sees Resolve Yes / Resolve No buttons in `/portfolio` which call `resolveMarket(marketId, outcome)` in `lib/store.ts`. |

`resolveMarket` immediately writes a `MarketOverride` with
`status: 'resolved'`, pins `yesPrice` to 0.99/0.01, pays winning positions
$1 per share into `balance`, and removes all positions on that market. There
is no delay, no review, and no way to reverse it.

## 2. Problems with naive manual resolution

1. **Creator is judge and party.** Nothing stops a creator from buying No on
   their own market and resolving No, regardless of reality. Payout is
   instant, so the theft is complete before anyone can react.
2. **No dispute channel.** Traders who disagree with an outcome have no
   recourse — no evidence submission, no challenge, no appeal.
3. **No accountability or cost of lying.** Resolving dishonestly costs the
   creator nothing; there is no bond, reputation, or slashing at risk.
4. **Ambiguity is unresolvable.** "Will X happen soon?" has no objective
   answer; the naive path lets the creator pick whichever side pays them.
5. **Abandonment locks funds.** If the creator disappears, a `manual` market
   can stay `open` forever and positions never settle.
6. **Instant finality removes the safety window.** Even honest mistakes
   (misread headline, timezone confusion) are irreversible the moment the
   button is clicked.

## 3. Proposed resolution pipeline

Every non-oracle market flows through five stages. Honest resolutions finish
in ~24 hours; contested ones take longer but cannot be stolen cheaply.

### Stage 1 — Bonded proposal

After `endDate`, the creator (or, after a grace period, anyone) posts a
proposed outcome together with a **resolution bond**:

- Bond = max(5% of open interest, $50).
- The proposal records outcome, evidence link/text, proposer, and timestamp.
- Market status moves to `proposed`; trading stays closed; **no payouts yet**.

### Stage 2 — 24h public dispute window

For 24 hours the proposal is publicly visible on the market page (banner +
countdown). Anyone can **challenge** by matching the bond and stating the
opposing outcome (or "ambiguous"). If the window passes unchallenged, the
proposal finalizes and the proposer's bond is returned in full.

### Stage 3 — Community jury vote

A challenged market goes to a **stake-weighted jury** of verified resolvers:

- Resolvers opt in by staking into a resolver pool; verification requires a
  minimum account age and stake.
- A vote runs for 48 hours; votes are weighted by stake, with a per-voter cap
  (e.g. 5% of total) so no whale decides alone.
- Jurors on the majority side split the loser's bond plus a resolution fee.
- Jurors on the minority side are **slashed** (e.g. 10% of their stake) —
  voting lazily or dishonestly has a real cost.
- Quorum required (e.g. stake representing 3x the disputed bond); otherwise
  escalate to Stage 4.

### Stage 4 — Optimistic oracle escalation

Systemic or ambiguous cases (no quorum, jury result within a 55/45 band,
repeated re-challenges, or evidence of vote-buying) escalate to a
Chainlink/UMA-style **optimistic oracle**: the question is posted with the
combined bonds as reward, the oracle's dispute game produces a final answer,
and that answer is binding. If the oracle rules the question genuinely
ambiguous, the market resolves **50/50** — every share pays out $0.50 —
so nobody profits from writing unresolvable questions.

### Stage 5 — Finalization and payout

Only after a proposal survives the window, wins the jury vote, or receives an
oracle answer does the market enter `finalized`. At that point (and only
then) `resolveMarket`'s current payout logic runs: winners get $1/share,
positions settle, bonds and rewards are distributed.

## 4. Incentive summary

| Actor | Puts at risk | Earns when honest | Loses when dishonest |
| --- | --- | --- | --- |
| Proposer (creator) | Bond: max(5% OI, $50) | Bond back + small creator fee on volume | Full bond to challenger/jury |
| Challenger | Matching bond | Loser's bond share if upheld | Own bond if challenge fails |
| Juror (majority) | Stake (capped weight) | Share of losing bond + fee | — |
| Juror (minority) | Stake | — | ~10% stake slashed |
| Oracle reporters | Oracle-level bonds | Escalation reward (combined bonds) | Oracle-level slashing |
| Traders | Trade amount | Correct payouts, dispute rights | — |

The core property: **lying must always cost more than it can earn**, and the
cost of a false resolution scales with the market's open interest.

## 5. Edge cases

- **Ambiguous wording.** Creation form nudges toward verifiable phrasing
  (source + deadline). If a jury/oracle rules "ambiguous", resolve 50/50 and
  refund the challenger's bond; the proposer's bond is split (half returned,
  half to the jury) so ambiguity is not free but not ruinous.
- **Early resolution.** Outcomes that become certain before `endDate` (e.g.
  "team X wins the cup" after elimination) may be proposed early, but the
  dispute window is extended to 48h and the bond doubled, since early calls
  are where honest mistakes concentrate.
- **Creator abandonment.** If no proposal appears within a 72h grace period
  after `endDate`, the market flips to community resolution: anyone may post
  a bonded proposal (Stage 1 onward unchanged). If nothing happens for 30
  days, the market auto-resolves 50/50 and refunds effective stake so funds
  never lock forever.
- **Self-dealing juries.** Jurors with open positions in the disputed market
  must disclose; their vote weight is halved and they are excluded from the
  bond reward on that market.
- **Spam challenges.** Each re-challenge doubles the required bond, capping
  griefing at a geometric cost.

## 6. MVP rollout plan (mapped to this codebase)

### Phase 1 — Pending state + dispute window (client store, demo)

- `lib/types.ts`: add
  `ResolutionState = 'none' | 'proposed' | 'disputed' | 'finalized'` and
  `interface ResolutionProposal { marketId: string; outcome: Side; bond:
  number; proposedBy: string; proposedAt: string; disputeEndsAt: string;
  state: ResolutionState; challenger?: string }`.
- `lib/store.ts`: new persisted field `resolutions:
  Record<string, ResolutionProposal>` (add to `partialize`); actions
  `proposeResolution(marketId, outcome)` (deducts bond from `balance`),
  `challengeResolution(marketId)`, `finalizeResolution(marketId)`. Rework
  `resolveMarket` to be callable only from `finalizeResolution`; for
  demo purposes a 5-minute dispute window stands in for 24h.
- UI: `/portfolio` resolve buttons become "Propose Yes/No (bond $X)";
  market page shows a proposal banner with countdown + Challenge button;
  `ResolutionInfo` already references this pipeline.

### Phase 2 — Jury vote + admin oversight (Supabase)

- `supabase/schema.sql`: add tables `resolutions` (proposal rows mirroring
  the type above, RLS: readable by all, insert by authenticated, update via
  `is_admin()` or finalization function) and `resolution_votes`
  (`resolution_id, user_id, outcome, stake, created_at`, one row per user
  per resolution). Add `resolution_state` and `bond` columns to `markets`.
- Store: dual-mode actions like the existing deposit flow — local demo
  simulates the jury with a simple majority of votes; Supabase mode persists
  votes and tallies stake-weighted.
- `/admin` gets a "Resolutions" tab (like Deposits) to force-finalize or
  void stuck markets while the community mechanism matures.

### Phase 3 — Slashing, resolver staking, oracle escalation

- Resolver registry (`resolvers` table: stake, accuracy record); slashing
  and reward distribution on finalization.
- Oracle adapter interface so `resolution: 'oracle'` markets and Stage 4
  escalations share one code path (Chainlink Functions or UMA OO adapter);
  until contracts exist, the adapter can proxy a trusted API feed.
- Payout release (`$1/share`) moves fully behind `finalized` — deleting the
  last code path that pays out on an unreviewed click.

Each phase is shippable on its own: Phase 1 already removes the worst
failure mode (instant unilateral payout) with nothing but store changes.
