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

**Progress:** v25.31 pages `/events/keyset` for the top 400 events by 24h
volume (was one page of 50). Feed: 417 → 572 events / ~5,200 markets; wire
3.7 MB raw (~450 KB gzipped in production), odds beat 356 KB/min. The quote
safety net is untouched and is what makes growth safe: the 60s odds beat
covers every carried market, `place_trade` re-anchors to `feed_price` at fill
time, and live games get the bet-time quote check — a user never fills at a
price the server has not just verified. The next real step is the DB
catalogue + cron (phase 1 below); do not push the client payload much past
this size.

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

**Corrected 2026-07-28 — the community half of this entry was wrong.** It said
community markets draw the seeded walk and that a `market_history_rpc` over
`trades` would fix them. They do not: `place_trade` has been appending every
fill to `markets.price_history` all along (schema.sql), and `mapPriceHistory`
reads it, so a community chart in cloud mode already IS its own fills. Such an
RPC would have duplicated a column that was already correct. The only rows
drawing a generated walk were the local-demo `seedMarkets` — which do not
exist in production — and v25.43 labels those "Illustrative" and records the
opening price at creation. Nothing is left here for community charts.

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

## Esports hub: what "cooler like Polymarket" still needs

Owner keeps pointing at PM's E-Sport page (2026-07-27, twice). What we already
have: LiveMatchHero with the live STREAM embedded (44% right, autostarts when
live), game tiles with gradients + live counts, the LIVE-TRADES strip. The
remaining gap, in order of visual impact:

- **Stream coverage.** `lib/streams.ts` maps ~6 tournaments to channels by
  hand; most esports matches have no known stream, so the hero falls back to
  a static icon. A real fix needs a data source for tournament → broadcast
  channel (PandaScore/Abios carry it; both paid). Do NOT guess channels — a
  wrong stream is worse than none.
- **Game artwork.** PM hotlinks key art; we decided not to (rights). Options:
  commission/own simple per-game illustrations, or keep gradients.
- **Score bubbles in the hero** — PM shows per-team map score + multiplier +
  % pill in the hero rows; ours shows price bars. Data exists (useScores).

## Live scores only cover what ESPN and Gamma report

`lib/espn.ts` matches events to a scoreboard by team names; anything it cannot
match renders without the live panel. The gap is widest in esports, where
`lib/streams.ts` fills in with a broadcast channel per tournament — a lookup
table that has to be maintained by hand. A real fix is a provider with an
esports scores API (PandaScore, Abios); both are paid.

---

## Design review 2026-07-27 — what is still open

Five reviewers went over the running app with screenshots (first impression /
trading surfaces / events + hubs / design system / slop hunt). The first wave
was implemented in v25.29; what follows is what they found and nobody has done
yet, in the order it changes the impression.

**Read this first if you are picking it up:** the reviewers ran against two dev
servers sharing one `.next` directory, which corrupts bundles. Two findings
("the event chart never draws at desktop", "the hub grid is a grey skeleton
after 13s") were artefacts of that and were verified fine afterwards. Run ONE
dev server, and re-verify a rendering claim before acting on it.

### Layout and density

- **The home page still spends ~760px before the first tradeable card** (was
  854). What is left: `FeaturedHero` is 458px tall, and its right-hand
  "Trending now" panel has `flex-1` (`components/markets/FeaturedHero.tsx:552`)
  so it stretches to the hero's height while its five rows end 236px short —
  a visibly half-empty card. Either drop `flex-1` or fill it with 10 rows
  (`:494`).
- **Card interiors do not line up across a grid row.** Measured first-button
  offsets in one row of four: 55 / 55 / 105 / 55 px. `MarketCard`'s title has
  `min-h-[38px]`, `EventCard`'s now does too, but the matchup branch has no
  title block at all and starts 50px lower. Give it the same spacer.
- **Every hub is a different layout** (`app/category/[cat]/page.tsx`): politics
  = rail + 3 columns, esports = no rail + 4 columns + tiles, community = no
  rail + 4 columns. The grid's left edge jumps 208px between two adjacent nav
  items. Reserve the rail column on every hub and settle on one column count.
- ~~**The market page on a phone puts the buy ticket and the resolution card
  ABOVE the market title.**~~ Done in v25.43 — the header leads the page below
  `lg` and the phone keeps a pinned title via `StickyContextBar`. No bottom
  bar was needed: the ticket sits directly under the header. Note for whoever
  touches that file next — the desktop header is `position: sticky` and has to
  stay a DIRECT child of the tall left column, so the header markup is shared
  (`TitleRow` / `MarketFacts`) and rendered once per breakpoint rather than
  moved by CSS.
- **The market page's right rail dies ~450px before the left column ends.**
  Move `MarketChat` or `RelatedMarkets` into it.

### Colour

- **`team-tint` buttons paint the feed's crest colours into the UI**
  (`components/markets/EventCard.tsx:212,487`,
  `components/category/LiveMatchHero.tsx:97-111`). One esports hub screen
  showed buy buttons in dark red, slate, olive, green, grey, blue, magenta,
  teal and red — and both sides of a pair in different colours, so nothing
  says which is the up-side. Use `yes-tint`/`no-tint` and keep the crest as
  the only team identity. **This is the biggest remaining colour item.**
- Green still selects on: `LiveMatchHero`'s two probability bars (both green —
  should be green/sky), the search overlay's prices and query highlight
  (`components/search/SearchOverlay.tsx:295,337,340`), the `Featured` badge
  that is true of every hero slide (`FeaturedHero.tsx:139`).
- `sky` and `danger` fail 4.5:1 on their own tints. `components/ui/badge.tsx`
  already solves this with `-bright`; ~13 hand-rolled tint blocks do not
  (`MarketDetail.tsx:314`, `NotificationBell.tsx:33-34`, `TradePulse.tsx:120`,
  `AuthModal.tsx:371`, `admin/page.tsx:186,196`, `VotePanel.tsx:126,146`).
  Mechanical: inside any `/10 /15 /20` tint or on `surface-3`, `text-sky` →
  `text-sky-bright`, `text-danger` → `text-danger-bright`.

### The system, measured

- **7 border radii / 39 border values / 20 neutral background values / 65
  padding steps / 37 gap steps.** The same square icon tile is `rounded-xl` in
  11 files, `rounded-2xl` in 2, `rounded-lg` in 3 and `rounded-full` in 1.
  Collapse to: card `rounded-2xl`, control `rounded-xl`, tile/chip/badge
  `rounded-lg`, avatar `rounded-full`; delete `rounded-md`/`rounded`/
  `rounded-sm`. Backgrounds to 4 tokens + `bg-ink/70` (scrim) +
  `bg-surface/75` (sticky blur).
- **`components/ui/card.tsx` is fully written, typed, documented — and has
  zero users.** `card-surface` is used 88 times with 9 different paddings.
  Either adopt the component or allow exactly `p-3.5 | p-5 | p-8`.
- **`ui/badge.tsx` is cloned inline 13 times** with the exact same class
  triples. Add a `Banner` primitive and route them through it.
- **globals.css is 1,395 lines, of which ~84% is per-category hero scenery** —
  35 `@keyframes`, a keyframed football, two lapping race cars, a ticking fake
  clock reel, a chromatic VS glitch. `components/category/*Hero*.tsx` is 4,283
  lines for 18 decorative scenes. Collapsing them to one `GenericHero` is the
  single largest deletion available.
- `.spotlight-card` + `components/common/CursorSpotlight.tsx` run a
  `pointermove` listener, a `MutationObserver` on `document.body`, a scroll
  listener and a rAF loop so card borders lean toward the cursor.

### Content and copy

- **`/about` says "real money" and "balances are backed 1:1"; `/help` said
  "educational platform, simulated values, not real funds".** The help answer
  was rewritten in v25.29 to "real, early, not launched"; `/about`'s trust
  claims still need the same pass, and `/wallet` + `/reserves` should agree.
- `/create` is nine stacked `card-surface` sections with nine green numbered
  chips, and the numbering shifts (`n={isEvent ? 9 : 8}`) when the type toggle
  flips. One card, hairline `divide-y`, no numerals.
- `/settings` has three cards with three explanatory subtitles for six
  controls, and a section called "Danger zone".
- `/leaderboard` and `/rewards` carry a **verbatim duplicated** 84-line season
  countdown hero, ticking every second toward a date 157 days out, wrapping
  3+1 on a phone.
- `/u/<name>` renders "No such user" in local mode for the account that is
  signed in (`lib/cloud.ts:1335` returns null without Supabase).
- Four content widths across the app: `max-w-[1400px]` (shell), `max-w-4xl`
  centred (`/wallet`), `max-w-2xl` left (`/settings`), `max-w-3xl` left
  (`/about`, `/help`). The `h1` starts at x=38 on four pages and x=266 on one.
- The sub-category rail is an unfiltered tag dump: "Lower Saxony 7" sits next
  to "Niedersachsen 7", `fomc 2` in raw lowercase, and the rail reshuffles on
  every 60s poll (`components/category/SubCategoryRail.tsx`).

### Fake content — the owner's call was to keep it and restyle

Recorded because a later reader will ask: the reviewers were unanimous that
`TradePulse` (invented trade chips over the chart), the hero's rolling
generated comments, `MarketChat`'s seeded thread and the invented
`/leaderboard` should be deleted rather than restyled. The owner decided on
2026-07-27 to keep them and improve the presentation instead. Two things are
NOT a matter of taste and should still be fixed:

- `components/markets/MarketCard.tsx:299` renders `TradePulse`
  unconditionally, so the **live preview on `/create`** shows invented trades
  for a market that does not exist yet (`id: 'preview'`).
- The pill is `absolute bottom-2 right-2` with no width cap, so on the hub
  grids it spills out of its card and covers the neighbouring card's meta
  line. Constrain it: `left-2 right-2 flex justify-end` + `max-w-full
  truncate`.
