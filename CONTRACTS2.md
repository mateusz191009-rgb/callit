# Callit v2 — Foundation Contracts (build spec for feature agents)

Extends `CONTRACTS.md` — everything there still applies (design language,
tokens, conventions, existing components). This file documents the v2
foundation (already written — READ the source before coding) plus the UI
contracts each feature agent must implement. Signatures are LAW.

Environment quirk reminder: NEVER use AnimatePresence exit animations
(broken with React 19.2 — exited elements stay mounted and block clicks).
Use conditional rendering with initial/animate entrance only.

## New/changed foundation modules (already written)

### lib/types.ts (changed)

- `Market` gained two optional fields:
  - `icon?: string` — image URL (Polymarket icon/image). Mocks leave it
    undefined — UI falls back to a category icon.
  - `eventId?: string` — set when the market is one outcome of an
    `EventGroup` (id of that event).
- New exports:
  - `interface EventGroup { id: string; title: string; icon?: string;
    category: Category; endDate: string; volume: number; markets: Market[] }`
    — multi-outcome event; `markets` are binary outcome markets **sorted by
    yesPrice desc**, each with `eventId` set, max 8.
  - `type DepositCurrency = 'BTC' | 'ETH' | 'USDT' | 'USDC' | 'BNB' | 'SOL'`
  - `interface Deposit { id: string; currency: DepositCurrency; amount:
    number; txHash?: string; status: 'pending' | 'approved' | 'rejected';
    createdAt: string; userEmail?: string }` — `amount` is the **USD value**
    (demo denomination).
  - `interface ChatMessage { id: string; marketId: string; author: string;
    text: string; createdAt: string }`
  - `interface AuthUser { email: string; username: string; isAdmin: boolean }`

### lib/wallets.ts (new)

- `interface DepositWallet { currency: DepositCurrency; label: string;
  network: string; address: string; color: string }`
- `WALLETS: DepositWallet[]` — 6 entries (BTC, ETH, USDT, USDC, BNB, SOL)
  with REAL deposit addresses and brand hex colors (BTC `#F7931A`, ETH
  `#8A92B2`, USDT `#26A17B`, USDC `#2775CA`, BNB `#F0B90B`, SOL `#9945FF`).
  Do NOT alter addresses. `color` is for dots/tiles/QR accents only.
- `walletFor(currency): DepositWallet` — lookup helper.

### lib/polymarket.ts (changed)

- `getTrendingMarkets(): Promise<Market[]>` — now fetches limit=100 from
  Gamma, maps `icon` from `r.icon ?? r.image`. Mock fallback unchanged in
  shape but now ~31 markets.
- `getTrendingEvents(): Promise<EventGroup[]>` (new) — Gamma
  `/events?limit=25&order=volume24hr` (3s timeout). Events with >= 3 usable
  active binary outcome markets become `EventGroup`s (id `pm-ev-<id>`, top 8
  outcomes by yesPrice, markets without prices dropped, `eventId` set on
  every outcome market). Falls back to `getMockEvents()`.
- `getPolymarketData(): Promise<{ markets: Market[]; events: EventGroup[] }>`
  (new) — combined payload, used by the API route.
- `getMockPolymarketData(): { markets: Market[]; events: EventGroup[] }`
  (new, **sync**) — client-side fallback when `/api/polymarket` is
  unreachable. Same shape.
- `getMockPolymarkets(): Market[]` — still exported (~31 mocks).
- `getMockEvents(): EventGroup[]` (new) — 6 mock events (2026 World Cup
  Winner, 2026/27 Champions League Winner, 2028 Dem/GOP nominees, Next Fed
  Chair, Best Picture 2027) with deterministic price histories. Mock event
  ids are `pm-ev-mock-<key>`; outcome market ids
  `pm-ev-mock-<key>-<outcome-slug>`.

### app/api/polymarket/route.ts (changed)

- `GET /api/polymarket` now returns `{ markets: Market[]; events:
  EventGroup[] }` (was a bare `Market[]`). Consume via
  `usePolymarketLoader()` — do not fetch it yourself.

### lib/supabase.ts (new)

- `supabase: SupabaseClient | null` — created from
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `null` when
  either is missing (local demo mode).
- `supabaseEnabled: boolean` — `Boolean(supabase)`. Use this to branch UI
  copy ("Demo mode — accounts are stored locally.").
- `supabase/schema.sql` — full DB schema + RLS (profiles, markets,
  positions, trades, deposits, chat_messages, `is_admin()` helper). Runnable
  in the Supabase SQL editor. `.env.local.example` documents the two vars.

### lib/store.ts (changed) — `useCallitStore`

New persisted fields (all in `partialize`, storage key still
`callit-store-v1`):

- `deposits: Deposit[]`
- `chat: Record<string, ChatMessage[]>` — keyed by marketId, capped at 200
  messages per market.
- `user: AuthUser | null`
- `bannedMarketIds: string[]`
- `localUsers: LocalUser[]` — demo credential store (plaintext, DEMO ONLY);
  `interface LocalUser { email: string; username: string; pass: string;
  banned: boolean; balance?: never }` (exported from store.ts).
- `adminUnlocked: boolean`

New runtime field: `polyEvents: EventGroup[]`.

Changed action:

- `setPolymarkets(data: { markets: Market[]; events: EventGroup[] })` —
  **signature changed** from `(ms: Market[])`. Sets `poly`, `polyEvents`,
  `polyLoaded`.
- `getMarketById(id)` — now also finds markets nested inside `polyEvents`
  (flattened), overrides applied.
- `trade(...)` — additionally returns `null` when the signed-in user's
  email is banned in `localUsers`.
- `createMarket(input)` — **signature changed** to `Market | null`: returns
  `null` (and stores nothing) when the signed-in user is banned; callers
  must handle the null and show an error.

New actions (dual-mode = Supabase when `supabaseEnabled`, else local demo):

- `signUp(email, username, pass): Promise<{ ok: boolean; error?: string }>`
  — Supabase: `auth.signUp` + `profiles` insert. Local: rejects duplicate
  email ("An account with this email already exists."), pushes to
  `localUsers`, signs in. Either way sets `user`;
  `isAdmin = email === 'admin@callit.app'`. Empty fields rejected.
- `signIn(email, pass): Promise<{ ok: boolean; error?: string }>` —
  Supabase: `auth.signInWithPassword`, loads profile (username/banned/
  is_admin), banned profiles are signed out + rejected ("This account is
  banned."). Local: verifies against `localUsers` ("Invalid email or
  password."), rejects banned. Sets `user` on success.
- `signOut(): void` — Supabase signOut fire-and-forget + `user: null`.
- `requestDeposit(currency: DepositCurrency, amount: number, txHash?:
  string): void` — pushes a pending `Deposit` (newest first), `userEmail`
  from `user`. Caller shows the toast. No-op for amount <= 0.
- `approveDeposit(id: string): void` — pending -> approved AND credits
  `balance` by `amount` (USD). No-op if not pending.
- `rejectDeposit(id: string): void` — pending -> rejected. No-op if not
  pending.
- `addChatMessage(marketId: string, text: string): void` — author =
  `user?.username ?? 'guest'`, appends to `chat[marketId]` (cap 200,
  oldest dropped). Trims; empty text is a no-op.
- `banMarket(id)` / `unbanMarket(id)` — add/remove in `bannedMarketIds`
  (idempotent).
- `banUser(email)` / `unbanUser(email)` — toggles `localUsers[].banned`;
  when Supabase is enabled also updates `profiles.banned` fire-and-forget.
- `adjustBalance(delta: number): void` — admin tool; result clamped >= 0.
- `setAdminUnlocked(v: boolean): void`.

### lib/useMarkets.ts (changed)

- `useAllMarkets(): { markets: Market[]; loading: boolean }` — now
  EXCLUDES `bannedMarketIds`. Does NOT include event outcome markets (they
  live in `useEvents`; mix on the page per the page contracts below).
- `useEvents(): { events: EventGroup[]; loading: boolean }` (new) — events
  with overrides applied to outcome markets; banned outcome markets removed;
  events whose outcomes are ALL banned are dropped.
- `useMarket(id): Market | undefined` — now also resolves markets nested in
  `polyEvents` (so `/market/[id]` works for event outcomes). Banned markets
  still resolve here (detail/admin views need them) — gate lists, not
  lookups.
- `usePolymarketLoader()` — fetches `/api/polymarket` once per session,
  `setPolymarkets(data)`; on failure falls back to
  `getMockPolymarketData()`.

### package.json (changed)

- Added deps (installed): `@supabase/supabase-js@^2.49.0`,
  `qrcode.react@^4.2.0` (`import { QRCodeSVG } from 'qrcode.react'`).

---

## UI contracts (what each feature agent builds)

### components/markets/ProbabilityGauge.tsx

- default `({ value, size = 72, label }: { value: number; size?: number;
  label?: string })` — SVG donut: track in `line` color, animated **green**
  arc (green always — it is the Yes share; do NOT switch to sky below 0.5),
  centered bold percentage, small label under. Client component, animates
  stroke on mount.

### components/markets/EventCard.tsx

- default `({ event }: { event: EventGroup })` — Polymarket-style
  multi-outcome card, same card shell/classes as MarketCard incl.
  `glow-hover liquid-border`: header row event icon (`img rounded-lg h-9
  w-9 object-cover`, fallback category icon squircle) + title (`line-clamp-2
  font-bold`); top-3 outcome rows: outcome name (short — strip 'Will '
  prefix / ' win…' suffix heuristics), percentage bold `tabular-nums`, mini
  Yes/No tinted buttons (open trade modal for that market via
  `openTradeModal`); '+N more' link row; footer volume + `Countdown`; card
  click -> `/event/[id]`.

### components/markets/FeaturedHero.tsx

- default `({ events, markets }: { events: EventGroup[]; markets:
  Market[] })` — Polymarket-style hero: lg 2-col grid
  (`minmax(0,1fr) 340px`). LEFT: featured panel (`rounded-2xl border-line
  bg-surface-2`, `hero-glow`) auto-rotating (8s, paused on hover, dot
  indicators + prev/next chevron buttons) through top 5 events: event icon +
  category chip + title (`font-black text-2xl`), top-4 outcomes as colored
  legend rows (dot color from `CHART_COLORS = ['#00E17E','#3B9DF8',
  '#FFB547','#FF5C7A']`, name, price ¢ bold, mini Yes button) and a
  `MultiOutcomeChart` of those 4 markets' priceHistory; footer Vol + Ends +
  'Trade event ->' link. If events empty, fall back to top binary markets
  with `ProbabilityGauge` instead of chart. RIGHT column: brand card 'Make
  the call. Make the market.' (`Make the <green>market</green>.`,
  font-black, tagline sub, Create-market CTA `buttonClasses` primary +
  `glow-green`) above a 'Trending now' list card (top 5 by volume: rank
  number, line-clamp-1 question, yes ¢ green, links).

### components/markets/MultiOutcomeChart.tsx

- default `({ series, height = 220 }: { series: { name: string; color:
  string; history: PricePoint[] }[]; height?: number })` — recharts
  LineChart, one Line per series (stroke=color, dot=false, strokeWidth=2),
  merged time axis (union of timestamps, forward-fill), dark tooltip listing
  each series name+¢, YAxis 0-100 ¢ ticks, grid `#2C4356` dashed vertical
  off, mounted-flag skeleton like PriceChart.

### components/social/TradePulse.tsx

- default `({ marketId, compact }: { marketId: string; compact?:
  boolean })` — fake live activity: every 6-14s (randomized per instance,
  useEffect interval) briefly shows a floating chip inside the card
  bottom-right: `<name> bought $<n> Yes/No` (name from a 12-name pool, n
  5-500 weighted small, side random weighted by yesPrice), motion entrance
  fade/slide, auto-hide after 2.5s. Yes chips green tint, No sky tint. Must
  be purely visual (no store writes), cheap (single interval), and render
  nothing until first fire.

### components/social/MarketChat.tsx

- default `({ marketId }: { marketId: string })` — card 'Discussion' with
  tabs Comments | Activity (ui Tabs). Comments: list from
  `store.chat[marketId]` (seeded with 2-3 deterministic mock comments per
  market when empty — generate from marketId hash, do NOT write mocks to
  store), input row (Input + send Button sm, disabled when empty; guests
  post as 'guest'); Activity: mock recent trades list (8 rows, deterministic
  from marketId hash: name, side chip, $amount, 'xm ago'). Avatars: 24px
  rounded-full bg gradient from name hash + initial letter.

### lib/useActivity.ts

- TradePulse is self-contained; useActivity exports shared helpers:
  `randomTrader(seed)`, `fakeTradesFor(marketId, count)` (deterministic) —
  shared by TradePulse + MarketChat Activity tab.

### components/auth/AuthModal.tsx

- default `({ open, onClose, defaultTab }: { open: boolean; onClose: () =>
  void; defaultTab?: 'signin' | 'signup' })` — ui Modal, Tabs Sign in /
  Sign up, email+username(signup)+password Inputs with validation, submit
  via `store.signIn`/`signUp`, loading state, error `text-danger`, success
  toast ('Welcome back' / 'Account created') + `onClose`. Note under form:
  'Demo mode — accounts are stored locally.' when `!supabaseEnabled`.

### components/auth/UserMenu.tsx

- default `()` — topbar chip for signed-in user (avatar initial, username,
  chevron; dropdown: Portfolio link, Wallet link, Admin link when isAdmin,
  Sign out). Client dropdown w/ outside-click close, no AnimatePresence
  exit.

### app/wallet/page.tsx

- Deposit center: heading 'Wallet'; balance card; currency selector grid (6
  tiles: currency color dot, label, network badge); selected wallet panel:
  `QRCodeSVG` (qrcode.react, bgColor transparent, fgColor `#FFFFFF`,
  includes margin, size 180, wrapped in `rounded-2xl bg-surface-3 p-4`) +
  address mono text with copy button (navigator.clipboard + toast 'Address
  copied') + amber warning 'Send only <CUR> on <network> to this address.';
  deposit request form: amount (USD value) + optional tx hash + submit ->
  `store.requestDeposit` + toast 'Deposit submitted — pending approval';
  'Your deposits' table (currency, amount, status Badge pending=amber
  approved=green rejected=danger, date). Educational demo note.

### app/admin/page.tsx

- Admin panel: access = `store.user?.isAdmin || store.adminUnlocked`, else
  password gate card (Input type password, unlock === 'callit-admin' ->
  `setAdminUnlocked(true)`, wrong -> toast.error). Panel tabs (ui Tabs):
  Overview (stat cards: users count, community markets, open positions
  count, balance, pending deposits), Users (table of localUsers + current
  session user: email, username, banned Badge, Ban/Unban Button sm
  outline/danger), Markets (table of userMarkets + seed community markets:
  question, source, volume, status, Ban/Unban toggling `bannedMarketIds` —
  banned rows dimmed with danger Badge), Deposits (pending first: currency,
  amount, user, txHash short, Approve (primary sm) / Reject (danger sm) via
  store actions + toasts), Settings (adjustBalance quick tools
  +$100/-$100/reset hint, supabaseEnabled status Badge, link to
  supabase/schema.sql instructions).

### components/markets/ResolutionInfo.tsx

- default `({ market }: { market: Market })` — 'How this market resolves'
  card: method icon+name (Community vote / Manual (creator resolves);
  'Chainlink Oracle' is still rendered for `resolution: 'oracle'` Global
  markets, but v4 REMOVED it from the create-form picker — see v4 below),
  1-2 sentence explanation, planned fairness pipeline
  note (bond -> 24h dispute window -> community jury), link-styled ref to
  docs/RESOLUTION.md. Compact, muted.

---

## Page-integration contracts

- `app/page.tsx` — uses `FeaturedHero(events, markets)` + mixed grid
  (EventCards first when tab all/trending/polymarket, then MarketCards;
  events filtered by category/search too; markets belonging to a displayed
  event (`eventId` set AND its event shown) are NOT repeated as single
  cards on 'all'/'trending' — but ARE searchable).
- `app/event/[id]/page.tsx` — event header w/ icon, outcome table rows w/
  bar, `MultiOutcomeChart` large, back link. Event lookup: find in
  `useEvents().events` by id. SUPERSEDED BY v4: the Frontrunner gauge card
  is gone; the right rail (lg+) holds a `TradePanel` for the selected
  outcome — clicking a row selects it, its mini Yes/No buttons select it
  AND preset the side. Below lg the rail is hidden and those buttons open
  the trade modal instead.
- `app/market/[id]/page.tsx` — adds: market icon in header,
  `ResolutionInfo` card in right column under TradePanel, `MarketChat` +
  `TradePulse` under the chart. (v4: NO `ProbabilityGauge` on this page —
  the component is now used only by `FeaturedHero`.)
- Topbar: replace 'Sign up' button with AuthModal trigger; when user signed
  in show `UserMenu` instead of Sign up (Connect Wallet chip stays).
- Sidebar gains 'Wallet' item (Wallet icon, `/wallet`) in main section and
  'Admin' item (Shield icon) at the bottom visible when
  `user?.isAdmin || adminUnlocked`.

## In-play trading + auth-gated trading UI (v2.1)

### lib/format.ts — `isInPlay`

- `isInPlay(market: Pick<Market,'status'|'category'|'endDate'>): boolean` —
  true when `status === 'open'`, category is `'sports'` or `'football'`,
  and now is within `[endDate, endDate + 4h)` (`IN_PLAY_WINDOW_MS`). Live
  sports markets stay tradeable during that window even though their
  endDate has passed — prices keep adjusting with every fill.
- `store.trade()` blocks expired markets only when `ended && !isInPlay(market)`.
- UI: TradePanel computes `closed = resolved || (ended && !inPlay)` and
  shows a pulsing green dot note "LIVE — in-play trading, odds update with
  the game." while in-play. MarketCard keeps its Yes/No quick-buy buttons
  active for ended-but-in-play markets and swaps the footer Countdown for a
  pulsing green "LIVE" indicator. The event detail OutcomeRows disable
  their Yes/No buttons only when `ended && !isInPlay(market)`.

### Auth-gated balance + money features

- Guests (store `user === null`) never see the demo balance; the underlying
  store balance is untouched — UI gating only. Guests can still browse and
  create markets.
- Topbar renders the balance chip only when `_hasHydrated && user`.
- TradePanel (guests): side toggle stays visible; amount input + live-calc
  rows are hidden; the CTA is a primary "Log in to trade" button that calls
  `openAuthModal('signin')`; note reads "Sign in to start trading."
- AmountInput gained `showBalance?: boolean` (default `true`) — hides the
  "Balance: …" row when false; TradePanel passes `showBalance={!!user}`.
- `/portfolio` and `/wallet` show a sign-in EmptyState ("Sign in to track
  your positions" / "Sign in to deposit", action "Log in" ->
  `openAuthModal('signin')`) instead of balance/summary cards and the
  deposit tools for guests.

## Withdrawals + auth hardening (v2.2)

- `lib/types.ts`: new `interface Withdrawal { id: string; currency:
  DepositCurrency; amount: number; address: string; status: 'pending' |
  'approved' | 'rejected'; createdAt: string; userEmail?: string }` —
  `amount` is the USD value, `address` the payout destination.
- Store: new persisted `withdrawals: Withdrawal[]` (in `partialize`). New
  actions:
  - `requestWithdrawal(currency, amount, address): boolean` — requires a
    signed-in user, validates `0 < amount <= balance`, DEDUCTS the balance
    immediately (reserved) and pushes a pending withdrawal (newest first).
    Returns false (no-op) when invalid.
  - `approveWithdrawal(id)` — pending -> approved (funds already reserved).
  - `rejectWithdrawal(id)` — pending -> rejected AND refunds the amount.
- Auth: `signUp`/`signIn` return `AuthResult { ok, error?, info? }`
  (exported from store.ts). When Supabase email confirmation is enabled,
  `signUp` succeeds with `info: 'Check your email to confirm your account.'`
  and sets NO user; AuthModal shows `toast.info(info)`. Supabase errors map
  to friendly copy ('Invalid credentials', 'Email not confirmed yet');
  network failures return 'Auth service unreachable — check
  NEXT_PUBLIC_SUPABASE_URL (use the Project URL, not the REST URL).'
  Profile row is created via upsert (is_admin false), RLS errors ignored.
- `lib/supabase.ts`: `NEXT_PUBLIC_SUPABASE_URL` is sanitized (trim, strip
  trailing slashes and a trailing `/rest/v1` or `/auth/v1` suffix) before
  `createClient` — pasting the Data API URL no longer 404s auth calls.
- `app/wallet/page.tsx`: Tabs 'Deposit' | 'Withdraw' above the content.
  Withdraw tab: currency tiles (shared selector), amount input with Max
  chip (Max = balance), destination address Input (min length 20), submit
  'Request withdrawal' -> toast 'Withdrawal requested — pending review',
  history table (currency, amount, short address, status Badge, date).
- `app/admin/page.tsx`: 'Deposits' tab renamed 'Payments' — Deposits table
  plus a Withdrawals section (Approve/Reject on pending; reject toast says
  refunded). Overview stat card counts pending deposits + withdrawals.
- `supabase/schema.sql`: new `withdrawals` table + RLS mirroring deposits
  (owner insert/select own, admin update/all).
- Topbar: the mock 'Connect Wallet' button is REMOVED — identity comes from
  the auth system. The wallet slice stays in the store (used internally for
  `createdBy`).
- `app/layout.tsx`: `<body suppressHydrationWarning>` (browser extensions
  inject data-* attributes before hydration).

## Conventions (unchanged + additions)

- Strict TS, `tsc --noEmit` must pass. Token classes only; chart/brand hex
  constants allowed (CHART_COLORS, wallet brand colors).
- Prices via `formatCents` (62¢), Yes = green, No = sky, red only
  errors/negative PnL. No emojis. English UI copy.
- NO AnimatePresence exit animations — conditional render + entrance only.
- Write ONLY your assigned files.

---

# v3 — "de-demo, real economy" foundation (already written — READ the source)

Everything above still applies. This section documents the v3 foundation
changes feature agents build on. Signatures are LAW.

## lib/types.ts (changed)

- `type BuiltinCategory` (new) — the fixed 7-value union
  (`'politics' | 'sports' | 'football' | 'crypto' | 'economy' |
  'pop-culture' | 'custom'`). Use for exhaustive icon maps.
- `type Category = BuiltinCategory | (string & {})` — **widened**: accepts
  any custom category slug while keeping literal autocomplete. In practice
  `Category` is assignable to/from `string`; `Record<Category, T>` now has
  a string index signature (unknown-slug lookups return a possibly-undefined
  value at runtime — always `?? Sparkles`-fallback icon lookups).
- `Market.category: string` and `CreateMarketInput.category: string` —
  built-in value OR custom slug.
- `Market.createdBy` is now the creator **username** (`'guest'` when
  signed out), NOT a wallet address. Detail pages display
  `censorName(market.createdBy)` (see lib/format.ts). Old seed markets
  still carry addresses; censorName handles both.
- `CATEGORIES: { value: BuiltinCategory; label: string }[]` — built-ins
  only. For the FULL list use `useCategories()` (lib/useMarkets.ts).
- `categoryLabel(c: string, custom?: readonly {value,label}[])` —
  **widened** to accept any string; pass the store's `customCategories` as
  the 2nd arg to resolve custom labels. Also new
  `resolveCategoryLabel(value, customCategories?)` (same behavior; falls
  back to the raw value).

## lib/store.ts (changed) — `useCallitStore`

New exported constants:

- `START_BALANCE = 0` — accounts start empty; balance is funded only via admin-approved deposits.
- `RESOLVE_FEE = 10` — USD fee for resolving a `'manual'` market.
- `ADMIN_EMAIL = 'mateusz191009@gmail.com'` — the ONE admin account;
  `user.isAdmin` is granted to this email (case-insensitive) or a Supabase
  `profiles.is_admin` flag.

Persistence: storage key still `callit-store-v1`, now `version: 2` with a
`migrate` that resets `balance` to 100 and clears `positions`,
`marketOverrides`, `deposits`, `withdrawals` for every pre-v2 client
(fresh start). `user`, `localUsers`, `chat`, `userMarkets`,
`bannedMarketIds`, `sidebarCollapsed` survive.

REMOVED: `adminUnlocked` + `setAdminUnlocked` — the admin password gate is
gone. Admin access = `user?.isAdmin` ONLY. (app/admin/page.tsx got a
minimal `AccessGate` replacement and Sidebar shows the Admin item for
`user?.isAdmin` only; feature agents may restyle.)

New persisted fields:

- `communityVotes: Record<string, Record<string, Side>>` — marketId ->
  voterEmail -> side.
- `customCategories: { value: string; label: string }[]` — admin-created
  categories.

New/changed actions:

- `sell(marketId, side, shares): { proceeds: number } | null` (new) —
  sells owned shares at the CURRENT price of that side via
  `applySell` (lib/pricing.ts): credits proceeds to the balance, reduces/
  removes the position, writes a price/volume/history override. Null when
  the user is banned, market not open (or ended and not in-play), shares
  <= 0, or the user owns fewer shares on that side.
- `resolveMarket(marketId, outcome): boolean` — **signature changed**
  (was void). For `resolution: 'manual'` it deducts `RESOLVE_FEE` from the
  balance FIRST and returns `false` (complete no-op) when
  `balance < RESOLVE_FEE` — surface "Resolving costs $10 — insufficient
  balance." on false. Oracle/community resolutions are free and behave as
  before. Returns `true` on success.
- `castVote(marketId, side): boolean` (new) — community ballot. Requires a
  signed-in user AND `resolution === 'community'` AND market ended AND
  unresolved. One vote per user; re-voting replaces. Returns success.
- `finalizeCommunityMarket(marketId): boolean` (new) — ADMIN-only
  (checks `user?.isAdmin`): resolves to the majority side via
  `resolveMarket` (no fee). Ties — including zero votes — do nothing and
  return `false`.
- `getVoteTally(marketId): { yes: number; no: number }` (new).
- `addCategory(label): boolean` (new) — slugifies the label
  (`'AI & Tech'` -> `'ai-tech'`), rejects blanks and duplicates against
  built-ins + existing customs. Returns success.
- `removeCategory(value): void` (new) — removes a CUSTOM category
  (built-ins unaffected; it only filters `customCategories`).
- `banMarket(id)` — **behavior changed**: also refunds EVERY position on
  that market at cost (`shares * avgPrice` back to the balance) and
  removes those positions; the ban itself is unchanged/idempotent.
  Local-mode behavior — a Supabase multi-user build would refund per-user
  server-side.
- `createMarket(input)` — `createdBy` is now `user?.username ?? 'guest'`.
- `signUp` — local mode additionally rejects duplicate usernames
  (case-insensitive) with error `'Username already taken'`. (Supabase
  projects enforce this via a unique index on `lower(username)`.)
- `mergeMarket(m, override)` (new export) — v3 override merge, used by
  `getMarketById` and every lib/useMarkets selector. For
  `source: 'polymarket'` markets the LIVE feed wins: base
  `yesPrice`/`volume`/`liquidity` come from the fresh feed; only
  `status`/`resolvedOutcome` are preserved from the override and
  locally-traded price points newer than the feed history are appended to
  the chart (anti-scam — local trades can't fake stale odds).
  Community/callit markets keep the full override behavior. `mergeOverride`
  is still exported for raw merges (admin tables) — prefer `mergeMarket`.

## lib/pricing.ts (changed)

- `applySell(m, side, shares)` (new) — mirror of `applyTrade`:
  `proceeds = shares * price(side)`,
  `impact = proceeds / (m.liquidity + proceeds)`, delta pushes yesPrice
  AWAY from the sold side (selling Yes lowers yesPrice), clamped
  0.01–0.99. `volume += proceeds`; **liquidity unchanged**. Returns
  `{ proceeds, yesPrice, volume, liquidity }`.

## lib/format.ts (changed)

- `censorName(name): string` (new) — privacy-censored display name: first
  2 + last 1 chars, middle `'***'` — `'mateusz'` -> `'ma***z'`; names <= 3
  chars keep only the first char (`'bo'` -> `'b***'`). Market detail pages
  display `censorName(market.createdBy)` for the creator.

## lib/useMarkets.ts (changed)

- ALL selectors (`useAllMarkets`, `useEvents`, `useMarketMap`, `useMarket`)
  now merge via `mergeMarket` (live Polymarket prices win — see above).
- `useCategories(): { value: string; label: string }[]` (new) — built-in
  `CATEGORIES` + store `customCategories`. Use this everywhere the full
  category list is needed (create-form select, chips, admin category
  manager).
- `usePolymarketLoader()` — still fetches once per session on mount, but
  now ALSO refetches `/api/polymarket` every 90s (`POLY_REFRESH_MS`,
  exported; single app-wide interval, cleaned up on unmount). Refresh
  failures are silent (last good payload stays; mock fallback only on the
  initial fetch). 90s polling of the one proxy endpoint is safely within
  Gamma limits.

## lib/wallets.ts (changed)

- `COINGECKO_IDS: Record<DepositCurrency, string>` (new) — CoinGecko ids
  (`BTC: 'bitcoin'`, …, `SOL: 'solana'`), used by /api/prices.

## app/api/prices/route.ts (new)

- `GET /api/prices` -> `Record<DepositCurrency, number>` — USD per 1 unit
  (e.g. `{ "BTC": 118000, ..., "USDC": 1 }`). Proxies CoinGecko
  simple/price (3s timeout), 5-min in-memory cache, static fallback prices
  `{BTC: 118000, ETH: 4200, USDT: 1, USDC: 1, BNB: 950, SOL: 210}` when
  unreachable (fallback is not cached). Use it to convert deposit amounts
  entered in crypto units to USD.

## supabase/schema.sql (changed — still idempotent)

- `profiles.balance` default is now **100** (plus an idempotent
  `alter column … set default 100` for existing projects; existing
  balances untouched).
- New unique index `profiles_username_lower_idx` on `lower(username)` —
  case-insensitive username uniqueness.
- Commented admin bootstrap snippet at the bottom (run manually after the
  admin signs up):
  `update profiles set is_admin = true where email = 'mateusz191009@gmail.com';`

## components/markets/MarketCard.tsx (one-line change)

- `CATEGORY_ICONS` lookup in `MarketIcon` is now
  `(CATEGORY_ICONS as Record<string, LucideIcon>)[category] ?? Sparkles` —
  unknown/custom category slugs fall back to Sparkles. Copy this pattern
  for any other `CATEGORY_ICONS`-style lookup fed by `market.category`.

---

# v4 — "cloud mode" foundation (already written — READ the source)

Everything above still applies. v4 makes **profiles, deposits and
withdrawals fully Supabase-backed** when cloud mode is active. Local demo
mode (no env vars) is the fallback and behaves exactly as documented in
v2/v3 — nothing changed there.

**Cloud mode** = `supabaseEnabled && store.user !== null` (Supabase
configured AND signed in). The store helper is private; feature agents
branch on `supabaseEnabled && user`.

## What is cloud-backed vs local-only (v4 scope)

Cloud-backed (Supabase is the source of truth):

- `profiles` — balance, banned, is_admin, username. The signed-in user's
  `balance` in the store MIRRORS `profiles.balance`.
- `deposits` / `withdrawals` — created and status-managed server-side via
  security-definer RPCs. The admin sees and manages EVERY user's rows;
  approving a deposit credits THAT user's cloud balance.

Local-only for now (even in cloud mode — unchanged v3 behavior):

- `positions`, `marketOverrides`, `userMarkets` (markets), `chat`,
  `communityVotes`, `customCategories`, `bannedMarketIds`. Trades/sells/
  resolutions still execute locally; **only the resulting balance is
  mirrored** to `profiles.balance` (fire-and-forget) after every local
  balance mutation (trade, sell, resolve fee/payout, banMarket refunds,
  adjustBalance).
- In cloud mode the store's `deposits`/`withdrawals` arrays are NOT the
  payment history — they stay empty/stale. Fetch cloud rows via
  `fetchMyPayments()` (wallet) / `fetchAllPayments()` (admin) instead.

## supabase/schema.sql (changed — still idempotent, re-run it)

New section 6: security-definer RPCs (all `set search_path = public`,
`grant execute … to authenticated`, revoked from anon/public; admin-only
ones check `public.is_admin()` and raise `'Admin only'` otherwise). All
raise exceptions with user-presentable messages (surfaced as
`CloudResult.error`):

- `request_deposit(currency text, amount numeric, tx_hash text default
  null) returns uuid` — inserts a pending deposit for `auth.uid()`.
  Rejects non-positive amounts and banned/signed-out callers.
- `request_withdrawal(currency text, amount numeric, address text)
  returns uuid` — atomically RESERVES the amount (update … where balance
  >= amount; raises `'Insufficient balance'`) then inserts the pending
  row.
- `approve_deposit(deposit_id uuid)` ADMIN — pending -> approved AND
  credits the depositor's `profiles.balance` (atomic; raises `'Deposit is
  not pending'` on anything else).
- `reject_deposit(deposit_id uuid)` ADMIN — pending -> rejected.
- `approve_withdrawal(withdrawal_id uuid)` ADMIN — pending -> approved
  (funds were reserved on request).
- `reject_withdrawal(withdrawal_id uuid)` ADMIN — pending -> rejected AND
  refunds the reserved amount to the requester's balance.
- `set_user_banned(user_id uuid, is_banned boolean)` ADMIN — ban/unban
  any profile.

Tables/RLS are unchanged (deposits/withdrawals already have
`user_id references profiles` + owner-select/admin-all policies; the
RPCs are definer so they bypass RLS for the cross-user writes).

## lib/cloud.ts (NEW) — typed cloud helpers

ALL helpers degrade gracefully: `null`/`[]`/empty payloads when
`!supabase` or on any error; mutations resolve `CloudResult` — callers
never need try/catch. Exported types: `CloudResult { ok: boolean;
error?: string }`, `CloudProfile { balance, banned, isAdmin, username }`,
`CloudProfileRow { id, email, username, balance, banned, isAdmin }`.

User-facing:

- `fetchMyProfile(): Promise<CloudProfile | null>` — own profile row.
- `pushMyBalance(balance: number): Promise<void>` — mirrors a balance to
  the own profiles row (RLS owner update). Fire-and-forget safe.
- `requestDepositCloud(currency, amount, txHash?): Promise<CloudResult>`
- `requestWithdrawalCloud(currency, amount, address): Promise<CloudResult>`
- `fetchMyPayments(): Promise<{ deposits: Deposit[]; withdrawals:
  Withdrawal[] }>` — OWN rows only (explicit user_id filter — admins
  would otherwise see all), newest first, mapped to the existing
  `Deposit`/`Withdrawal` types (uuid `id` as string, `userId` set).

Admin:

- `fetchAllProfiles(): Promise<CloudProfileRow[]>` — every profile
  (RLS trims to own row for non-admins).
- `fetchAllPayments(): Promise<{ deposits; withdrawals }>` — ALL rows
  with `userEmail` joined from profiles (+ `userId`), newest first.
- `approveDepositCloud(id)` / `rejectDepositCloud(id)` /
  `approveWithdrawalCloud(id)` / `rejectWithdrawalCloud(id)` — RPC
  wrappers, `Promise<CloudResult>`.
- `setUserBannedCloud(userId: string, banned: boolean):
  Promise<CloudResult>`.

## lib/types.ts (changed)

- `Deposit` and `Withdrawal` gained `userId?: string` — the Supabase
  `profiles.id` of the requester (cloud rows only; local rows leave it
  undefined).

## lib/store.ts (changed) — cloud wiring

- `signIn`/`signUp` (Supabase branch): on success the store now loads the
  profile via `fetchMyProfile()` and sets `balance` from
  `profiles.balance` (cloud is the balance source of truth). Banned
  profiles are still signed out + rejected (`'This account is banned.'`);
  `isAdmin` = `profiles.is_admin` OR the `ADMIN_EMAIL` match.
- NEW `refreshProfile(): Promise<void>` — cloud mode only (no-op
  otherwise). Reloads the own profile and syncs
  `balance`/`username`/`isAdmin`; a user banned mid-session is signed
  out. **Integrators:** the wallet page should call it on mount, and
  `components/common/Providers.tsx` must run it on a 60s interval while
  `supabaseEnabled && user` (interval cleaned up on unmount) — neither is
  wired yet.
- Every local balance mutation (`trade`, `sell`, `resolveMarket`,
  `banMarket` refund, `adjustBalance`, local deposit/withdrawal paths)
  fire-and-forgets `pushMyBalance(newBalance)` in cloud mode.
- **Signature changes** (async dual-mode; all resolve
  `CloudResult { ok, error? }`):
  - `requestDeposit(currency, amount, txHash?): Promise<CloudResult>` —
    cloud -> `request_deposit` RPC; local -> pushes the pending Deposit
    as before. Rejects non-positive amounts.
  - `requestWithdrawal(currency, amount, address): Promise<CloudResult>`
    (was `boolean`) — cloud -> `request_withdrawal` RPC; the reserve
    happens SERVER-side and the local balance is NOT deducted (on ok the
    store awaits `refreshProfile()` — no double-deduct). Local -> reserve
    + pending row as before.
  - `approveDeposit(id)` / `rejectDeposit(id)` / `approveWithdrawal(id)`
    / `rejectWithdrawal(id)`: `Promise<CloudResult>` (were void) — cloud
    -> admin RPCs which credit/refund the TARGET user server-side; the
    admin's LOCAL balance is never touched (a `refreshProfile()` is fired
    after approve-deposit/reject-withdrawal to cover self-targets). Local
    -> v2 behavior, now with `{ ok:false, error: '… is not pending.' }`
    instead of silent no-ops.
  - `banUser(email, userId?)` / `unbanUser(email, userId?)` — still
    sync/void. When Supabase is enabled: with `userId` (from
    `fetchAllProfiles()`) they use the `set_user_banned` RPC; without it
    they fall back to the v2 email-matched profiles update. Admin UI
    should ALWAYS pass `userId` for cloud users.
- In cloud mode admin IDs are uuids: pass the cloud row's `id` string to
  approve/reject actions (they route to the RPCs, not the local arrays).

## app/wallet/page.tsx (minimal compat change)

- Deposit/withdraw submit handlers now `await` the async store actions
  and toast `res.error` on failure (cloud RPC errors like `'Insufficient
  balance'` surface directly). The wallet feature agent may restyle but
  MUST keep awaiting the results.

## Admin UI expectations (for the admin feature agent)

- Users tab (cloud): list from `fetchAllProfiles()`; Ban/Unban ->
  `banUser(row.email, row.id)` / `unbanUser(row.email, row.id)`.
- Payments tab (cloud): list from `fetchAllPayments()` (poll or refetch
  after each action); Approve/Reject -> `await approveDeposit(d.id)` etc.
  and toast `res.error` when `!res.ok`; refetch on success. Local mode
  keeps reading `store.deposits`/`store.withdrawals`.
- Wallet history (cloud): `fetchMyPayments()` instead of the store
  arrays.

## v4 UI changes (verified in-browser 2026-07-15)

These SUPERSEDE the older v2/v3 sections above wherever they conflict.

- **Buy-only.** `TradePanel` has no Buy/Sell tabs and no Sell path; the
  only CTA is `Call it` (guests: `Log in to trade`). `store.sell()` and
  `applySell()` stay in the codebase for a future re-introduction, but
  NOTHING in the UI may call them. Do not re-add a Sell tab.
- **No gauge on market detail.** `ProbabilityGauge` is imported by
  `FeaturedHero` ONLY. `/market/[id]` shows the big Yes/No ¢ price strip.
- **Event page trades in place** (`app/event/[id]/page.tsx`): local state
  `selectedOutcome` (defaults to the frontrunner = highest `yesPrice`).
  Right rail (`lg+`, `hidden lg:block`) renders `<TradePanel market=
  {selectedOutcome} />` keyed by outcome+side so it remounts on change.
  Outcome rows are `aria-pressed` toggles (selected: `border-green/40`);
  their mini Yes/No buttons select the outcome AND preset the side. Below
  `lg` the rail is hidden and those buttons call `openTradeModal` instead.
  Rationale (user request): buying must never cost an extra click.
- **Resolution picker: 2 options.** `Community vote` (default in
  `CreateMarketForm`) and `Manual` ($10 fee note). `Chainlink Oracle` is
  NOT selectable — `resolution: 'oracle'` still exists in the type and is
  used by Global (Polymarket) markets, which `ResolutionInfo` labels.
- **Themed category heroes** (`app/category/[cat]/page.tsx`): `crypto` ->
  `components/category/CryptoHero` (coin orbs + `.crypto-grid` backdrop +
  animated `.constellation-line` svg links), `football` ->
  `components/category/FootballHero` (`.pitch-stripes` field, formation
  tiles, `.pitch-ball`), every other category -> the generic floating-tiles
  hero. All scene geometry is derived from `hashString(id)` (never
  `Math.random`) so SSR and client agree; scenes hide below `sm` and must
  never cause horizontal page overflow.

## Security model (read before touching money code)

- Privileged profile columns (`is_admin`, `banned`, `email`, `id`) are
  pinned by the `profiles_guard` trigger in `supabase/schema.sql` — RLS
  alone would let any user self-promote to admin. Never send `is_admin`
  from the client (the trigger trusts admin callers, so an admin's own
  upsert would demote them).
- ~~OPEN GAP: `profiles.balance` is owner-writable~~ — **CLOSED in v5**,
  see the v5 section below. `place_trade` now settles server-side and
  client `update` on `profiles` is revoked down to the `username` column.

# v5 — server-authoritative economy (supabase/schema.sql section 7)

These SUPERSEDE every earlier section wherever they conflict. The SQL is
the source of truth; this section is the exact interface the TS agents
build against. Re-running `supabase/schema.sql` is still safe (idempotent).

## What changed, in one line

Money and prices moved to the server. The client no longer computes a
balance, a fill price or a market's economics — it calls an RPC and reads
back the result. Community markets and positions now live in Postgres, so
the site is multiplayer: a market one user creates is a market everyone
sees and trades.

## Hard breaks (fix these or things fail at runtime)

- **`pushMyBalance()` (lib/cloud.ts) MUST BE DELETED.** `update` on
  `public.profiles` is revoked from `authenticated`; only the `username`
  column may still be written. Any balance mirror now returns
  `permission denied for table profiles`. The balance is whatever
  `place_trade` / the payment RPCs say it is — refetch, never push.
- **The sign-up `profiles` upsert in lib/store.ts (`.from('profiles')
  .upsert({ id, email, username })`) always errors now** — an upsert needs
  UPDATE on every column in its SET list. It is already dead code: the
  `handle_new_user` trigger creates the profile row. Remove it.
- **`banUser`/`unbanUser` email fallback is dead** (it did a direct
  `profiles` update). Cloud mode MUST pass `userId` so it routes to the
  `set_user_banned` RPC.
- **No client writes to `markets` / `positions` / `trades` /
  `community_votes`** — insert/update/delete policies are dropped AND the
  grants revoked. Reads are unchanged (`markets` and `community_votes` are
  readable by anon so the signed-out feed still renders; `positions` and
  `trades` are own-or-admin).
- **`store.sell()` / `applySell()` have no server counterpart.** There is
  no `sell_rpc` — selling stays UI-dead as per the v4 buy-only rule.

## Tables (new/changed)

- `markets` — now the shared book, aligned to the `Market` type. Columns:
  `id text pk`, `source`, `question`, `description`, `category`,
  `end_date timestamptz`, `resolution`, `yes_price`, `volume`,
  `liquidity`, `creator_id uuid`, `creator_name text`, `created_by text`
  (v2 legacy, back-filled into `creator_name`), `status`,
  `resolved_outcome`, `icon`, `short_name`, `event_id`,
  `price_history jsonb` (`[{t,yes}]`, last 200), `banned`, `created_at`.
  Map snake_case -> camelCase in the client.
- `positions` — `unique (user_id, market_id, side)`. One row per user per
  side per market; `place_trade` upserts it at the weighted avg price.
- `trades` — immutable fill log.
- `community_votes(market_id text, user_id uuid, side text, created_at,
  primary key (market_id, user_id))` — public read (tallies are public).

## RPC signatures (exact — `supabase.rpc(name, args)`)

All are SECURITY DEFINER, `search_path = public`, EXECUTE granted to
`authenticated` only (anon gets nothing). All raise on failure: surface
`error.message` in a toast — the strings below are user-facing.

- `place_trade(p_market_id text, p_side text, p_amount numeric) -> jsonb`
  Returns `{ shares, price, balance, yesPrice, volume, liquidity }`
  (`balance` = the caller's NEW balance; `yesPrice`/`volume`/`liquidity` =
  the market's new state — apply them locally, no refetch needed).
  Maths mirror `lib/pricing.ts applyTrade()` exactly; in-play mirrors
  `lib/format.ts isInPlay()` (sports/football tradeable until end+4h).
  `source='callit'` moves price/volume/liquidity + appends to
  `price_history`; `source='polymarket'` adds volume ONLY (the live feed
  owns the price — the returned `yesPrice` is unchanged).
  Raises: `Not signed in`, `Invalid side`, `Amount must be positive`,
  `This account is banned`, `Market not found`, `This market is
  unavailable`, `This market is closed`, `This market has ended`,
  `Market price unavailable`, `Insufficient balance`.
- `ensure_market(p_id text, p_source text, p_question text,
  p_description text, p_category text, p_end_date timestamptz,
  p_resolution text, p_yes_price numeric, p_volume numeric,
  p_liquidity numeric, p_icon text default null,
  p_short_name text default null, p_event_id text default null,
  p_creator_name text default null) -> void`
  **Call this before the first `place_trade` on any `pm-` (Polymarket) or
  `cl-` (seed) market** — those markets are generated client-side and
  `place_trade` raises `Market not found` if the row doesn't exist.
  Insert-only (`on conflict do nothing`): it can never rewrite an existing
  market's economics, so it is safe to call on every trade. Rejects the
  `cm-` namespace (use `create_market_rpc`).
- `create_market_rpc(p_id text, p_question text, p_description text,
  p_category text, p_end_date timestamptz, p_resolution text) -> text`
  Returns the id. Client generates `p_id` (`cm-…`); `pm-`/`cl-` are
  reserved and rejected. Server fixes the economics: `source 'callit'`,
  `yes_price 0.5`, `volume 0`, `liquidity 500`, `creator_id = auth.uid()`,
  `creator_name` = the caller's username, `status 'open'`.
  `p_resolution` must be `'community'` or `'manual'` — `'oracle'` is
  rejected (matches the 2-option picker).
  Raises: `Not signed in`, `This account is banned`, `Market id is
  required`, `Reserved market id`, `Question is required`, `End date is
  required`, `Resolution must be community or manual`, `Market already
  exists`.
- `resolve_market_rpc(p_market_id text, p_outcome text) -> void`
  Creator + `resolution='manual'` -> charges the $10 fee (atomic; raises
  `Insufficient balance for the $10 resolve fee`). Admin -> free, any
  market. Sets `status='resolved'`, `resolved_outcome`, pays every winning
  position $1/share, clears the book. Raises: `Invalid outcome`, `Market
  not found`, `This market is already resolved`, `Only the creator can
  resolve this market`, `This market does not use manual resolution`.
- `ban_market_rpc(p_market_id text, p_banned boolean) -> void`
  Admin only. Banning refunds every open position **at cost**
  (`shares * avg_price`) and clears them. Raises `Admin only`, `Market not
  found`.
- `community_vote_rpc(p_market_id text, p_side text) -> void`
  Signed-in, not banned. Only for `resolution='community'` markets that
  have ENDED and are unresolved; re-voting replaces the ballot. Raises:
  `This market is not resolved by community vote`, `Voting opens when the
  market ends`, `This market is already resolved`, `This market is
  unavailable`.
- `finalize_community_market(p_market_id text) -> text`
  Admin only. Counts ballots, majority wins, returns `'yes'`/`'no'` and
  runs the same payout as `resolve_market_rpc`. Raises `No votes have been
  cast` / `The vote is tied` (market stays open — an admin can resolve it
  manually instead).
- `payout_market(p_market_id text, p_outcome text)` — INTERNAL. No role
  has EXECUTE; do not call it from the client.

## Security model (v5)

- The gap is CLOSED once the app calls `place_trade`: the fill price comes
  from the server-held `markets.yes_price`, the debit is atomic
  (`update … where balance >= amount`), and the client cannot write
  `balance` at all. `profiles_guard` stays as defense-in-depth for
  `is_admin`/`banned`/`email` — and deliberately does NOT pin `balance`
  (a trigger fires inside SECURITY DEFINER RPCs too and would silently
  revert every payout; see the note in the schema).
- RESIDUAL GAP (bounded, documented in the schema): `ensure_market` lets
  an ordinary client seed the opening `yes_price` of a feed market that
  nobody has traded yet. Later trades fill against the stored price and
  can't be forged, and payout on those markets always needs an admin, so
  it can't self-serve a withdrawal. Close it by syncing the feed from a
  service_role Edge Function/cron and revoking `ensure_market` from
  `authenticated`.
- Withdrawals stay manually reviewed in /admin as a second pair of eyes.

---

# v5 — client wiring (server/store agent — already written, READ the source)

The SQL section above is the server contract; this is the CLIENT contract
built on it. Signatures are LAW. Everything degrades to the documented
local-demo behavior when Supabase is not configured — **branch, never
delete**.

## The two modes (do not confuse them)

- **Cloud FEED** = `supabaseEnabled` (sign-in NOT required). Governs
  market DATA: the shared `markets` book is readable by anon, so guests
  see the multiplayer feed too. Exported as `cloudFeedEnabled` from
  lib/useMarkets.ts.
- **Cloud MONEY** = `supabaseEnabled && store.user`. Governs balance,
  trades, positions, votes. Private helper `cloudActive(s)` in store.ts;
  feature agents branch on `supabaseEnabled && user`.
- **Local mode** (neither) = the exact v3/v4 behavior, untouched.

## lib/serverSupabase.ts (NEW — SERVER ONLY)

- `serviceSupabase: SupabaseClient | null` — `createClient(url,
  process.env.SUPABASE_SERVICE_ROLE_KEY)` with `auth.persistSession:
  false` + `autoRefreshToken: false`. Null when the key/URL is absent.
- `serviceEnabled: boolean`.
- **NEVER import this from a `'use client'` file.** The key bypasses RLS
  and every grant. It is not `NEXT_PUBLIC_`, so Next refuses to inline it
  into client bundles, and the module throws on `typeof window !==
  'undefined'` so an accidental client import fails loudly instead of
  leaking the key. Only `app/api/polymarket/route.ts` imports it today.
- `.env.local.example` documents `SUPABASE_SERVICE_ROLE_KEY` (Supabase
  Dashboard -> Project Settings -> API -> service_role, secret).

## app/api/polymarket/route.ts (changed)

- Response shape and the 120s cache header are UNCHANGED.
- When `serviceEnabled`, it also mirrors every Global market (flat +
  event outcomes, de-duped) into the `markets` table — upsert on `id`,
  chunks of 100, **throttled to once per 60s** (module-level
  `lastSyncAt`, stamped before the await so concurrent requests can't
  double-sync). Fire-and-forget: errors are logged and can never break
  the response.
- This mirror is what makes `place_trade` price Global markets from a
  FRESH server-held price instead of client input. Consequence:
  **`ensure_market` is no longer called from the client at all** —
  `placeTradeCloud` takes only (market, side, amount), so the residual
  "client seeds the opening price" gap the schema documents is closed in
  practice by the service-role sync.
- Written columns: `id, source, question, category, end_date, resolution
  ('oracle'), yes_price (clamped 0.01-0.99), volume, liquidity, icon,
  short_name, event_id`. **Deliberately NOT written: `status`,
  `resolved_outcome`, `banned`, `price_history`** — the column defaults
  ('open', false, '[]') cover inserts, and omitting them means an upsert
  can never re-open a market an admin resolved or silently unban one.
  `yes_price`/`volume`/`liquidity` ARE overwritten each cycle: for
  `source: 'polymarket'` the live feed owns the economics (the same rule
  `mergeMarket()` enforces client-side).
- Without the key the route behaves exactly as before (no sync). Global
  markets then have no row in the book and `place_trade` raises `Market
  not found` -> surfaced as "This market is not open for trading yet —
  try again in a moment."
- `app/api/markets/sync/route.ts` was NOT created — the poly route is the
  only sync trigger needed, and a second public endpoint would only add
  attack surface.

## lib/cloud.ts (changed)

- **`pushMyBalance()` is DELETED** (v5 revoked `update` on profiles down
  to `username`). Never push a balance; read it from the RPC result or
  `fetchMyProfile()`.
- New types: `CloudTradeResult { ok, shares?, price?, balance?, error? }`,
  `CloudCreateResult { ok, id?, error? }`, `CloudFinalizeResult { ok,
  outcome?, error? }`, `CloudMarketsSnapshot { markets, bannedIds }`.
- `placeTradeCloud(marketId, side, amount)` -> `rpc('place_trade',
  {p_market_id,p_side,p_amount})`. Returns the SERVER's `shares`/`price`/
  `balance`.
- `createMarketCloud(input)` -> `rpc('create_market_rpc', …)`; generates
  the `cm-<base36>-<rand>` id itself and returns the stored id.
- `resolveMarketCloud(marketId, outcome)` / `banMarketCloud(marketId,
  banned)` / `castVoteCloud(marketId, side)` /
  `finalizeCommunityCloud(marketId)` -> the matching RPCs.
- `fetchMyPositions(): Promise<Position[]>` — own rows (explicit
  `user_id` filter: RLS lets ADMINS read everyone's).
- `fetchMarketsSnapshot(): Promise<CloudMarketsSnapshot | null>` — ONE
  consistent read: all `source: 'callit'` markets **including banned ones**
  (admin tables need them) + the ids of every banned market of any source.
  **`null` means the read FAILED** — callers keep their last good data
  instead of blanking the feed. Logs the real reason once via
  `console.warn` (this read failing silently is otherwise undebuggable —
  the usual cause is supabase/schema.sql not being applied yet).
- `fetchCommunityMarkets(): Promise<Market[]>` — the spec'd wrapper:
  snapshot minus banned. snake_case -> camelCase, `price_history` jsonb ->
  validated `PricePoint[]`, `creator_name` (fallback `created_by`) ->
  `createdBy`.
- `fetchBannedMarketIds(): Promise<string[]>`, `fetchMarketVotes(marketId):
  Promise<{yes,no}>` (public read).
- `onSharedBookChanged(fn) / notifySharedBookChanged()` — tiny emitter so
  the store can tell useMarkets "refetch the book now" after an RPC.
  cloud.ts imports neither module, so this avoids a store<->useMarkets
  import cycle.
- `mapRpcError()` — the RPCs' raises are already user-facing and pass
  through untouched ('Insufficient balance', 'This account is banned',
  'Admin only', '… is not pending', 'The vote is tied'). Only plumbing
  failures are rewritten: missing function/relation -> "Server functions
  are missing — run supabase/schema.sql.", `permission denied` -> "You are
  not allowed to do that.", JWT -> "Sign in to continue.", offline ->
  "Network error — try again."

## lib/store.ts (changed) — cloud mode is AUTHORITATIVE for money

`syncBalanceToCloud` / every `pushMyBalance` call site is GONE. The
sign-up `profiles` upsert is GONE (dead code that always errors under v5;
`handle_new_user` creates the row). `banUser`/`unbanUser` lost the dead
email fallback — **cloud mode MUST pass `userId`** or nothing happens.

**Signature changes — update every call site:**

- `trade(marketId, side, amount): Promise<{shares, avgPrice} | null>` —
  cloud: `placeTradeCloud`; on ok adopts the returned `balance`, fires
  `refreshPositions()`, and notifies the book when the market is
  `source: 'callit'` (its price moved).
- `createMarket(input): Promise<Market | null>` — cloud: `createMarketCloud`
  then `await refreshCommunityMarkets()` BEFORE resolving, so the caller
  can immediately route to `/market/<id>`.
- `resolveMarket(marketId, outcome): Promise<boolean>` — cloud: the server
  charges the $10 fee and pays out; then refreshes profile + positions.
- `castVote(marketId, side): Promise<boolean>`,
  `finalizeCommunityMarket(marketId): Promise<boolean>`.
- `banMarket(id) / unbanMarket(id): Promise<CloudResult>` — cloud: the
  server refunds EVERY holder at cost (a client could only refund itself).

**New runtime state** (none of it persisted):

- `cloudPositions: Position[]` + `refreshPositions()` — read via
  `usePositions()`, never `store.positions` directly.
- `cloudMarkets: Market[]` (banned INCLUDED), `cloudBannedIds: string[]`,
  `cloudMarketsLoaded: boolean` + `refreshCommunityMarkets()`.
- `lastActionError: string | null` — **the error channel**. The actions
  above keep their `boolean`/`null` contracts, so this carries the RPC's
  user-facing wording. Read it immediately after awaiting:
  `useCallitStore.getState().lastActionError ?? '<your generic copy>'`.
  Local mode leaves it null (generic copy wins = identical UX to today).

**Behavior notes:**

- `refreshCommunityMarkets()` ALWAYS sets `cloudMarketsLoaded = true`,
  even when the read fails. The community book must never be able to hold
  the Polymarket feed hostage — a broken/unapplied DB costs you community
  markets, not the whole site. (Found by running it: before this, an
  unapplied schema left every feed stuck on skeletons forever.)
- `getMarketById(id)` — cloud feed: `cloudMarkets` first (NO override
  merge — the server owns those rows), then the poly feed via
  `mergeMarket`.
- `sell()` — returns null in cloud mode (there is no `sell_rpc`; a local
  settle would forge a balance). Still UI-dead per the v4 buy-only rule.
- `adjustBalance(delta)` — LOCAL ONLY, no-op in cloud mode (the client
  cannot write `balance`). Fund cloud accounts via an approved deposit.
  The /admin Settings balance tools are therefore local-mode only.
- `getVoteTally(marketId)` — returns zeros in cloud mode; use
  `fetchMarketVotes()`.
- `signOut()` clears `cloudPositions` + `lastActionError`.

## lib/useMarkets.ts (changed)

- `cloudFeedEnabled: boolean` (= `supabaseEnabled`) — exported.
- `useCommunityMarkets(): { markets, loading }` (NEW) — cloud: the shared
  book (banned filtered); local: `userMarkets + seedMarkets` merged with
  overrides. **In cloud mode `seedMarkets` are NOT in the feed** — the
  book is the source of truth and the site is multiplayer.
- `useBannedMarketIds(): string[]` (NEW) — local `bannedMarketIds` plus,
  in cloud mode, `markets.banned` from the DB. Needed because Global
  markets render from the API payload, so the DB flag can't travel with
  them. Use this instead of reading `store.bannedMarketIds`.
- `usePositions(): Position[]` (NEW) — cloud: `cloudPositions`; local:
  `store.positions`.
- `useAllMarkets` / `useMarketMap` / `useMarket` — same signatures; they
  now source the community half from `useCommunityMarkets`/`cloudMarkets`
  instead of `userMarkets + seedMarkets` in cloud mode. Polymarket markets
  are unchanged (live feed wins via `mergeMarket`). `useMarket`/
  `useMarketMap` still resolve banned markets — gate lists, not lookups.
- `usePolymarketLoader()` — unchanged for poly (once + 90s). It now ALSO
  drives `refreshCommunityMarkets()` on mount + the same 90s tick, and
  subscribes to `onSharedBookChanged` so an RPC-driven change
  (create/resolve/ban/community trade) refetches immediately instead of
  waiting out the interval.

## Call sites updated (UX kept identical)

- `components/trading/TradePanel.tsx` — `await trade(...)`; new `pending`
  state disables the CTA in flight so a double-click cannot double-spend.
  CTA text is still exactly `Call it` (guests: `Log in to trade`). Toast
  now prefers `lastActionError`. `bannedMarketIds` -> `useBannedMarketIds()`.
- `components/create/CreateMarketForm.tsx` — awaits `createMarket`.
- `app/portfolio/page.tsx` — `usePositions()`; awaits `resolveMarket`; the
  "My created markets" tab matches on `createdBy === user.username` in
  cloud mode (ids live in the shared book, not `userMarkets`).
- `components/markets/VotePanel.tsx` — cloud tallies via
  `fetchMarketVotes` (+ refetch after voting); `myVote` comes from local
  session state in cloud mode (the tally query returns counts only).
- `app/admin/page.tsx` — `usePositions()`, `useBannedMarketIds()`,
  `communityMarkets` = `cloudMarkets` (banned rows INCLUDED so Unban
  works), awaits `banMarket`/`unbanMarket`/`finalizeCommunityMarket`,
  cloud vote tallies.
- `components/common/Providers.tsx` — the existing 60s cloud interval now
  refreshes profile AND positions, and fires **immediately** on
  sign-in/reload (cloud positions are server state; the store starts
  empty).

## Rollout requirement (verified in-browser 2026-07-15)

`supabase/schema.sql` MUST be re-run on the project before v5 works. The
live DB still had the v4 `markets` table during verification and the book
read failed with `column markets.creator_name does not exist` — the app
correctly kept serving the Polymarket feed and logged the one-time
warning. Until the schema is applied: no community markets, and cloud
trades on Global markets raise `Market not found`.

---

# v6 — the real market: a funded AMM (supabase/schema.sql)

These SUPERSEDE every earlier section wherever they conflict. The SQL is the
source of truth; this section is the exact interface the TS agents build
against. Re-running `supabase/schema.sql` is still safe (idempotent) and
**MUST be re-run before any v6 client code ships**.

## Why this exists (read it — it changes how you think about the book)

Until v5 the economy was structurally insolvent, and not subtly:

- there was **no share ledger and no pool**. `place_trade` debited the buyer
  and minted a position backed by nothing;
- `resolve` paid `shares × $1` **out of thin air** — the operator personally
  funded every winning payout;
- `liquidity` was a **display number backed by $0**;
- a trade filled the ENTIRE order at the pre-trade tick, so a $10,000 buy
  bought every share at the 50¢ the market showed *before* the order existed.
  That was the money-printer's fuel.

v6 replaces it with a per-market **Fixed-Product Market Maker** (Gnosis/Omen
style) that holds real collateral:

- `price(yes) = no_reserve / (yes_reserve + no_reserve)`;
- a buy **mints complete sets** (each $1 becomes 1 yes + 1 no share + $1 of
  collateral) and then removes the bought side's shares from its reserve,
  preserving `yes_reserve * no_reserve = k`. The trader walks the curve and
  pays a real, worsening **average** price;
- because every share came from a complete set, `outstanding(side) =
  collateral - reserve(side)`, so **collateral >= max possible payout is
  arithmetic, not a hope**. `payout_market()` asserts it and raises rather
  than settle an insolvent book;
- **markets are funded by someone.** Community: the creator. Global: the
  platform, lazily, on the first trade.

## Hard breaks — fix these or things fail at runtime

- **`create_market_rpc` gained a 7th arg `p_seed numeric` (REQUIRED, no
  default) and the 6-arg overload is DROPPED.** Any existing 6-arg call now
  fails. The creator funds their own market; there is no more free $500.
- **`ensure_market` gained 5 args and its 14-arg overload is DROPPED.**
- **`place_trade`'s returned `price` is the AVERAGE FILL, not a tick.** It
  will differ from the quote the user saw — by design, that is the slippage.
- **`lib/pricing.ts applyTrade()` no longer mirrors the server.** v5 required
  the two to stay in sync; v6's curve is a different function entirely. Do
  NOT use `applyTrade` to predict a fill or to render an optimistic result —
  quote from the reserves, or just use the server's numbers. (`applySell` /
  `store.sell()` remain UI-dead per the v4 buy-only rule; there is still no
  `sell_rpc`.)
- **The feed sync MUST NOT overwrite `yes_price` / `volume` / `liquidity`
  for any market with `collateral > 0`.** v5's sync overwrote them every
  cycle because the live feed owned polymarket prices. In v6 the POOL owns
  the price for Global markets too — we fill out of our own collateral, so
  the fill must move the curve we pay from. Sync those three columns only
  while `collateral = 0` (i.e. before the market's first trade); after that
  the feed may still refresh metadata (question/icon/end_date/`in_play_ok`/
  `provider_ref`/grouping), never the economics.
- **In-play is now a FEED FLAG, not a category guess.** `place_trade`'s
  expiry gate: past `end_date` a trade is allowed ONLY when
  `in_play_ok = true` AND `now() < end_date + 4h`. **`lib/format.ts
  isInPlay()` must be updated to match or the UI will lie** — it currently
  gates on `category`, so it would keep offering a Yes/No button that
  `place_trade` then rejects with `This market has ended`. Change it to:

  ```ts
  export function isInPlay(
    market: Pick<Market, 'status' | 'endDate' | 'inPlayOk'>
  ): boolean {
    if (market.status !== 'open') return false;
    if (!market.inPlayOk) return false;
    const end = new Date(market.endDate).getTime();
    const now = Date.now();
    return now >= end && now < end + IN_PLAY_WINDOW_MS;
  }
  ```

  (`'category'` leaves the Pick, `'inPlayOk'` joins it; `IN_PLAY_WINDOW_MS`
  is unchanged and still matches the SQL's 4h.) The old category rule kept
  time-boxed questions ("goal in the first 10 minutes") tradeable for 4h
  after they were already decided — the owner's rule is that in-play applies
  only to real live games, and only the feed knows which those are.
- **`liquidity` is now real money** (it tracks `collateral` exactly). It is
  no longer "seed + half of volume". Copy that calls it depth is now true.

## markets — every new v6 column

| column | type | meaning |
| --- | --- | --- |
| `yes_reserve` | numeric | FPMM yes-share reserve. NULL/0 = pool not funded yet. |
| `no_reserve` | numeric | FPMM no-share reserve. `yes_reserve * no_reserve = k`. |
| `collateral` | numeric, not null, default 0 | **Real money held by this market**, USD. Every payout comes from here. `liquidity` is kept equal to it. |
| `seed` | numeric, not null, default 0 | Initial funding F (audit trail; unwinds `platform_exposure`). |
| `funder_id` | uuid -> profiles(id) | The LP. Creator for community markets; **NULL for platform-funded Global markets** (their residual + fees go to `platform_settings.platform_balance`). |
| `fee_bps` | int, not null, default 200 | This market's trading fee, **locked in at creation** so an admin changing the global fee cannot retro-price a live market. 200 = 2%. |
| `fees_accrued` | numeric, not null, default 0 | Fees taken so far; paid to the funder at resolution. |
| `in_play_ok` | boolean, not null, default false | Feed's verdict: is this a genuinely live game? The only thing that unlocks post-`end_date` trading. |
| `group_id` | text | Match/event group (e.g. one game). Indexed. |
| `group_label` | text | Sub-market section, e.g. 'Moneyline' / 'Spreads' / 'Totals'. |
| `provider` | text, default 'polymarket' | One of `'callit'`, `'polymarket'`, `'kalshi'` (CHECK-constrained). |
| `provider_ref` | text | Source ticker/id used to poll for the result. Indexed with `provider`. |
| `settle_status` | text, default 'none' | One of `'none'`, `'pending'`, `'settled'`, `'failed'` (CHECK-constrained). |

`trades` also gained `fee numeric not null default 0`. `trades.amount` stays
the GROSS stake; `trades.price` is now the average fill.

`source` is UNCHANGED (`'callit' | 'polymarket'`) and so is the TS union.
Mirror Kalshi markets as `source: 'polymarket'` (= "an external feed owns
it") and distinguish them with `provider: 'kalshi'` — `provider` is what the
settlement poller branches on.

## platform_settings — new table (single row, `id = 1`)

| column | type | meaning |
| --- | --- | --- |
| `global_seed` | numeric, not null, default 25 | What the platform funds a Global market with on its first trade. |
| `fee_bps` | int, not null, default 200 | Fee that NEW markets are created with. |
| `platform_balance` | numeric, not null, default 0 | The operator's till: fees + residuals from platform-funded markets + the $10 manual-resolve fees. |
| `platform_exposure` | numeric, not null, default 0 | Sum of seeds currently at risk in unresolved Global markets. |

RLS: **readable by everyone incl. anon** (the client shows the fee, and
guests see the trade panel). Writable by admins — and only
`global_seed`/`fee_bps`: the till columns have no client write path at all
(the policy gates rows, the column grants gate columns; both are needed, or
an admin could set `platform_balance` to any number and withdraw it). Prefer
the `admin_settings_update` RPC over a direct update.

**Operator honesty note:** seeding a Global market credits the pool WITHOUT
debiting anyone — the DB cannot conjure dollars. In reality the operator must
hold `platform_exposure` in real funds. That column is the number to
reconcile against, and the admin UI should surface it.

## Funding rules

- **Community markets** — the CREATOR funds the seed from their balance
  (`p_seed`, min $10, max $10,000, debited atomically). They become the
  market's LP: at resolution they take `collateral - total_paid` **plus every
  fee the market accrued**. That can be more or less than the seed — being
  the house is a position, and a loss there is normal LP risk, not a bug.
  Surface this in the create form; do not describe the seed as a "fee".
- **Global (feed) markets** — seeded LAZILY by the platform on the FIRST
  trade, at the price the feed last wrote, from
  `platform_settings.global_seed`, with no user debited. This is what
  **bounds the platform's downside to `global_seed` per market someone
  actually trades**; seeding the whole feed up front would risk the seed on
  thousands of markets nobody ever touches. `ensure_market` therefore inserts
  feed markets UNFUNDED and does not seed (it is executable by any
  authenticated client — eager seeding there would let anyone book unbounded
  `platform_exposure`).

## RPC signatures (exact — `supabase.rpc(name, args)`)

SECURITY DEFINER, `search_path = public`, EXECUTE granted to `authenticated`
only, unless noted. Raises are user-facing — surface `error.message`.

- **`place_trade(p_market_id text, p_side text, p_amount numeric) -> jsonb`**
  *(signature unchanged; behavior rewritten, return gained `fee`)*
  Returns `{ shares, price, fee, balance, yesPrice, volume, liquidity }`.
  `price` = **average fill** = `(amount - fee) / shares`. `fee` =
  `round(amount * market.fee_bps / 10000, 2)`. `liquidity` = the pool's new
  `collateral`. Lazily seeds Global pools. Keeps every v5 guard.
  Raises: `Not signed in`, `Invalid side`, `Amount must be positive`,
  `This account is banned`, `Market not found`, `This market is unavailable`,
  `This market is closed`, `This market has ended`, `This market has no
  liquidity`, `Trade too small for this market`, `Insufficient balance`.
- **`create_market_rpc(p_id text, p_question text, p_description text,
  p_category text, p_end_date timestamptz, p_resolution text,
  p_seed numeric) -> text`**
  Debits `p_seed` from the creator, funds the pool at 50¢
  (`yes_reserve = no_reserve = collateral = seed`), sets
  `funder_id = auth.uid()`, `provider 'callit'`, `fee_bps` from
  `platform_settings`. Every v5 guard/raise still applies, plus:
  `Seed liquidity must be at least $10`, `Seed liquidity cannot exceed
  $10,000`, `Insufficient balance to fund your market`.
- **`ensure_market(p_id, p_source, p_question, p_description, p_category,
  p_end_date, p_resolution, p_yes_price, p_volume, p_liquidity,
  p_icon default null, p_short_name default null, p_event_id default null,
  p_creator_name default null, p_provider default 'polymarket',
  p_provider_ref default null, p_group_id default null,
  p_group_label default null, p_in_play_ok default false) -> void`**
  Insert-only. `p_yes_price` is the EXTERNAL price the pool will later be
  seeded at (clamped to `[0.02, 0.98]`); the row is inserted with
  `collateral = 0`. New raise: `Invalid provider`.
- **`resolve_market_rpc(p_market_id text, p_outcome text) -> void`**
  Unchanged guards — including the v5 ones: a non-admin resolver must not
  hold a position (`You hold a position in this market — an admin will settle
  it`) and cannot resolve before `end_date`. Now pays winners **from the
  pool** and hands the funder the residual + fees. The $10 manual-resolve fee
  now lands in `platform_balance` (v5 destroyed it).
- **`ban_market_rpc(p_market_id text, p_banned boolean) -> void`** ADMIN.
  Refunds every position **at cost** from `collateral`, returns the rest +
  fees to the funder, then VOIDS the pool. **Unban is not an undo:** a voided
  community market has no pool and raises `This market has no liquidity` on
  the next trade (the creator's seed is already back in their balance); a
  feed market re-seeds itself. Treat a ban as terminal in the UI.
- **`finalize_community_market(p_market_id text) -> text`** ADMIN. Unchanged;
  same new payout path.
- **`settle_feed_market(p_market_id text, p_outcome text) -> void`** — NEW.
  **service_role ONLY.** Settles a Global market from the source API's
  result. Guarded by `auth.uid() is null` (the service key sends no end-user
  JWT; every real user, admins included, always has a uid) AND by having no
  execute grant for `anon`/`authenticated`. Call it from a server route
  holding the service key — never from the browser. Raises: `Service role
  only`, `Invalid outcome`, `Market not found`, `Not a feed market`,
  `This market is already resolved`.
- **`admin_settings_update(p_global_seed numeric, p_fee_bps int) -> void`**
  — NEW. ADMIN. Raises: `Admin only`, `Global seed must be between $1 and
  $10,000`, `Fee must be between 0 and 1000 bps` (fee capped at 10%).
- **`payout_market(p_market_id, p_outcome)`** and
  **`seed_market_pool(p_market_id, p_price, p_seed, p_funder)`** — INTERNAL.
  No role holds EXECUTE; never call them from a client.

## lib/types.ts (changed — all additive, everything still compiles)

- `Market` gained: `provider?: 'callit' | 'polymarket' | 'kalshi'`,
  `providerRef?: string`, `groupId?: string`, `groupLabel?: string`,
  `inPlayOk?: boolean`, `feeBps?: number`, `seed?: number`.
- NEW `interface MarketGroup { id: string; label: string; markets: Market[] }`
  — a section of sub-markets under one event.
- `EventGroup` gained `groups?: MarketGroup[]` (optional: events without
  grouped sub-markets keep using `markets`).
- Map snake_case to camelCase in the client as usual
  (`in_play_ok` -> `inPlayOk`, `fee_bps` -> `feeBps`, `provider_ref` ->
  `providerRef`, `group_id` -> `groupId`, `group_label` -> `groupLabel`).

## Migration (section 8b) — what happens to the live DB

Every OPEN market predating v6 has no pool, and the positions standing on it
are the audit's actual hole (users paid real balance; nothing was set aside).
The backfill funds each one at its CURRENT price with
`F = max(global_seed, ceil(max(sum of yes shares, sum of no shares)))` — i.e.
the platform explicitly ASSUMES the inherited liability so those markets stay
solvent and settleable, and books its true size into `platform_exposure`.
`funder_id` stays NULL, so residuals return to the platform. Idempotent.

## Deviation from the v6 brief (deliberate — read this)

The brief specified asymmetric seeding as
`yes_reserve = F*(1-p)*2, no_reserve = F*p*2`. **That formula prices
correctly but is not backed, and the schema does not use it.** Those reserves
sum to `2F` — claiming F complete sets were minted — while handing the heavy
side `2Fp > F` shares, i.e. more of that side than exists. Buying the heavy
side with a large `A` then extracts `~A + 2Fp` against collateral `F + A`,
leaving `F*(2p-1)` unbacked (at p = 0.98, 96% of the seed) — reproducing the
exact insolvency v6 exists to kill, and violating the brief's own stated
invariant ("every share is minted from a complete set").

The schema uses the complete-set-preserving form instead:

```
yes_reserve = F * min(1, (1-p)/p)
no_reserve  = F * min(1, p/(1-p))
```

It gives the same `price(yes) = p`, is **identical at p = 0.5**, keeps
`collateral >= max payout` exact, and makes the solvency assert unfireable
rather than merely unlikely. The shares held back from the lighter side
belong to the funder and reach them automatically through the residual, so no
funder position is minted.

Two smaller, documented deviations: payouts are **floored** to the cent (not
rounded) so cumulative rounding cannot false-fire the assert on a solvent
book — the sub-cent dust flows to the funder via the residual; and
`ensure_market` does not seed the pool (see Funding rules above).

---

# v7 — the fee split, source-truth expiry, deposit verification, and the four money bugs v6 left behind

**Read this before touching anything.** v7 is mostly a money-correctness
release: it closes an unbounded money printer, un-bricks the v6 migration,
and stops the platform earning nothing on community markets.
`supabase/schema.sql` is the single source of truth and stays fully
idempotent — re-running it is always safe.

## 0. The money bugs v7 fixes (context for why the code looks like it does)

### 0a. The money printer survived v6, wearing an LP hat

v6 blocked a creator who **holds a position** from resolving their own
market. That guard checks the wrong thing. On every community market the
creator **is the funder** (`create_market_rpc` calls
`seed_market_pool(v_id, 0.5, v_seed, v_uid)`), and `payout_market` hands the
funder `collateral - total_paid + fees`. **That residual is economically a
SHORT on the winning side** — it grows as fewer winning shares are
outstanding. So a creator holding no position at all still profited by
declaring whichever side had the FEWEST shares against it, bounded only by
other traders' total stake. Owning the house *is* a position; the `positions`
table just does not know it.

`resolve_market_rpc` now ALSO refuses when the caller funds the market and
anyone else has traded it:

```
'You fund this market — an admin will settle it'
```

**The rule:** the moment anyone else trades a community market, only an
**admin** (or the community vote) can settle it. A creator may still settle
their own **untraded** market — no counterparty, nothing to steal. The
message flows through `lastActionError`; the client MUST surface it.

### 0b. The v6 backfill broke the very invariant it existed for

`seed_market_pool` derives reserves from **price only**, so it cannot encode
shares that already exist. Its pool implies `outstanding(yes) = collateral -
yes_reserve` while legacy shares sit outstanding **on top**. Worked example
(verified numerically):

| | v6 backfill | v7 |
| --- | --- | --- |
| legacy: p = 0.5, user A holds 100 Yes | F = 100 -> reserves 100/100, C = 100 | C = 103 -> reserves **3/103** |
| implied `outstanding(yes)` vs real | **0 vs 100 — MISMATCH** | **100 vs 100 — exact** |
| B buys $1000 Yes (fee $20, net $980) | shares 1070.74, C = 1080 | shares 982.71, C = 1083 |
| resolve Yes | paid **1170.74 > 1080** -> **assert FIRES, market permanently unsettleable by every path** | paid **1082.71 <= 1083** -> assert does not fire, residual $0.29 to funder |

v7 adds **`seed_market_pool_exact(p_market_id, p_min_seed, p_funder)`** —
internal, no EXECUTE grant — which encodes the outstanding shares so the
invariant holds **by construction**:

```
yes_out = sum(shares) where side='yes';  no_out = same for 'no'
C = greatest(<default seed>, ceil(max(yes_out, no_out) * 1.02) + 1)
yes_reserve = C - yes_out;  no_reserve = C - no_out;  collateral = C
```

Both reserves are then `> 0` by construction, and `outstanding(side) =
C - reserve(side)` is **exact**. The invariant is preserved exactly by every
later trade (a buy of net `A` adds `shares` to both `outstanding(side)` and
`collateral - reserve(side)`), so `payout <= collateral` is arithmetic, not
optimism.

**Accepted cost, stated plainly:** the market re-opens at the price the
reserves imply (`103/106` = 97¢ above, not the 50¢ it showed), because the
pool is now telling the truth about a book that is 100 Yes shares short. For
a one-off migration, **solvency beats price fidelity** — a market with a
wrong price is tradeable and settleable; a market with a wrong balance sheet
is neither.

### 0c. The backfill loop had no legacy filter

The v6 `WHERE` matched **every open unfunded market**. After any feed sync
that is the whole Polymarket + Kalshi board (~500 rows at `collateral = 0`),
so re-running the schema had the platform "assume" phantom liability for
hundreds of markets nobody ever traded, and book ~500 x `global_seed` of
exposure it never had at risk. Section 8b now adds:

```sql
and exists (select 1 from public.positions po where po.market_id = m.id)
```

**Markets without positions carry no inherited hole and MUST stay unfunded**
so `place_trade` seeds them lazily on first trade — that lazy seed is what
bounds the platform to `global_seed` per *actually traded* market.

### 0d. `platform_exposure` could be unwound twice

`seed` was never cleared, and the exposure unwind subtracts `v_m.seed`. Two
paths could unwind the same seed twice (a double-ban; a ban on an
already-resolved market — `ban_market_rpc` has no status guard). Fixed on
both sides:

- `seed = 0` is now part of the pool-voiding UPDATE in **`payout_market`**
  AND **`ban_market_rpc`** — it is arithmetically impossible to unwind a seed
  that is already zero.
- `ban_market_rpc` voids only on the **false -> true transition**:
  `if p_banned and not coalesce(v_m.banned, false) then`.

The refunds themselves never double-paid (positions are deleted), but
`platform_exposure` is the number the operator reconciles **real funds**
against, so it lying is a money bug.

## 1. THE FEE SPLIT — platform 1% + LP 1% (owner-approved)

Under v6 the **whole** 2% accrued to the market's funder, so on community
markets (funder = the creator, never us) **the platform earned nothing**. v7
splits it. The user-facing fee is unchanged: still 2% total.

- `place_trade`: `total = round(A * (platform_fee_bps + lp_fee_bps) / 10000, 2)`.
  The **LP slice** accrues to `markets.fees_accrued` (paid to the funder at
  resolution, exactly as v6). The **platform slice** is added to
  `platform_settings.platform_balance` **at trade time**. `A_net = A - total`.
- Everything else (complete-set mint, `shares_out`, collateral, solvency) is
  **exactly as v6 specified**. The platform slice never entered `collateral`,
  so banking it cannot affect solvency.
- **The returned jsonb `'fee'` is the TOTAL** (what the user paid), and
  `trades.fee` stays the TOTAL. Unchanged for the client.

**Rounding order is load-bearing** — round the TOTAL, then the platform
slice, then make the LP slice the **remainder**:

```
v_fee          = round(A * (pf + lp) / 10000, 2)   -- what the user pays
v_fee_platform = round(A * pf / 10000, 2)
v_fee_lp       = round(v_fee - v_fee_platform, 2)  -- the REMAINDER
```

Rounding each slice independently would let them sum to a cent more or less
than the total, and that cent would be conjured from — or lost out of — the
pool's accounting. As the remainder they sum exactly, always (verified over
200k cases; `round` is monotonic and `pf <= pf + lp`, so the LP slice can
never go negative).

### The split is LOCKED PER MARKET (deliberate deviation from the v7 brief)

The brief had `place_trade` read the split live from `platform_settings`.
**We do not.** That would resurrect exactly what `markets.fee_bps` exists to
prevent since v6 — an admin editing the config would retro-price every live
market, and worse, **retro-cut the LP's share of a deal they already
funded**. So `markets` gains `platform_fee_bps` / `lp_fee_bps`, locked at
creation from the live config, and `platform_settings` holds the values
**new** markets are created with.

`markets.fee_bps` is kept as the **DEPRECATED TOTAL**, maintained as
`platform_fee_bps + lp_fee_bps` so the existing UI (`TradePanel`, cloud.ts
`feeBps`) keeps showing a truthful user-facing fee **with no change**.
`platform_settings.fee_bps` is likewise deprecated: it is **no longer read**
when a market is created, and `admin_settings_update` keeps it equal to the
sum purely for older readers.

**Legacy markets keep the v6 deal.** A one-off migration sets
`lp_fee_bps = fee_bps, platform_fee_bps = 0` on every pre-v7 row — those
funders signed up for the whole fee, and v7 does not retro-take a cut out of
their markets.

## 2. The $10 resolve fee is banked, not destroyed

`resolve_market_rpc` credits the $10 to `platform_settings.platform_balance`
in the same transaction. (Already present in the schema as shipped — verified
and kept.)

## 3. SOURCE-CLOSED IS THE TRUTH FOR FEED MARKETS

Verified against the live Gamma API: **Polymarket's `endDate` on a game
market is the KICKOFF, not the end.** "England vs. Argentina" carried
`endDate` 19:00 == `gameStartTime` 19:00 and still reported `closed: false`
at 20:19, mid-match. "Next Prime Minister of Ethiopia?" is long past its
2026-06-01 `endDate` and also still `closed: false` (unresolved upstream).
The v6 `end_date` gate therefore **blocked a LIVE game as "Ended"** and
**mislabelled open markets as closed** — both owner-reported.

New columns on `markets`: **`source_closed boolean not null default false`**
and **`start_time timestamptz`**. **The feed sync writes them.**

`place_trade`'s expiry gate is now **provider-aware**:

| provider | gate |
| --- | --- |
| `'callit'` (community) | **unchanged** — reject when `end_date <= now()`. We own the deadline. |
| `'polymarket'` / `'kalshi'` (feed) | reject **only** when `source_closed = true`. **`end_date` is NOT consulted.** |

**Safety valve:** a feed market is also rejected when
`end_date + interval '30 days' < now()` AND `source_closed = false` — a dead
sync must not leave a market tradeable forever against a stale price. 30 days
is well past any real settlement lag, so this only ever catches a broken sync.

**`in_play_ok` is NO LONGER a trading gate** — it is purely the LIVE label
(what it was introduced for in v6). Requiring it to trade is what blocked the
live match. It stays on the row and keeps its v6 meaning for the label.

`settle_feed_market` is **unchanged** (it settles from the source result).

### The settle job is ALSO the source-state refresher (v7 review fix)

**The feed sync alone can NEVER flip `source_closed` to `true`.** The
discovery feed is queried with `closed=false&active=true`
(lib/polymarket.ts), and both mappers (lib/polymarket.ts, lib/kalshi.ts)
drop closed/inactive rows *before* the flag is computed. When a market
closes upstream it simply **vanishes from that payload**, so the sync keeps
upserting nothing and the DB row keeps `source_closed = false` forever — a
market whose result the source already knows stays tradeable at a stale
price. Verified against the live feed: 964 feed markets, **all**
`sourceClosed: false`, zero `true`. Without a second writer, the v7 trade
gate is inert.

**Absence from the feed is NOT closure.** The discovery feed is a
top-100-by-volume window; "missing" almost always means "not trending".
Inferring closed-from-absence would freeze live markets.

The fix: **`/api/settle` polls the markets WE track, by id/ticker, without
a closed filter**, and is what makes the gate real:

- `lib/settlement.ts fetchSourceState(markets)` — pure network half. Asks
  Gamma (`?id=`/`?slug=` **with `closed=true`** — Gamma's id/slug filters
  default to `closed=false`, so a row coming back under `closed=true` is
  positive evidence of closure; verified live) and Kalshi
  (`?tickers=a,b,c`, returns rows of any status). Chunked (25/20 per
  request), 5s timeouts, `Promise.allSettled`, never throws. **A failed
  lookup is never reported as closed** — no entry means "no news, retry
  next run". Outcomes are reported only when unambiguous (Polymarket:
  `closed` + UMA `resolved` + full-dollar `outcomePrices`; Kalshi:
  `finalized`/`settled` + `result` `'yes'|'no'`).
- `app/api/settle/route.ts` — DB half. Selects **ALL open, non-banned feed
  markets with a `provider_ref`** (not just expired ones — v7: `end_date`
  says nothing about a feed market's real state), oldest `end_date` first,
  limit 1000/run. Freezes first (`source_closed = true` via a **direct
  service-role UPDATE**, filtered on `source_closed = false` so re-runs are
  no-ops), then settles confident outcomes via the existing
  `settle_feed_market` RPC (capped at 100 RPCs/run). Returns
  `{ checked, closedMarked, settled, skipped, errors }`. Idempotent — safe
  every 15 minutes.
- **No new RPC, no schema change.** The `source_closed` write path is the
  same service-role pattern the feed sync already uses; a
  `record_source_state()` RPC would add a second, inconsistent writer and
  force a schema re-run before the fix did anything.

**Operational requirement: the cron MUST be configured** (`SETTLE_SECRET` +
a ~15-minute schedule hitting `/api/settle`; Vercel Cron's
`Authorization: Bearer` is accepted). Without it, feed markets trade until
the 30-day safety valve — the net, not the design.

> **Legacy `provider` repair (important):** `provider` was added with
> `default 'polymarket'`, so every pre-v6 row — **including every community
> market** — was stamped `'polymarket'`. A community market wearing that tag
> would take the FEED branch, gated on a `source_closed` nothing ever sets,
> and stay tradeable for 30 days past its end date. The schema repairs it:
> `update markets set provider = 'callit' where source = 'callit' and
> provider is distinct from 'callit'`. The gate also belt-and-braces on
> `or v_m.source = 'callit'`.

### `lib/format.ts isInPlay()` — the v6 note in this file is now WRONG

The v6 section above tells you to gate `isInPlay()` on `inPlayOk` + the 4h
window **and to make it match the SQL trading gate**. As of v7 those are two
different questions and must not be conflated:

- **`isInPlay()` = the LIVE label only.** Keep gating it on `inPlayOk`.
- **"can I trade this?" is no longer the same predicate.** For a feed market
  it is `!sourceClosed`. Do **not** hide the trade CTA behind `isInPlay()`
  or behind `endDate` for feed markets — that is the bug the owner reported.

## 4. Deposit verification

`public.deposits` gains (all `add column if not exists`):

| column | type | meaning |
| --- | --- | --- |
| `verified` | boolean | Did the chain confirm a matching payment? |
| `verified_amount` | numeric | The amount the chain actually shows. |
| `verified_to` | text | The destination address the chain actually shows. |
| `verified_confirmations` | int | Confirmations at the time of the check. |
| `verified_at` | timestamptz | When the check last ran. |
| `verify_error` | text | Why the check failed, when it did. |
| `chain_tx` | text | Canonical tx hash **as the chain reports it** (`tx_hash` is what the USER typed — keep both). |

**`record_deposit_verification` NEVER touches a balance, and that is the
design.** A confirmed tx to the right address for the right amount still is
not proof that the person who typed the hash is the person who sent it —
anyone can copy a hash out of a block explorer. Verification is **evidence
that makes the admin's decision informed**; `approve_deposit` stays the thing
that moves money, and stays **human**.

## RPC signatures (exact — `supabase.rpc(name, args)`)

**NEW**

```ts
// SERVICE ROLE ONLY (server route with the service key). Not callable from a browser.
supabase.rpc('record_deposit_verification', {
  p_deposit_id: string,      // uuid
  p_verified: boolean,
  p_amount: number | null,
  p_to: string | null,
  p_confirmations: number | null,
  p_error: string | null,
}) // -> void
```

```ts
// ADMIN ONLY. How the admin UI reads the till (see the hard break below).
supabase.rpc('admin_platform_stats')
// -> { platform_balance, platform_exposure, open_markets,
//      total_collateral, fees_accrued_total }
```

**CHANGED — signature break, v6 overload explicitly dropped**

```ts
// WAS: admin_settings_update({ p_global_seed, p_fee_bps })
supabase.rpc('admin_settings_update', {
  p_global_seed: number,      // $1..$10,000
  p_platform_fee_bps: number, // 0..1000
  p_lp_fee_bps: number,       // 0..1000; platform + lp must be <= 1000 (10% total cap)
}) // -> void
```

The v6 2-arg overload is `drop function if exists`-ed. Left in place,
PostgREST would resolve the admin UI's old call to it and write the
deprecated `fee_bps`, which nothing reads at creation any more — the admin
would change the fee, see it "saved", and every new market would silently
keep the old split. **The admin UI MUST be updated to the 3-arg call.**

Values apply to markets created **from now on**. Live markets keep the split
they were created with. Retro-cutting an LP's share is not a knob this
product offers.

**UNCHANGED:** `place_trade`, `create_market_rpc`, `resolve_market_rpc`,
`ban_market_rpc`, `community_vote_rpc`, `finalize_community_market`,
`ensure_market`, `settle_feed_market`, and every v4 payments RPC.

## markets — new v7 columns

| column | type | meaning |
| --- | --- | --- |
| `platform_fee_bps` | int, not null, default 100 | The slice banked to `platform_balance` at trade time. **Locked at creation.** Legacy rows: `0`. |
| `lp_fee_bps` | int, not null, default 100 | The slice accruing to `fees_accrued`, paid to `funder_id` at resolution. **Locked at creation.** Legacy rows: their old `fee_bps`. |
| `source_closed` | boolean, not null, default false | **What the PROVIDER says.** The trading gate for feed markets. Written by the feed sync. |
| `start_time` | timestamptz | The event's real kickoff, when the provider reports one. Written by the feed sync. |

`fee_bps` — **DEPRECATED, still maintained** as `platform_fee_bps + lp_fee_bps`.
Keep reading it for the user-facing total; never write it.

## platform_settings — new v7 columns

| column | type | meaning |
| --- | --- | --- |
| `platform_fee_bps` | int, not null, default 100 | Platform slice **new** markets are created with. |
| `lp_fee_bps` | int, not null, default 100 | LP slice **new** markets are created with. |

`fee_bps` — **DEPRECATED** as a config knob. No longer read at creation;
`admin_settings_update` keeps it equal to the sum for older readers.

## Hard breaks — fix these or things fail at runtime

1. **`select('*')` on `platform_settings` now FAILS** with `permission denied
   for column platform_balance`. Until v7 the operator's balance and exposure
   were one `select *` away from **any anonymous visitor**. The
   "readable by all" policy stays (a signed-out visitor needs the fee and the
   seed for the trade panel), but READ is narrowed by column grant to
   `id, global_seed, fee_bps, platform_fee_bps, lp_fee_bps, updated_at`.
   **Every read must list columns explicitly.** `lib/cloud.ts` already does
   (`.select('global_seed, fee_bps')`) — keep it that way and add
   `platform_fee_bps, lp_fee_bps` there rather than reaching for `*`.
   Admins read the till through **`admin_platform_stats()`**, never the table.
2. **`admin_settings_update` is 3-arg now** (see above). The 2-arg call will
   fail — the overload is dropped on purpose.
3. **The feed sync MUST write `source_closed`** (from the provider's own
   `closed` flag) **and `start_time`** — but know that in practice the sync
   only ever writes `false`: its discovery query filters on
   `closed=false&active=true`, and a market that closes upstream vanishes
   from the payload instead of coming back as `closed: true`. **The thing
   that actually flips the flag to `true` is the `/api/settle` cron** (the
   source-state refresher — see section 3). If that cron is not running,
   `source_closed` stays `false` and feed markets trade until the 30-day
   valve — which is the safety net, not the design.
4. **`isInPlay()` is the LIVE label, not the trade gate.** See section 3.
5. **`resolve_market_rpc` has a new refusal** — `'You fund this market — an
   admin will settle it'`. Surface it via `lastActionError`.
6. **`ban_market_rpc` voids only on the false -> true transition.** Unban is
   still not an undo — treat a ban as terminal (v6 rule, unchanged).

## Deviations from the v7 brief (deliberate — read this)

1. **The fee split is locked per market, not read live from
   `platform_settings`.** The brief specified the live read. It would
   retro-price live markets and retro-cut LPs mid-market, which is the exact
   thing `markets.fee_bps` was introduced in v6 to prevent. See section 1.
2. **`record_deposit_verification` IS granted to `service_role`.** The brief
   said no grant was needed because the service key "bypasses grants as the
   definer/owner". **It does not:** `SECURITY DEFINER` changes the role a
   function *executes as*, not who may *call* it, and `BYPASSRLS` does not
   cover function `EXECUTE`. After `revoke all ... from public`,
   `service_role` holds no privilege unless granted, and the call would fail
   with `permission denied for function`. `settle_feed_market` is the proof:
   same service-role-only pattern, same explicit grant, working in
   production. The brief's intent — **no grant to `authenticated`** — is
   honoured exactly.
3. **Column-level SELECT grants were practical**, so `platform_balance` is
   hidden from `anon`/`authenticated` at the table AND `admin_platform_stats()`
   is provided. The brief offered these as alternatives; we do both (the
   function is the admin's read path, the grant is the enforcement).
4. **`seed_market_pool` is unchanged and still price-based** — it is correct
   for a market with **no** positions (it over-states `outstanding`, which is
   conservative: the excess returns to the funder as residual, and
   `paid <= collateral` still holds). Only the migration path needed exact
   encoding, so `seed_market_pool_exact` is a separate helper rather than a
   rewrite of the function the lazy seed depends on.

---

# v8 — community-only resolution, email-confirmed withdrawals, public profiles, proof of reserves

These SUPERSEDE every earlier section wherever they conflict.
`supabase/schema.sql` is the source of truth, stays fully idempotent, and
**MUST be re-run before any v8 client code ships**. Everything below is
already written in the foundation files (schema, lib/store.ts, lib/cloud.ts,
lib/email.ts, lib/serverEmail.ts, lib/types.ts) — READ the source; this
section is the exact interface the feature agents build against. Signatures
are law.

(Also landed under the v8 banner earlier: `markets.yes_label`/`no_label`
side display labels — presentation only, already documented inline in
lib/types.ts and lib/cloud.ts. Unrelated to the changes below.)

## 0. GRACEFUL DEGRADATION IS A CONTRACT, NOT A NICETY

The owner has NOT yet provided RESEND_API_KEY (email) or the Turnstile keys
(captcha). Everything v8 adds MUST work without them:

- email sends are no-ops resolving `{ ok: false, skipped: true }` (one
  console.info, never a throw) and every flow still completes;
- the withdrawal-confirmation route AUTO-CONFIRMS the withdrawal when the
  email was skipped (see section 2) so admin review never dead-ends;
- the captcha widget renders NOTHING without `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  and sign-up proceeds; with the keys it renders and the server route
  verifies `TURNSTILE_SECRET_KEY`-side. Never hard-fail on a missing
  optional key.

New env vars (all documented in `.env.local.example`; all optional):
`RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL` (default
`http://localhost:3013` — used to build absolute links in emails),
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.

## 1. THE RESOLUTION MODEL (owner decision)

There are exactly TWO resolution kinds now:

- **`oracle`** — Global feed markets, auto-settled from Polymarket/Kalshi
  via `/api/settle`. Unchanged.
- **`community`** — the ONLY kind a user can create. Users vote after the
  market ends, then an **admin reviews and CONFIRMS** the result
  (`finalize_community_market`), and the **$10 confirmation fee is charged
  at that confirm step** — from the market's own pot, never from a balance.

**`manual` self-resolution is GONE as a product.** The value survives in
the `ResolutionMethod` TS union and the DB CHECK purely for pre-v8 rows —
no new market can be created with it, and nobody but an admin can resolve
anything. The old "$10 from the resolver's balance" rule is removed
everywhere (server, store, local mode).

### RPC changes (exact)

- **`create_market_rpc(p_id, p_question, p_description, p_category,
  p_end_date, p_resolution, p_seed)`** — signature unchanged;
  `p_resolution` now must be `'community'` or it raises
  **`Only community resolution is available`**. Seed funding rules
  unchanged ($10–$10,000, debited, creator = LP).
- **`resolve_market_rpc(p_market_id, p_outcome)`** — now **ADMIN ONLY and
  FREE**. The whole non-admin branch (creator checks, position/funder
  guards, the $10 debit) is deleted. Raises: `Admin only`,
  `Invalid outcome`, `Market not found`, `This market is already resolved`.
  Admins use it for Global/legacy markets and as the fallback for community
  markets stuck without a majority.
- **`finalize_community_market(p_market_id)`** — the ADMIN CONFIRMATION
  step. **Return type CHANGED: `text` -> `jsonb { outcome: 'yes'|'no',
  fee: number }`** (`fee` = the confirmation fee actually banked). Guards,
  in order: `Admin only`, `Market not found`,
  `This market is not resolved by community vote`,
  `This market is already resolved`, `This market is unavailable` (banned),
  `This market has not ended yet`, and — for a tie OR zero votes — the one
  v8 message **`No majority yet — cannot finalize`** (replaces v5's
  'No votes have been cast' / 'The vote is tied'; the market stays open).
- **`payout_market(p_market_id, p_outcome, p_platform_fee default 0)`** —
  INTERNAL (no EXECUTE grant), signature changed, now returns the fee it
  banked. **The $10 fee mechanics, exactly:** (1) winners are ALWAYS paid
  in full first; (2) the fee pot is what remains for the funder
  (`residual + fees_accrued`); (3) the fee is `least(10, pot)` — a thin
  market yields less than $10, possibly $0, and settlement is NEVER
  blocked; (4) the fee goes to `platform_settings.platform_balance`, the
  funder gets `pot - fee`. No user balance is ever debited for it.

### Client wiring (already written)

- `store.createMarket(input)` — rejects `resolution !== 'community'` in
  BOTH modes (`lastActionError` = the RPC's message, returns null).
- `store.resolveMarket(marketId, outcome)` — admin-only in BOTH modes
  (local non-admins get false + `lastActionError 'Admin only'`); no fee in
  either mode. Signature unchanged (`Promise<boolean>`).
- `store.finalizeCommunityMarket(marketId)` — signature unchanged
  (`Promise<boolean>`), but on cloud success the store sets **NEW runtime
  field `lastFinalizeFee: number | null`** — read it right after the await
  for the toast (e.g. "Finalized Yes — $10.00 confirmation fee banked").
  Local mode charges nothing and leaves it null. Failures put
  'No majority yet — cannot finalize' etc. in `lastActionError`.
- `cloud.finalizeCommunityCloud(marketId)` -> `CloudFinalizeResult` gained
  `fee?: number` (0 when a pre-v8 DB returns the old bare-text outcome).
- `RESOLVE_FEE` (lib/store.ts) still exists and still equals 10, but its
  MEANING changed: it is the community-confirmation fee. Any UI copy about
  "resolving costs $10 from your balance" is now wrong — fix it where you
  touch it.

### UI consequences (feature agents)

- **create form / ResolutionPicker**: community vote is the ONLY option
  (show it as informational, not a choice, or a single pre-selected card).
  Explain: "after the market ends, holders vote; an admin confirms the
  result — a $10 confirmation fee is taken from the market's pot."
- **portfolio**: the self-resolve buttons on "My created markets" are GONE.
- **admin**: community review UI calls `finalizeCommunityMarket` and shows
  the vote tally (`fetchMarketVotes`) + the fee toast via
  `lastFinalizeFee`. Direct Yes/No settle (`resolveMarket`) stays as the
  admin fallback for no-majority markets.

## 2. WITHDRAWALS ARE EMAIL-CONFIRMED BEFORE ADMIN REVIEW

Flow: request (balance reserved, unchanged) -> **confirmation email** ->
user clicks the link -> row flips `confirmed` -> admin may approve.
Reject/refund is deliberately NOT gated on confirmation (an admin must
always be able to kill a request and return the reserve).

### Schema (already applied by re-running schema.sql)

- `withdrawals` gained `confirmed boolean not null default false`,
  `confirm_token text` (unguessable, 2x uuid hex, UNIQUE partial index),
  `confirm_sent_at timestamptz`. Pre-v8 rows (marker: `confirm_token is
  null`) were repaired to `confirmed = true` — they predate the rule.
- `request_withdrawal(currency, amount, address)` — signature unchanged;
  now inserts `confirmed = false` + a fresh token. Still returns the uuid.
- **NEW `confirm_withdrawal(p_token text) returns uuid`** — SERVICE ROLE
  ONLY (`auth.uid() is null` guard + EXECUTE granted to service_role only;
  the link may be opened logged-out, so it cannot ride on a session).
  Single-use: flips `confirmed`, NULLs the token. Raises
  **`Invalid or used confirmation link`** otherwise. NEVER call it with a
  user JWT — only the server route below.
- `approve_withdrawal(withdrawal_id)` — new guard: raises
  **`User has not confirmed this withdrawal yet`** on an unconfirmed
  pending row (after the existing `Withdrawal is not pending`).
- **HARD BREAK:** the client SELECT grant on `withdrawals` is narrowed —
  `confirm_token` is NOT readable (a hijacked session must not self-confirm
  by reading its own token). **`select('*')` on withdrawals now fails**
  with "permission denied for column confirm_token". Use explicit columns
  (lib/cloud.ts exports the pattern via its internal `WITHDRAWAL_COLUMNS`;
  lib/history.ts already lists columns). Readable columns: `id, user_id,
  currency, amount, address, status, confirmed, confirm_sent_at,
  created_at`.
- **HARD BREAK (money-hole fix):** the v2 "insert own" policies on
  `deposits` AND `withdrawals` are DROPPED and the INSERT grants revoked.
  A direct client insert of a withdrawal skipped the balance reserve
  entirely (approve only flips status — it trusts the reserve happened) and
  could have set `confirmed = true`. All inserts go through the RPCs, which
  are SECURITY DEFINER and unaffected. Nothing in the current client did
  direct inserts.

### Route contracts (feature agents build these — exact)

**`POST /api/withdrawals/confirm`** — body `{ token: string }` ->
`{ ok: boolean, id?: string, error?: string }`. No auth (the token IS the
proof; the link may be opened in any browser). Server-side: requires
`serviceSupabase` (503 with a clear error when `SUPABASE_SERVICE_ROLE_KEY`
is absent), calls `rpc('confirm_withdrawal', { p_token: token })`,
returns the uuid as `id`. 400 on a missing/empty token; map the RPC's
`Invalid or used confirmation link` to `{ ok: false, error }` with status
400. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `cache-control:
no-store`.

**Confirm PAGE**: `/withdraw/confirm?token=…` (client page) — reads the
token from the query string, POSTs it to the route above, renders
success ("Withdrawal confirmed — it is now in review.") or the error.
This exact path is what the email links to — do not rename it without
updating the send route.

**`POST /api/withdrawals/send-confirmation`** — body `{ id: string }`,
header `Authorization: Bearer <caller's Supabase access token>` ->
`{ ok: boolean, skipped?: boolean, confirmed?: boolean, error?: string }`.
Server-side, in order:

1. 503 when `serviceSupabase` is null. Validate the bearer via
   `serviceSupabase.auth.getUser(token)` (401 otherwise — same pattern as
   `/api/deposits/verify`).
2. Load the withdrawal via the service client (it must read
   `confirm_token`, which no user role can): must exist, belong to the
   caller (`user_id` = the auth user's id; 404 otherwise — do not leak
   other users' rows via a 403), be `pending` and `confirmed = false`
   (if already confirmed return `{ ok: true, confirmed: true }` —
   idempotent).
3. Build `url = appBaseUrl() + '/withdraw/confirm?token=' + confirm_token`
   (`appBaseUrl()` from lib/serverEmail.ts) and send
   `withdrawalConfirmEmail(url)` to the caller's profile email via
   `sendTemplate`.
4. **Sent** -> stamp `confirm_sent_at = now()` (service-role direct
   update) and return `{ ok: true }`.
   **Skipped** (`RESEND_API_KEY` absent) -> AUTO-CONFIRM via
   `rpc('confirm_withdrawal', { p_token })` and return
   `{ ok: true, skipped: true, confirmed: true }` — THIS is the graceful
   degradation that keeps withdrawals working with zero third-party keys.
   **Failed** (key set but send errored) -> `{ ok: false, error }`; the
   row stays unconfirmed and the wallet page may offer "Resend email"
   (same route again; throttle on `confirm_sent_at` if you add resend).

### Client wiring (already written)

- `cloud.requestWithdrawalCloud(...)` now returns
  `CloudWithdrawalRequestResult { ok, id?, error? }` (the uuid).
- NEW `cloud.sendWithdrawalConfirmation(withdrawalId)` — POSTs to the
  send-confirmation route with the caller's access token; never throws.
- `store.requestWithdrawal(...)` — cloud path fires
  `sendWithdrawalConfirmation(id)` automatically (fire-and-forget) after a
  successful reserve; its public contract is unchanged
  (`Promise<CloudResult>`). Success copy for the wallet page:
  **"Withdrawal requested — check your email to confirm it."**
- `Withdrawal` (lib/types.ts) gained `confirmed?: boolean`. Local rows
  leave it `undefined` (no email step exists locally) — render the
  **"Confirmed" badge for `confirmed !== false`** and an amber
  "Awaiting email confirmation" state for `confirmed === false`.
- Admin payments tab: show the Confirmed badge per withdrawal; Approve on
  an unconfirmed row will surface `User has not confirmed this withdrawal
  yet` via the existing `res.error` toast path.

## 3. EMAIL LIB

- **`lib/email.ts`** — PURE template builders (no I/O, no env, importable
  anywhere). Exported: `interface EmailTemplate { subject; html; text }`
  and the builders `withdrawalConfirmEmail(url)`,
  `depositApprovedEmail(amount)`, `depositRejectedEmail()`,
  `withdrawalApprovedEmail(amount, address)`,
  `marketResolvedEmail(question, outcome, payout)`. Dark, branded,
  inline-styled, single green CTA where relevant, English, no emojis.
- **`lib/serverEmail.ts`** — SERVER ONLY (throws on client import, same
  guard as serverSupabase). Exports:
  - `sendEmail({ to, subject, html, text? }): Promise<{ ok, skipped?,
    error? }>` — Resend POST, `from = EMAIL_FROM ?? 'Callit
    <noreply@callit.app>'`, 8s timeout, NEVER throws; without
    `RESEND_API_KEY` -> `{ ok: false, skipped: true }` + one console.info.
  - `sendTemplate(to, template)` — convenience wrapper.
  - `emailEnabled(): boolean`, `appBaseUrl(): string`
    (`NEXT_PUBLIC_APP_URL` sans trailing slash, default
    `http://localhost:3013`).
  - Re-exports every builder from lib/email.ts, so a route imports one
    module.
- **Who sends what** (feature agents; ALWAYS from a server route — never
  from the browser, the key is server-only): withdrawal confirm = the
  send-confirmation route (section 2). Notification mails
  (deposit approved/rejected, withdrawal approved) belong in an
  admin-triggered server route (e.g. a small `/api/notify` the admin panel
  calls after a successful approve/reject — validate the caller is an
  admin exactly like /api/deposits/verify does, and read the target email
  via the service client). They are best-effort: a failed notification
  must never roll back the money action it describes. `marketResolvedEmail`
  is available for a future settle-notification pass — wiring it into
  `/api/settle` is OPTIONAL and out of v8's required scope.

## 4. PUBLIC PROFILES (anon-readable BY DESIGN)

- **`public_profile(p_username text) -> jsonb`** — SECURITY DEFINER,
  EXECUTE granted to anon + authenticated. Case-insensitive username
  match. Returns `{ username, joined_at, markets_created,
  markets_volume }` or NULL for unknown AND banned users (indistinguishable
  on purpose). It never returns email, balance, is_admin, banned, or any
  uuid — its select list is the privacy boundary; never widen it.
- **`list_creator_markets(p_username text) -> table (id, question,
  category, yes_price, volume, status, end_date, resolved_outcome,
  created_at)`** — the creator's non-banned community markets, newest
  first, LIMIT 100. Banned creators return zero rows.
- **lib/cloud.ts** (already written):
  - `fetchPublicProfile(username): Promise<PublicProfile | null>` —
    `PublicProfile { username, joinedAt, marketsCreated, marketsVolume }`;
    null on unknown/banned/local/error.
  - `fetchCreatorMarkets(username): Promise<Market[]>` — rows mapped into
    FULL `Market` objects with safe defaults (`source 'callit'`,
    `resolution 'community'`, `priceHistory []`, `liquidity 0`,
    `createdBy` = the queried username) so `MarketCard` renders them
    directly; `[]` on local/error.
- UI suggestion for the feature agent: `/u/[username]` page. These fields
  are public by construction — do NOT run `censorName` over the username
  here (`censorName` remains for creator lines on market pages).

## 5. PROOF OF RESERVES (public trust page)

- **`reserves_stats() -> jsonb`** — SECURITY DEFINER, EXECUTE granted to
  anon + authenticated. Shape (snake_case): `{ total_collateral,
  open_liability, platform_balance, fees_accrued, open_markets,
  funded_markets }`.
  - `total_collateral` = sum of `markets.collateral` over OPEN markets —
    real money in pools.
  - `open_liability` = sum over open FUNDED markets of
    `max(yes_outstanding, no_outstanding)` where `outstanding(side) =
    collateral - reserve(side)` — the maximum the book could ever owe.
    THE claim: `total_collateral >= open_liability`, always (v6
    complete-set arithmetic).
  - `platform_balance` — DELIBERATE v8 exposure of a number v7 hid: a
    reserves page with a secret house buffer proves nothing.
    `platform_exposure` stays admin-only (risk topology, not solvency).
- **lib/cloud.ts** `fetchReserves(): Promise<ReservesStats | null>` —
  camelCase mapping (`totalCollateral`, `openLiability`,
  `platformBalance`, `feesAccrued`, `openMarkets`, `fundedMarkets`); null
  on local mode/error — render an "unavailable" state, NEVER zeros (zeros
  read as insolvency).

## 6. HARD BREAKS — fix these or things fail at runtime

1. **`finalize_community_market` returns jsonb now** (was text). Only
   `finalizeCommunityCloud` consumes it and it is already updated (accepts
   both shapes).
2. **`resolve_market_rpc` raises `Admin only` for every non-admin.** Any
   UI offering self-resolve (portfolio resolve buttons, TradePanel copy
   about the $10 resolve fee, ResolutionInfo's "you resolve it yourself")
   is now lying — update it where you touch it.
3. **`create_market_rpc` rejects `'manual'`** — the create form must stop
   offering it or every submit fails with 'Only community resolution is
   available'.
4. **`select('*')` on `withdrawals` fails** (confirm_token grant). List
   columns explicitly.
5. **Direct client INSERTs into `deposits`/`withdrawals` fail** (policy
   dropped + grant revoked). Use the RPCs (the client already does).
6. **`approve_withdrawal` refuses unconfirmed rows** — the admin panel
   must render the confirmation state or approvals will look randomly
   broken.
7. **schema.sql must be re-run** before any of this exists in the live DB.
   Until then: finalize returns text (handled), the new RPCs 404 into
   `mapRpcError`'s "Server functions are missing — run
   supabase/schema.sql.", and withdrawals carry no `confirmed` column
   (the explicit-column reads would fail — apply the schema first, it is
   one paste).

## 7. WHAT THE OWNER MUST ADD (to activate the optional integrations)

- **Email**: `RESEND_API_KEY` (resend.com, free tier) + optionally
  `EMAIL_FROM` (verified domain) + `NEXT_PUBLIC_APP_URL` (production
  origin, so email links do not point at localhost). Without them:
  withdrawal confirmations auto-confirm (flow intact, just without the
  email security layer) and notification mails are skipped.
- **Captcha**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
  (Cloudflare Turnstile, free). Without them sign-up runs captcha-less.
