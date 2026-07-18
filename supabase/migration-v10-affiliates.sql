-- =====================================================================
-- v10 — AFFILIATE PROGRAM (standalone migration)
-- =====================================================================
-- Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor ->
-- New query -> paste -> Run). It is idempotent — re-running is safe.
-- The same section is appended to schema.sql so a fresh project gets it
-- from the single script as usual.
--
-- The program:
--   * Any signed-in user can claim a personal referral code (3-20 chars,
--     picked by the user, globally unique case-insensitively).
--   * New users may enter a code at sign-up; handle_new_user() stores the
--     attribution in profiles.referred_by (invalid codes are ignored —
--     they must never break account creation).
--   * When the referred user's FIRST deposit is approved, the affiliate
--     is credited 50% of it into profiles.affiliate_balance and an
--     affiliate_earnings row records the commission (unique per referred
--     user — arithmetic guarantee of "first deposit only").
--   * Affiliates request payouts (min $10) which reserve the amount from
--     affiliate_balance; the admin approves (sends the crypto manually)
--     or rejects (refunds the reserve). Mirrors the withdrawals flow.
--
-- SECURITY — same posture as the rest of the schema:
--   * All money movement via SECURITY DEFINER RPCs; the client has no
--     write path to affiliate_balance / referred_by / the new tables
--     (authenticated's UPDATE grant on profiles is username-only, and
--     the new tables get no write grants at all).
--   * profiles_guard: referred_by is pinned on UPDATE for end users;
--     affiliate_balance and referral_code are NOT pinned there (the v5
--     note applies — definer RPCs run with the CALLER's auth.uid(), so
--     pinning would silently neuter set_affiliate_code() and
--     request_affiliate_payout(); the revoked grants protect them).

-- ---------------------------------------------------------------------
-- v10.1  profiles columns
-- ---------------------------------------------------------------------

alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists affiliate_balance numeric not null default 0;

-- One owner per code, case-insensitively ('Max' and 'max' collide).
create unique index if not exists profiles_referral_code_lower_idx
  on public.profiles (lower(referral_code))
  where referral_code is not null;

create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by);

-- ---------------------------------------------------------------------
-- v10.2  tables
-- ---------------------------------------------------------------------

-- One commission per referred user — the UNIQUE constraint IS the
-- "first deposit only" rule; approve_deposit() inserts with ON CONFLICT
-- DO NOTHING so a race between two admins cannot double-credit.
create table if not exists public.affiliate_earnings (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  deposit_id uuid references public.deposits (id) on delete set null,
  deposit_amount numeric not null,
  amount numeric not null,
  created_at timestamptz not null default now(),
  unique (referred_user_id)
);

create index if not exists affiliate_earnings_affiliate_idx
  on public.affiliate_earnings (affiliate_id, created_at desc);

-- Payout requests. `amount` was reserved from affiliate_balance at
-- request time (request_affiliate_payout), exactly like withdrawals:
-- approve only flips status (the admin sends the crypto manually),
-- reject refunds the reserve.
create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null check (currency in ('BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL')),
  address text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists affiliate_payouts_affiliate_idx
  on public.affiliate_payouts (affiliate_id, created_at desc);

-- ---------------------------------------------------------------------
-- v10.3  RLS
-- ---------------------------------------------------------------------

alter table public.affiliate_earnings enable row level security;
alter table public.affiliate_payouts enable row level security;

drop policy if exists "affiliate_earnings: read own or admin" on public.affiliate_earnings;
create policy "affiliate_earnings: read own or admin"
  on public.affiliate_earnings for select
  using (auth.uid() = affiliate_id or public.is_admin());

drop policy if exists "affiliate_payouts: read own or admin" on public.affiliate_payouts;
create policy "affiliate_payouts: read own or admin"
  on public.affiliate_payouts for select
  using (auth.uid() = affiliate_id or public.is_admin());

-- No insert/update/delete policies ON PURPOSE — the RPCs below are the
-- only writers (SECURITY DEFINER = policy-exempt). Belt and braces:
revoke insert, update, delete on public.affiliate_earnings from authenticated, anon;
revoke insert, update, delete on public.affiliate_payouts from authenticated, anon;

-- ---------------------------------------------------------------------
-- v10.4  profiles_guard — pin referred_by for end users
-- ---------------------------------------------------------------------
-- Attribution is written once, by handle_new_user(), in a context where
-- auth.uid() is null (the auth API's insert) — pinning it here cannot
-- break that. referral_code / affiliate_balance are deliberately NOT
-- pinned (see the header); the section-7b username-only UPDATE grant is
-- what keeps end users out of them, and the RPCs legitimately bypass it.

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
    -- v10: no self-granted commissions or forged attribution either.
    new.affiliate_balance := 0;
    new.referred_by := null;
    new.referral_code := null;
  else
    new.is_admin := old.is_admin;
    new.banned := old.banned;
    new.email := old.email;
    new.id := old.id;
    -- v10: who referred you is a sign-up fact, not an editable field.
    new.referred_by := old.referred_by;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- v10.5  handle_new_user — attribute the sign-up to a referral code
-- ---------------------------------------------------------------------
-- Reads `ref_code` from signUp({ options: { data: { ref_code } } }).
-- Unknown/own/banned-owner codes are silently ignored: a typo in the
-- referral field must never abort account creation.

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
  v_ref_code text;
  v_ref uuid;
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

  -- v10 — referral attribution (best-effort, never blocks the sign-up).
  v_ref_code := nullif(trim(new.raw_user_meta_data ->> 'ref_code'), '');
  if v_ref_code is not null then
    select p.id into v_ref
      from public.profiles p
     where lower(p.referral_code) = lower(v_ref_code)
       and p.id <> new.id
       and not p.banned
     limit 1;
  end if;

  insert into public.profiles (id, email, username, referred_by)
  values (new.id, coalesce(new.email, new.id::text), v_username, v_ref)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- v10.6  approve_deposit — pay the 50% first-deposit commission
-- ---------------------------------------------------------------------
-- Same function as v4, plus: when the depositor was referred and this is
-- their FIRST approved deposit, credit the affiliate 50% of it. The
-- affiliate_earnings UNIQUE(referred_user_id) + ON CONFLICT DO NOTHING
-- makes a double-credit impossible even under concurrent approvals; the
-- deposits count check keeps users whose first deposit predates v10 from
-- generating a commission on a LATER deposit.

create or replace function public.approve_deposit(deposit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_amount numeric;
  v_ref uuid;
  v_comm numeric;
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

  -- v10 — affiliate commission: 50% of the FIRST approved deposit.
  select p.referred_by into v_ref
    from public.profiles p
   where p.id = v_user;
  if v_ref is not null
     and not coalesce((select b.banned from public.profiles b where b.id = v_ref), true)
     and (select count(*) from public.deposits d2
           where d2.user_id = v_user and d2.status = 'approved') = 1
  then
    v_comm := round(v_amount * 0.5, 2);
    if v_comm > 0 then
      insert into public.affiliate_earnings
        (affiliate_id, referred_user_id, deposit_id, deposit_amount, amount)
      values (v_ref, v_user, deposit_id, v_amount, v_comm)
      on conflict (referred_user_id) do nothing;
      -- FOUND is true only when the row was actually inserted — the
      -- conflict path must not credit a second time.
      if found then
        update public.profiles p
           set affiliate_balance = round(coalesce(p.affiliate_balance, 0) + v_comm, 2)
         where p.id = v_ref;
      end if;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- v10.7  affiliate RPCs
-- ---------------------------------------------------------------------

-- USER: claim (or change) the caller's referral code. 3-20 chars,
-- letters/digits/underscore/hyphen, unique case-insensitively. Returns
-- the stored code.
create or replace function public.set_affiliate_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := trim(coalesce(p_code, ''));
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;
  if length(v_code) < 3 or length(v_code) > 20 then
    raise exception 'Code must be 3-20 characters';
  end if;
  if v_code !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Only letters, numbers, - and _ are allowed';
  end if;
  if exists (
    select 1 from public.profiles p
     where lower(p.referral_code) = lower(v_code)
       and p.id <> v_uid
  ) then
    raise exception 'This code is already taken';
  end if;
  update public.profiles p
     set referral_code = v_code
   where p.id = v_uid;
  return v_code;
end;
$$;

-- ANON/USER: does this referral code exist (and belong to an active
-- account)? Lets the sign-up form catch typos BEFORE the account is
-- created. Codes are meant to be shared publicly, so confirming one
-- exists leaks nothing.
create or replace function public.check_referral_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where lower(p.referral_code) = lower(trim(coalesce(p_code, '')))
       and not p.banned
  )
$$;

-- USER: the caller's whole affiliate dashboard in one read — code,
-- balances and the referred-user list (usernames are safe to show the
-- affiliate: they recruited these accounts, and usernames are public on
-- /u/[username] anyway; emails are deliberately NOT included).
create or replace function public.get_affiliate_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles%rowtype;
  v_total_earned numeric;
  v_total_paid numeric;
  v_pending numeric;
  v_referrals jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select * into v_row from public.profiles where id = v_uid;
  if not found then
    raise exception 'Profile not found';
  end if;

  select coalesce(sum(e.amount), 0) into v_total_earned
    from public.affiliate_earnings e where e.affiliate_id = v_uid;
  select coalesce(sum(a.amount), 0) into v_total_paid
    from public.affiliate_payouts a
   where a.affiliate_id = v_uid and a.status = 'approved';
  select coalesce(sum(a.amount), 0) into v_pending
    from public.affiliate_payouts a
   where a.affiliate_id = v_uid and a.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
           'username', r.username,
           'joined_at', r.created_at,
           'earned', coalesce(e.amount, 0),
           'deposited', e.id is not null
         ) order by r.created_at desc), '[]'::jsonb)
    into v_referrals
    from public.profiles r
    left join public.affiliate_earnings e on e.referred_user_id = r.id
   where r.referred_by = v_uid;

  return jsonb_build_object(
    'code', v_row.referral_code,
    'available', round(coalesce(v_row.affiliate_balance, 0), 2),
    'total_earned', round(v_total_earned, 2),
    'total_paid', round(v_total_paid, 2),
    'pending_payout', round(v_pending, 2),
    'referrals', v_referrals
  );
end;
$$;

-- USER: reserve p_amount from the caller's affiliate_balance and insert
-- a pending payout request. Mirrors request_withdrawal — the atomic
-- UPDATE-with-guard IS the balance check.
create or replace function public.request_affiliate_payout(
  p_currency text,
  p_amount numeric,
  p_address text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_address text := trim(coalesce(p_address, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_amount < 10 then
    raise exception 'Minimum payout is $10';
  end if;
  if v_address = '' then
    raise exception 'Destination address is required';
  end if;
  if coalesce((select p.banned from public.profiles p where p.id = v_uid), false) then
    raise exception 'This account is banned';
  end if;
  -- Atomic reserve: only matches when the affiliate balance covers it.
  update public.profiles p
     set affiliate_balance = round(p.affiliate_balance - v_amount, 2)
   where p.id = v_uid
     and coalesce(p.affiliate_balance, 0) >= v_amount;
  if not found then
    raise exception 'Insufficient affiliate balance';
  end if;
  insert into public.affiliate_payouts (affiliate_id, amount, currency, address, status)
  values (v_uid, v_amount, p_currency, v_address, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

-- ADMIN: pending -> approved (funds were reserved on request; the admin
-- sends the crypto to the stored address manually, exactly like a
-- withdrawal approval).
create or replace function public.approve_affiliate_payout(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  update public.affiliate_payouts a
     set status = 'approved',
         processed_at = now()
   where a.id = p_id
     and a.status = 'pending';
  if not found then
    raise exception 'Payout is not pending';
  end if;
end;
$$;

-- ADMIN: pending -> rejected AND refund the reserved amount.
create or replace function public.reject_affiliate_payout(p_id uuid)
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
  update public.affiliate_payouts a
     set status = 'rejected',
         processed_at = now()
   where a.id = p_id
     and a.status = 'pending'
  returning a.affiliate_id, a.amount into v_user, v_amount;
  if not found then
    raise exception 'Payout is not pending';
  end if;
  update public.profiles p
     set affiliate_balance = round(coalesce(p.affiliate_balance, 0) + v_amount, 2)
   where p.id = v_user;
end;
$$;

-- ADMIN: one row per affiliate (anyone with a code OR with referrals),
-- with recruitment + money totals for the admin panel.
create or replace function public.admin_affiliate_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'username', p.username,
             'email', p.email,
             'code', p.referral_code,
             'referrals', (select count(*) from public.profiles r where r.referred_by = p.id),
             'converted', (select count(*) from public.affiliate_earnings e where e.affiliate_id = p.id),
             'total_earned', round((select coalesce(sum(e.amount), 0)
                                      from public.affiliate_earnings e
                                     where e.affiliate_id = p.id), 2),
             'total_paid', round((select coalesce(sum(a.amount), 0)
                                    from public.affiliate_payouts a
                                   where a.affiliate_id = p.id and a.status = 'approved'), 2),
             'available', round(coalesce(p.affiliate_balance, 0), 2)
           ) order by p.created_at desc)
      from public.profiles p
     where p.referral_code is not null
        or exists (select 1 from public.profiles r where r.referred_by = p.id)
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- v10.8  function grants
-- ---------------------------------------------------------------------

revoke all on function public.set_affiliate_code(text) from public, anon;
revoke all on function public.get_affiliate_overview() from public, anon;
revoke all on function public.request_affiliate_payout(text, numeric, text) from public, anon;
revoke all on function public.approve_affiliate_payout(uuid) from public, anon;
revoke all on function public.reject_affiliate_payout(uuid) from public, anon;
revoke all on function public.admin_affiliate_stats() from public, anon;

grant execute on function public.set_affiliate_code(text) to authenticated;
grant execute on function public.get_affiliate_overview() to authenticated;
grant execute on function public.request_affiliate_payout(text, numeric, text) to authenticated;
grant execute on function public.approve_affiliate_payout(uuid) to authenticated;
grant execute on function public.reject_affiliate_payout(uuid) to authenticated;
grant execute on function public.admin_affiliate_stats() to authenticated;

-- check_referral_code is the one anon-callable member: the sign-up form
-- validates the code BEFORE an account exists.
revoke all on function public.check_referral_code(text) from public;
grant execute on function public.check_referral_code(text) to anon, authenticated;
