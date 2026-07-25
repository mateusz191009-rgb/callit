-- ==================================================================
-- callit v25.17 — VOIDED FEED MARKETS PAY EVERYONE BACK
-- ==================================================================
--
-- Run this once in the Supabase SQL editor (it is also folded into
-- supabase/schema.sql, so a fresh project gets it automatically).
-- Re-runnable: every statement is idempotent.
--
-- THE BUG. A feed market whose real-world event never happens does not
-- resolve yes or no — the source voids it. Polymarket calls that "50-50"
-- and pays both sides exactly $0.50; Kalshi reports `result: 'void'`.
-- Neither is a Side, so `settle_feed_market()` could not be called for one,
-- and the settle cron did the only thing it could: it froze the market on
-- the `closed` half and skipped the payout, every run, forever. The stakes
-- stayed locked in the pool with no path out but an admin ban.
--
-- Found on UFC Abu Dhabi (Turman vs Dulatov, 2026-07-25): the bout was
-- cancelled hours before the card after Dulatov was hospitalised, and the
-- market's own rules say it resolves 50-50.
--
-- THE FIX. `void_feed_market()` — the same refund leg `ban_market_rpc()`
-- already runs, minus the ban: every holder gets their COST BASIS back
-- (shares x avg_price, the dollars they actually paid), the residual and
-- the accrued fees go to the funder, and the market lands `resolved` with
-- `resolved_outcome = 'void'`.
--
-- WHY COST BASIS AND NOT $0.50/SHARE: a void means the trade never really
-- happened, so the honest unwind is the money back — not a payout at a
-- price nobody agreed to. Paying $0.50 a share would hand a profit to
-- anyone who bought under 50c and a loss to anyone above it, on an event
-- that was never contested. Cost basis is also what the pool provably
-- holds: it is bounded by `collateral` by construction, which is why the
-- solvency assert below can never fire on a healthy book.

-- 1. 'void' becomes a legal resolved_outcome ------------------------
-- Nothing in the app reads resolved_outcome without an explicit
-- yes/no comparison, so widening the domain cannot change an existing
-- verdict; it gives the void its own value instead of overloading NULL
-- (which is also what an UNRESOLVED market carries).
alter table public.markets drop constraint if exists markets_resolved_outcome_check;
alter table public.markets
  add constraint markets_resolved_outcome_check
  check (resolved_outcome in ('yes', 'no', 'void'));

-- 2. The refund ------------------------------------------------------
create or replace function public.void_feed_market(p_market_id text)
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
  -- Service role only, exactly like settle_feed_market(): this is the
  -- settle cron's second verdict, not an admin button. An admin who needs
  -- to void by hand still has ban_market_rpc().
  if auth.uid() is not null then
    raise exception 'Service role only';
  end if;

  select * into v_m from public.markets m where m.id = p_market_id for update;
  if not found then
    raise exception 'Market not found';
  end if;
  if v_m.source = 'callit' then
    raise exception 'Not a feed market';
  end if;
  -- Same guard as settle_feed_market, and the same reason: this is what
  -- makes a retrying cron idempotent. A second call is refused, never a
  -- second refund.
  if v_m.status <> 'open' then
    raise exception 'This market is already resolved';
  end if;

  -- Cost basis back to every holder. Rounded per user, not per position,
  -- so someone who bought the same side five times is not paid five
  -- half-cent roundings.
  with refunds as (
    select po.user_id, round(sum(po.shares * po.avg_price), 2) as amount
      from public.positions po
     where po.market_id = p_market_id
     group by po.user_id
    having round(sum(po.shares * po.avg_price), 2) > 0
  ), credited as (
    update public.profiles p
       set balance = round(p.balance + r.amount, 2)
      from refunds r
     where p.id = r.user_id
    returning r.amount as amount
  )
  select coalesce(sum(c.amount), 0) into v_paid from credited c;

  -- Solvency assert, same tolerance as payout_market(). Refunds are the
  -- money that came IN, so this can only fire if the book is already
  -- broken — in which case failing loudly beats overdrawing the pool.
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
    -- Platform-funded Global market: residual + fees to the till, and the
    -- seed stops counting against exposure.
    update public.platform_settings s
       set platform_balance  = round(s.platform_balance + v_residual + v_fees, 2),
           platform_exposure = greatest(round(s.platform_exposure - coalesce(v_m.seed, 0), 2), 0)
     where s.id = 1;
  end if;

  delete from public.positions po where po.market_id = p_market_id;

  -- The pool is spent. `seed = 0` for the same reason payout_market()
  -- zeroes it: the exposure unwind above subtracts v_m.seed, so leaving it
  -- set would let a later path unwind the same seed a second time.
  update public.markets m
     set collateral       = 0,
         fees_accrued     = 0,
         yes_reserve      = 0,
         no_reserve       = 0,
         seed             = 0,
         liquidity        = 0,
         status           = 'resolved',
         resolved_outcome = 'void',
         settle_status    = 'settled',
         resolved_at      = now()
   where m.id = v_m.id;
end;
$$;
