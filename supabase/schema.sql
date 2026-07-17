-- Callit — Supabase schema (run in the Supabase SQL editor)
-- Safe to re-run: script is idempotent.
-- Tables: profiles, markets, positions, trades, community_votes, deposits,
--         withdrawals, chat_messages, platform_settings
--
-- v6: THE MARKET IS NOW A REAL AMM. Until v5 there was no share ledger and
-- no pool: place_trade debited the buyer and minted an unbacked position,
-- resolve paid `shares × $1` out of thin air, and `liquidity` was a display
-- number backed by $0 — the operator ate every payout (structural
-- insolvency). v6 replaces that with a per-market Fixed-Product Market
-- Maker (Gnosis/Omen style) holding REAL collateral:
--
--   * every share is minted from a complete set (1 yes + 1 no per $1), so
--     `collateral` is ALWAYS >= the maximum possible payout — solvency is a
--     property of the arithmetic, not a hope. payout_market() asserts it.
--   * price(yes) = no_reserve / (yes_reserve + no_reserve); a buy mints
--     complete sets and removes shares from one reserve, so a big order
--     pays a materially worse average price (REAL slippage). The v5 code
--     filled the whole order at the pre-trade tick — that was the
--     money-printer's fuel.
--   * markets are FUNDED. Community markets: the creator seeds them from
--     their own balance (create_market_rpc gained p_seed) and is the LP —
--     they get the residual + fees at resolution and carry the LP's normal
--     risk. Global (feed) markets: seeded lazily by the platform on the
--     FIRST trade, so exposure is bounded to `global_seed` per market that
--     someone actually trades.
-- RLS: owners READ their own rows; admins (profiles.is_admin) see all;
-- chat is readable by everyone and writable by authenticated users;
-- markets + community_votes are readable by everyone incl. anon.
-- v5: money and prices are server-authoritative — the book (markets,
-- positions, trades, community_votes) and profiles.balance have NO client
-- write path at all; every mutation goes through a SECURITY DEFINER RPC in
-- section 7 (place_trade, create_market_rpc, resolve_market_rpc,
-- ban_market_rpc, community_vote_rpc, finalize_community_market,
-- ensure_market) or the v4 payment RPCs in section 6.
--
-- v8 (CONTRACTS2.md ## v8): the resolution model is oracle | community ONLY
-- ('manual' self-resolution is gone — create_market_rpc rejects it,
-- resolve_market_rpc is admin-only and free, finalize_community_market is
-- the admin CONFIRMATION step and charges the $10 fee from the market's own
-- pot); withdrawals are email-confirmed before admin review (confirmed /
-- confirm_token / confirm_withdrawal / the approve guard); public_profile,
-- list_creator_markets and reserves_stats are the new anon-readable RPCs;
-- deposits/withdrawals lost their direct client INSERT path.
--
-- Ordering matters: the script runs top-to-bottom in a FRESH project.
--   1. tables (profiles first — everything references it)
--   2. indexes
--   3. helper functions (SQL bodies are validated at CREATE time, so they
--      must come AFTER the tables they reference)
--   4. enable row level security
--   5. policies (which use the helper)

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  username text not null,
  balance numeric not null default 0,
  banned boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Accounts start empty ($0): balance is funded only by approve_deposit().
-- `alter … set default` is idempotent, so projects created with an older
-- default are brought in line on re-run (existing balances are untouched).
alter table public.profiles alter column balance set default 0;

-- SECURITY — GAP CLOSED in v5 (section 7). `profiles.balance` is no longer
-- writable by its owner: section 7 revokes UPDATE on profiles from
-- `authenticated` and re-grants it for the `username` column ONLY. Every
-- balance mutation now runs inside a SECURITY DEFINER RPC (place_trade,
-- create_market_rpc, resolve_market_rpc, ban_market_rpc,
-- finalize_community_market + the v4 payment RPCs), which execute as the
-- function owner and are therefore unaffected by that revoke.
-- The privileged columns (is_admin/banned/email) stay pinned by the
-- profiles_guard trigger below — defense in depth, not the primary lock.
--
-- REQUIRED CLIENT CHANGE: pushMyBalance() (lib/cloud.ts) mirrored a
-- client-computed balance into this table and MUST BE DELETED — after this
-- migration it can only fail (permission denied). Trades must go through
-- place_trade(), which computes the fill against the server-held price and
-- debits the caller atomically. Withdrawals stay manually reviewed in
-- /admin as a second pair of eyes, but the forged-balance path is gone.

-- markets (v5: the SHARED market book — community markets created by any
-- user are visible to everyone, and feed/seed markets are mirrored here by
-- ensure_market() so place_trade() has a server-held price to fill against.
-- Written ONLY by the section 7 RPCs; the client has no insert/update path.)
create table if not exists public.markets (
  id text primary key,
  creator_id uuid references public.profiles (id) on delete set null,
  source text not null default 'callit' check (source in ('callit', 'polymarket')),
  question text not null,
  description text,
  category text not null default 'custom',
  end_date timestamptz not null,
  resolution text not null default 'manual' check (resolution in ('oracle', 'community', 'manual')),
  yes_price numeric not null default 0.5,
  volume numeric not null default 0,
  liquidity numeric not null default 500,
  creator_name text,
  created_by text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_outcome text check (resolved_outcome in ('yes', 'no')),
  banned boolean not null default false,
  price_history jsonb not null default '[]'::jsonb,
  icon text,
  short_name text,
  event_id text,
  created_at timestamptz not null default now()
);

-- v5: bring older projects in line with the app's Market type. Each add is
-- a no-op once applied, so the script stays re-runnable.
alter table public.markets add column if not exists creator_id uuid references public.profiles (id) on delete set null;
alter table public.markets add column if not exists creator_name text;
alter table public.markets add column if not exists short_name text;
alter table public.markets add column if not exists description text;
alter table public.markets add column if not exists resolved_outcome text;
alter table public.markets add column if not exists icon text;
alter table public.markets add column if not exists event_id text;
alter table public.markets add column if not exists banned boolean not null default false;
-- v9: when the market settled — drives the 48h feed grace window and the
-- cleanup job. Backfilled below for rows resolved before the column existed.
alter table public.markets add column if not exists resolved_at timestamptz;
alter table public.markets add column if not exists price_history jsonb not null default '[]'::jsonb;
alter table public.markets alter column status set default 'open';

-- v6 — THE POOL. These seven columns are the market's balance sheet.
--   yes_reserve/no_reserve — the FPMM reserves. Invariant:
--     yes_reserve * no_reserve = k across a trade, and
--     price(yes) = no_reserve / (yes_reserve + no_reserve).
--     NULL/0 = "not funded yet" (see seed_market_pool + the lazy seed in
--     place_trade). Reserves are share counts, not dollars.
--   collateral — REAL money held by this market, in dollars. Every dollar
--     ever paid in (minus fees) is here until resolution pays it out. This
--     is the number that makes the book solvent; `liquidity` is kept equal
--     to it purely so the existing UI displays something true.
--   seed — the initial funding F (audit trail; also what the platform's
--     exposure counter unwinds by at resolution).
--   funder_id — the LP. The creator for community markets; NULL for
--     platform-seeded Global markets (their residual + fees go to
--     platform_settings.platform_balance instead).
--   fee_bps — the trading fee in basis points, LOCKED IN at creation from
--     platform_settings.fee_bps so an admin lowering the global fee can
--     never retro-price a live market. 200 = 2%.
--   fees_accrued — fees taken so far, paid to the funder at resolution.
alter table public.markets add column if not exists yes_reserve numeric;
alter table public.markets add column if not exists no_reserve numeric;
alter table public.markets add column if not exists collateral numeric not null default 0;
alter table public.markets add column if not exists seed numeric not null default 0;
alter table public.markets add column if not exists funder_id uuid references public.profiles (id) on delete set null;
alter table public.markets add column if not exists fee_bps int not null default 200;
alter table public.markets add column if not exists fees_accrued numeric not null default 0;

-- v7 — THE FEE SPLIT, LOCKED IN PER MARKET.
--   platform_fee_bps — the slice that goes to platform_settings.platform_balance
--     at trade time (the operator's cut; 100 = 1%).
--   lp_fee_bps — the slice that accrues to markets.fees_accrued and is paid to
--     `funder_id` at resolution (the v6 behaviour, now only half the fee).
--   fee_bps stays as the DEPRECATED TOTAL: it is maintained as
--     platform_fee_bps + lp_fee_bps so the existing UI (TradePanel, cloud.ts
--     `feeBps`) keeps showing the user-facing fee without a change.
--
-- WHY PER-MARKET AND NOT JUST platform_settings (deviation from the v7 brief,
-- deliberate): the brief has place_trade read the split live from
-- platform_settings. That would resurrect exactly what markets.fee_bps exists
-- to prevent — an admin editing the config would retro-price every live
-- market, and worse, retro-cut the LP's share of a deal they already funded.
-- The split is therefore LOCKED at creation from the live config, same as
-- fee_bps has been since v6. platform_settings holds the values NEW markets
-- are created with.
alter table public.markets add column if not exists platform_fee_bps int;
alter table public.markets add column if not exists lp_fee_bps int;

-- One-off: every row that predates v7 was funded under the v6 deal, where the
-- WHOLE fee went to the LP. Honour the deal those funders signed up for —
-- do not retro-take a platform cut out of their markets.
update public.markets
   set lp_fee_bps = coalesce(fee_bps, 200),
       platform_fee_bps = 0
 where lp_fee_bps is null
    or platform_fee_bps is null;

alter table public.markets alter column platform_fee_bps set default 100;
alter table public.markets alter column lp_fee_bps set default 100;
alter table public.markets alter column platform_fee_bps set not null;
alter table public.markets alter column lp_fee_bps set not null;

-- v7 — SOURCE-CLOSED IS THE TRUTH FOR FEED MARKETS.
--   source_closed — what the PROVIDER says: is this market closed upstream?
--     Written by the feed sync. This, not end_date, gates trading on feed
--     markets (see place_trade).
--   start_time — the event's real kickoff, when the provider reports one.
--
-- WHY: Polymarket's `endDate` on a game market is the KICKOFF, not the end.
-- Verified against the live Gamma API: "England vs. Argentina" carried
-- endDate 19:00 == gameStartTime 19:00 and still reported `closed: false` at
-- 20:19, mid-match. "Next Prime Minister of Ethiopia?" is past its
-- 2026-06-01 endDate and also still `closed: false` (unresolved upstream).
-- The v6 end_date gate therefore blocked a LIVE game as "Ended" and
-- mislabelled open markets as closed.
alter table public.markets add column if not exists source_closed boolean not null default false;
alter table public.markets add column if not exists start_time timestamptz;

-- v8 — SIDE DISPLAY LABELS. Feed sub-markets whose two sides have REAL names
-- carry them here: 'Over'/'Under' on a totals market, 'England'/'Argentina'
-- on a spread. NULL means the literal Yes/No. PRESENTATION ONLY — the
-- 'yes'/'no' side ids, colors and every price/pool column are untouched by
-- these. Written by the feed sync (metadata, refreshed every cycle).
alter table public.markets add column if not exists yes_label text;
alter table public.markets add column if not exists no_label text;

-- v6 — in-play. The FEED decides whether a market is a real live game
-- (in_play_ok = true); the DB just honors the flag. This exists because
-- v5 inferred in-play from `category in ('sports','football')`, which also
-- kept time-boxed questions ("goal in the first 10 minutes") tradeable for
-- 4h after they had already been decided — a free-money window.
alter table public.markets add column if not exists in_play_ok boolean not null default false;

-- v6 — grouping + settlement provenance (filled by the feed sync).
--   group_id/group_label — sub-market sections under one event, e.g. a game
--     with 'Moneyline' / 'Spreads' / 'Totals'.
--   provider — who the market comes from: 'callit' | 'polymarket' | 'kalshi'.
--   provider_ref — the source ticker/id used to poll for the result.
--   settle_status — 'none' | 'pending' | 'settled' | 'failed'.
alter table public.markets add column if not exists group_id text;
alter table public.markets add column if not exists group_label text;
alter table public.markets add column if not exists provider text default 'polymarket';
alter table public.markets add column if not exists provider_ref text;
alter table public.markets add column if not exists settle_status text default 'none';

-- Value constraints for the v6 text columns. `alter table … add constraint`
-- is NOT idempotent, so guard each one (existing rows all carry the column
-- defaults, so they validate).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'markets_provider_check'
  ) then
    alter table public.markets
      add constraint markets_provider_check
      check (provider in ('callit', 'polymarket', 'kalshi'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'markets_settle_status_check'
  ) then
    alter table public.markets
      add constraint markets_settle_status_check
      check (settle_status in ('none', 'pending', 'settled', 'failed'));
  end if;
end $$;

-- v7 — REPAIR `provider` ON LEGACY COMMUNITY MARKETS. The `provider` column
-- was added with `default 'polymarket'`, so every row that predates v6 —
-- including every community market — was stamped 'polymarket'. v7's expiry
-- gate branches on the provider, and a community market wearing a
-- 'polymarket' tag would take the FEED branch: gated on `source_closed`,
-- which nothing ever sets for a community market, so it would stay tradeable
-- for 30 days past its end date. `source = 'callit'` is the reliable marker
-- (its check constraint has always been ('callit','polymarket'), and only
-- create_market_rpc writes 'callit'), so use it to fix the tag.
update public.markets
   set provider = 'callit'
 where source = 'callit'
   and provider is distinct from 'callit';

-- v6 — platform_settings: the single-row (id = 1) operator config + till.
--   global_seed — what the platform funds a Global market with on its
--     first trade. THE platform's exposure per traded feed market.
--   fee_bps — the fee NEW markets are created with (live markets keep the
--     fee they were created with; see markets.fee_bps).
--   platform_balance — the operator's till: fees + residuals from
--     platform-funded markets, plus the $10 manual-resolve fees.
--   platform_exposure — sum of seeds the platform currently has at risk in
--     unresolved Global markets. Unwinds as those markets settle.
--
-- HONESTY NOTE FOR THE OPERATOR: seeding a Global market credits the pool
-- WITHOUT debiting anyone — the DB cannot conjure dollars. In reality the
-- operator must hold `platform_exposure` in real funds; this column is the
-- number to reconcile against.
create table if not exists public.platform_settings (
  id int primary key default 1,
  global_seed numeric not null default 25,
  fee_bps int not null default 200,
  platform_fee_bps int not null default 100,
  lp_fee_bps int not null default 100,
  platform_balance numeric not null default 0,
  platform_exposure numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id = 1)
);

alter table public.platform_settings add column if not exists global_seed numeric not null default 25;
alter table public.platform_settings add column if not exists fee_bps int not null default 200;

-- v7 — THE SPLIT NEW MARKETS ARE CREATED WITH. Owner-approved: platform 1%
-- + liquidity provider 1%, i.e. the same 2% the user has always paid, but the
-- operator now actually earns on community markets (under v6 the whole fee
-- went to the market's funder, so the platform earned NOTHING on them).
--   fee_bps is DEPRECATED as a config knob: it is no longer read when a
--   market is created (platform_fee_bps + lp_fee_bps are), and
--   admin_settings_update keeps it equal to their sum purely so any older
--   reader still sees a truthful total.
alter table public.platform_settings add column if not exists platform_fee_bps int not null default 100;
alter table public.platform_settings add column if not exists lp_fee_bps int not null default 100;
alter table public.platform_settings add column if not exists platform_balance numeric not null default 0;
alter table public.platform_settings add column if not exists platform_exposure numeric not null default 0;
alter table public.platform_settings add column if not exists updated_at timestamptz not null default now();

insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

-- `created_by` (v2, free-text author) is superseded by creator_name; carry
-- the old value over once so detail pages keep rendering an author.
update public.markets
   set creator_name = created_by
 where creator_name is null
   and created_by is not null;

-- v5: community-vote ballots. One ballot per (market, user); re-voting
-- replaces the previous ballot. Written only by community_vote_rpc().
create table if not exists public.community_votes (
  market_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  side text not null check (side in ('yes', 'no')),
  created_at timestamptz not null default now(),
  primary key (market_id, user_id)
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  market_id text not null,
  side text not null check (side in ('yes', 'no')),
  shares numeric not null,
  avg_price numeric not null,
  created_at timestamptz not null default now()
);

-- trades (immutable fill log)
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  market_id text not null,
  side text not null check (side in ('yes', 'no')),
  amount numeric not null,
  shares numeric not null,
  price numeric not null,
  created_at timestamptz not null default now()
);

-- v6: `amount` stays the GROSS stake the user paid; `fee` is the slice that
-- went to fees_accrued, and `price` is now the AVERAGE fill price
-- ((amount - fee) / shares), not a single tick.
alter table public.trades add column if not exists fee numeric not null default 0;

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  currency text not null check (currency in ('BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL')),
  amount numeric not null check (amount > 0),
  tx_hash text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- v7 — ON-CHAIN VERIFICATION EVIDENCE. The server route reads the tx from
-- Etherscan and records what it found here via record_deposit_verification().
-- This is EVIDENCE, not a decision: nothing in this block touches a balance.
-- Approving a deposit stays a human action (approve_deposit), because a
-- matching tx hash still is not proof the depositor owns the wallet.
--   verified               — did the chain confirm a matching payment?
--   verified_amount        — the amount the chain actually shows.
--   verified_to            — the destination address the chain actually shows.
--   verified_confirmations — confirmations at the time of the check.
--   verified_at            — when the check last ran.
--   verify_error           — why the check failed, when it did.
--   chain_tx               — the canonical tx hash as the chain reports it
--                            (tx_hash is what the USER typed; keep both).
alter table public.deposits add column if not exists verified boolean;
alter table public.deposits add column if not exists verified_amount numeric;
alter table public.deposits add column if not exists verified_to text;
alter table public.deposits add column if not exists verified_confirmations int;
alter table public.deposits add column if not exists verified_at timestamptz;
alter table public.deposits add column if not exists verify_error text;
alter table public.deposits add column if not exists chain_tx text;

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  currency text not null check (currency in ('BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL')),
  amount numeric not null check (amount > 0),
  address text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- v8 — WITHDRAWALS ARE EMAIL-CONFIRMED BEFORE ADMIN REVIEW.
--   confirmed       — did the requester click the confirmation link that was
--                     emailed to them? approve_withdrawal REFUSES unconfirmed
--                     rows ('User has not confirmed this withdrawal yet').
--                     The balance is still reserved at REQUEST time (that is
--                     unchanged) — confirmation gates the admin approval, not
--                     the reserve.
--   confirm_token   — unguessable single-use secret embedded in the emailed
--                     link. NEVER readable by the client (see the column
--                     grants in 7b): a hijacked browser session must not be
--                     able to read its own token and self-confirm — receiving
--                     the EMAIL is the whole proof.
--   confirm_sent_at — when the confirmation email last went out (server
--                     route bookkeeping; also a resend rate-limit anchor).
alter table public.withdrawals add column if not exists confirmed boolean not null default false;
alter table public.withdrawals add column if not exists confirm_token text;
alter table public.withdrawals add column if not exists confirm_sent_at timestamptz;

-- One-off legacy repair: rows that predate v8 were requested when no
-- confirmation existed — the users were never sent a link and could never
-- click one. `confirm_token is null` is the reliable marker (the v8
-- request_withdrawal ALWAYS writes a token), so this can never touch a row
-- created after the migration. Idempotent.
update public.withdrawals
   set confirmed = true
 where confirmed = false
   and confirm_token is null;

-- chat_messages (public read, authenticated write)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  user_id uuid references public.profiles (id) on delete set null,
  author text not null default 'guest',
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------

create index if not exists chat_messages_market_idx
  on public.chat_messages (market_id, created_at);

-- Usernames are unique case-insensitively (v3).
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- v5 — positions are keyed by (user, market, side): place_trade() upserts
-- into this index (weighted average price), so it MUST exist and be unique.
--
-- Before v5 the app never wrote positions (they lived in localStorage), so
-- the two statements below are normally no-ops. If a project does hold
-- duplicates for the same key, merge them into the oldest row (weighted
-- average, no shares lost) and drop the rest, so the index can be created.
with ranked as (
  select
    id,
    first_value(id) over w as keep_id,
    shares,
    avg_price
  from public.positions
  window w as (partition by user_id, market_id, side order by created_at, id)
),
merged as (
  select
    keep_id,
    sum(shares) as shares,
    case when sum(shares) > 0
         then sum(shares * avg_price) / sum(shares)
         else 0 end as avg_price
  from ranked
  group by keep_id
  having count(*) > 1
)
update public.positions p
   set shares = m.shares,
       avg_price = round(m.avg_price, 6)
  from merged m
 where p.id = m.keep_id;

delete from public.positions p
 where exists (
   select 1
     from public.positions q
    where q.user_id = p.user_id
      and q.market_id = p.market_id
      and q.side = p.side
      and (q.created_at, q.id) < (p.created_at, p.id)
 );

create unique index if not exists positions_user_market_side_idx
  on public.positions (user_id, market_id, side);

create index if not exists positions_market_idx on public.positions (market_id);
create index if not exists trades_user_idx on public.trades (user_id, created_at desc);
create index if not exists trades_market_idx on public.trades (market_id, created_at desc);
create index if not exists markets_status_idx on public.markets (status, end_date);
create index if not exists markets_creator_idx on public.markets (creator_id);
create index if not exists community_votes_market_idx on public.community_votes (market_id);

-- v6 — the feed groups a game's sub-markets by group_id, and the settlement
-- poller looks markets up by their source ticker.
create index if not exists markets_group_idx on public.markets (group_id);
create index if not exists markets_provider_ref_idx on public.markets (provider, provider_ref);
create index if not exists markets_funder_idx on public.markets (funder_id);

-- v8 — confirm_withdrawal() looks a withdrawal up BY its token. Unique on
-- purpose: two rows must never share a confirmation link.
create unique index if not exists withdrawals_confirm_token_idx
  on public.withdrawals (confirm_token)
  where confirm_token is not null;

-- v8 — public profiles + creator pages look markets up by creator, and
-- public_profile() resolves a username case-insensitively.
create index if not exists markets_source_creator_idx
  on public.markets (source, creator_id);

-- ---------------------------------------------------------------------
-- 3. Helper functions (after the tables they reference)
-- ---------------------------------------------------------------------

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  )
$$;

-- ---------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.markets enable row level security;
alter table public.positions enable row level security;
alter table public.trades enable row level security;
alter table public.deposits enable row level security;
alter table public.withdrawals enable row level security;
alter table public.chat_messages enable row level security;
alter table public.community_votes enable row level security;
alter table public.platform_settings enable row level security;

-- ---------------------------------------------------------------------
-- 5. Policies (drop-then-create so the script can be re-run safely)
-- ---------------------------------------------------------------------

-- profiles
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin());

-- markets — readable by EVERYONE incl. anon (the feed must render for
-- signed-out visitors). v5: there is deliberately NO client insert/update
-- policy; the price, volume and liquidity are the server's to move, so the
-- only writers are the section 7 RPCs (SECURITY DEFINER = policy-exempt).
-- The v4 "insert own"/"update own or admin" policies are dropped, NOT
-- recreated — with them a user could set their own market's yes_price.
drop policy if exists "markets: readable by all" on public.markets;
create policy "markets: readable by all"
  on public.markets for select
  using (true);

drop policy if exists "markets: insert own" on public.markets;
drop policy if exists "markets: update own or admin" on public.markets;

drop policy if exists "markets: delete admin" on public.markets;
create policy "markets: delete admin"
  on public.markets for delete
  using (public.is_admin());

-- community_votes — tallies are public (the whole point of a community
-- vote); ballots are cast only through community_vote_rpc().
drop policy if exists "community_votes: readable by all" on public.community_votes;
create policy "community_votes: readable by all"
  on public.community_votes for select
  using (true);

-- platform_settings — readable by EVERYONE incl. anon: the client shows the
-- fee on the trade panel, and a signed-out visitor sees that panel too.
-- Writable by admins only, and only the two CONFIG columns (see the grants
-- in section 7b): `platform_balance`/`platform_exposure` are the till, and
-- an admin crediting themselves a balance from it must go through a real
-- deposit, not an UPDATE.
drop policy if exists "platform_settings: readable by all" on public.platform_settings;
create policy "platform_settings: readable by all"
  on public.platform_settings for select
  using (true);

drop policy if exists "platform_settings: update admin only" on public.platform_settings;
create policy "platform_settings: update admin only"
  on public.platform_settings for update
  using (public.is_admin());

-- positions — read-only for their owner. v5 drops every client write
-- policy: a self-inserted position is free money at resolution, so rows
-- are created/updated/deleted exclusively by the section 7 RPCs.
drop policy if exists "positions: read own or admin" on public.positions;
create policy "positions: read own or admin"
  on public.positions for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "positions: insert own" on public.positions;
drop policy if exists "positions: update own or admin" on public.positions;
drop policy if exists "positions: delete own or admin" on public.positions;

-- trades — immutable fill log, read-only for its owner (v5: no client
-- insert; place_trade() writes it).
drop policy if exists "trades: read own or admin" on public.trades;
create policy "trades: read own or admin"
  on public.trades for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "trades: insert own" on public.trades;

-- deposits
drop policy if exists "deposits: read own or admin" on public.deposits;
create policy "deposits: read own or admin"
  on public.deposits for select
  using (auth.uid() = user_id or public.is_admin());

-- v8: the client insert path is CLOSED (policy dropped, NOT recreated, and
-- the grant revoked in 7b). Deposits are inserted only via request_deposit()
-- — a direct insert was a leftover v2 path, and for withdrawals its twin was
-- an actual money hole (see the withdrawals block below).
drop policy if exists "deposits: insert own" on public.deposits;

drop policy if exists "deposits: update admin only" on public.deposits;
create policy "deposits: update admin only"
  on public.deposits for update
  using (public.is_admin());

-- withdrawals (mirror of deposits: owner insert/select own, admin all)
drop policy if exists "withdrawals: read own or admin" on public.withdrawals;
create policy "withdrawals: read own or admin"
  on public.withdrawals for select
  using (auth.uid() = user_id or public.is_admin());

-- v8: the client insert path is CLOSED (policy dropped, NOT recreated, and
-- the grant revoked in 7b). It was a real money hole: request_withdrawal()
-- reserves the balance atomically, but a DIRECT insert under this old policy
-- skipped the reserve entirely — approve_withdrawal only flips status ("funds
-- were reserved on request"), so an admin approving such a row would pay out
-- money that was never held. It could also have been inserted with
-- `confirmed = true`, skipping the v8 email check. The RPC is SECURITY
-- DEFINER and unaffected.
drop policy if exists "withdrawals: insert own" on public.withdrawals;

drop policy if exists "withdrawals: update admin only" on public.withdrawals;
create policy "withdrawals: update admin only"
  on public.withdrawals for update
  using (public.is_admin());

-- chat_messages
drop policy if exists "chat: readable by all" on public.chat_messages;
create policy "chat: readable by all"
  on public.chat_messages for select
  using (true);

drop policy if exists "chat: insert authenticated" on public.chat_messages;
create policy "chat: insert authenticated"
  on public.chat_messages for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "chat: delete own or admin" on public.chat_messages;
create policy "chat: delete own or admin"
  on public.chat_messages for delete
  using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------
-- 5b. Privilege guard on profiles
-- ---------------------------------------------------------------------
-- The RLS policies above let a user write their OWN profiles row, which
-- on its own would let anyone set is_admin = true on themselves (full
-- admin: approving their own withdrawals, banning others) or lift their
-- own ban. This trigger pins the privileged columns to their previous
-- values for end users; admins and trusted contexts (SQL editor /
-- service_role, where auth.uid() is null) pass through untouched.
--
-- v5 NOTE — DO NOT pin `balance` in the UPDATE branch below. A SECURITY
-- DEFINER RPC bypasses RLS and table grants, but NOT triggers, and
-- auth.uid() still resolves to the CALLING user inside it (the JWT claims
-- are session state, not role state). Pinning balance here would silently
-- neuter place_trade()/approve_deposit()/every payout — the write would be
-- reverted to `old` with no error raised. `balance` is protected by the
-- grant revoke in section 7b instead, which the RPCs legitimately bypass.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No end-user JWT (SQL editor, service_role) or a real admin: allow.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Self sign-up: never trusted to grant itself anything. Accounts
    -- start empty; balance is credited only by approve_deposit().
    new.is_admin := false;
    new.banned := false;
    new.balance := 0;
  else
    new.is_admin := old.is_admin;
    new.banned := old.banned;
    new.email := old.email;
    new.id := old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------
-- 5c. Auto-create a profile for every auth user
-- ---------------------------------------------------------------------
-- Without this, the profile row depended on a best-effort client upsert
-- that RLS REJECTS whenever sign-up returns no session (i.e. whenever
-- "Confirm email" is on): auth.uid() is still null at that moment, so
-- `profiles: insert own` (auth.uid() = id) fails. The user then existed in
-- auth.users with no profile row — invisible in /admin, and any deposit
-- died on the deposits.user_id -> profiles FK. This trigger runs as the
-- definer right after the auth user is created, so it always succeeds.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_username text;
  v_i int := 0;
begin
  -- Prefer the username passed via signUp({ options: { data: { username } } }),
  -- else derive one from the email local part.
  v_base := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'caller'
  );
  v_username := v_base;
  -- profiles_username_lower_idx is UNIQUE — never let a collision abort
  -- the sign-up; suffix until free.
  while exists (
    select 1 from public.profiles p where lower(p.username) = lower(v_username)
  ) loop
    v_i := v_i + 1;
    v_username := v_base || v_i::text;
  end loop;

  insert into public.profiles (id, email, username)
  values (new.id, coalesce(new.email, new.id::text), v_username)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 6. v4 — cloud payments RPCs (idempotent: create or replace)
-- ---------------------------------------------------------------------
-- Money mutations run through SECURITY DEFINER functions so the admin
-- can credit/refund OTHER users' balances atomically — plain table
-- writes under RLS could never touch another user's profiles.balance.
-- Every function pins search_path = public; admin-only functions check
-- public.is_admin() first. Amounts are USD values rounded to cents.

-- USER: insert a pending deposit for the caller.
create or replace function public.request_deposit(
  currency text,
  amount numeric,
  tx_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric := round(amount, 2);
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;
  insert into public.deposits (user_id, currency, amount, tx_hash, status)
  values (
    v_uid,
    request_deposit.currency,
    v_amount,
    nullif(trim(coalesce(request_deposit.tx_hash, '')), ''),
    'pending'
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- USER: reserve the amount from the caller's balance and insert a
-- pending withdrawal. Fails (no state change) when the balance is short.
create or replace function public.request_withdrawal(
  currency text,
  amount numeric,
  address text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric := round(amount, 2);
  v_address text := trim(coalesce(address, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if v_address = '' then
    raise exception 'Destination address is required';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;
  -- Atomic reserve: the update only matches when the balance covers it.
  update public.profiles p
     set balance = round(p.balance - v_amount, 2)
   where p.id = v_uid
     and p.balance >= v_amount;
  if not found then
    raise exception 'Insufficient balance';
  end if;
  -- v8: every withdrawal starts UNCONFIRMED and carries an unguessable
  -- single-use token (2 x uuid = 256 bits, core-Postgres only — pgcrypto's
  -- gen_random_bytes lives in the `extensions` schema, which this function's
  -- pinned search_path deliberately excludes). The server email route embeds
  -- the token in the confirmation link; approve_withdrawal refuses the row
  -- until confirm_withdrawal() has flipped `confirmed`.
  insert into public.withdrawals
    (user_id, currency, amount, address, status, confirmed, confirm_token)
  values (
    v_uid,
    request_withdrawal.currency,
    v_amount,
    v_address,
    'pending',
    false,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ADMIN: pending -> approved AND credit the depositor's balance.
create or replace function public.approve_deposit(deposit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_amount numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.deposits d
     set status = 'approved'
   where d.id = deposit_id
     and d.status = 'pending'
  returning d.user_id, d.amount into v_user, v_amount;
  if not found then
    raise exception 'Deposit is not pending';
  end if;
  update public.profiles p
     set balance = round(p.balance + v_amount, 2)
   where p.id = v_user;
end;
$$;

-- ADMIN: pending -> rejected (nothing was credited).
create or replace function public.reject_deposit(deposit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.deposits d
     set status = 'rejected'
   where d.id = deposit_id
     and d.status = 'pending';
  if not found then
    raise exception 'Deposit is not pending';
  end if;
end;
$$;

-- ADMIN: pending -> approved (funds were already reserved on request).
--
-- v8: only a CONFIRMED withdrawal can be approved. The user proves control
-- of their account email by clicking the emailed link (confirm_withdrawal)
-- BEFORE the request reaches admin review — a hijacked session can request
-- a withdrawal, but it cannot confirm one. Reject/refund is deliberately
-- NOT gated on confirmation: an admin must always be able to kill a
-- suspicious request and return the reserve.
create or replace function public.approve_withdrawal(withdrawal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w public.withdrawals%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  select * into v_w from public.withdrawals w
   where w.id = withdrawal_id
   for update;
  if not found or v_w.status <> 'pending' then
    raise exception 'Withdrawal is not pending';
  end if;
  if not coalesce(v_w.confirmed, false) then
    raise exception 'User has not confirmed this withdrawal yet';
  end if;
  update public.withdrawals w
     set status = 'approved'
   where w.id = withdrawal_id;
end;
$$;

-- v8 — CONFIRM A WITHDRAWAL BY ITS EMAILED TOKEN. Single-use: the token is
-- cleared on success, and `confirmed = false` in the WHERE makes a replay
-- arithmetically impossible. Returns the withdrawal's id.
--
-- SERVICE ROLE ONLY (same pattern as settle_feed_market): the confirmation
-- link may be opened in a browser that is NOT signed in — or not even the
-- requester's — so the check cannot ride on auth.uid(). The token itself is
-- the proof (256 unguessable bits, delivered only to the account's email).
-- The server route POST /api/withdrawals/confirm holds the service key and
-- is the only caller; anon/authenticated hold no EXECUTE (see 7c), and the
-- `auth.uid() is null` guard is the belt to that braces.
create or replace function public.confirm_withdrawal(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := trim(coalesce(p_token, ''));
  v_id uuid;
begin
  if auth.uid() is not null then
    raise exception 'Service role only';
  end if;
  if v_token = '' then
    raise exception 'Invalid or used confirmation link';
  end if;

  update public.withdrawals w
     set confirmed = true,
         confirm_token = null
   where w.confirm_token = v_token
     and w.confirmed = false
     and w.status = 'pending'
  returning w.id into v_id;
  if not found then
    raise exception 'Invalid or used confirmation link';
  end if;
  return v_id;
end;
$$;

-- ADMIN: pending -> rejected AND refund the reserved amount.
create or replace function public.reject_withdrawal(withdrawal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_amount numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.withdrawals w
     set status = 'rejected'
   where w.id = withdrawal_id
     and w.status = 'pending'
  returning w.user_id, w.amount into v_user, v_amount;
  if not found then
    raise exception 'Withdrawal is not pending';
  end if;
  update public.profiles p
     set balance = round(p.balance + v_amount, 2)
   where p.id = v_user;
end;
$$;

-- ADMIN: ban/unban any user by profile id.
create or replace function public.set_user_banned(user_id uuid, is_banned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.profiles p
     set banned = set_user_banned.is_banned
   where p.id = set_user_banned.user_id;
  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

-- Only signed-in users may call the RPCs (definer functions would
-- otherwise be executable by anon through PostgREST).
revoke all on function public.request_deposit(text, numeric, text) from public, anon;
revoke all on function public.request_withdrawal(text, numeric, text) from public, anon;
revoke all on function public.approve_deposit(uuid) from public, anon;
revoke all on function public.reject_deposit(uuid) from public, anon;
revoke all on function public.approve_withdrawal(uuid) from public, anon;
revoke all on function public.reject_withdrawal(uuid) from public, anon;
revoke all on function public.set_user_banned(uuid, boolean) from public, anon;

grant execute on function public.request_deposit(text, numeric, text) to authenticated;
grant execute on function public.request_withdrawal(text, numeric, text) to authenticated;
grant execute on function public.approve_deposit(uuid) to authenticated;
grant execute on function public.reject_deposit(uuid) to authenticated;
grant execute on function public.approve_withdrawal(uuid) to authenticated;
grant execute on function public.reject_withdrawal(uuid) to authenticated;
grant execute on function public.set_user_banned(uuid, boolean) to authenticated;

-- v8 — confirm_withdrawal is SERVICE ROLE ONLY (see its header). The
-- explicit service_role grant IS required: SECURITY DEFINER changes what a
-- function executes AS, not who may CALL it (the v7 deviations note has the
-- full argument; settle_feed_market is the working precedent).
revoke all on function public.confirm_withdrawal(text) from public, anon, authenticated;
grant execute on function public.confirm_withdrawal(text) to service_role;

-- ---------------------------------------------------------------------
-- 7. v5 — server-authoritative economy (idempotent: create or replace)
-- ---------------------------------------------------------------------
-- Everything that moves money or a price lives here. These functions are
-- SECURITY DEFINER: they execute as the function owner, so they bypass
-- both RLS and the table grants revoked at the end of this section. That
-- is exactly why the client can keep its balance in sync WITHOUT being
-- able to write it.
--
-- Invariants every function below upholds:
--   * auth.uid() must exist (anon has no execute grant either).
--   * banned profiles cannot trade, create, resolve or vote.
--   * USD amounts are rounded to cents; share counts to 1e-6.
--   * The market row is locked FOR UPDATE before profiles are touched
--     (consistent lock order = no deadlock between concurrent RPCs).

-- v6 — FUND a market's pool. Internal helper (no role holds EXECUTE); the
-- caller must already hold the market row's FOR UPDATE lock.
--
-- Funding with F mints F complete sets: F yes-shares + F no-shares, backed
-- by F dollars of collateral. At the 50¢ open both reserves are simply F.
--
-- To open AT an external price p (Global feed markets), the pool keeps the
-- over-represented side at F and scales the other down until
-- price(yes) = no_reserve / (yes_reserve + no_reserve) = p:
--     yes_reserve = F * min(1, (1-p)/p)
--     no_reserve  = F * min(1, p/(1-p))
-- The shares held back from the smaller side belong to the funder; we do
-- NOT mint them a position for it — the residual at resolution
-- (collateral - total_paid) returns exactly that value to them anyway.
--
-- WHY NOT `yes_reserve = F*(1-p)*2, no_reserve = F*p*2` (the shape the v6
-- brief sketched): it prices correctly but is NOT backed. Those reserves
-- sum to 2F, i.e. they claim F complete sets were minted, while handing the
-- heavy side 2Fp > F shares — more of that side than exists. Buying the
-- heavy side with a large A then extracts ~A + 2Fp against collateral F + A,
-- leaving F*(2p-1) unbacked (at p = 0.98, 96% of the seed). That is the
-- exact insolvency v6 exists to kill, so we use the complete-set-preserving
-- form above: it satisfies the brief's own stated invariant ("every share is
-- minted from a complete set"), is identical at p = 0.5, and makes the
-- solvency assert in payout_market() unfireable rather than merely unlikely.
--
-- No-op when the market is already funded, so callers may call it blindly.
create or replace function public.seed_market_pool(
  p_market_id text,
  p_price numeric,
  p_seed numeric,
  p_funder uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p numeric;
  v_f numeric := round(coalesce(p_seed, 0), 2);
begin
  if v_f <= 0 then
    raise exception 'Seed must be positive';
  end if;
  -- Clamp: at p = 0 or 1 one reserve collapses to zero and the invariant
  -- divides by zero on the next trade.
  v_p := least(0.98, greatest(0.02, coalesce(p_price, 0.5)));

  update public.markets m
     set yes_reserve  = round(v_f * least(1, (1 - v_p) / v_p), 6),
         no_reserve   = round(v_f * least(1, v_p / (1 - v_p)), 6),
         collateral   = v_f,
         seed         = v_f,
         funder_id    = p_funder,
         fees_accrued = 0,
         liquidity    = v_f,
         yes_price    = v_p
   where m.id = p_market_id
     and coalesce(m.collateral, 0) <= 0;
  if not found then
    return; -- already funded
  end if;

  -- Platform-funded (Global) markets: book the exposure. It unwinds in
  -- payout_market() when the market settles.
  if p_funder is null then
    update public.platform_settings s
       set platform_exposure = round(s.platform_exposure + v_f, 2)
     where s.id = 1;
  end if;
end;
$$;

-- v7 — FUND A POOL THAT ALREADY HAS SHARES STANDING ON IT. Internal helper
-- for the section 8b migration ONLY; the caller must hold the market row's
-- FOR UPDATE lock. No role holds EXECUTE.
--
-- WHY THIS EXISTS — the bug it fixes. `seed_market_pool` derives its reserves
-- from PRICE alone, so it cannot encode shares that already exist. The pool it
-- builds implies `outstanding(yes) = collateral - yes_reserve`, but a legacy
-- market's shares sit outstanding ON TOP of that, unaccounted. Worked example
-- that BROKE under the v6 backfill: legacy market at p = 0.5, user A holds 100
-- Yes. F = 100 -> reserves 100/100, collateral 100, so the pool claims
-- outstanding(yes) = 100 - 100 = 0 while A really holds 100. Trader B then buys
-- $1000 of Yes: fee $20, net $980, k = 10000, shares = 1080 - 10000/1080 =
-- 1070.74, collateral 1080. Resolve Yes -> 100 + 1070.74 = 1170.74 > 1080, the
-- solvency assert fires, and the market is PERMANENTLY unsettleable by every
-- path. The backfill broke the very invariant it existed to restore.
--
-- THE FIX — encode the outstanding shares directly instead of inferring them
-- from a price, so `outstanding(side) = collateral - reserve(side)` holds BY
-- CONSTRUCTION rather than by luck:
--     C = collateral, yes_reserve = C - yes_out, no_reserve = C - no_out
-- with C > max(yes_out, no_out), which also keeps both reserves > 0 (the
-- constant-product curve divides by them).
--
-- Same example, fixed: yes_out = 100, no_out = 0 -> C = 103, yes_reserve = 3,
-- no_reserve = 103. B's $1000: k = 309, yes = 3 + 980 = 983, no = 103 + 980 =
-- 1083, shares = 983 - 309/1083 = 982.71, collateral = 1083. Resolve Yes ->
-- 100 + 982.71 = 1082.71 <= 1083. The assert does not fire, and the residual
-- ($0.29) goes to the funder. The invariant holds exactly: outstanding(yes) =
-- 1083 - 0.285 = 1082.71 = what was paid.
--
-- THE PRICE COST, ACCEPTED DELIBERATELY: the market re-opens at the price the
-- reserves imply (`no_reserve / (yes_reserve + no_reserve)` = 103/106 = 97¢
-- above, not the 50¢ it showed), because the pool is now telling the truth
-- about a book that is 100 Yes shares short. For a ONE-OFF migration of legacy
-- markets, solvency beats price fidelity: a market with a wrong price is
-- tradeable and settleable, a market with a wrong balance sheet is neither.
create or replace function public.seed_market_pool_exact(
  p_market_id text,
  p_min_seed numeric,
  p_funder uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yes_out numeric;
  v_no_out numeric;
  v_c numeric;
begin
  select
    coalesce(sum(po.shares) filter (where po.side = 'yes'), 0),
    coalesce(sum(po.shares) filter (where po.side = 'no'), 0)
    into v_yes_out, v_no_out
    from public.positions po
   where po.market_id = p_market_id;

  -- 2% headroom + $1 keeps both reserves strictly positive and leaves the
  -- curve enough room that the first trade is not pinned at the clamp.
  v_c := greatest(
    round(greatest(coalesce(p_min_seed, 0), 1), 2),
    ceil(greatest(v_yes_out, v_no_out) * 1.02) + 1
  );

  update public.markets m
     set yes_reserve  = round(v_c - v_yes_out, 6),
         no_reserve   = round(v_c - v_no_out, 6),
         collateral   = v_c,
         seed         = v_c,
         funder_id    = p_funder,
         fees_accrued = 0,
         liquidity    = v_c,
         yes_price    = least(0.98, greatest(0.02, round(
           (v_c - v_no_out) / nullif((v_c - v_yes_out) + (v_c - v_no_out), 0), 6
         )))
   where m.id = p_market_id
     and coalesce(m.collateral, 0) <= 0;
  if not found then
    return; -- already funded
  end if;

  if p_funder is null then
    update public.platform_settings s
       set platform_exposure = round(s.platform_exposure + v_c, 2)
     where s.id = 1;
  end if;
end;
$$;

-- Shared settlement leg for resolve_market_rpc / finalize_community_market /
-- settle_feed_market: every winning share pays $1 OUT OF THE POOL, the
-- funder takes what is left, then the book for that market is cleared.
-- Internal helper — no role holds EXECUTE (see the revokes below); it is
-- only reachable from the DEFINER functions that call it.
--
-- This is where v5 minted money: it paid `shares × $1` from nowhere. Now
-- every dollar paid out came from `collateral`, and the assert below proves
-- it: outstanding shares on a side always equal `collateral - reserve`, so
-- `total_paid <= collateral` is arithmetic, not optimism. If it ever fires,
-- the pool maths are broken — fail the transaction rather than pay out an
-- insolvent book.
--
-- v8 — SIGNATURE CHANGED (internal only, so no client breaks): gained
-- `p_platform_fee numeric default 0` and now RETURNS the fee it actually
-- banked. This carries the $10 community-CONFIRMATION fee (charged by
-- finalize_community_market, the admin confirm step). The fee mechanics —
-- exact, in order:
--   1. winners are paid IN FULL first. The fee can never touch a payout.
--   2. the fee pot is what is LEFT: `residual + fees_accrued` (the money
--      that would otherwise go to the funder). The fee is
--      `least(p_platform_fee, pot)` — if the pot is short of $10 we take
--      what is there, never negative, and settlement is NEVER blocked. No
--      user balance is ever debited for it.
--   3. the fee goes to platform_settings.platform_balance; the funder gets
--      the pot minus the fee. (Platform-funded markets: the whole pot goes
--      to the till anyway, so the fee is just reported, not moved.)
drop function if exists public.payout_market(text, text);

create or replace function public.payout_market(
  p_market_id text,
  p_outcome text,
  p_platform_fee numeric default 0
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.markets%rowtype;
  v_paid numeric := 0;
  v_residual numeric;
  v_fees numeric;
  v_pot numeric;
  v_take numeric;
begin
  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

  -- Winning shares pay $1 each. Payouts are FLOORED to the cent, never
  -- rounded: rounding up could push the total a fraction of a cent past
  -- `collateral` for each winner and false-fire the assert on a perfectly
  -- solvent book. The sub-cent dust stays in the pool and reaches the
  -- funder through the residual below.
  with winners as (
    select po.user_id, floor(sum(round(po.shares, 6)) * 100) / 100 as payout
      from public.positions po
     where po.market_id = p_market_id
       and po.side = p_outcome
     group by po.user_id
    having floor(sum(round(po.shares, 6)) * 100) / 100 > 0
  ), credited as (
    update public.profiles p
       set balance = round(p.balance + w.payout, 2)
      from winners w
     where p.id = w.user_id
    returning w.payout as payout
  )
  select coalesce(sum(c.payout), 0) into v_paid from credited c;

  -- Solvency assert. Tolerance is one cent for the floor() dust above.
  if v_paid > coalesce(v_m.collateral, 0) + 0.01 then
    raise exception
      'Insolvent market % — payout % exceeds collateral %',
      p_market_id, v_paid, coalesce(v_m.collateral, 0);
  end if;

  v_fees := coalesce(v_m.fees_accrued, 0);
  v_residual := greatest(round(coalesce(v_m.collateral, 0) - v_paid, 2), 0);

  -- v8 — the confirmation fee comes OUT OF THE POT, never out of a payout
  -- or a balance (see the header). Capped at what is actually there.
  v_pot := round(v_residual + v_fees, 2);
  v_take := least(greatest(round(coalesce(p_platform_fee, 0), 2), 0), v_pot);

  -- The LP takes the remainder + the fees (minus the confirmation fee, when
  -- one was charged). It may be LESS than the seed — that is the liquidity
  -- provider's normal risk, not a bug.
  if v_m.funder_id is not null then
    update public.profiles p
       set balance = round(p.balance + v_pot - v_take, 2)
     where p.id = v_m.funder_id;
    if v_take > 0 then
      update public.platform_settings s
         set platform_balance = round(s.platform_balance + v_take, 2)
       where s.id = 1;
    end if;
  else
    -- Platform-funded Global market: residual + fees go to the till and the
    -- seed stops counting against exposure. A confirmation fee here would be
    -- the till paying itself — the whole pot lands there regardless, so
    -- `v_take` is only REPORTED, not moved.
    update public.platform_settings s
       set platform_balance  = round(s.platform_balance + v_pot, 2),
           platform_exposure = greatest(round(s.platform_exposure - coalesce(v_m.seed, 0), 2), 0)
     where s.id = 1;
  end if;

  -- The pool is spent: zero it so a second settlement can never pay twice.
  --
  -- v7: `seed = 0` is part of that, and it is not cosmetic. The exposure
  -- unwind above subtracts `v_m.seed`, so leaving the seed set means any
  -- LATER path that unwinds again — an admin banning an already-resolved
  -- market (ban_market_rpc has no status guard) — subtracts the same seed a
  -- second time and drives `platform_exposure` below the platform's true
  -- risk. Clearing it makes the unwind idempotent at the source: it is now
  -- arithmetically impossible to unwind a seed that is already zero.
  update public.markets m
     set collateral   = 0,
         fees_accrued = 0,
         yes_reserve  = 0,
         no_reserve   = 0,
         seed         = 0,
         liquidity    = 0
   where m.id = p_market_id;

  -- Losing positions expire worthless; winners have been paid.
  delete from public.positions po where po.market_id = p_market_id;

  return v_take;
end;
$$;

-- Mirror a feed/seed market into the shared book so place_trade() has a
-- server-held row to fill against (Polymarket 'pm-…' + seeded 'cl-…'
-- markets are generated client-side and would otherwise not exist here).
--
-- Insert-only: `on conflict do nothing` means the economics of a market
-- can never be rewritten by a client once the row exists. User-created
-- markets must go through create_market_rpc(), so the 'cm-' namespace is
-- rejected here.
--
-- SECURITY — residual gap (documented, deliberately bounded): the FIRST
-- caller to touch a given feed market seeds its server price, and that
-- caller is an ordinary client, so a tampered client can seed a favorable
-- opening price for a market nobody has traded yet. Every LATER trade
-- fills against the stored price and cannot be forged. Payout on those
-- markets needs an admin (resolution 'oracle' -> resolve_market_rpc
-- rejects non-admins; finalize_community_market is admin-only), so the
-- gap cannot self-serve a withdrawal. Close it fully by syncing the feed
-- from a trusted context (service_role Edge Function / cron upserting
-- yes_price) and then: revoke execute on function public.ensure_market(...)
-- from authenticated. (v5's service-role sync in app/api/polymarket/route.ts
-- already closes it in practice — the client no longer calls this.)
--
-- v6: `p_yes_price` is the EXTERNAL price the pool will be seeded at, and
-- the row is inserted UNFUNDED (collateral 0). It is deliberately NOT
-- seeded here: seeding is what puts the platform's money at risk, and this
-- function is executable by any authenticated client, so eager seeding
-- would let anyone book unbounded `platform_exposure` against markets
-- nobody ever trades. place_trade() seeds lazily instead, which is what
-- bounds the platform to `global_seed` per market that someone ACTUALLY
-- trades. v6 also accepts the grouping/settlement columns so the feed can
-- populate them.
--
-- Signature CHANGED in v6 — drop the v5 overload or PostgREST will happily
-- keep resolving to it and create markets with no provenance.
drop function if exists public.ensure_market(text, text, text, text, text, timestamptz, text, numeric, numeric, numeric, text, text, text, text);

create or replace function public.ensure_market(
  p_id text,
  p_source text,
  p_question text,
  p_description text,
  p_category text,
  p_end_date timestamptz,
  p_resolution text,
  p_yes_price numeric,
  p_volume numeric,
  p_liquidity numeric,
  p_icon text default null,
  p_short_name text default null,
  p_event_id text default null,
  p_creator_name text default null,
  p_provider text default 'polymarket',
  p_provider_ref text default null,
  p_group_id text default null,
  p_group_label text default null,
  p_in_play_ok boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := trim(coalesce(p_id, ''));
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_id = '' then
    raise exception 'Market id is required';
  end if;
  if v_id like 'cm-%' then
    raise exception 'Use create_market_rpc for community markets';
  end if;
  if p_source not in ('callit', 'polymarket') then
    raise exception 'Invalid source';
  end if;
  if coalesce(p_provider, 'polymarket') not in ('callit', 'polymarket', 'kalshi') then
    raise exception 'Invalid provider';
  end if;
  if p_resolution not in ('oracle', 'community', 'manual') then
    raise exception 'Invalid resolution method';
  end if;
  if p_end_date is null then
    raise exception 'End date is required';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;

  insert into public.markets (
    id, source, question, description, category, end_date, resolution,
    yes_price, volume, liquidity, creator_id, creator_name, created_by,
    status, icon, short_name, event_id, price_history,
    provider, provider_ref, group_id, group_label, in_play_ok,
    fee_bps, platform_fee_bps, lp_fee_bps, collateral, seed, settle_status
  )
  values (
    v_id,
    p_source,
    coalesce(nullif(trim(coalesce(p_question, '')), ''), v_id),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_category, '')), ''), 'custom'),
    p_end_date,
    p_resolution,
    -- Clamp to the pool's tradeable band: the seed formula divides by p and
    -- by (1-p), so 0/1 (and anything outside [0.02, 0.98]) is out.
    least(0.98, greatest(0.02, coalesce(p_yes_price, 0.5))),
    greatest(coalesce(p_volume, 0), 0),
    greatest(coalesce(p_liquidity, 500), 1),
    null,
    nullif(trim(coalesce(p_creator_name, '')), ''),
    nullif(trim(coalesce(p_creator_name, '')), ''),
    'open',
    nullif(trim(coalesce(p_icon, '')), ''),
    nullif(trim(coalesce(p_short_name, '')), ''),
    nullif(trim(coalesce(p_event_id, '')), ''),
    '[]'::jsonb,
    coalesce(nullif(trim(coalesce(p_provider, '')), ''), 'polymarket'),
    nullif(trim(coalesce(p_provider_ref, '')), ''),
    nullif(trim(coalesce(p_group_id, '')), ''),
    nullif(trim(coalesce(p_group_label, '')), ''),
    coalesce(p_in_play_ok, false),
    -- v7: lock the fee AND its split in at creation from the live config.
    -- fee_bps is the derived total (deprecated, kept for the UI).
    coalesce((select s.platform_fee_bps from public.platform_settings s where s.id = 1), 100)
      + coalesce((select s.lp_fee_bps from public.platform_settings s where s.id = 1), 100),
    coalesce((select s.platform_fee_bps from public.platform_settings s where s.id = 1), 100),
    coalesce((select s.lp_fee_bps from public.platform_settings s where s.id = 1), 100),
    0, -- unfunded: place_trade() seeds the pool on the first trade
    0,
    'none'
  )
  on conflict (id) do nothing;
end;
$$;

-- THE CORE RPC. Buys `p_amount` USD of `p_side` for the caller against the
-- market's FPMM pool and returns the fill.
--
-- v6 REWRITE. The v5 body filled the entire order at the pre-trade tick
-- (`shares = amount / price`) and then nudged the price with a cosmetic
-- `impact` formula — so a $10,000 order bought every share at the 50¢ the
-- market showed before the order existed, and the shares were backed by
-- nothing. This version:
--   1. takes the fee, then mints A_net complete sets into the pool
--      (collateral += A_net, BOTH reserves += A_net),
--   2. removes the bought side's shares from its reserve so that
--      yes_reserve * no_reserve = k is preserved.
-- The trader therefore walks the curve and pays a real, worsening average
-- price, and every share they hold is backed by a dollar in `collateral`.
--
-- The returned `price` is the AVERAGE fill (A_net / shares), NOT a tick —
-- it will differ from the pre-trade quote, by design. lib/pricing.ts
-- applyTrade() no longer mirrors this and must not be used to predict a
-- fill; quote from the reserves or accept the server's number.
create or replace function public.place_trade(
  p_market_id text,
  p_side text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_m public.markets%rowtype;
  v_fee_bps int;
  v_pf_bps int;
  v_lp_bps int;
  v_fee numeric;
  v_fee_platform numeric;
  v_fee_lp numeric;
  v_net numeric;
  v_k numeric;
  v_yes numeric;
  v_no numeric;
  v_shares numeric;
  v_price numeric;
  v_new_yes numeric;
  v_balance numeric;
  v_hist jsonb;
  v_volume numeric;
  v_collateral numeric;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_side is null or p_side not in ('yes', 'no') then
    raise exception 'Invalid side';
  end if;
  if v_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;

  -- Lock the market for the whole trade: two concurrent buys must walk the
  -- curve one after the other, never from the same starting reserves.
  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;
  if v_m.banned then
    raise exception 'This market is unavailable';
  end if;
  if v_m.status <> 'open' then
    raise exception 'This market is closed';
  end if;

  -- v7 EXPIRY GATE — PROVIDER-AWARE. Who owns "is this still tradeable?"
  -- depends on who owns the market.
  --
  -- Community ('callit'): WE own the deadline, so end_date IS the truth.
  -- Unchanged from v6.
  --
  -- Feed ('polymarket'/'kalshi'): THE SOURCE owns it, and end_date is not
  -- what we assumed. Polymarket's `endDate` on a game is the KICKOFF — the
  -- v6 gate closed a live match at kickoff ("Ended") and, on markets the
  -- source has not resolved, called them closed while they still traded
  -- upstream. So the gate is `source_closed`, written by the feed sync from
  -- the provider's own `closed` flag, and end_date is NOT consulted.
  --
  -- SAFETY VALVE: `source_closed` is only as fresh as the sync. If the sync
  -- dies, every feed market would stay tradeable forever against a stale
  -- price — so a market whose end_date is more than 30 days past and which
  -- the source still has not closed is refused anyway. 30 days is well past
  -- any real settlement lag, so this only ever catches a broken sync.
  --
  -- in_play_ok is NO LONGER a trading gate — it is purely the LIVE label
  -- (that is what it was introduced for in v6). Requiring it to trade is
  -- what blocked the England vs. Argentina match mid-game.
  if coalesce(v_m.provider, 'polymarket') = 'callit' or v_m.source = 'callit' then
    if v_m.end_date <= now() then
      raise exception 'This market has ended';
    end if;
  else
    if coalesce(v_m.source_closed, false) then
      raise exception 'This market has ended';
    end if;
    if not coalesce(v_m.source_closed, false)
       and v_m.end_date + interval '30 days' < now() then
      raise exception 'This market has ended';
    end if;
  end if;

  -- LAZY SEED (Global/feed markets only). The platform funds the pool on
  -- the FIRST trade, at the price the feed sync last wrote. This is what
  -- bounds the platform's downside to `global_seed` per market that someone
  -- actually trades — seeding the whole feed up front would put the seed at
  -- risk on thousands of markets nobody ever touches.
  if coalesce(v_m.collateral, 0) <= 0
     or coalesce(v_m.yes_reserve, 0) <= 0
     or coalesce(v_m.no_reserve, 0) <= 0 then
    if v_m.source = 'callit' then
      -- Community markets are funded by their creator in create_market_rpc.
      -- Reaching here means the pool was voided (banned) or the row predates
      -- v6 and the backfill missed it — either way there is nothing to
      -- trade against, and minting unbacked shares is exactly what v6 bans.
      raise exception 'This market has no liquidity';
    end if;
    perform public.seed_market_pool(
      v_m.id,
      v_m.yes_price,
      coalesce((select s.global_seed from public.platform_settings s where s.id = 1), 25),
      null
    );
    select * into v_m from public.markets m where m.id = p_market_id;
  end if;

  -- v7 FEE SPLIT. The rates are the MARKET's own, locked at creation, never
  -- the live config: an admin retuning the split must not re-cut a deal an LP
  -- already funded. Legacy rows carry platform 0 / lp = their old fee_bps, so
  -- they keep the exact v6 economics.
  v_pf_bps := coalesce(v_m.platform_fee_bps, 0);
  v_lp_bps := coalesce(v_m.lp_fee_bps, coalesce(v_m.fee_bps, 200));
  v_fee_bps := v_pf_bps + v_lp_bps;

  -- ORDER MATTERS: round the TOTAL (this is what the user is told they paid
  -- and what leaves their balance), then round the platform slice, then make
  -- the LP slice the REMAINDER. Rounding each slice independently would let
  -- them sum to a cent more or less than the total, and that cent would be
  -- conjured from — or quietly lost out of — the pool's accounting. As the
  -- remainder, platform + lp = total exactly, always. `round` is monotonic
  -- and v_pf_bps <= v_fee_bps, so v_fee_platform <= v_fee and the LP slice
  -- can never go negative.
  v_fee := round(v_amount * v_fee_bps / 10000.0, 2);
  v_fee_platform := round(v_amount * v_pf_bps / 10000.0, 2);
  v_fee_lp := round(v_fee - v_fee_platform, 2);

  v_net := round(v_amount - v_fee, 2);
  if v_net <= 0 then
    raise exception 'Amount must be positive';
  end if;

  -- Debit FIRST and atomically: the update matches only while the balance
  -- covers the stake, so two racing trades can never overdraw.
  update public.profiles p
     set balance = round(p.balance - v_amount, 2)
   where p.id = v_uid
     and p.balance >= v_amount
  returning p.balance into v_balance;
  if not found then
    raise exception 'Insufficient balance';
  end if;

  -- Mint A_net complete sets: every dollar becomes 1 yes + 1 no share,
  -- backed by 1 dollar of collateral. This is the step that makes the book
  -- solvent by construction.
  v_k   := v_m.yes_reserve * v_m.no_reserve;
  v_yes := v_m.yes_reserve + v_net;
  v_no  := v_m.no_reserve + v_net;

  -- Take the bought side out of its reserve so that (new yes) * (new no) = k.
  if p_side = 'yes' then
    v_shares := round(v_yes - v_k / v_no, 6);
    v_yes := v_yes - v_shares;
  else
    v_shares := round(v_no - v_k / v_yes, 6);
    v_no := v_no - v_shares;
  end if;
  if v_shares is null or v_shares <= 0 then
    raise exception 'Trade too small for this market';
  end if;

  -- Average fill price. Always between the pre- and post-trade quote: this
  -- IS the slippage.
  v_price := round(v_net / v_shares, 6);
  v_new_yes := least(0.98, greatest(0.02, round(v_no / (v_yes + v_no), 6)));

  -- The pool owns the price now — for Global markets too. v5 let the live
  -- feed own polymarket prices and only added volume here; that cannot hold
  -- in v6, because we are filling from OUR collateral and the fill has to
  -- move the curve we pay out of. The feed sync MUST stop overwriting
  -- yes_price/volume/liquidity once collateral > 0 (see CONTRACTS2.md v6).
  v_hist := coalesce(v_m.price_history, '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object(
                 't', (extract(epoch from now()) * 1000)::bigint,
                 'yes', v_new_yes
               ));
  if jsonb_array_length(v_hist) > 200 then
    v_hist := (
      select coalesce(jsonb_agg(x.elem order by x.ord), '[]'::jsonb)
        from (
          select elem, ord
            from jsonb_array_elements(v_hist) with ordinality as t(elem, ord)
           order by ord
          offset greatest(jsonb_array_length(v_hist) - 200, 0)
        ) x
    );
  end if;

  update public.markets m
     set yes_reserve   = v_yes,
         no_reserve    = v_no,
         collateral    = round(m.collateral + v_net, 2),
         -- v7: only the LP's slice accrues here (paid to funder_id at
         -- resolution, exactly as in v6). The platform's slice is banked
         -- below instead of being handed to the funder.
         fees_accrued  = round(m.fees_accrued + v_fee_lp, 2),
         yes_price     = v_new_yes,
         volume        = m.volume + v_amount,
         -- `liquidity` is now the honest number: the real money in the pool.
         liquidity     = round(m.collateral + v_net, 2),
         price_history = v_hist
   where m.id = v_m.id
  returning m.volume, m.collateral into v_volume, v_collateral;

  -- v7: bank the platform's slice NOW, at trade time — not at resolution.
  -- This is the whole point of the split: under v6 the entire fee went to the
  -- market's funder, so on community markets (where the funder is the
  -- creator, never us) the platform earned nothing at all. This money is
  -- real: it came out of the trader's balance and never entered `collateral`,
  -- so booking it here cannot affect solvency.
  if v_fee_platform > 0 then
    update public.platform_settings s
       set platform_balance = round(s.platform_balance + v_fee_platform, 2)
     where s.id = 1;
  end if;

  -- Upsert the position at the weighted average entry price.
  insert into public.positions as pos (user_id, market_id, side, shares, avg_price)
  values (v_uid, v_m.id, p_side, v_shares, v_price)
  on conflict (user_id, market_id, side) do update
     set avg_price = round(
           (pos.shares * pos.avg_price + excluded.shares * excluded.avg_price)
           / nullif(pos.shares + excluded.shares, 0), 6),
         shares = pos.shares + excluded.shares;

  insert into public.trades (user_id, market_id, side, amount, shares, price, fee)
  values (v_uid, v_m.id, p_side, v_amount, v_shares, v_price, v_fee);

  return jsonb_build_object(
    'shares', v_shares,
    'price', v_price,
    'fee', v_fee,
    'balance', v_balance,
    'yesPrice', v_new_yes,
    'volume', v_volume,
    'liquidity', v_collateral
  );
end;
$$;

-- Launch a community market. The client generates the id ('cm-…'); the
-- economics are fixed here (0.5 open) — a client must never get to pick its
-- own starting price.
--
-- v6: THE CREATOR FUNDS THE MARKET. v5 handed every new market $500 of
-- `liquidity` backed by nothing, which is precisely how the book went
-- insolvent. Now `p_seed` dollars are debited from the creator, become the
-- pool's real collateral, and make the creator its LP: at resolution they
-- take `collateral - total_paid` plus every fee the market accrued. That
-- can be more or less than the seed — being the house is a position.
--
-- Signature CHANGED in v6 (gained p_seed, no default). Drop the v5 overload:
-- left in place, PostgREST would resolve a 6-arg call to it and mint exactly
-- the unfunded markets this rewrite exists to prevent.
drop function if exists public.create_market_rpc(text, text, text, text, timestamptz, text);

create or replace function public.create_market_rpc(
  p_id text,
  p_question text,
  p_description text,
  p_category text,
  p_end_date timestamptz,
  p_resolution text,
  p_seed numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := trim(coalesce(p_id, ''));
  v_question text := trim(coalesce(p_question, ''));
  v_username text;
  v_seed numeric := round(coalesce(p_seed, 0), 2);
  v_fee_bps int;
  v_pf_bps int;
  v_lp_bps int;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select p.username into v_username from public.profiles p where p.id = v_uid;
  if not found then
    raise exception 'Profile not found';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;
  if v_id = '' then
    raise exception 'Market id is required';
  end if;
  -- 'pm-' is the Polymarket feed namespace, 'cl-' the seeded book: a user
  -- market must never be able to shadow one of those ids.
  if v_id like 'pm-%' or v_id like 'cl-%' then
    raise exception 'Reserved market id';
  end if;
  if v_question = '' then
    raise exception 'Question is required';
  end if;
  if p_end_date is null then
    raise exception 'End date is required';
  end if;
  -- The create form has a `min` on the date input, but that is a hint, not
  -- a control: under v5 the server owns validation. A past end date would
  -- mint an instantly-resolvable market.
  if p_end_date <= now() then
    raise exception 'End date must be in the future';
  end if;
  -- v8 — COMMUNITY IS THE ONLY USER-CREATABLE RESOLUTION (owner decision).
  -- 'manual' self-resolution is gone: every user market is voted on by the
  -- community and then CONFIRMED by an admin (finalize_community_market),
  -- where the $10 confirmation fee is charged. 'oracle' stays reserved for
  -- the Global feed. The 'manual' value survives in the column CHECK purely
  -- for pre-v8 rows — no new market can be created with it.
  if p_resolution is null or p_resolution <> 'community' then
    raise exception 'Only community resolution is available';
  end if;
  if exists (select 1 from public.markets m where m.id = v_id) then
    raise exception 'Market already exists';
  end if;
  -- Bounds: below $10 the curve is so thin the first $5 order moves the
  -- price to the clamp; above $10k a creator can put more at risk than the
  -- product is meant to carry.
  if v_seed < 10 then
    raise exception 'Seed liquidity must be at least $10';
  end if;
  if v_seed > 10000 then
    raise exception 'Seed liquidity cannot exceed $10,000';
  end if;

  -- v7: lock BOTH halves of the split in at creation, and derive the
  -- deprecated total from them so the UI keeps rendering a truthful fee.
  select coalesce(s.platform_fee_bps, 100), coalesce(s.lp_fee_bps, 100)
    into v_pf_bps, v_lp_bps
    from public.platform_settings s where s.id = 1;
  v_pf_bps := coalesce(v_pf_bps, 100);
  v_lp_bps := coalesce(v_lp_bps, 100);
  v_fee_bps := v_pf_bps + v_lp_bps;

  -- Atomic debit: the update matches only while the balance covers the
  -- seed, so a market can never exist without the money that backs it.
  update public.profiles p
     set balance = round(p.balance - v_seed, 2)
   where p.id = v_uid
     and p.balance >= v_seed;
  if not found then
    raise exception 'Insufficient balance to fund your market';
  end if;

  insert into public.markets (
    id, source, question, description, category, end_date, resolution,
    yes_price, volume, liquidity, creator_id, creator_name, created_by,
    status, price_history, provider, fee_bps, platform_fee_bps, lp_fee_bps,
    in_play_ok, source_closed, settle_status
  )
  values (
    v_id,
    'callit',
    v_question,
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(coalesce(p_category, '')), ''), 'custom'),
    p_end_date,
    p_resolution,
    0.5,
    0,
    v_seed,
    v_uid,
    v_username,
    v_username,
    'open',
    '[]'::jsonb,
    'callit',
    v_fee_bps,
    v_pf_bps,
    v_lp_bps,
    false,
    -- Community markets are gated on end_date, never on source_closed;
    -- there is no upstream source to close them.
    false,
    'none'
  );

  -- Fund the pool at 50¢: yes_reserve = no_reserve = seed, collateral = seed.
  perform public.seed_market_pool(v_id, 0.5, v_seed, v_uid);

  return v_id;
end;
$$;

-- Resolve a market and pay the winners $1/share.
--
-- v8 — ADMIN ONLY, FREE. The whole creator self-resolve branch is GONE
-- (owner decision): 'manual' resolution no longer exists as a product, so
-- there is no creator path, no $10 resolve fee here, and none of the v6/v7
-- money-printer guards it needed (they existed only because a non-admin was
-- allowed in; an admin is trusted to settle honestly by definition). Admins
-- use this to settle Global/legacy markets and as the fallback for community
-- markets stuck without a majority. The $10 fee moved to the community
-- CONFIRMATION step (finalize_community_market).
create or replace function public.resolve_market_rpc(
  p_market_id text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.markets%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_outcome is null or p_outcome not in ('yes', 'no') then
    raise exception 'Invalid outcome';
  end if;

  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;
  if v_m.status <> 'open' then
    raise exception 'This market is already resolved';
  end if;

  update public.markets m
     set status = 'resolved',
         resolved_outcome = p_outcome,
         settle_status = 'settled',
         resolved_at = now()
   where m.id = v_m.id;

  -- v6: pays the winners OUT OF THE POOL, hands the funder the residual +
  -- fees, and asserts the book was solvent. No confirmation fee here —
  -- admin settlement is free.
  perform public.payout_market(v_m.id, p_outcome);
end;
$$;

-- ADMIN: ban/unban a market. Banning VOIDS the pool — every open position
-- is refunded at cost (what the holder actually paid for the shares), never
-- at the current mark, so a ban can neither create nor destroy value. The
-- funder then gets whatever is left, exactly as at resolution.
--
-- v6: the refunds now come OUT OF `collateral`, and they always fit:
-- refund-at-cost totals Σ A_net, while collateral = seed + Σ A_net. The
-- surplus (the seed, plus the fee slice) returns to the funder.
--
-- CONSEQUENCE OF THE VOID: an unbanned market has no pool. A feed market
-- re-seeds itself on the next trade; a COMMUNITY market stays untradeable
-- ('This market has no liquidity') because its creator's seed has already
-- been returned to them. Unban is not an undo — treat a ban as terminal.
create or replace function public.ban_market_rpc(
  p_market_id text,
  p_banned boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.markets%rowtype;
  v_paid numeric := 0;
  v_residual numeric;
  v_fees numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_banned is null then
    raise exception 'Banned flag is required';
  end if;

  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

  -- v7 — BAN IS NOT RE-ENTRANT. `if p_banned then` alone runs the whole void
  -- leg again on a market that is ALREADY banned, and the exposure unwind
  -- below subtracts `v_m.seed` every time. Two clicks on Ban = the platform's
  -- exposure counter reads a seed lower than its real risk. (The refunds
  -- themselves cannot double-pay — positions are deleted — but the counter is
  -- the number the operator reconciles real funds against, so it lying is a
  -- money bug.) Only the false -> true TRANSITION voids the pool; `seed = 0`
  -- in the void below is the second, independent line of defence.
  if p_banned and not coalesce(v_m.banned, false) then
    with refunds as (
      select po.user_id, sum(round(po.shares * po.avg_price, 2)) as amount
        from public.positions po
       where po.market_id = p_market_id
       group by po.user_id
    ), credited as (
      update public.profiles p
         set balance = round(p.balance + r.amount, 2)
        from refunds r
       where p.id = r.user_id
      returning r.amount as amount
    )
    select coalesce(sum(c.amount), 0) into v_paid from credited c;

    if v_paid > coalesce(v_m.collateral, 0) + 0.01 then
      raise exception
        'Insolvent market % — refunds % exceed collateral %',
        p_market_id, v_paid, coalesce(v_m.collateral, 0);
    end if;

    v_fees := coalesce(v_m.fees_accrued, 0);
    v_residual := greatest(round(coalesce(v_m.collateral, 0) - v_paid, 2), 0);

    if v_m.funder_id is not null then
      update public.profiles p
         set balance = round(p.balance + v_residual + v_fees, 2)
       where p.id = v_m.funder_id;
    else
      update public.platform_settings s
         set platform_balance  = round(s.platform_balance + v_residual + v_fees, 2),
             platform_exposure = greatest(round(s.platform_exposure - coalesce(v_m.seed, 0), 2), 0)
       where s.id = 1;
    end if;

    delete from public.positions po where po.market_id = p_market_id;

    -- v7: `seed = 0` — see payout_market. The seed has now been unwound from
    -- platform_exposure; leaving the number in place lets a later path
    -- (resolve after unban, a second ban) unwind it again.
    update public.markets m
       set collateral   = 0,
           fees_accrued = 0,
           yes_reserve  = 0,
           no_reserve   = 0,
           seed         = 0,
           liquidity    = 0
     where m.id = p_market_id;
  end if;

  update public.markets m set banned = p_banned where m.id = p_market_id;
end;
$$;

-- Cast (or change) a community-resolution ballot. Only after the market
-- has ended and only while it is unresolved — voting on a live market
-- would just be another way to trade.
create or replace function public.community_vote_rpc(
  p_market_id text,
  p_side text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_m public.markets%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_side is null or p_side not in ('yes', 'no') then
    raise exception 'Invalid side';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;

  select * into v_m from public.markets m where m.id = p_market_id;
  if not found then
    raise exception 'Market not found';
  end if;
  if v_m.banned then
    raise exception 'This market is unavailable';
  end if;
  if v_m.resolution <> 'community' then
    raise exception 'This market is not resolved by community vote';
  end if;
  if v_m.status <> 'open' then
    raise exception 'This market is already resolved';
  end if;
  if v_m.end_date > now() then
    raise exception 'Voting opens when the market ends';
  end if;

  insert into public.community_votes as cv (market_id, user_id, side)
  values (v_m.id, v_uid, p_side)
  on conflict (market_id, user_id) do update
     set side = excluded.side,
         created_at = now();
end;
$$;

-- v8 — THE ADMIN CONFIRMATION STEP (owner decision: "bei der community muss
-- ein admin trotzdem rueberschauen und es nochmal bestaetigen"). Community
-- markets are the ONLY user-creatable kind now, and this is how they settle:
-- users vote after the market ends, then an admin reviews the tally and
-- CONFIRMS it here. Majority wins; a tie or an empty ballot box is NOT a
-- result — it raises, leaving the market open (the admin can wait for more
-- votes or settle it directly with resolve_market_rpc).
--
-- THE $10 CONFIRMATION FEE is charged HERE, at the confirm step — not from
-- the admin, not from the creator's balance. It comes out of the market's
-- own pot (residual + accrued LP fees, AFTER winners are paid in full — see
-- payout_market's v8 header for the exact mechanics): it never requires
-- anyone to hold spare balance and can never block settlement. If the pot
-- holds less than $10 the platform takes what is there (possibly $0), never
-- negative. The old "$10 from the resolver's balance" rule is gone.
--
-- SIGNATURE CHANGED in v8 (return text -> jsonb, so the client can show
-- both the outcome and the fee actually banked). Postgres cannot change a
-- return type in-place — drop the v7 overload first.
drop function if exists public.finalize_community_market(text);

create or replace function public.finalize_community_market(p_market_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.markets%rowtype;
  v_yes bigint;
  v_no bigint;
  v_outcome text;
  v_fee numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;
  if v_m.resolution <> 'community' then
    raise exception 'This market is not resolved by community vote';
  end if;
  if v_m.status <> 'open' then
    raise exception 'This market is already resolved';
  end if;
  if v_m.banned then
    raise exception 'This market is unavailable';
  end if;
  -- Voting only opens at end_date (community_vote_rpc), so a pre-end
  -- finalize could only ever see an empty box — but the guard belongs here
  -- too: confirming a market that is still trading would be a rug-pull.
  if v_m.end_date > now() then
    raise exception 'This market has not ended yet';
  end if;

  select
    count(*) filter (where cv.side = 'yes'),
    count(*) filter (where cv.side = 'no')
    into v_yes, v_no
    from public.community_votes cv
   where cv.market_id = v_m.id;

  -- Zero votes and a tie are the same non-result (v8 collapses the two v5
  -- messages into one): there is no majority to confirm.
  if v_yes + v_no = 0 or v_yes = v_no then
    raise exception 'No majority yet — cannot finalize';
  end if;
  v_outcome := case when v_yes > v_no then 'yes' else 'no' end;

  update public.markets m
     set status = 'resolved',
         resolved_outcome = v_outcome,
         settle_status = 'settled',
         resolved_at = now()
   where m.id = v_m.id;

  -- Winners from the pool, then the $10 confirmation fee out of the pot,
  -- then the funder takes the rest. Returns the fee actually banked.
  v_fee := public.payout_market(v_m.id, v_outcome, 10);

  return jsonb_build_object('outcome', v_outcome, 'fee', coalesce(v_fee, 0));
end;
$$;

-- v6 — SETTLE A GLOBAL MARKET FROM ITS SOURCE. The feed poller reads the
-- result from the provider's API (markets.provider + provider_ref) and calls
-- this from the server route, which holds the SERVICE KEY.
--
-- SERVICE ROLE ONLY, enforced by `auth.uid() is null`: the service key sends
-- no end-user JWT, so auth.uid() is null inside it, while EVERY real user —
-- admins included — always has a uid. There is no execute grant for anon or
-- authenticated either (see 7c), so this is belt and braces: without the uid
-- check, an admin could hand-settle a feed market against their own
-- position, and with it, even a leaked anon path could not.
create or replace function public.settle_feed_market(
  p_market_id text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.markets%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'Service role only';
  end if;
  if p_outcome is null or p_outcome not in ('yes', 'no') then
    raise exception 'Invalid outcome';
  end if;

  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;
  if v_m.source = 'callit' then
    raise exception 'Not a feed market';
  end if;
  if v_m.status <> 'open' then
    raise exception 'This market is already resolved';
  end if;

  update public.markets m
     set status = 'resolved',
         resolved_outcome = p_outcome,
         settle_status = 'settled',
         resolved_at = now()
   where m.id = v_m.id;

  -- Same payout path as every other settlement: winners from the pool,
  -- residual + fees to the funder (the platform, for feed markets).
  perform public.payout_market(v_m.id, p_outcome);
end;
$$;

-- ADMIN: update the operator config. Only the knobs; the till
-- (platform_balance/platform_exposure) is never hand-editable.
--
-- v7 — SIGNATURE CHANGED: the single `p_fee_bps` becomes the two halves of
-- the split. Drop the v6 overload — left in place, PostgREST would resolve
-- the admin UI's old 2-arg call to it and write the DEPRECATED `fee_bps`,
-- which nothing reads when a market is created any more. The admin would
-- change the fee, see it "saved", and every new market would keep the old
-- 1% + 1%.
--
-- These values apply to markets created FROM NOW ON. Live markets keep the
-- split they were created with (markets.platform_fee_bps / lp_fee_bps) —
-- retro-cutting an LP's share of a market they already funded is not a knob
-- this product offers.
drop function if exists public.admin_settings_update(numeric, int);

create or replace function public.admin_settings_update(
  p_global_seed numeric,
  p_platform_fee_bps int,
  p_lp_fee_bps int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed numeric := round(coalesce(p_global_seed, 0), 2);
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  -- The seed is real platform money at risk on every traded Global market.
  if v_seed < 1 or v_seed > 10000 then
    raise exception 'Global seed must be between $1 and $10,000';
  end if;
  if p_platform_fee_bps is null or p_platform_fee_bps < 0 or p_platform_fee_bps > 1000 then
    raise exception 'Platform fee must be between 0 and 1000 bps';
  end if;
  if p_lp_fee_bps is null or p_lp_fee_bps < 0 or p_lp_fee_bps > 1000 then
    raise exception 'LP fee must be between 0 and 1000 bps';
  end if;
  -- Cap the TOTAL at 10%: the fee is charged per trade and a runaway value
  -- would quietly confiscate stakes. Capping each half alone would allow 20%.
  if p_platform_fee_bps + p_lp_fee_bps > 1000 then
    raise exception 'Total fee must be at most 1000 bps';
  end if;

  update public.platform_settings s
     set global_seed = v_seed,
         platform_fee_bps = p_platform_fee_bps,
         lp_fee_bps = p_lp_fee_bps,
         -- Keep the deprecated total truthful for any reader still on it.
         fee_bps = p_platform_fee_bps + p_lp_fee_bps,
         updated_at = now()
   where s.id = 1;
end;
$$;

-- v7 — ADMIN: the till + book summary. platform_balance and
-- platform_exposure are NOT readable by end users (see the column grants in
-- 7b), and `select *` on platform_settings now fails for them, so this is
-- how the admin UI reads the operator's numbers.
--
-- SECURITY DEFINER + an is_admin() gate rather than column grants for the
-- admin path: `authenticated` covers admins and end users alike, so there is
-- no role to grant the columns TO. The gate inside the function is the only
-- place the distinction exists.
create or replace function public.admin_platform_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select jsonb_build_object(
    'platform_balance', coalesce(s.platform_balance, 0),
    'platform_exposure', coalesce(s.platform_exposure, 0),
    'open_markets', (
      select count(*) from public.markets m
       where m.status = 'open' and coalesce(m.banned, false) = false
    ),
    'total_collateral', (
      select coalesce(sum(m.collateral), 0) from public.markets m
       where m.status = 'open'
    ),
    'fees_accrued_total', (
      select coalesce(sum(m.fees_accrued), 0) from public.markets m
       where m.status = 'open'
    )
  ) into v_out
  from public.platform_settings s
  where s.id = 1;

  return coalesce(v_out, '{}'::jsonb);
end;
$$;

-- v7 — RECORD WHAT THE CHAIN SAYS ABOUT A DEPOSIT. Called by the server
-- route that holds the SERVICE KEY, after it reads the tx from Etherscan.
--
-- SERVICE ROLE ONLY, enforced by `auth.uid() is null` — the service key
-- sends no end-user JWT, so auth.uid() is null inside it, while every real
-- user (admins included) always has a uid. Same pattern as
-- settle_feed_market.
--
-- THIS FUNCTION NEVER TOUCHES A BALANCE, AND THAT IS THE DESIGN. A confirmed
-- tx to the right address for the right amount still is not proof that the
-- person who typed the hash is the person who sent it — anyone can copy a
-- hash out of a block explorer. Verification is EVIDENCE that makes the
-- admin's decision informed; approve_deposit stays the thing that moves
-- money, and stays human.
create or replace function public.record_deposit_verification(
  p_deposit_id uuid,
  p_verified boolean,
  p_amount numeric,
  p_to text,
  p_confirmations int,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'Service role only';
  end if;

  update public.deposits d
     set verified               = p_verified,
         verified_amount        = p_amount,
         verified_to            = nullif(trim(coalesce(p_to, '')), ''),
         verified_confirmations = p_confirmations,
         verify_error           = nullif(trim(coalesce(p_error, '')), ''),
         verified_at            = now()
   where d.id = p_deposit_id;
  if not found then
    raise exception 'Deposit not found';
  end if;
end;
$$;

-- v8 — PUBLIC PROFILE. Safe, public-by-design fields for /u/<username>
-- pages, readable by ANON. Returns jsonb, or NULL when no (visible) profile
-- matches — banned profiles are hidden (returning them would advertise the
-- ban and keep dead accounts discoverable).
--
-- WHAT IS DELIBERATELY NOT HERE: email, balance, is_admin, banned, user_id
-- (the uuid). `profiles` RLS is own-or-admin, so this SECURITY DEFINER
-- function is the ONLY anon path into the table — its select list IS the
-- privacy boundary; never widen it. `markets_volume` (the lifetime traded
-- volume of the profile's community markets) is the "trivially derivable"
-- public stat: markets are anon-readable anyway, so it leaks nothing.
create or replace function public.public_profile(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'username', p.username,
    'joined_at', p.created_at,
    'markets_created', (
      select count(*) from public.markets m
       where m.creator_id = p.id
         and m.source = 'callit'
         and coalesce(m.banned, false) = false
    ),
    'markets_volume', (
      select coalesce(sum(m.volume), 0) from public.markets m
       where m.creator_id = p.id
         and m.source = 'callit'
         and coalesce(m.banned, false) = false
    )
  )
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(p_username, '')))
    and coalesce(p.banned, false) = false
  limit 1
$$;

-- v8 — A CREATOR'S PUBLIC MARKETS. The non-banned community markets a
-- username has launched, newest first, capped at 100. Readable by ANON
-- (markets are public anyway; the definer part is only the username ->
-- creator_id lookup, which profiles RLS would otherwise block). Banned
-- creators return zero rows, matching public_profile.
create or replace function public.list_creator_markets(p_username text)
returns table (
  id text,
  question text,
  category text,
  yes_price numeric,
  volume numeric,
  status text,
  end_date timestamptz,
  resolved_outcome text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.question, m.category, m.yes_price, m.volume, m.status,
         m.end_date, m.resolved_outcome, m.created_at
    from public.markets m
    join public.profiles p on p.id = m.creator_id
   where lower(p.username) = lower(trim(coalesce(p_username, '')))
     and coalesce(p.banned, false) = false
     and m.source = 'callit'
     and coalesce(m.banned, false) = false
   order by m.created_at desc
   limit 100
$$;

-- v8 — PROOF OF RESERVES. The public trust numbers, readable by EVERYONE
-- including anon. The claim the page makes: `total_collateral` must always
-- be >= `open_liability`, and under the v6 complete-set AMM that is
-- arithmetic, not policy — every share was minted from a complete set, so
-- outstanding(side) = collateral - reserve(side) and the pool always holds
-- the worst case.
--
--   total_collateral — real money sitting in open markets' pools.
--   open_liability   — the MAXIMUM the book could ever owe: for each open
--                      funded market, max(yes_outstanding, no_outstanding)
--                      where outstanding(side) = collateral - reserve(side)
--                      (whichever side wins, that is the payout ceiling).
--   platform_balance — the operator's till. DELIBERATE v8 EXPOSURE of a
--                      number v7 hid: proof-of-reserves is worthless if the
--                      house's own buffer is secret. `platform_exposure`
--                      (risk topology, not solvency) stays admin-only.
--   fees_accrued     — LP fees accrued in open markets (paid at resolution).
--   open_markets     — open, non-banned markets of any source.
--   funded_markets   — the subset actually holding collateral.
create or replace function public.reserves_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_collateral', coalesce((
      select sum(m.collateral) from public.markets m
       where m.status = 'open'
    ), 0),
    'open_liability', coalesce((
      select sum(greatest(
               coalesce(m.collateral, 0) - coalesce(m.yes_reserve, 0),
               coalesce(m.collateral, 0) - coalesce(m.no_reserve, 0),
               0
             ))
        from public.markets m
       where m.status = 'open'
         and coalesce(m.collateral, 0) > 0
         and coalesce(m.yes_reserve, 0) > 0
         and coalesce(m.no_reserve, 0) > 0
    ), 0),
    'platform_balance', coalesce((
      select s.platform_balance from public.platform_settings s where s.id = 1
    ), 0),
    'fees_accrued', coalesce((
      select sum(m.fees_accrued) from public.markets m
       where m.status = 'open'
    ), 0),
    'open_markets', (
      select count(*) from public.markets m
       where m.status = 'open' and coalesce(m.banned, false) = false
    ),
    'funded_markets', (
      select count(*) from public.markets m
       where m.status = 'open'
         and coalesce(m.banned, false) = false
         and coalesce(m.collateral, 0) > 0
    )
  )
$$;

-- ---------------------------------------------------------------------
-- 7b. Lock down the money columns (the point of v5)
-- ---------------------------------------------------------------------
-- With trades settled server-side, nothing in the client needs to write
-- profiles.balance any more — so take the privilege away. `username` is
-- the only column an end user may still update (the profile editor).
-- The RPCs above are SECURITY DEFINER and execute as the function owner,
-- so they are NOT affected by these revokes.
--
-- Column-level UPDATE also makes the old lib/cloud.ts pushMyBalance()
-- fail loudly ('permission denied for table profiles') instead of
-- silently mirroring a forged number — delete it from the client.
revoke update on public.profiles from authenticated, anon;
grant update (username) on public.profiles to authenticated;

-- Same idea for the book: RLS already blocks these (no policy), the
-- revokes make it explicit and survive a policy being re-added by mistake.
--
-- markets keeps its DELETE grant on purpose: the "markets: delete admin"
-- policy above still gates it to admins (grants are per-role, RLS is
-- per-row — the pair is what makes "admins only" expressible). Revoking
-- DELETE here would leave that policy dead and silently break admin
-- market deletion. INSERT/UPDATE have no policy at all, so they are shut.
revoke insert, update on public.markets from authenticated, anon;
revoke insert, update, delete on public.positions from authenticated, anon;
revoke insert, update, delete on public.trades from authenticated, anon;
revoke insert, update, delete on public.community_votes from authenticated, anon;

-- v6 — platform_settings: config is admin-writable, the till is not. The
-- "update admin only" policy gates WHICH ROWS; these grants gate WHICH
-- COLUMNS. Both are needed: with the policy alone an admin could set
-- platform_balance to any number and withdraw it.
revoke insert, update, delete on public.platform_settings from authenticated, anon;
grant update (global_seed, fee_bps, platform_fee_bps, lp_fee_bps) on public.platform_settings to authenticated;

-- v7 — THE TILL IS NOT PUBLIC. Until now `platform_settings` was SELECTable
-- in full by anon, so the operator's balance and exposure were one
-- `select *` away from any visitor. The "readable by all" policy stays (the
-- trade panel needs the fee and the seed for a signed-out visitor), but READ
-- is narrowed to the CONFIG columns.
--
-- HARD BREAK FOR CLIENT CODE: `select('*')` on platform_settings now fails
-- with "permission denied for column platform_balance". Every read must list
-- columns explicitly. lib/cloud.ts already does
-- (`.select('global_seed, fee_bps')`) — keep it that way, and add
-- platform_fee_bps/lp_fee_bps there rather than reaching for `*`. Admins read
-- the till through admin_platform_stats().
revoke select on public.platform_settings from authenticated, anon;
grant select (id, global_seed, fee_bps, platform_fee_bps, lp_fee_bps, updated_at)
  on public.platform_settings to authenticated, anon;

-- v8 — close the client insert path on payments (the policies are dropped in
-- section 5; the revoke makes it explicit and survives a policy re-add).
-- Every deposit/withdrawal is created by its SECURITY DEFINER RPC, which is
-- what makes the withdrawal reserve unskippable.
revoke insert, update, delete on public.deposits from authenticated, anon;
revoke insert, update, delete on public.withdrawals from authenticated, anon;

-- v8 — THE CONFIRM TOKEN IS NOT READABLE BY THE CLIENT. The token proves the
-- requester received the confirmation EMAIL; if the owner's session could
-- `select` it, a hijacked browser could read its own token and self-confirm,
-- which is exactly the attack the email step exists to stop.
--
-- HARD BREAK FOR CLIENT CODE: `select('*')` on withdrawals now fails with
-- "permission denied for column confirm_token". Every read must list columns
-- explicitly — lib/cloud.ts does (WITHDRAWAL_COLUMNS); keep it that way.
revoke select on public.withdrawals from authenticated, anon;
grant select (id, user_id, currency, amount, address, status, confirmed, confirm_sent_at, created_at)
  on public.withdrawals to authenticated;

-- ---------------------------------------------------------------------
-- 7c. Function grants (definer functions are PUBLIC-executable by default)
-- ---------------------------------------------------------------------
revoke all on function public.payout_market(text, text, numeric) from public, anon, authenticated;
revoke all on function public.seed_market_pool(text, numeric, numeric, uuid) from public, anon, authenticated;
revoke all on function public.seed_market_pool_exact(text, numeric, uuid) from public, anon, authenticated;
revoke all on function public.ensure_market(text, text, text, text, text, timestamptz, text, numeric, numeric, numeric, text, text, text, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.place_trade(text, text, numeric) from public, anon;
revoke all on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric) from public, anon;
revoke all on function public.resolve_market_rpc(text, text) from public, anon;
revoke all on function public.ban_market_rpc(text, boolean) from public, anon;
revoke all on function public.community_vote_rpc(text, text) from public, anon;
revoke all on function public.finalize_community_market(text) from public, anon;
revoke all on function public.admin_settings_update(numeric, int, int) from public, anon;
revoke all on function public.admin_platform_stats() from public, anon;

-- settle_feed_market is the ONLY function `authenticated` is denied outright:
-- it settles a real market from the source API and must never be reachable
-- from a browser session, admin or not. The service key is not a role that
-- goes through PostgREST's anon/authenticated split — it runs as
-- `service_role`, so grant it there and nowhere else.
revoke all on function public.settle_feed_market(text, text) from public, anon, authenticated;
grant execute on function public.settle_feed_market(text, text) to service_role;

-- v7 — record_deposit_verification: same shape. No grant to `authenticated`
-- (an end user must never write their own deposit's verification evidence).
--
-- THE GRANT TO service_role IS REQUIRED — the v7 brief said it was not, on
-- the theory that the service key "bypasses grants as the definer". It does
-- not: SECURITY DEFINER changes the role a function EXECUTES AS, not who is
-- allowed to CALL it, and BYPASSRLS does not cover function EXECUTE either.
-- After `revoke all ... from public`, service_role holds no privilege unless
-- it is granted one, and the call would fail with "permission denied for
-- function". settle_feed_market above is the proof: it is the same
-- service-role-only pattern, it carries this exact grant, and it works in
-- production.
revoke all on function public.record_deposit_verification(uuid, boolean, numeric, text, int, text)
  from public, anon, authenticated;
grant execute on function public.record_deposit_verification(uuid, boolean, numeric, text, int, text)
  to service_role;

grant execute on function public.ensure_market(text, text, text, text, text, timestamptz, text, numeric, numeric, numeric, text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.place_trade(text, text, numeric) to authenticated;
grant execute on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric) to authenticated;
grant execute on function public.resolve_market_rpc(text, text) to authenticated;
grant execute on function public.ban_market_rpc(text, boolean) to authenticated;
grant execute on function public.community_vote_rpc(text, text) to authenticated;
grant execute on function public.finalize_community_market(text) to authenticated;
grant execute on function public.admin_settings_update(numeric, int, int) to authenticated;
grant execute on function public.admin_platform_stats() to authenticated;

-- v8 — the three PUBLIC readers are executable by anon ON PURPOSE: public
-- profile pages and the proof-of-reserves page render for signed-out
-- visitors. They expose only the fields their headers whitelist.
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.list_creator_markets(text) to anon, authenticated;
grant execute on function public.reserves_stats() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Backfill + admin bootstrap (runs on every re-run, idempotent)
-- ---------------------------------------------------------------------
-- Any auth user created BEFORE the on_auth_user_created trigger existed
-- has no profile row (invisible in /admin, deposits fail on the FK).
-- Give each one a profile; usernames get a short id suffix so they can
-- never collide with profiles_username_lower_idx.
insert into public.profiles (id, email, username)
select
  u.id,
  u.email,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'caller'
  ) || '_' || left(replace(u.id::text, '-', ''), 4)
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 8b. v7 — fund the pools of the legacy markets that ACTUALLY need it
-- ---------------------------------------------------------------------
-- Open markets created under v1-v5 have no pool (collateral 0, reserves
-- null). The ones that matter are those with POSITIONS already standing on
-- them: users paid real balance for those shares and nothing was ever set
-- aside, so settling them would trip the solvency assert and the market would
-- be stuck open forever. That inherited hole is the audit's actual finding,
-- and the platform assumes it here — explicitly, visibly, and booked into
-- platform_settings.platform_exposure, which is the number the operator must
-- really hold. `funder_id` stays NULL, so the residual returns to the
-- platform as those markets settle.
--
-- TWO v6 BUGS FIXED HERE — this block used to make things worse, not better:
--
-- 1. NO LEGACY FILTER (the expensive one). The v6 WHERE matched EVERY open
--    unfunded market. After any feed sync that is the whole Polymarket +
--    Kalshi board — ~500 rows sitting at collateral = 0 — so re-running the
--    schema had the platform "assume" phantom liability for hundreds of
--    markets nobody had ever traded, and booked ~500 x global_seed of
--    exposure it never actually had at risk. `exists (positions)` is the
--    filter: no positions = no inherited hole = nothing to assume. Those
--    markets must stay unfunded so place_trade() seeds them LAZILY on their
--    first real trade, which is exactly what bounds the platform's downside.
--
-- 2. THE PRICE-BASED SEED BROKE THE INVARIANT IT EXISTED FOR. `seed_market_pool`
--    encodes reserves from PRICE only, so it cannot represent shares that
--    already exist — it produced pools that were insolvent on arrival and
--    unsettleable by every path. Fixed by seeding from the OUTSTANDING SHARES
--    instead; see the seed_market_pool_exact header for the arithmetic and
--    the worked example.
--
-- Idempotent: seed_market_pool_exact no-ops once collateral > 0, and the loop
-- only picks up unfunded rows.
do $$
declare
  r record;
  v_default numeric := coalesce(
    (select s.global_seed from public.platform_settings s where s.id = 1), 25
  );
begin
  for r in
    select m.id
      from public.markets m
     where m.status = 'open'
       and coalesce(m.banned, false) = false
       and (coalesce(m.collateral, 0) <= 0
            or coalesce(m.yes_reserve, 0) <= 0
            or coalesce(m.no_reserve, 0) <= 0)
       -- ONLY markets that already carry shares. See bug 1 above.
       and exists (
         select 1 from public.positions po where po.market_id = m.id
       )
     for update
  loop
    perform public.seed_market_pool_exact(r.id, v_default, null);
  end loop;
end $$;

-- The admin account. This used to be a commented-out hint, so re-running
-- the schema never actually granted anything — hence "Could not load from
-- Supabase" in /admin. It is a plain idempotent update: safe every run,
-- and it works even if the account signs up later (re-run it then).
update public.profiles
   set is_admin = true
 where lower(email) = 'mateusz191009@gmail.com';

-- ---------------------------------------------------------------------
-- v9 — resolved-market lifecycle
-- ---------------------------------------------------------------------

-- Backfill: rows resolved before resolved_at existed get stamped NOW —
-- they receive one full grace window and then leave the feeds. Idempotent.
update public.markets
   set resolved_at = now()
 where status = 'resolved'
   and resolved_at is null;

-- ADMIN: delete resolved markets that are no longer needed.
--   * Deleted outright: resolved > p_days ago AND nothing references them
--     (no trades — receipts/history join on markets for the question — and
--     no leftover positions, which payout should have cleared anyway).
--   * Slimmed instead of deleted: resolved > p_days ago WITH trade history.
--     The row must survive so /portfolio History keeps resolving question
--     titles, but its chart data (price_history — by far the heaviest
--     column) is emptied. Feeds already hide these rows via the grace
--     window, so keeping a slim archive row costs nothing visible.
-- Ballots and chat messages for deleted markets are removed with them
-- (chat_messages.market_id is a plain text column, no FK cascade).
create or replace function public.cleanup_resolved_markets(
  p_days int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := greatest(coalesce(p_days, 30), 2);
  v_deleted int := 0;
  v_slimmed int := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  -- Delete unreferenced, long-resolved markets (+ their ballots).
  with victims as (
    select m.id
      from public.markets m
     where m.status = 'resolved'
       and m.resolved_at is not null
       and m.resolved_at < now() - make_interval(days => v_days)
       and not exists (select 1 from public.trades t where t.market_id = m.id)
       and not exists (select 1 from public.positions po where po.market_id = m.id)
  ),
  purged_votes as (
    delete from public.community_votes cv
     where cv.market_id in (select id from victims)
  ),
  purged_chat as (
    delete from public.chat_messages ch
     where ch.market_id in (select id from victims)
  ),
  purged as (
    delete from public.markets m
     where m.id in (select id from victims)
    returning 1
  )
  select count(*) into v_deleted from purged;

  -- Slim the rest of the old resolved rows (keep them for history joins).
  with slimmed as (
    update public.markets m
       set price_history = '[]'::jsonb
     where m.status = 'resolved'
       and m.resolved_at is not null
       and m.resolved_at < now() - make_interval(days => v_days)
       and m.price_history <> '[]'::jsonb
    returning 1
  )
  select count(*) into v_slimmed from slimmed;

  return jsonb_build_object('deleted', v_deleted, 'slimmed', v_slimmed);
end;
$$;

revoke all on function public.cleanup_resolved_markets(int) from public, anon;
grant execute on function public.cleanup_resolved_markets(int) to authenticated;

-- ---------------------------------------------------------------------
-- v9 — PLATFORM CASH-OUT
-- ---------------------------------------------------------------------
-- The operator withdrawing their own earnings. The DB side is BOOKKEEPING
-- ONLY: it deducts from platform_settings.platform_balance and writes an
-- audit row — the actual crypto payout is the operator moving funds out of
-- wallets they already control, nothing here touches user money. Keeping
-- the till honest matters because /reserves publishes platform_balance:
-- cash out here and the public number drops with it, as it should.

-- Audit trail. RLS on with NO policies = invisible through the API for
-- every role; only the SECURITY DEFINER function below writes to it.
create table if not exists public.platform_cashouts (
  id uuid primary key default gen_random_uuid(),
  amount numeric not null check (amount > 0),
  balance_after numeric not null,
  created_at timestamptz not null default now()
);
alter table public.platform_cashouts enable row level security;

-- ADMIN: deduct p_amount from the till and log it. Raises on a
-- non-positive amount or one exceeding the balance. The FOR UPDATE lock
-- serializes concurrent cash-outs against the singleton settings row.
create or replace function public.admin_platform_cashout(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amt numeric := round(coalesce(p_amount, 0), 2);
  v_bal numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if v_amt <= 0 then
    raise exception 'Amount must be positive';
  end if;

  select s.platform_balance into v_bal
    from public.platform_settings s
   where s.id = 1
     for update;

  if coalesce(v_bal, 0) < v_amt then
    raise exception 'Amount exceeds the platform balance';
  end if;

  update public.platform_settings s
     set platform_balance = round(s.platform_balance - v_amt, 2),
         updated_at = now()
   where s.id = 1
  returning s.platform_balance into v_bal;

  insert into public.platform_cashouts (amount, balance_after)
  values (v_amt, v_bal);

  return jsonb_build_object('cashed_out', v_amt, 'new_balance', v_bal);
end;
$$;

revoke all on function public.admin_platform_cashout(numeric) from public, anon;
grant execute on function public.admin_platform_cashout(numeric) to authenticated;
