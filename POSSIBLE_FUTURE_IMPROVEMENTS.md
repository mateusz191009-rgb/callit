# Possible future improvements

The parking lot. Things that were investigated, sized, and deliberately NOT
built yet — so the next agent starts from what was measured rather than from a
guess.

Rules for this file:

- One section per idea. Say what it is, why it is not done, and what it would
  actually cost. Numbers beat adjectives.
- When something here gets built, delete the section (git history keeps it).
- Do not park bugs here. A bug gets fixed or it gets a line in the commit that
  says why it was left.

---

## Carry many more events from Polymarket and Kalshi

Measured 2026-07-27 by walking both catalogues to exhaustion:

| Source | Events | Markets | Raw JSON | Requests |
| --- | --- | --- | --- | --- |
| Polymarket (open, lifetime volume ≥ $1k) | 3,862 | 43,536 | 186 MB | 39 |
| Kalshi (all open) | 8,104 | 68,530 | 147 MB | 41 |
| **What the app carries today** | **417** | **~4,600** | **2.6 MB wire** | 2–15 |

Polymarket's `/events` caps `offset` at ~3000 and points at `/events/keyset`
for deeper paging; the cursor parameter is **`after_cursor`** (not `cursor`,
which is silently ignored — the whole first page comes back forever). Kalshi's
`/events` cursor walk exhausts at 41 pages of 200.

**Ingest is not the problem** — ~80 requests, ~20 s for a full crawl, in a cron
rather than in a request a user is waiting on.

Three things are:

1. **The payload.** The client holds the whole feed in a Zustand store; 417
   events already cost 2.6 MB on the wire. 12,000 would be 60–75 MB per page
   load, which is dead on a phone. The fix is the real work: the DB becomes the
   catalogue and the home grid, hubs, search and trending query it paginated
   (~3–4 days). The cost is losing instant client-side filtering — search goes
   server-side.
2. **The refresh.** ~4,600 rows are mirrored to Postgres every 60 s today. At
   112,000 rows the upsert alone is ~1,120 requests per cycle at
   `SYNC_CHUNK = 100`. A 60 s beat over everything is physically out. Tiering:
   live / traded / held markets at 30–60 s, the rest at 5–15 min, the tail
   hourly.
3. **The promise.** Every listed market is a commitment to settle it.
   `/api/settle` sweeps 500 per run; the settlement pipeline has to scale with
   the catalogue or user money sits stuck in markets nobody can resolve.

**Recommendation:** aim for ~2,000–4,000 events, not "everything". Most of
Kalshi's 68k markets are hourly/daily strikes on the same series ("BTC above X
at 5pm") and most of Polymarket's tail is game props with no liquidity —
listing them makes search and the hubs worse, not better. Order of work:
(1) crawl → DB catalogue + cron, (2) server-driven hubs/search/pagination,
(3) tiered price refresh + settlement scaling. After (1) you can see whether
the volume holds up before paying for (2).

---

## Charts: the ranges are capped at 30 days

`/api/history` asks both providers for 30 days at hourly resolution
(Polymarket CLOB `interval=max&fidelity=60`, Kalshi `period_interval=60`), so
the ALL pill means "30 days" and not "since listing". Polymarket's CLOB accepts
explicit `startTs`/`endTs`, and Kalshi accepts any window, so a longer range is
a parameter change plus a second cache key — the reason it is not done is that
the chart component has three fixed pills (1D / 1W / ALL) and a real range
picker is a different piece of UI.

Community markets still draw the seeded walk from `lib/utils.ts` (labelled
"Illustrative"). Their real history is their own fills — `trades` has every one
of them, so a `market_history_rpc` reading that table would make those charts
real too. Small job, needs an RPC and an index on `(market_id, created_at)`.

---

## Community events: the outcomes are independent pools

`create_event_rpc` (v25.28) opens one binary FPMM per outcome, each seeded at
1/N. Nothing keeps them summing to 100% afterwards — buy Alice up to 60% and
the board can read 130% while Bob and Carol sit where they were. Polymarket has
the same property per market, which is why this shipped, but a real
multi-outcome market maker (LMSR over N outcomes, one shared collateral pool)
would price them as one question and make arbitrage between the sides
impossible rather than merely unprofitable. That is a pricing-engine change:
`place_trade`, `previewBuy` and the payout path all assume a two-sided pool.

Also missing on community events, in rough order of how much they are missed:

- No way to edit or delete your own market after launch (an admin ban is the
  only lever, and it refunds at cost).
- Outcomes resolve one at a time through the normal community vote, so an event
  can sit half-settled. A "one winner" resolution that settles every sibling in
  one call would match how the event reads.
- Uploaded icons are not moderated. The bucket is public-read and writes are
  scoped to the uploader's folder, so the exposure is limited to what one
  account can put on its own markets — but there is no review step and no
  report button.

## Live scores only cover what ESPN and Gamma report

`lib/espn.ts` matches events to a scoreboard by team names; anything it cannot
match renders without the live panel. The gap is widest in esports, where
`lib/streams.ts` fills in with a broadcast channel per tournament — a lookup
table that has to be maintained by hand. A real fix is a provider with an
esports scores API (PandaScore, Abios); both are paid.
