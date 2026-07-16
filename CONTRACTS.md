# Callit — Component Contracts (build spec for authoring agents)

Every agent MUST follow these contracts exactly. Files import each other across
agents, so signatures are law. TypeScript strict. Path alias `@/*` = repo root.
All interactive components start with `'use client'`. All components are
**default exports** unless stated otherwise. UI copy is **English**. No emojis
in the UI. Icons: `lucide-react` only.

## Design language (already implemented — just use it)

- Tailwind tokens: `ink` (page bg), `surface` / `surface-2` / `surface-3`,
  `line` / `line-strong`, `green` / `green-deep` / `green-ink`, `sky` /
  `sky-deep`, `danger`, `amber`, `tx` / `tx-sec` / `tx-mut`. Font is Nunito
  (`font-sans`), headlines 800–900 with tight tracking.
- Cards: `rounded-2xl border border-line bg-surface-2` (16px radius).
  Buttons/inputs: `rounded-xl` (12px).
- Global CSS utility classes (in globals.css): `.glow-hover` (green liquid
  glow + lift on hover), `.glow-hover-sky` (blue variant), `.glow-green`
  (static glow for the primary CTA), `.liquid-border` (rotating conic border
  on hover — add to market cards ALONGSIDE glow-hover), `.skeleton-shimmer`,
  `.hero-glow` (radial green ambient for the hero), `animate-marquee` +
  wrapper class `ticker-track` (pauses on hover).
- Numbers (prices, volume, countdown, balance): add `tabular-nums`.
- Prices in cent notation via `formatCents` → `62¢`. Yes = green, No = sky.
  `danger` red ONLY for errors/negative PnL.
- Semantics: buy button copy is **"Call it"** (never "Buy"/"Submit").

## Foundation modules (already written — READ them before coding)

- `lib/types.ts`: `Category`, `Side`, `ResolutionMethod`, `PricePoint`,
  `Market`, `Position`, `CreateMarketInput`, `MarketOverride`,
  `CATEGORIES: {value, label}[]`, `categoryLabel(c)`.
- `lib/format.ts`: `formatCents(p)`, `formatPercent(p)`,
  `formatMoney(n, {compact?, decimals?})`, `formatTimeLeft(endDate, now?) →
  {label, ended, urgent}`, `formatDate(iso)`, `shortAddress(addr)`.
- `lib/pricing.ts`: `applyTrade(m, side, amount)`, `previewTrade(m, side,
  amount) → {price, shares, payout, returnPct}`.
- `lib/store.ts`: `useCallitStore` (zustand). Fields: `balance`, `wallet
  {connected, connecting, address?}`, `userMarkets`, `marketOverrides`,
  `positions`, `sidebarCollapsed`, `_hasHydrated`, `poly`, `polyLoaded`,
  `searchQuery`, `categoryFilter: Category | 'all'`, `homeTab: 'all' |
  'trending' | 'polymarket' | 'mine'`, `mobileNavOpen`, `tradeModal:
  {marketId, side} | null`. Actions: `connectWallet()` (mock, 800ms),
  `disconnectWallet()`, `createMarket(input): Market`, `trade(marketId, side,
  amount): {shares, avgPrice} | null`, `resolveMarket(marketId, outcome)`,
  `setSearchQuery`, `setCategoryFilter`, `setHomeTab`, `setSidebarCollapsed`,
  `setMobileNavOpen`, `openTradeModal(marketId, side)`, `closeTradeModal()`,
  `getMarketById(id)`. Also exported: `mergeOverride`, type `HomeTab`.
- `lib/useMarkets.ts`: `useAllMarkets() → {markets: Market[], loading:
  boolean}` (user + seed + polymarket, overrides applied),
  `useMarket(id) → Market | undefined`.
- `lib/seed.ts`: `seedMarkets: Market[]`.
- `components/brand/Logo.tsx`: default `Logo({iconSize?, textClassName?,
  className?})`, named `LogoIcon({size?, className?})`, `Wordmark`.
- `components/ui/button.tsx`: default `Button` — props `{variant?: 'primary'
  | 'sky' | 'outline' | 'ghost' | 'danger' | 'yes-tint' | 'no-tint', size?:
  'sm' | 'md' | 'lg', loading?: boolean}` + motion button props. Named:
  `buttonClasses(variant, size, className?)` for styling `<Link>`s.
- `components/ui/input.tsx` default `Input` (`error?: boolean`),
  `components/ui/textarea.tsx` default `Textarea` (`error?`),
  `components/ui/select.tsx` default `Select` (native, `error?`),
  `components/ui/badge.tsx` default `Badge` (`variant?: 'green' | 'sky' |
  'neutral' | 'amber' | 'danger'`), `components/ui/skeleton.tsx` default
  `Skeleton ({className?})`, `components/ui/tooltip.tsx` default `Tooltip
  ({label, side?: 'top' | 'right', children})`,
  `components/ui/modal.tsx` default `Modal ({open, onClose, title?,
  children, className?})` — portal, spring, focus trap, backdrop blur.
- Toasts: `import { toast } from 'sonner'` → `toast.success('…')`,
  `toast.error('…')`. Toaster is already mounted.
- `cn` from `@/lib/utils`.

## Component contracts (what each agent builds)

### components/layout (agent: layout)
- `AppShell.tsx` — default `AppShell({children})`. Client. Renders `<Topbar/>`,
  desktop `<Sidebar/>`, `<MobileNav/>`, global `<TradeModal/>` (from
  `@/components/trading/TradeModal`, no props) and `<main>` with correct
  offsets: topbar h-16 fixed; sidebar fixed left below topbar, width 256px
  (collapsed 72px), hidden below `lg`; main gets `lg:pl-[256px]` /
  `lg:pl-[72px]` (transition) + `pt-16`. Page content container:
  `mx-auto max-w-[1400px] px-4 sm:px-6 py-6`.
- `Topbar.tsx` — default, no props. Left: burger (lg:hidden, toggles
  `mobileNavOpen`) + Logo link `/`. Center: global search (max-w-xl, Search
  icon, placeholder "Search markets…", ⌘K hint chip, binds
  `searchQuery`/`setSearchQuery`; Cmd/Ctrl+K focuses it; typing navigates to
  `/` if not there). Right: balance chip (`$1,000.00 USDC` format via
  formatMoney + " USDC", tabular-nums, hidden until `_hasHydrated`, hidden on
  mobile), Connect Wallet button (primary, glow; when `connecting` show
  loading; when connected show green status dot + `shortAddress`; click when
  connected = disconnect via small menu or direct toggle), Sign up (outline,
  hidden on mobile, toast "Demo build — sign up is disabled").
- `Sidebar.tsx` — default, no props. Desktop only (`hidden lg:flex`). Fixed,
  `bg-surface border-r border-line`, collapsible via `sidebarCollapsed` +
  collapse toggle button (chevron). Sections per spec: Home `/`, Trending
  (Flame icon → sets homeTab 'trending', navigates `/`), Leaderboard
  `/leaderboard`, Rewards `/rewards` (both with "Soon" amber badge);
  "Prediction markets" collapsible group (default open): **Create new
  market** — green pill Button with Plus icon + glow, links `/create`, THE
  standout item; All markets (→ homeTab 'all' + `/`), My markets (→ homeTab
  'mine' + `/`), My positions → `/portfolio`; "Categories" collapsible group:
  from `CATEGORIES` (each sets `categoryFilter` + navigates `/`); bottom:
  Settings (toast "Coming soon"), Help (toast). Active item: `bg-surface-3` +
  2px green bar on the left + green icon. Collapsed mode: icons only with
  `Tooltip side="right"`.
- `MobileNav.tsx` — default, no props. Off-canvas drawer (< lg) driven by
  `mobileNavOpen`, AnimatePresence slide-in from left, backdrop, same nav
  content as Sidebar (not collapsed), closes on any nav action.

### components/markets + components/common (agent: markets)
- `MarketCard.tsx` — default `MarketCard({market, interactive = true,
  className?}: {market: Market; interactive?: boolean; className?: string})`.
  Card `rounded-2xl border border-line bg-surface-2 glow-hover liquid-border`
  + framer `whileHover={{y: -2}}`. Head: category chip (Badge neutral,
  `categoryLabel`) + `<SourceBadge source/>`; resolved markets show a Badge
  ("Resolved Yes" green / "Resolved No" sky) instead of quick-buys. Question:
  `line-clamp-2 font-bold`. `<ProbabilityBar yesPrice showLabels/>`. Two
  quick-buy buttons: `Yes 62¢` (variant yes-tint) / `No 38¢` (no-tint), on
  click (stopPropagation) → `openTradeModal(market.id, 'yes' | 'no')`. Footer:
  `$1.2M Vol.` (formatMoney compact) · `<Countdown endDate/>`. Whole card
  (except buttons) navigates to `/market/[id]` when `interactive` (use
  router.push on click + cursor-pointer; also make the question a real
  `<Link>` for a11y). When `!interactive` (create-page preview): no
  navigation, buttons disabled.
- `MarketGrid.tsx` — default `({markets, loading?, emptyState?}: {markets:
  Market[]; loading?: boolean; emptyState?: React.ReactNode})`. Grid
  `grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
  `loading` → 8 skeleton cards (Skeleton blocks mimicking card layout).
  Empty + !loading → render `emptyState`.
- `ProbabilityBar.tsx` — default `({yesPrice, showLabels = true, className?})`.
  Labels `Yes 62¢` (green, font-bold) / `No 38¢` (sky) above a 6px
  `rounded-full` track: green fill `width: yesPrice%`, sky remainder, with a
  smooth width transition.
- `SourceBadge.tsx` — default `({source}: {source: Market['source']})` —
  `Badge variant="sky"` outline text "Polymarket" or `variant="green"`
  "Community".
- `CategoryChips.tsx` — default `({value, onChange}: {value: Category |
  'all'; onChange: (c: Category | 'all') => void})` — horizontal scrollable
  chip row ("All" + CATEGORIES). Active chip: green tint; inactive:
  surface-3, hover border.
- `MarketTicker.tsx` — default `({markets}: {markets: Market[]})` — slow
  marquee bar (wrapper `ticker-track overflow-hidden`, inner flex
  `animate-marquee` with content duplicated for seamless loop). Each item:
  Flame icon, question (truncated ~40ch), `Yes 62¢` in green; click →
  `/market/[id]`. Hidden when markets empty.
- `common/EmptyState.tsx` — default `({icon: Icon, title, description?,
  actionLabel?, actionHref?, onAction?}: {icon?: LucideIcon; title: string;
  description?: string; actionLabel?: string; actionHref?: string; onAction?:
  () => void})` — centered panel, icon in a green-tinted squircle, CTA
  Button (renders Link when actionHref).
- `common/StatChip.tsx` — default `({label, value, className?})` — small
  labeled stat (label tx-mut uppercase text-[11px], value font-bold
  tabular-nums).
- `common/Countdown.tsx` — default `({endDate, className?})` — client
  component; computes `formatTimeLeft` on mount + every 60s (avoid hydration
  mismatch: render '—' until mounted). Shows Clock icon + `Ends in 3d 4h`;
  urgent (<24h) → amber text; ended → tx-mut "Ended".

### components/trading (agent: trading)
- `TradeModal.tsx` — default, **no props**. Reads `tradeModal` from store,
  `useMarket(tradeModal.marketId)`. Renders `<Modal open onClose>` with
  title = market question (line-clamp-1) and `<TradePanel market
  defaultSide=… variant="modal" onTraded={close}/>`. Must keep the last
  market rendered during the exit animation (cache market in a ref so the
  content does not blank while closing).
- `TradePanel.tsx` — default `({market, defaultSide = 'yes', variant =
  'panel', onTraded?}: {market: Market; defaultSide?: Side; variant?:
  'panel' | 'modal'; onTraded?: () => void})`. Content: (1) side toggle —
  two large buttons `Yes 62¢` / `No 38¢` (selected: solid green with
  green-ink text / solid sky; unselected: tinted outline). (2)
  `<AmountInput value onChange max={balance}/>`. (3) live calc via
  `previewTrade`: rows Shares, Avg. price (formatCents), Potential payout
  (formatMoney), Return % (green when positive). (4) big **"Call it"**
  Button (primary lg, full width, glow-green class, disabled when amount
  invalid / > balance / market resolved/ended). On success: `trade(...)`,
  `toast.success('Position opened — you called it.')`, reset amount, call
  `onTraded`. Failure → `toast.error`. Polymarket markets: muted note with
  Info icon: "Demo trade — routes to Polymarket in production." Resolved
  or past-end markets: disable + "Market closed" note. `variant='panel'`
  wraps in card (`rounded-2xl border border-line bg-surface-2 p-5`) with
  "Place your call" heading; `variant='modal'` is bare.
- `AmountInput.tsx` — default `({value, onChange, max}: {value: number | '';
  onChange: (v: number | '') => void; max: number})` — USD amount: $ prefix
  input (type number, min 0, step 1) + quick chips `$10 · $50 · $100 · Max`
  (Max = floor(max*100)/100). Chips: small surface-3 pills, hover green
  border. Shows balance line "Balance: $1,000.00" (tabular-nums).
- `PriceChart.tsx` — default `({history, className?}: {history: PricePoint[];
  className?: string})` — Recharts AreaChart of yes-probability. Green line
  `#00E17E` (strokeWidth 2), gradient fill (green, opacity .25 → 0), grid
  lines `#2C4356` (dashed, vertical off), Y axis 0–100 with `¢` ticks
  (hide domain line), X axis time labels (short, tx-mut, fontSize 11).
  Custom dark tooltip: `bg-surface-3 border-line rounded-xl px-3 py-2` with
  date + `62¢`. Range toggles 1D / 1W / ALL (pill group, active green tint)
  filtering by timestamp. Render inside `ResponsiveContainer` height 280,
  only after mount (`useState` mounted flag → Skeleton before). Handles
  short histories gracefully.

### components/create + /create page (agent: create)
- `CreateMarketForm.tsx` — default, no props. Client. Two-column on lg
  (form 1fr, sticky preview 400px right; preview below form on mobile).
  Card-sections: 1) Question — Input, required, 10–140 chars, live counter
  `x/140` (amber >125, danger past limits), placeholder "Will Bitcoin close
  above $150,000 on Dec 31, 2026?". 2) Description — Textarea, optional,
  hint about resolution criteria. 3) Category — Select from CATEGORIES.
  4) End date & time — `<Input type="datetime-local">`, must be future.
  5) Resolution method — `<ResolutionPicker/>`. Inline error messages under
  fields (danger text, only after touch/submit). Submit: **Launch market**
  (primary lg, glow-green; loading state ~400ms for feel). On success:
  `createMarket(...)`, `toast.success('Market is live')`,
  `router.push('/market/' + m.id)`. If wallet not connected, still works
  (mock address) — but show subtle hint "Creating as guest — connect wallet
  to own your market" when not connected.
- `ResolutionPicker.tsx` — default `({value, onChange}: {value:
  ResolutionMethod; onChange: (v: ResolutionMethod) => void})` — three
  selectable cards (radiogroup a11y): `Chainlink Oracle` (Link2 or Zap icon,
  "Resolved automatically by a decentralized oracle"), `Community vote`
  (Users icon, "Token holders vote on the outcome"), `Manual` (UserCheck
  icon, "You resolve the market yourself"). Selected: green border +
  green/10 bg + check.
- `MarketPreview.tsx` — default `({input}: {input: {question: string;
  description?: string; category: Category; endDate: string; resolution:
  ResolutionMethod}}})` — heading "Live preview", builds a preview `Market`
  (id 'preview', source 'callit', yesPrice 0.5, volume 0, liquidity 500,
  status 'open', priceHistory `[{t: Date.now(), yes: .5}]`, question fallback
  "Your question appears here…" when empty, endDate fallback +30d) and
  renders `<MarketCard market interactive={false}/>`.
- `app/create/page.tsx` — client page: heading "Create a market" (font-black
  text-3xl) + sub "Launch your own prediction market in under a minute. No
  permission needed." + `<CreateMarketForm/>`.

### pages (agent: pages)
- `app/page.tsx` — client. Sections: (1) Hero panel (`hero-glow` bg card):
  H1 `Make the call. Make the market.` — 'Make the call.' white, 'Make the
  market.' with `market` in green; Nunito 900 4xl–6xl; sub "Trade real-world
  events — or launch your own market in seconds. No permission needed.";
  CTAs: "Create your first market" (Link `/create`, buttonClasses primary
  lg + glow-green) & "Explore trending" (ghost/outline, sets homeTab
  'trending'). (2) `<MarketTicker markets={top5ByVolume}/>`. (3) Filter row:
  `<CategoryChips value={categoryFilter} onChange={setCategoryFilter}/>` +
  sort `<Select>` (Volume / Newest / Ending soon) right-aligned. (4)
  `<Tabs>` items All/Trending/Polymarket/My markets bound to
  homeTab/setHomeTab. (5) `<MarketGrid markets loading emptyState>`.
  Filtering: `useAllMarkets()` → tab filter (trending = top 12 by volume;
  polymarket = source; mine = createdBy === wallet.address || source
  'callit' && userMarkets includes), category filter, debounced 250ms
  `searchQuery` match on question + category label, then sort. Open markets
  first, resolved at the end. Empty states: mine → "You haven't launched a
  market yet." + CTA `/create`; search → `No markets found for "…"`.
- `app/market/[id]/page.tsx` — client, `useParams()` for id,
  `useMarket(id)`. Not found (after hydration+polyLoaded) → EmptyState
  "Market not found" + back home CTA; while loading → skeletons. Layout
  `lg:grid-cols-[1fr_380px]` gap 6: LEFT: category Badge + SourceBadge +
  resolved Badge; H1 question (font-black text-2xl/3xl); meta StatChips row:
  Volume, Liquidity, `Ends {formatDate}` + Countdown, Resolution
  (capitalized method), Creator (shortAddress, only community); big current
  price strip: `Yes 62¢` (text-3xl font-black green, animated tick via
  framer `key={price}` fade) + `No 38¢` sky; `<PriceChart history/>`;
  Description card ("About this market"). If market resolved: banner
  (green/sky tint) "Resolved — outcome: Yes/No". RIGHT: `<div className=
  "lg:sticky lg:top-20">` `<TradePanel market/>` + small "Market stats"
  card (StatChips: created date, volume, liquidity). Mobile: panel under
  chart.
- `app/portfolio/page.tsx` — client. Heading "Portfolio" + balance summary
  cards (Balance, Portfolio value = Σ shares×current price, Total PnL
  green/danger). `<Tabs>`: "My positions" / "My created markets".
  Positions: table (Market question → link, Side chip green/sky, Shares
  (2 dec), Avg. price ¢, Current ¢, Value $, PnL $ + % colored). PnL =
  (current − avg) × shares; current price from `useAllMarkets()` map.
  Empty → EmptyState "No positions yet." + "Explore markets" CTA `/`.
  Created: `<MarketGrid>` of user markets; for `resolution==='manual' &&
  status==='open'`: Resolve buttons Yes/No under each card
  (`resolveMarket`, confirm via small inline confirm state, toast
  "Market resolved — winners paid out."). Empty → "You haven't launched a
  market yet."
- `app/leaderboard/page.tsx` — static-ish placeholder: heading, "Coming
  soon" Badge amber, mock top-10 table (rank, shortened addresses, PnL,
  win rate) marked "Preview data".
- `app/rewards/page.tsx` — placeholder: heading + amber "Coming soon"
  Badge + 3 teaser cards (Trading rewards / Creator fees / Referrals) with
  lucide icons, muted copy.

## Conventions
- Strict TS. No `any` unless unavoidable. Build must pass `tsc --noEmit`.
- Use `Link` from `next/link` for navigation, `useRouter` from
  `next/navigation`.
- Never hardcode hex colors in components — use token classes. (Charts may
  use hex constants matching tokens.)
- Everything must look premium-sportsbook: dense, calm, dark; green is the
  only hero accent.
