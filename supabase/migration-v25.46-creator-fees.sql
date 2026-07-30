-- ---------------------------------------------------------------------
-- v25.46 — THE CREATOR'S HALF OF THE FEE, VISIBLE AND CLAIMABLE
--          (+ the create-a-market regression that shipped in v25.43)
-- ---------------------------------------------------------------------
--
-- WHAT THIS FIXES, IN ORDER OF HOW MUCH IT COSTS TODAY.
--
-- 1. `create_market_rpc` HAS BEEN THROWING SINCE v25.43. The insert names 22
--    target columns and passes 23 values — `icon` was dropped from the column
--    list when the opening price-history point was added, and its value was
--    left in place. Postgres does not catch that at CREATE FUNCTION time (the
--    plpgsql validator syntax-checks the body but does not parse-analyse the
--    SQL inside it), so the migration applied cleanly and every attempt to
--    launch a single community market since then dies with
--
--        INSERT has more expressions than target columns
--
--    `create_event_rpc` kept its `icon` column and is unaffected — multi-
--    outcome events still work, single markets do not. This file restores the
--    column. Nothing else in that function changes.
--
-- 2. THE CREATOR'S FEE WAS REAL BUT UNREACHABLE. The split works exactly as
--    designed — `place_trade` banks the platform's slice into
--    `platform_settings.platform_balance` at trade time and accrues the LP's
--    slice into `markets.fees_accrued` — but for a COMMUNITY market the LP is
--    the creator, and `fees_accrued` only ever becomes money in
--    `payout_market()`, i.e. at resolution. Community markets resolve one way:
--    an admin confirms the community vote. Until they do:
--
--      - the creator cannot see a cent of what their market earned (nothing
--        in the app reads `fees_accrued` except the ADMIN revenue panel and
--        the aggregate on /reserves), and
--      - `finalize_community_market` REFUSES to settle a market with no
--        majority or no votes at all, so a market nobody voted on holds the
--        creator's fees for as long as that stays true. There is no timeout
--        and no fallback path.
--
--    So this adds the missing half: `creator_earnings()` to see it and
--    `claim_creator_fees()` to take it, at any time, without waiting for a
--    resolution that may never come.
--
-- WHY CLAIMING EARLY IS SAFE — the solvency argument, in full. A trade debits
-- the trader `A` and splits it three ways: `A_net` becomes pool COLLATERAL,
-- the platform slice becomes platform_balance, and the LP slice becomes a
-- NUMBER IN `fees_accrued` that is credited to nobody. It never entered
-- `collateral`, so the pool's payout ceiling does not depend on it:
-- `outstanding(side) = collateral - reserve(side)` is untouched by paying it
-- out. Claiming moves already-earned revenue from an unassigned counter into
-- the creator's balance and changes no other number — the seed stays locked
-- in the pool, and the residual is still settled at resolution as before.
--
-- SAFE TO RE-RUN. One `add column if not exists`, four `create or replace`s.
-- No table is rewritten, no money moves.

-- 1. ------------------------------------------------------------------
-- Lifetime counter, so a creator can see what a market has ALREADY paid
-- them and not just what is still owed. Bumped by claim_creator_fees()
-- below and by payout_market() when a settlement hands the funder their
-- fees. Purely informational: nothing reads it to decide a payment.
alter table public.markets
  add column if not exists fees_claimed numeric not null default 0;

-- 2. ------------------------------------------------------------------
-- THE v25.43 REGRESSION. Identical to the shipped function except that
-- `icon` is back in the column list, where the value has been all along.
create or replace function public.create_market_rpc(
  p_id text,
  p_question text,
  p_description text,
  p_category text,
  p_end_date timestamptz,
  p_resolution text,
  p_seed numeric,
  p_icon text default null
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
  if v_id like 'pm-%' or v_id like 'cl-%' or v_id like 'ce-%' then
    raise exception 'Reserved market id';
  end if;
  if v_question = '' then
    raise exception 'Question is required';
  end if;
  if p_end_date is null then
    raise exception 'End date is required';
  end if;
  if p_end_date <= now() then
    raise exception 'End date must be in the future';
  end if;
  if p_resolution is null or p_resolution <> 'community' then
    raise exception 'Only community resolution is available';
  end if;
  if exists (select 1 from public.markets m where m.id = v_id) then
    raise exception 'Market already exists';
  end if;
  if v_seed < 10 then
    raise exception 'Seed liquidity must be at least $10';
  end if;
  if v_seed > 10000 then
    raise exception 'Seed liquidity cannot exceed $10,000';
  end if;

  select coalesce(s.platform_fee_bps, 100), coalesce(s.lp_fee_bps, 100)
    into v_pf_bps, v_lp_bps
    from public.platform_settings s where s.id = 1;
  v_pf_bps := coalesce(v_pf_bps, 100);
  v_lp_bps := coalesce(v_lp_bps, 100);
  v_fee_bps := v_pf_bps + v_lp_bps;

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
    in_play_ok, source_closed, settle_status, icon
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
    -- v25.43 — the chart STARTS where the market opened; `place_trade` only
    -- ever appends the POST-fill price.
    jsonb_build_array(jsonb_build_object(
      't', (extract(epoch from now()) * 1000)::bigint,
      'yes', 0.5
    )),
    'callit',
    v_fee_bps,
    v_pf_bps,
    v_lp_bps,
    false,
    false,
    'none',
    nullif(trim(coalesce(p_icon, '')), '')
  );

  perform public.seed_market_pool(v_id, 0.5, v_seed, v_uid);

  return v_id;
end;
$$;

-- 3. ------------------------------------------------------------------
-- payout_market: unchanged money, one new counter.
--
-- The only difference from the shipped v8 function is `v_fee_to_funder` and
-- the `fees_claimed` line in the final update. Every payment, every assert
-- and every zeroing is byte-for-byte what it was — the counter exists so
-- "you have earned $X as a creator" stays true for markets that settled
-- normally instead of being claimed by hand.
--
-- ATTRIBUTION: the confirmation fee comes out of a pot that is
-- `residual + fees`, and it is charged against the RESIDUAL first. So the
-- funder's fee portion is the whole `fees_accrued` unless the take ate into
-- it, which only happens once the residual is already gone.
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
  v_fee_to_funder numeric := 0;
begin
  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;

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

  if v_paid > coalesce(v_m.collateral, 0) + 0.01 then
    raise exception
      'Insolvent market % — payout % exceeds collateral %',
      p_market_id, v_paid, coalesce(v_m.collateral, 0);
  end if;

  v_fees := coalesce(v_m.fees_accrued, 0);
  v_residual := greatest(round(coalesce(v_m.collateral, 0) - v_paid, 2), 0);

  v_pot := round(v_residual + v_fees, 2);
  v_take := least(greatest(round(coalesce(p_platform_fee, 0), 2), 0), v_pot);

  if v_m.funder_id is not null then
    -- What of the pot the funder is about to receive was FEE rather than
    -- returned seed. Reported only; the payment below is the same v_pot -
    -- v_take it has always been.
    v_fee_to_funder := greatest(least(v_fees, round(v_pot - v_take, 2)), 0);
    update public.profiles p
       set balance = round(p.balance + v_pot - v_take, 2)
     where p.id = v_m.funder_id;
    if v_take > 0 then
      update public.platform_settings s
         set platform_balance = round(s.platform_balance + v_take, 2)
       where s.id = 1;
    end if;
  else
    update public.platform_settings s
       set platform_balance  = round(s.platform_balance + v_pot, 2),
           platform_exposure = greatest(round(s.platform_exposure - coalesce(v_m.seed, 0), 2), 0)
     where s.id = 1;
  end if;

  update public.markets m
     set collateral   = 0,
         fees_accrued = 0,
         fees_claimed = round(coalesce(m.fees_claimed, 0) + v_fee_to_funder, 2),
         yes_reserve  = 0,
         no_reserve   = 0,
         seed         = 0,
         liquidity    = 0
   where m.id = p_market_id;

  delete from public.positions po where po.market_id = p_market_id;

  return v_take;
end;
$$;

-- 4. ------------------------------------------------------------------
-- THE CREATOR'S OWN LEDGER. Everything the "Earnings" tab renders, in one
-- read: the markets this user is the LP of, what each has accrued, what has
-- already been paid out, and the totals.
--
-- OWN ROWS ONLY — `funder_id = auth.uid()` is the whole filter, and it is the
-- LP relationship rather than `creator_id` on purpose: the fee follows the
-- money that backs the pool. For every market this product can create they
-- are the same person (create_market_rpc seeds with the creator as funder).
--
-- `claimable` deliberately includes markets that have ENDED and are waiting
-- for the admin confirmation. That wait is exactly the case this feature
-- exists for: the fee was earned while the market traded, and nothing about
-- confirming a vote changes how much of it there is.
create or replace function public.creator_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_markets jsonb;
  v_claimable numeric := 0;
  v_claimed numeric := 0;
  v_locked numeric := 0;
  v_volume numeric := 0;
  v_count int := 0;
  v_lp_bps int;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- The rate NEW markets are created with, for the "you earn x% of every
  -- trade" line. A live market's own rate travels on its row below.
  select coalesce(s.lp_fee_bps, 100) into v_lp_bps
    from public.platform_settings s where s.id = 1;
  v_lp_bps := coalesce(v_lp_bps, 100);

  select
    coalesce(sum(
      case when m.status = 'open' and not coalesce(m.banned, false)
           then coalesce(m.fees_accrued, 0) else 0 end), 0),
    coalesce(sum(coalesce(m.fees_claimed, 0)), 0),
    coalesce(sum(
      case when m.status = 'open' then coalesce(m.collateral, 0) else 0 end), 0),
    coalesce(sum(coalesce(m.volume, 0)), 0),
    count(*)
    into v_claimable, v_claimed, v_locked, v_volume, v_count
    from public.markets m
   where m.funder_id = v_uid;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',              x.id,
               'question',        x.question,
               'eventTitle',      x.event_title,
               'shortName',       x.short_name,
               'icon',            x.icon,
               'category',        x.category,
               'status',          x.status,
               'banned',          coalesce(x.banned, false),
               'endDate',         x.end_date,
               'createdAt',       x.created_at,
               'resolvedOutcome', x.resolved_outcome,
               'volume',          coalesce(x.volume, 0),
               'seed',            coalesce(x.seed, 0),
               'collateral',      coalesce(x.collateral, 0),
               'feesAccrued',     coalesce(x.fees_accrued, 0),
               'feesClaimed',     coalesce(x.fees_claimed, 0),
               'lpFeeBps',        coalesce(x.lp_fee_bps, coalesce(x.fee_bps, 200))
             )
             order by x.created_at desc
           ),
           '[]'::jsonb
         )
    into v_markets
    from (
      select m.*
        from public.markets m
       where m.funder_id = v_uid
       order by m.created_at desc
       limit 200
    ) x;

  return jsonb_build_object(
    'claimable', round(v_claimable, 2),
    'claimed',   round(v_claimed, 2),
    'locked',    round(v_locked, 2),
    'volume',    round(v_volume, 2),
    'markets',   coalesce(v_markets, '[]'::jsonb),
    'marketCount', v_count,
    'lpFeeBps',  v_lp_bps
  );
end;
$$;

-- 5. ------------------------------------------------------------------
-- TAKE THE FEES. One market when `p_market_id` is given, every eligible one
-- when it is null ("Claim all").
--
-- THE RACE, AND WHY THE LOOP RE-READS. Read-then-write across two statements
-- is how a claim gets paid twice: two concurrent calls both read $4.10 and
-- both credit it. So each market is re-read `for update` INSIDE the loop —
-- under READ COMMITTED that blocks on the other transaction's row lock and
-- then sees its committed result, which is 0. The amount paid is therefore
-- always the amount zeroed, in one atomic step per market.
--
-- The subtraction is written as `fees_accrued - v_amount` rather than `= 0`
-- for the same reason: a trade that lands between the read and the write
-- must keep its accrual, not have it silently dropped.
create or replace function public.claim_creator_fees(p_market_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := nullif(trim(coalesce(p_market_id, '')), '');
  v_row record;
  v_amount numeric;
  v_total numeric := 0;
  v_count int := 0;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;

  -- Naming a market you are not the LP of is a mistake worth reporting.
  -- (Claim-all simply finds nothing and returns zero.)
  if v_id is not null then
    if not exists (select 1 from public.markets m where m.id = v_id) then
      raise exception 'Market not found';
    end if;
    if not exists (
      select 1 from public.markets m where m.id = v_id and m.funder_id = v_uid
    ) then
      raise exception 'You did not fund this market';
    end if;
  end if;

  for v_row in
    select m.id
      from public.markets m
     where m.funder_id = v_uid
       and m.status = 'open'
       and not coalesce(m.banned, false)
       and coalesce(m.fees_accrued, 0) > 0
       and (v_id is null or m.id = v_id)
     order by m.id
  loop
    select round(coalesce(m.fees_accrued, 0), 2) into v_amount
      from public.markets m
     where m.id = v_row.id
       -- Re-check the gates under the lock: a market can be banned or
       -- resolved between the scan and the claim, and both of those paths
       -- pay the funder themselves.
       and m.status = 'open'
       and not coalesce(m.banned, false)
       for update;
    if not found or v_amount is null or v_amount <= 0 then
      continue;
    end if;

    update public.markets m
       set fees_accrued = round(coalesce(m.fees_accrued, 0) - v_amount, 2),
           fees_claimed = round(coalesce(m.fees_claimed, 0) + v_amount, 2)
     where m.id = v_row.id;

    v_total := round(v_total + v_amount, 2);
    v_count := v_count + 1;
  end loop;

  if v_total > 0 then
    update public.profiles p
       set balance = round(p.balance + v_total, 2)
     where p.id = v_uid
    returning p.balance into v_balance;
  else
    select p.balance into v_balance from public.profiles p where p.id = v_uid;
  end if;

  return jsonb_build_object(
    'claimed', v_total,
    'markets', v_count,
    'balance', coalesce(v_balance, 0)
  );
end;
$$;

-- 6. ------------------------------------------------------------------
-- Grants. Both are own-rows-only and signed-in-only; anon has no business
-- with either.
revoke all on function public.creator_earnings() from public, anon;
grant execute on function public.creator_earnings() to authenticated;

revoke all on function public.claim_creator_fees(text) from public, anon;
grant execute on function public.claim_creator_fees(text) to authenticated;

-- create_market_rpc / payout_market were replaced in place, so their existing
-- grants survive. Re-issued anyway — this file must work on a database where
-- the v25.43 migration was never applied.
grant execute on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric, text) to authenticated;
