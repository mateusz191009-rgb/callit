-- ============================================================================
-- migration-v25.43-community-chart-open.sql
--
-- COMMUNITY CHARTS START WHERE THE MARKET OPENED.
--
-- Both create RPCs inserted `price_history = '[]'`, and `place_trade` only
-- ever appends the price AFTER a fill. So a community market seeded at 50c
-- whose first trade moved it to 70c ended up with a ONE-point series — and
-- PriceChart renders a single point as a flat line (it duplicates the point
-- an hour earlier, components/trading/PriceChart.tsx). The one move that had
-- actually happened rendered as "nothing ever happened, it has always been
-- 70c".
--
-- The opening price is a recorded fact, not a reconstruction: it is the same
-- number the insert already writes to `yes_price` — 0.5 for a binary market,
-- 1/N for an event outcome.
--
-- SAFE TO RE-RUN. Nothing but the two function bodies changes; no table, no
-- column, no money path. Markets created BEFORE this ran keep the history
-- they have — there is no backfill, because for an already-traded market we
-- would be guessing at a timestamp we never recorded.
--
-- Folded into schema.sql; running that instead is equivalent.
-- ============================================================================

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
  -- 'pm-' is the Polymarket feed namespace, 'cl-' the seeded book, and
  -- 'ce-' belongs to community EVENTS (create_event_rpc owns those ids): a
  -- single market must never be able to shadow one of them.
  if v_id like 'pm-%' or v_id like 'cl-%' or v_id like 'ce-%' then
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
    -- v25.43 — the chart STARTS where the market opened.
    --
    -- This was '[]'. `place_trade` appends the POST-fill price, so a market
    -- seeded at 50c whose first trade moved it to 70c had a one-point series
    -- — and PriceChart draws a single point as a flat line (it duplicates it
    -- an hour earlier), so the one move that had actually happened rendered
    -- as "nothing ever happened, it has always been 70c". The opening price
    -- is a recorded fact, not a reconstruction: it is the same 0.5 this very
    -- insert writes to yes_price.
    jsonb_build_array(jsonb_build_object(
      't', (extract(epoch from now()) * 1000)::bigint,
      'yes', 0.5
    )),
    'callit',
    v_fee_bps,
    v_pf_bps,
    v_lp_bps,
    false,
    -- Community markets are gated on end_date, never on source_closed;
    -- there is no upstream source to close them.
    false,
    'none',
    -- v25.28 — the creator's uploaded image (public storage URL). Absent =
    -- the category glyph, exactly as before.
    nullif(trim(coalesce(p_icon, '')), '')
  );

  -- Fund the pool at 50¢: yes_reserve = no_reserve = seed, collateral = seed.
  perform public.seed_market_pool(v_id, 0.5, v_seed, v_uid);

  return v_id;
end;
$$;

create or replace function public.create_event_rpc(
  p_event_id text,
  p_title text,
  p_description text,
  p_category text,
  p_end_date timestamptz,
  p_outcomes text[],
  p_seed_each numeric,
  p_icon text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_event_id text := trim(coalesce(p_event_id, ''));
  v_title text := trim(coalesce(p_title, ''));
  v_username text;
  v_seed numeric := round(coalesce(p_seed_each, 0), 2);
  v_names text[] := '{}';
  v_name text;
  v_count int;
  v_total numeric;
  v_price numeric;
  v_fee_bps int;
  v_pf_bps int;
  v_lp_bps int;
  v_market_id text;
  i int;
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

  -- The event id namespace is ours to hand out; anything else could shadow a
  -- feed event id and merge a user's outcomes into a Polymarket card.
  if v_event_id !~ '^ce-[a-z0-9]+-[a-z0-9]+$' then
    raise exception 'Invalid event id';
  end if;
  if exists (select 1 from public.markets m where m.event_id = v_event_id) then
    raise exception 'Event already exists';
  end if;
  if v_title = '' then
    raise exception 'A question is required';
  end if;
  if length(v_title) > 140 then
    raise exception 'Keep the question to 140 characters or fewer';
  end if;
  if p_end_date is null or p_end_date <= now() then
    raise exception 'End date must be in the future';
  end if;

  -- Normalize the outcome names: trimmed, non-empty, unique case-insensitively
  -- (two sides called "Yes" and "yes" are one side with two prices).
  for i in 1 .. coalesce(array_length(p_outcomes, 1), 0) loop
    v_name := trim(coalesce(p_outcomes[i], ''));
    if v_name = '' then
      continue;
    end if;
    if length(v_name) > 60 then
      raise exception 'Outcome names are limited to 60 characters';
    end if;
    if lower(v_name) = any (select lower(x) from unnest(v_names) x) then
      continue;
    end if;
    v_names := v_names || v_name;
  end loop;

  v_count := coalesce(array_length(v_names, 1), 0);
  if v_count < 2 then
    raise exception 'An event needs at least 2 different outcomes';
  end if;
  if v_count > 8 then
    raise exception 'An event can have at most 8 outcomes';
  end if;
  if v_seed < 10 then
    raise exception 'Seed liquidity must be at least $10 per outcome';
  end if;
  if v_seed > 10000 then
    raise exception 'Seed liquidity cannot exceed $10,000 per outcome';
  end if;
  v_total := round(v_seed * v_count, 2);

  select coalesce(s.platform_fee_bps, 100), coalesce(s.lp_fee_bps, 100)
    into v_pf_bps, v_lp_bps
    from public.platform_settings s where s.id = 1;
  v_pf_bps := coalesce(v_pf_bps, 100);
  v_lp_bps := coalesce(v_lp_bps, 100);
  v_fee_bps := v_pf_bps + v_lp_bps;

  -- One debit for the whole event, and it only matches while the balance
  -- covers every pool the loop below is about to open.
  update public.profiles p
     set balance = round(p.balance - v_total, 2)
   where p.id = v_uid
     and p.balance >= v_total;
  if not found then
    raise exception 'Insufficient balance to fund every outcome';
  end if;

  v_price := least(0.98, greatest(0.02, round(1.0 / v_count, 4)));

  for i in 1 .. v_count loop
    v_market_id := v_event_id || '-o' || i;
    insert into public.markets (
      id, source, question, description, category, end_date, resolution,
      yes_price, volume, liquidity, creator_id, creator_name, created_by,
      status, price_history, provider, fee_bps, platform_fee_bps, lp_fee_bps,
      in_play_ok, source_closed, settle_status, icon, short_name,
      event_id, event_title
    )
    values (
      v_market_id,
      'callit',
      -- The row's own question stands alone on its market page, so it repeats
      -- the event's question and names the side it is about.
      v_title || ' — ' || v_names[i],
      nullif(trim(coalesce(p_description, '')), ''),
      coalesce(nullif(trim(coalesce(p_category, '')), ''), 'custom'),
      p_end_date,
      'community',
      v_price,
      0,
      v_seed,
      v_uid,
      v_username,
      v_username,
      'open',
      -- v25.43 — same as create_market_rpc: the outcome's chart starts at the
      -- price it opened on, which for an N-outcome event is the 1/N this
      -- insert writes to yes_price.
      jsonb_build_array(jsonb_build_object(
        't', (extract(epoch from now()) * 1000)::bigint,
        'yes', v_price
      )),
      'callit',
      v_fee_bps,
      v_pf_bps,
      v_lp_bps,
      false,
      false,
      'none',
      nullif(trim(coalesce(p_icon, '')), ''),
      -- short_name is the outcome label the event card and the outcome table
      -- render; yes_label stays null so each row keeps literal Yes/No sides,
      -- exactly like a feed event's outcomes.
      v_names[i],
      v_event_id,
      v_title
    );
    perform public.seed_market_pool(v_market_id, v_price, v_seed, v_uid);
  end loop;

  return v_event_id;
end;
$$;

-- Permissions are unchanged by a redefinition, but a create-or-replace
-- resets nothing else either — restate them so a partial DB converges.
revoke all on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric, text) from public, anon;
revoke all on function public.create_event_rpc(text, text, text, text, timestamptz, text[], numeric, text) from public, anon;
grant execute on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric, text) to authenticated;
grant execute on function public.create_event_rpc(text, text, text, text, timestamptz, text[], numeric, text) to authenticated;
