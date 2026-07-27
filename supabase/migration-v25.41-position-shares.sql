-- ============================================================================
-- v25.41 — SHARE A POSITION, not just a single fill
--
-- Paste this whole file into the Supabase SQL editor. Idempotent, safe to
-- re-run, and requires v25.40 (migration-v25.40-sharing.sql) first. The same
-- statements also live in supabase/schema.sql.
--
-- WHY. v25.40 could share one FILL. But a position is often several: people
-- add to a call as it moves, and sharing "the newest fill" then understates
-- the stake and misstates the entry. A shared position has to be the
-- aggregate — total staked, total shares, the blended entry price.
--
-- WHY IT RESOLVES FROM `trades` AND NOT FROM `positions`. Payout DELETES the
-- position rows (see payout_market). Resolving a share against that table
-- would mean every shared position link goes dead at settlement — exactly the
-- moment the link is worth opening, because that is when it says whether the
-- call came in. `trades` is the immutable fill log, so a share built on it
-- keeps working forever and can still show a settled result.
--
-- The privacy boundary is unchanged: one market, one side, one user's own
-- aggregate. Still no user id, no balance, no other position.
-- ============================================================================

/* ------------------------------------------------------------------ */
/* 1. bet_shares learns a second shape                                 */
/* ------------------------------------------------------------------ */

alter table public.bet_shares alter column trade_id drop not null;
alter table public.bet_shares add column if not exists market_id text;
alter table public.bet_shares add column if not exists side text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bet_shares_side_check') then
    alter table public.bet_shares
      add constraint bet_shares_side_check check (side is null or side in ('yes', 'no'));
  end if;
  -- EXACTLY ONE SHAPE PER ROW. A row is either a fill share (trade_id) or a
  -- position share (market_id + side); a half-populated row would make
  -- public_bet_share's branch ambiguous, so the database refuses to store one.
  if not exists (select 1 from pg_constraint where conname = 'bet_shares_shape_check') then
    alter table public.bet_shares
      add constraint bet_shares_shape_check check (
        (trade_id is not null and market_id is null and side is null)
        or (trade_id is null and market_id is not null and side is not null)
      );
  end if;
end $$;

-- One token per position, forever — the same idempotence the fill share has.
-- Partial: fill-share rows have a null market_id and must not collide.
create unique index if not exists bet_shares_position_idx
  on public.bet_shares (user_id, market_id, side)
  where trade_id is null;

/* ------------------------------------------------------------------ */
/* 2. create_position_share                                            */
/* ------------------------------------------------------------------ */

-- Mint (or re-return) the token for one of the CALLER's own positions.
-- Existence is checked against the FILL LOG, not `positions`, for the reason
-- in the header: a settled position has no row in the latter but is still a
-- perfectly good thing to have shared.
create or replace function public.create_position_share(
  p_market_id text,
  p_side text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_side  text := lower(trim(coalesce(p_side, '')));
  v_token text;
  v_try   int := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to share a position';
  end if;

  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'Account suspended';
  end if;

  if v_side not in ('yes', 'no') then
    raise exception 'Invalid side';
  end if;

  if not exists (
    select 1 from public.trades t
     where t.user_id = v_uid
       and t.market_id = p_market_id
       and t.side = v_side
  ) then
    raise exception 'No such position';
  end if;

  select bs.token into v_token
    from public.bet_shares bs
   where bs.user_id = v_uid
     and bs.market_id = p_market_id
     and bs.side = v_side
     and bs.trade_id is null;
  if v_token is not null then
    return v_token;
  end if;

  loop
    v_try := v_try + 1;
    -- Same token shape as create_bet_share; see the note there.
    v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
            || substr(replace(gen_random_uuid()::text, '-', ''), 21, 8);
    begin
      insert into public.bet_shares (token, trade_id, user_id, market_id, side)
      values (v_token, null, v_uid, p_market_id, v_side);
      return v_token;
    exception when unique_violation then
      select bs.token into v_token
        from public.bet_shares bs
       where bs.user_id = v_uid
         and bs.market_id = p_market_id
         and bs.side = v_side
         and bs.trade_id is null;
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
/* 3. public_bet_share — one reader, both shapes                       */
/* ------------------------------------------------------------------ */

-- Replaces the v25.40 body. Both shapes now come out of the SAME aggregate
-- over `trades`, which is why a fill share keeps behaving exactly as before:
-- it just aggregates over a single row.
--
-- `avg_price` is recomputed as (staked - fees) / shares rather than read from
-- `trades.price`. For a single v6 fill that IS `price` by definition; for a
-- multi-fill position it is the blended entry, which is the only honest thing
-- to print on a slip that shows one number.
--
-- Still anon-readable, still zero rows for a banned user or market.
create or replace function public.public_bet_share(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select bs.token,
           bs.user_id,
           bs.trade_id,
           bs.trade_id is null                  as is_position,
           coalesce(bs.market_id, t0.market_id) as market_id,
           coalesce(bs.side, t0.side)           as side
      from public.bet_shares bs
      left join public.trades t0 on t0.id = bs.trade_id
     where bs.token = trim(coalesce(p_token, ''))
     limit 1
  ),
  agg as (
    select s.token,
           s.user_id,
           s.is_position,
           s.market_id,
           s.side,
           sum(t.amount)                      as stake,
           sum(t.shares)                      as shares,
           sum(t.amount - coalesce(t.fee, 0)) as net,
           min(t.created_at)                  as opened_at,
           count(*)::int                      as fills
      from s
      join public.trades t
        on t.user_id = s.user_id
       and (
             (s.is_position and t.market_id = s.market_id and t.side = s.side)
          or (not s.is_position and t.id = s.trade_id)
           )
     group by s.token, s.user_id, s.is_position, s.market_id, s.side
  )
  select jsonb_build_object(
    'token',            a.token,
    'is_position',      a.is_position,
    'fills',            a.fills,
    'username',         p.username,
    'placed_at',        a.opened_at,
    'market_id',        a.market_id,
    'question',         m.question,
    'icon',             m.icon,
    'category',         m.category,
    'source',           m.source,
    'yes_label',        m.yes_label,
    'no_label',         m.no_label,
    'end_date',         m.end_date,
    'side',             a.side,
    'stake',            round(a.stake, 2),
    'shares',           round(a.shares, 6),
    'avg_price',        case when a.shares > 0 then round(a.net / a.shares, 6) else 0 end,
    'market_status',    m.status,
    'resolved_outcome', m.resolved_outcome,
    'yes_price',        coalesce(m.feed_price, m.yes_price)
  )
    from agg a
    join public.profiles p on p.id = a.user_id
    left join public.markets m on m.id = a.market_id
   where coalesce(p.banned, false) = false
     and coalesce(m.banned, false) = false
   limit 1
$$;

/* ------------------------------------------------------------------ */
/* 4. Grants                                                           */
/* ------------------------------------------------------------------ */

revoke all on function public.create_position_share(text, text) from public, anon;
grant execute on function public.create_position_share(text, text) to authenticated;
grant execute on function public.public_bet_share(text) to anon, authenticated;
