-- ============================================================================
-- v25.40 — SHARING: shareable bet slips + public betting stats
--
-- Paste this whole file into the Supabase SQL editor. It is idempotent and
-- safe to re-run. The same statements also live in supabase/schema.sql; this
-- file exists so an already-deployed project can be brought up without a full
-- schema re-run.
--
-- WHAT IT ADDS
--   1. `bet_shares`         — one short token per fill, minted on demand.
--   2. `create_bet_share()` — the owner of a fill mints/returns its token.
--   3. `public_bet_share()` — anon-readable, the token's PUBLIC projection.
--   4. `public_profile()`   — extended with betting aggregates.
--
-- THE PRIVACY BOUNDARY IS THE SELECT LIST, exactly as in v8. A share token
-- exposes ONE fill (stake, side, shares, average price) and the market it was
-- placed on — never a user id, never an email, never a balance, never the
-- rest of the portfolio. `public_profile` stays aggregate-only: counts, sums
-- and one ratio, no market ids and no individual positions.
--
-- WHY A TABLE AND NOT AN ENCODED LINK. A bet slip is a claim about what
-- somebody did with real money. If the numbers ride in the URL, anybody can
-- author a 100x winner and it renders identically — so the server holds the
-- mapping and the page reads the fill log. A share link is a pointer, never a
-- payload.
-- ============================================================================

/* ------------------------------------------------------------------ */
/* 0. Prerequisite                                                     */
/* ------------------------------------------------------------------ */

-- `public_bet_share()` reads `markets.feed_price`, which arrived in v25.22.
-- A SQL function body is validated at CREATE time, so on a project that
-- skipped that migration this whole file would fail on section 3 — and the
-- error would point at the wrong version. Declaring the column here is
-- idempotent and costs nothing when v25.22 has already run.
alter table public.markets add column if not exists feed_price numeric;

/* ------------------------------------------------------------------ */
/* 1. bet_shares                                                       */
/* ------------------------------------------------------------------ */

create table if not exists public.bet_shares (
  token      text primary key,
  trade_id   uuid not null references public.trades (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One token per fill, forever: re-sharing the same bet must return the link
-- that was already sent, not mint a second one (and never invalidate it).
create unique index if not exists bet_shares_trade_idx
  on public.bet_shares (trade_id);

create index if not exists bet_shares_user_idx
  on public.bet_shares (user_id, created_at desc);

alter table public.bet_shares enable row level security;

-- DELIBERATELY NO POLICIES. RLS-on with zero policies denies every direct
-- read and write; the table is reachable only through the two security-definer
-- functions below, which is what keeps "list every share token" off the table
-- while `public_bet_share(token)` stays open to anon.
revoke all on public.bet_shares from anon, authenticated;

/* ------------------------------------------------------------------ */
/* 2. create_bet_share — mint (or re-return) a fill's token             */
/* ------------------------------------------------------------------ */

-- Callable by the signed-in owner of the fill and nobody else.
--
-- Three ways to name the bet, in order of precedence:
--   p_trade_id  — a specific fill (the receipt list passes this),
--   p_market_id — the caller's NEWEST fill on that market (what the trade
--                 panel has right after a buy: `place_trade` returns the fill,
--                 not its id),
--   neither     — the caller's newest fill overall.
--
-- Always the CALLER's own row: the `user_id = auth.uid()` filter is inside
-- every branch, so passing somebody else's trade id finds nothing.
create or replace function public.create_bet_share(
  p_trade_id uuid default null,
  p_market_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_token text;
  v_try   int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to share a bet';
  end if;

  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'Account suspended';
  end if;

  if p_trade_id is not null then
    select * into v_trade
      from public.trades t
     where t.id = p_trade_id
       and t.user_id = v_uid;
  elsif p_market_id is not null then
    select * into v_trade
      from public.trades t
     where t.user_id = v_uid
       and t.market_id = p_market_id
     order by t.created_at desc, t.id desc
     limit 1;
  else
    select * into v_trade
      from public.trades t
     where t.user_id = v_uid
     order by t.created_at desc, t.id desc
     limit 1;
  end if;

  if not found then
    raise exception 'No such bet';
  end if;

  select bs.token into v_token
    from public.bet_shares bs
   where bs.trade_id = v_trade.id;
  if v_token is not null then
    return v_token;
  end if;

  loop
    v_try := v_try + 1;
    -- 16 hex chars (~64 bits) from two v4 uuids. Two, and offset 21 for the
    -- second half, so no slice lands on a uuid's fixed version/variant
    -- nibbles. gen_random_uuid() is core in PG13+, so this needs no pgcrypto
    -- (which `set search_path = public` would not resolve anyway).
    v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
            || substr(replace(gen_random_uuid()::text, '-', ''), 21, 8);
    begin
      insert into public.bet_shares (token, trade_id, user_id)
      values (v_token, v_trade.id, v_uid);
      return v_token;
    exception when unique_violation then
      -- Either a token collision (vanishingly rare) or a concurrent share of
      -- this same fill. Re-read: if the fill has a token now, that IS the
      -- answer — the function is idempotent per fill.
      select bs.token into v_token
        from public.bet_shares bs
       where bs.trade_id = v_trade.id;
      if v_token is not null then
        return v_token;
      end if;
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

/* ------------------------------------------------------------------ */
/* 3. public_bet_share — what a share link is allowed to show           */
/* ------------------------------------------------------------------ */

-- ANON-readable by design: the whole point is that the recipient does not
-- need an account. The select list below IS the privacy boundary — adding a
-- column here publishes it to anyone holding the link.
--
-- `yes_price` is the market's CURRENT price so the slip can show what the
-- call is worth now: `feed_price` (the source's own opinion, refreshed on the
-- 60s beat) for a feed market, the pool's `yes_price` for a community one.
--
-- Banned user or banned market -> zero rows, matching public_profile: a
-- share link is never a way around a ban.
create or replace function public.public_bet_share(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'token',            bs.token,
    'username',         p.username,
    'placed_at',        t.created_at,
    'market_id',        t.market_id,
    'question',         m.question,
    'icon',             m.icon,
    'category',         m.category,
    'source',           m.source,
    'yes_label',        m.yes_label,
    'no_label',         m.no_label,
    'end_date',         m.end_date,
    'side',             t.side,
    'stake',            t.amount,
    'shares',           t.shares,
    'avg_price',        t.price,
    'market_status',    m.status,
    'resolved_outcome', m.resolved_outcome,
    'yes_price',        coalesce(m.feed_price, m.yes_price)
  )
    from public.bet_shares bs
    join public.trades t   on t.id = bs.trade_id
    join public.profiles p on p.id = bs.user_id
    left join public.markets m on m.id = t.market_id
   where bs.token = trim(coalesce(p_token, ''))
     and coalesce(p.banned, false) = false
     and coalesce(m.banned, false) = false
   limit 1
$$;

/* ------------------------------------------------------------------ */
/* 4. public_profile — plus betting aggregates                          */
/* ------------------------------------------------------------------ */

-- v25.40 adds five numbers to the v8 projection. They are AGGREGATES ONLY:
--
--   bets_placed   — fills, all time.
--   bets_resolved — fills whose market settled with a winner. Voided markets
--                   are excluded from BOTH sides of the ratio: the question
--                   was cancelled and the stake refunded, so counting it as a
--                   loss would be a lie about the user's record.
--   bets_won      — fills whose side won.
--   volume_traded — gross staked, all time.
--   best_multiple — the largest payout-per-dollar on a winning fill
--                   (shares / stake). "My best call was 6.4x".
--
-- No market ids, no individual stakes, no open positions, no balance. The
-- `trades_user_idx (user_id, created_at desc)` index covers the scan.
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
    ),
    'bets_placed',   s.bets_placed,
    'bets_resolved', s.bets_resolved,
    'bets_won',      s.bets_won,
    'volume_traded', s.volume_traded,
    'best_multiple', s.best_multiple
  )
  from public.profiles p
  cross join lateral (
    select
      count(t.id)::int as bets_placed,
      count(t.id) filter (
        where m.status = 'resolved'
          and m.resolved_outcome in ('yes', 'no')
      )::int as bets_resolved,
      count(t.id) filter (
        where m.status = 'resolved'
          and m.resolved_outcome = t.side
      )::int as bets_won,
      coalesce(round(sum(t.amount), 2), 0) as volume_traded,
      coalesce(
        round(
          max(t.shares / nullif(t.amount, 0)) filter (
            where m.status = 'resolved'
              and m.resolved_outcome = t.side
          ),
          2
        ),
        0
      ) as best_multiple
    from public.trades t
    left join public.markets m on m.id = t.market_id
   where t.user_id = p.id
  ) s
  where lower(p.username) = lower(trim(coalesce(p_username, '')))
    and coalesce(p.banned, false) = false
  limit 1
$$;

/* ------------------------------------------------------------------ */
/* 5. Grants                                                            */
/* ------------------------------------------------------------------ */

-- Minting a share needs an account; reading one deliberately does not.
revoke all on function public.create_bet_share(uuid, text) from public, anon;
grant execute on function public.create_bet_share(uuid, text) to authenticated;

grant execute on function public.public_bet_share(text) to anon, authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
