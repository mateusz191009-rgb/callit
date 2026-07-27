-- ---------------------------------------------------------------------
-- v25.28 — community market creation grows up: own icon, many outcomes
-- ---------------------------------------------------------------------
--
-- Run this ONCE in the Supabase SQL editor of an existing project. A fresh
-- project gets all of it from supabase/schema.sql, which carries the same
-- statements — the two must stay in sync.
--
-- What it adds:
--   1. markets.event_title — the parent event's title, denormalized onto
--      every outcome row. A feed event arrives as an object and carries its
--      own title; a community event is nothing but its outcome rows, so the
--      title has to travel with them or the client cannot rebuild the group.
--   2. create_market_rpc gains p_icon. The 7-argument version is DROPPED
--      rather than left beside it: with a default on the new argument the two
--      overloads are ambiguous for a 7-argument call and Postgres refuses to
--      pick ("function is not unique"). Dropping also drops the grants, so
--      they are re-issued at the bottom.
--   3. create_event_rpc — one transaction, N binary markets, one debit.
--      Half an event must never exist, which is exactly what a client loop
--      over create_market_rpc would produce the first time a call failed.
--   4. The `market-icons` storage bucket + its policies, so an uploaded
--      image is a public URL rather than a data URL in the row.
--
-- Idempotent: re-running it is a no-op.

-- 1. ------------------------------------------------------------------
alter table public.markets add column if not exists event_title text;

-- 2. ------------------------------------------------------------------
drop function if exists public.create_market_rpc(text, text, text, text, timestamptz, text, numeric);

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
  -- 'pm-' is the Polymarket feed namespace, 'cl-' the seeded book, and 'ce-'
  -- belongs to community EVENTS (create_event_rpc owns those ids): a single
  -- market must never be able to shadow one of them.
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
    '[]'::jsonb,
    'callit',
    v_fee_bps,
    v_pf_bps,
    v_lp_bps,
    false,
    false,
    'none',
    -- v25.28 — the creator's uploaded image (public storage URL). Absent =
    -- the category glyph, exactly as before.
    nullif(trim(coalesce(p_icon, '')), '')
  );

  perform public.seed_market_pool(v_id, 0.5, v_seed, v_uid);

  return v_id;
end;
$$;

-- 3. ------------------------------------------------------------------
-- A multi-outcome community event: one title, N sides, N binary markets.
--
-- WHY A SINGLE RPC and not N calls to create_market_rpc: the debit and the
-- inserts have to be one transaction. A client loop that fails on outcome 3
-- of 5 leaves a half event on the board — two funded markets and a question
-- nobody can answer — and no way to refund the creator that does not involve
-- an admin. Here, any raise rolls the whole thing back.
--
-- PRICING: each outcome opens at 1/N, not at 50c. They are independent pools,
-- so nothing forces them to sum to 100% later — but starting four outcomes at
-- 50% each would present a 200% board on day one, which is not what "no
-- information yet" looks like.
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
      '[]'::jsonb,
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

-- Grants. create_market_rpc was dropped above, so its grant went with it.
revoke all on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric, text) from public, anon;
grant execute on function public.create_market_rpc(text, text, text, text, timestamptz, text, numeric, text) to authenticated;
revoke all on function public.create_event_rpc(text, text, text, text, timestamptz, text[], numeric, text) from public, anon;
grant execute on function public.create_event_rpc(text, text, text, text, timestamptz, text[], numeric, text) to authenticated;

-- 4. ------------------------------------------------------------------
-- Icon storage. Public bucket: a market's image is shown to signed-out
-- visitors on the home grid, so a signed URL would have to be minted for
-- every card. Writes are restricted to the uploader's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'market-icons',
  'market-icons',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "market icons: public read" on storage.objects;
create policy "market icons: public read"
  on storage.objects for select
  using (bucket_id = 'market-icons');

drop policy if exists "market icons: owner upload" on storage.objects;
create policy "market icons: owner upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'market-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "market icons: owner delete" on storage.objects;
create policy "market icons: owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'market-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
