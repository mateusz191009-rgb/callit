-- v23.8 — NEWSLETTER OPT-IN. Paste this whole file into the Supabase SQL
-- editor and run it once (idempotent — safe to re-run). It is the same
-- block appended to schema.sql; fresh installs get it from there.
--
-- Adds profiles.marketing_opt_in (default FALSE — registering is not
-- newsletter consent) and the self-service toggle RPC the /settings page
-- calls. The admin "send newsletter" button and the emailed unsubscribe
-- link both run under the service key and need no further grants.

alter table public.profiles add column if not exists marketing_opt_in boolean not null default false;

create or replace function public.set_marketing_opt_in(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  update public.profiles set marketing_opt_in = p_on where id = auth.uid();
  return p_on;
end;
$$;

revoke all on function public.set_marketing_opt_in(boolean) from public;
grant execute on function public.set_marketing_opt_in(boolean) to authenticated;
