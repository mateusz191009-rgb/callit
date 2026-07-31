-- ---------------------------------------------------------------------
-- v25.48 — "THAT NAME IS TAKEN": TELL THE USER AT SIGN-UP, NOT NEVER
-- ---------------------------------------------------------------------
--
-- WHAT IS BROKEN TODAY.
--
-- 1. A TAKEN USERNAME IS SILENTLY RENAMED. `handle_new_user()` suffixes on
--    collision (`alice` -> `alice1`) so that the UNIQUE index
--    `profiles_username_lower_idx` can never abort an account creation. That
--    fallback is correct and stays — but nothing anywhere tells the user it
--    happened. They type `alice`, the form says "Account created", the store
--    even sets `user.username = 'alice'` from the local input, and the actual
--    row says `alice1`. The first time they find out is when /u/alice turns
--    out to be a stranger.
--
-- 2. A TAKEN EMAIL SAYS "CHECK YOUR INBOX". With Supabase email confirmation
--    ON, `auth.signUp` on an existing address deliberately returns success
--    with no session and no error (anti-enumeration). The client cannot tell
--    that apart from a real new account, so it shows "Check your email to
--    confirm your account." to someone who already HAS an account and simply
--    needs to sign in. That check is added server-side in
--    app/api/auth/signup-check/route.ts, behind the existing rate limiter and
--    captcha — no new database object is needed for it.
--
-- WHAT THIS FILE ADDS: one anon-callable reader, `check_username_available`,
-- exactly mirroring `check_referral_code` — the sign-up form can now ask
-- BEFORE the account exists.
--
-- WHY ANON MAY CALL IT. Usernames are already a public namespace: every one
-- of them is readable at /u/<username> (`public_profile`, granted to anon)
-- and printed on leaderboards and market cards. Confirming that a name is
-- occupied leaks nothing that a page visit does not. Emails are the opposite,
-- which is why THIS function only takes a username and the email answer never
-- leaves the server.
--
-- LENGTH IS NOT THIS FUNCTION'S JOB. It answers exactly one question — does a
-- profile with this name (case-insensitively) exist — so `false` always means
-- "taken" and never "too short". The 3-20 rule is enforced in the form and
-- would make the boolean ambiguous if it were folded in here.
--
-- BANNED ACCOUNTS STILL OCCUPY THEIR NAME. `profiles_username_lower_idx`
-- covers every row, banned or not, so a `not p.banned` filter (which
-- `check_referral_code` correctly has, because a banned affiliate should earn
-- nothing) would promise a name the insert cannot deliver.
--
-- SAFE TO RE-RUN. One `create or replace` plus its grants. No table is
-- touched, no money moves.

create or replace function public.check_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles p
     where lower(p.username) = lower(trim(coalesce(p_username, '')))
  )
$$;

-- Same shape as check_referral_code: a sign-up pre-check runs before the
-- account exists, so `anon` is the role that has to be able to call it.
revoke all on function public.check_username_available(text) from public;
grant execute on function public.check_username_available(text) to anon, authenticated;
