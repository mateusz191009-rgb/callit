-- ==================================================================
-- callit v25.22 — THE POOL FOLLOWS THE LIVE ODDS
-- ==================================================================
--
-- Run this once in the Supabase SQL editor (it is also folded into
-- supabase/schema.sql, so a fresh project gets it automatically).
-- Re-runnable: every statement is idempotent.
--
-- THE BUG (Mets 8-3 Dodgers, bot 8th, 2026-07-26). The panel quoted
-- "New York Mets 97c" and previewed the fill at 64c: 15.53 shares and
-- +55.3% return for buying a side the feed prices at 97c. The trade would
-- really have filled there — the preview was honest about the pool and the
-- BUTTON was the lie.
--
-- WHY. Two prices, one market:
--   * the DISPLAYED price is the live feed's (Polymarket/Kalshi), refreshed
--     every 60s and at bet time by /api/quote,
--   * the FILL price is our FPMM pool's, and since v6 the pool owns its own
--     price: `seed_market_pool` opens it at the feed price on the FIRST
--     trade and nothing ever moves it again except our own fills.
-- Seed that pool pre-game at 44c, let the game run to 8-3, and the feed is
-- at 3c while the pool still sits at 44c. Everything downstream was
-- correct — the pool had simply stopped tracking reality.
--
-- That is not a display bug, it is a hole in the till: the winning side is
-- on sale at a 33c discount for as long as nobody re-prices the curve, and
-- an in-play market is exactly where somebody is watching.
--
-- THE FIX. `anchor_pool_to()` — move a funded feed pool's reserves onto the
-- feed's price, and run it (a) on every sync beat for every funded feed
-- market and (b) inside `place_trade` immediately before the fill, off the
-- freshest price we hold. The feed's price now lives in its own column
-- (`markets.feed_price`) so the v6 rule stands untouched: the feed still
-- never writes `yes_price`/`volume`/`liquidity` over a funded pool — it
-- states an opinion in its own column, and the anchor is what acts on it.
--
-- WHY IT CANNOT MINT UNBACKED SHARES — the whole reason this is a function
-- and not an UPDATE. Solvency in v6 rests on `outstanding(side) <=
-- collateral - reserve(side)`: whoever wins, the pool holds their dollar.
-- Moving a price means moving reserves, and growing a reserve past
-- `collateral - outstanding` would hand out shares nothing backs — the v5
-- insolvency, re-opened. So the anchor reads the REAL outstanding shares
-- (sum over `positions`, which is what `payout_market` actually pays) and
-- treats `collateral - outstanding` as a hard ceiling per side:
--
--     cap_yes = collateral - outstanding(yes)
--     cap_no  = collateral - outstanding(no)
--     yes_reserve = min(cap_yes, cap_no * (1-p)/p)     -- deepest curve
--     no_reserve  = yes_reserve * p/(1-p)              -- that prices at p
--
-- price(yes) = no/(yes+no) = p exactly, both reserves stay under their cap,
-- and the inequality is preserved by every subsequent trade (a buy of A_net
-- adds A_net to collateral and to both reserves, then removes exactly the
-- shares it hands out). `payout_market`'s assert therefore stays unfireable.
--
-- WHY NOT JUST SHRINK ONE RESERVE (the naive safe move): it works once. A
-- baseball game swings 50c -> 3c -> 50c, and shrink-only never gives the
-- depth back — after two swings a $25 pool quotes ~93c for a coin flip and
-- the market is dead. Capping against real outstanding instead lets the
-- curve breathe back out to the money that is genuinely unspoken for, which
-- on a market with small positions is nearly the whole pool.
--
-- WHAT THE TRADER SEES AFTERWARDS: the quoted 97c fills at ~97-98c (the
-- rest is ordinary curve slippage, which the panel already warns about),
-- and the 3c long shot fills far above 3c on a $25 pool — that is not a
-- bug either, it is what a $25 curve can honestly sell at 33:1. Raise
-- `platform_settings.global_seed` to tighten it.

-- 1. The feed's own price column -------------------------------------
-- NOT `yes_price`: that column is the POOL's, and v6 forbids the sync from
-- touching it on a funded market. This one is metadata — the source's
-- opinion, written every sync for the life of the market, funded or not.
alter table public.markets add column if not exists feed_price numeric;

comment on column public.markets.feed_price is
  'v25.22 — the SOURCE''s latest price for a feed market (metadata, written '
  'by the feed sync + /api/quote for funded and unfunded rows alike). The '
  'pool''s own price stays in yes_price; anchor_pool_to() is the only bridge '
  'between the two.';

-- Backfill: a funded row's yes_price is where the feed last had it (that is
-- the price it was seeded at), so this is exact for unfunded rows and the
-- best available prior for funded ones — the next sync corrects it.
update public.markets
   set feed_price = yes_price
 where source <> 'callit'
   and feed_price is null;

-- 2. THE ANCHOR ------------------------------------------------------
-- Internal helper. Callers that hold the market's FOR UPDATE lock (place_trade)
-- get a consistent read; the batch below takes rows one at a time and is
-- allowed to race a trade — losing that race just means the next beat
-- re-anchors. No role holds EXECUTE (see the revokes at the end).
--
-- No-ops (deliberately, all of them) on: an unfunded pool (nothing to move —
-- place_trade seeds it at the feed price anyway), a community market (the
-- pool IS the price there, there is no second opinion), a null/garbage
-- target, and a market whose caps have collapsed.
create or replace function public.anchor_pool_to(
  p_market_id text,
  p_price numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.markets%rowtype;
  v_p numeric;
  v_out_yes numeric;
  v_out_no numeric;
  v_cap_y numeric;
  v_cap_n numeric;
  v_y numeric;
  v_n numeric;
begin
  if p_price is null then
    return false;
  end if;

  select * into v_m from public.markets m where m.id = p_market_id;
  if not found then
    return false;
  end if;
  -- The pool owns the price on community markets — there is no feed to
  -- follow, and `feed_price` is null on them anyway.
  if v_m.source = 'callit' or coalesce(v_m.provider, 'polymarket') = 'callit' then
    return false;
  end if;
  if coalesce(v_m.collateral, 0) <= 0
     or coalesce(v_m.yes_reserve, 0) <= 0
     or coalesce(v_m.no_reserve, 0) <= 0 then
    return false;
  end if;

  -- Same band the pool is clamped to everywhere else: at 0 or 1 a reserve
  -- collapses and the invariant divides by zero on the next fill.
  v_p := least(0.98, greatest(0.02, p_price));

  -- THE REAL LIABILITY, not the one implied by the reserves. `positions` is
  -- what payout_market pays out of, so it is what the ceiling must be built
  -- from — the reserves may already carry slack from an earlier anchor.
  select coalesce(sum(po.shares) filter (where po.side = 'yes'), 0),
         coalesce(sum(po.shares) filter (where po.side = 'no'), 0)
    into v_out_yes, v_out_no
    from public.positions po
   where po.market_id = v_m.id;

  v_cap_y := round(coalesce(v_m.collateral, 0) - v_out_yes, 6);
  v_cap_n := round(coalesce(v_m.collateral, 0) - v_out_no, 6);
  if v_cap_y <= 0 or v_cap_n <= 0 then
    return false; -- fully sold out on one side; leave the curve alone
  end if;

  -- Deepest curve that prices at v_p without either side breaching its cap.
  v_y := least(v_cap_y, v_cap_n * (1 - v_p) / v_p);
  v_n := v_y * v_p / (1 - v_p);
  v_y := round(v_y, 6);
  v_n := round(v_n, 6);
  if v_y <= 0 or v_n <= 0 then
    return false; -- rounded to dust: a pool this small cannot hold a price
  end if;

  update public.markets m
     set yes_reserve = v_y,
         no_reserve  = v_n,
         yes_price   = v_p
   where m.id = v_m.id;

  return true;
end;
$$;

-- 3. THE SYNC-BEAT SWEEP ---------------------------------------------
-- Every funded feed market whose pool has drifted off the source by more
-- than a cent, re-anchored in one pass. Called by the feed sync (service
-- key, once a minute), which is the same beat that refreshes `feed_price`.
--
-- Why a sweep AND the call inside place_trade: the sweep keeps the STORED
-- price honest for everything that reads the row without trading (the trade
-- preview's reserves, the charts, the portfolio), while place_trade's own
-- call is what guarantees the FILL is anchored — a market can be traded
-- seconds after a goal, long before the next beat.
--
-- Returns how many pools it moved.
create or replace function public.reanchor_feed_pools(p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_price numeric;
  v_n int := 0;
begin
  if auth.uid() is not null then
    raise exception 'Service role only';
  end if;

  for v_id, v_price in
    select m.id, m.feed_price
      from public.markets m
     where m.status = 'open'
       and coalesce(m.banned, false) = false
       and m.source <> 'callit'
       and coalesce(m.provider, 'polymarket') <> 'callit'
       and m.feed_price is not null
       and coalesce(m.collateral, 0) > 0
       and coalesce(m.yes_reserve, 0) > 0
       and coalesce(m.no_reserve, 0) > 0
       -- A cent of drift is below what any curve can express anyway; this
       -- keeps the sweep off the thousands of markets that never move.
       and abs(m.feed_price - coalesce(m.yes_price, m.feed_price)) > 0.01
     order by m.volume desc nulls last
     limit greatest(coalesce(p_limit, 500), 0)
  loop
    if public.anchor_pool_to(v_id, v_price) then
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$$;

-- 4. place_trade — anchor, THEN fill ---------------------------------
-- Identical to v7 except for the anchor block marked v25.22 below (and the
-- lazy seed, which now opens the pool at `feed_price` when the sync has
-- written one — same value, fresher, and it keeps the two prices agreeing
-- from the market's very first fill).
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
  -- depends on who owns the market. Community ('callit'): WE own the
  -- deadline, so end_date IS the truth. Feed ('polymarket'/'kalshi'): THE
  -- SOURCE owns it (its end_date is the kickoff), so `source_closed` is the
  -- gate — with a 30-day valve in case the sync itself dies.
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
  -- the FIRST trade, at the price the feed last wrote. This is what bounds
  -- the platform's downside to `global_seed` per market that someone
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
    -- v25.22: `feed_price` first. On a funded market the sync stops writing
    -- yes_price (v6), so the two can only agree here if the seed reads the
    -- column the sync still maintains.
    perform public.seed_market_pool(
      v_m.id,
      coalesce(v_m.feed_price, v_m.yes_price),
      coalesce((select s.global_seed from public.platform_settings s where s.id = 1), 25),
      null
    );
    select * into v_m from public.markets m where m.id = p_market_id;
  end if;

  -- v25.22 — ANCHOR BEFORE FILLING. The pool owns its price (v6), but on a
  -- FEED market that price is only ever moved by our own fills, so between
  -- them it drifts away from the live source — pre-game 44c against a game
  -- that is now 8-3. Filling from that curve sells the winning side at a
  -- discount the source stopped offering hours ago.
  --
  -- So: move the curve onto `feed_price` first (the sync writes it every
  -- 60s, and /api/quote refreshes it in the second the user confirms an
  -- in-play bet), then fill. anchor_pool_to() keeps every reserve under
  -- `collateral - outstanding(side)`, so this cannot mint an unbacked share
  -- — see its header for the arithmetic. It no-ops on community markets.
  if public.anchor_pool_to(v_m.id, v_m.feed_price) then
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
  -- conjured from — or quietly lost out of — the pool's accounting.
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
         fees_accrued  = round(m.fees_accrued + v_fee_lp, 2),
         yes_price     = v_new_yes,
         volume        = m.volume + v_amount,
         liquidity     = round(m.collateral + v_net, 2),
         price_history = v_hist
   where m.id = v_m.id
  returning m.volume, m.collateral into v_volume, v_collateral;

  -- v7: bank the platform's slice NOW, at trade time.
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

-- 5. Grants ----------------------------------------------------------
-- anchor_pool_to: internal only. It moves a live pool's price, so nothing
-- outside a DEFINER function may reach it.
revoke all on function public.anchor_pool_to(text, numeric) from public, anon, authenticated;

-- reanchor_feed_pools: the feed sync's service key only (the auth.uid()
-- guard inside is the belt to this brace). The service_role GRANT is
-- required — SECURITY DEFINER changes the role a function executes AS, not
-- who may CALL it, so after the revoke service_role holds nothing.
revoke all on function public.reanchor_feed_pools(int) from public, anon, authenticated;
grant execute on function public.reanchor_feed_pools(int) to service_role;

grant execute on function public.place_trade(text, text, numeric) to authenticated;
