-- ============================================================================
--  Secure Support Desk - database schema
--  Paste this entire file into the Supabase SQL Editor and run it.
--  It is idempotent: running it twice is safe.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  1. Enums
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum ('customer', 'agent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_status as enum ('open', 'in_progress', 'resolved');
exception when duplicate_object then null; end $$;


-- ----------------------------------------------------------------------------
--  2. Tables
-- ----------------------------------------------------------------------------

-- The user's role lives HERE, in a table they cannot write to.
--
-- It deliberately does NOT live in auth.users.raw_user_meta_data, because that
-- column is writable by the user themselves via
-- supabase.auth.updateUser({ data: { role: 'agent' } }).
-- Storing the role there would let any customer promote themselves to agent.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  -- FK points at public.profiles (not auth.users) so PostgREST can embed the
  -- owner's email for the agent list view.
  customer_id uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  description text not null,
  status      public.ticket_status not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Length limits are enforced in the database too, not only by the API layer.
  constraint tickets_title_len
    check (char_length(btrim(title)) between 1 and 200),
  constraint tickets_description_len
    check (char_length(btrim(description)) between 1 and 5000)
);

create index if not exists tickets_customer_created_idx
  on public.tickets (customer_id, created_at desc);
create index if not exists tickets_status_created_idx
  on public.tickets (status, created_at desc);


-- ----------------------------------------------------------------------------
--  3. Triggers
-- ----------------------------------------------------------------------------

-- Create a profile row whenever someone signs up.
-- The role is hard-coded to 'customer'. It is never read from the signup
-- payload, so signUp({ options: { data: { role: 'agent' } } }) has no effect.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'customer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tickets_touch_updated_at on public.tickets;
create trigger tickets_touch_updated_at
  before update on public.tickets
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
--  4. Role helper
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER is required: this function is called from policies ON
-- public.profiles, and a plain function would re-enter those policies and
-- recurse forever. Running as the owner bypasses RLS and breaks the cycle.
create or replace function public.is_agent()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'agent'
  );
$$;

revoke execute on function public.is_agent() from public, anon;
grant  execute on function public.is_agent() to authenticated;


-- ----------------------------------------------------------------------------
--  5. Table privileges  (layer 1 of 2)
-- ----------------------------------------------------------------------------
-- Supabase grants ALL on public tables to anon/authenticated by default.
-- We take that back and hand out only what each role genuinely needs.
-- These GRANTs are checked independently of RLS, so a sloppy policy added
-- later still cannot widen access beyond this.

revoke all on public.profiles from anon, authenticated;
revoke all on public.tickets  from anon, authenticated;

-- Signed-out users get nothing at all: every grant below targets
-- `authenticated`, and none targets `anon`.

grant select on public.profiles to authenticated;
-- No insert/update/delete on profiles for anyone: rows are written only by the
-- SECURITY DEFINER signup trigger. This is what makes the role unforgeable.

grant select on public.tickets to authenticated;
grant insert (customer_id, title, description) on public.tickets to authenticated;
-- Column-level: agents may change the status and nothing else. Even a bug in
-- the API layer cannot rewrite someone's title or description.
grant update (status) on public.tickets to authenticated;
-- No delete privilege on tickets for anyone.


-- ----------------------------------------------------------------------------
--  6. Row Level Security  (layer 2 of 2)
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tickets  enable row level security;

-- ---- profiles ----

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_select_agent on public.profiles;
create policy profiles_select_agent on public.profiles
  for select to authenticated
  using (public.is_agent());

-- Deliberately NO insert/update/delete policies on profiles.
-- With RLS enabled and no policy, those commands are denied for everybody,
-- so a customer cannot set their own role to 'agent'.

-- ---- tickets ----

drop policy if exists tickets_select_own on public.tickets;
create policy tickets_select_own on public.tickets
  for select to authenticated
  using (customer_id = (select auth.uid()));

drop policy if exists tickets_select_agent on public.tickets;
create policy tickets_select_agent on public.tickets
  for select to authenticated
  using (public.is_agent());

-- WITH CHECK governs what the new row is allowed to look like. Without it a
-- customer could insert a ticket owned by somebody else, or pre-set it to
-- 'resolved'.
drop policy if exists tickets_insert_own on public.tickets;
create policy tickets_insert_own on public.tickets
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and status = 'open'
  );

-- Only agents may update. USING picks the rows they can target; WITH CHECK
-- re-validates the row afterwards.
drop policy if exists tickets_update_agent on public.tickets;
create policy tickets_update_agent on public.tickets
  for update to authenticated
  using (public.is_agent())
  with check (public.is_agent());

-- No delete policy: tickets cannot be deleted through the API.


-- ----------------------------------------------------------------------------
--  7. Promote a support agent
-- ----------------------------------------------------------------------------
-- Sign the user up through the app first, then run this here in the SQL Editor
-- (the editor connects as `postgres`, which is why it may write profiles while
-- the app never can):
--
--   update public.profiles set role = 'agent' where email = 'agent@example.com';


-- ----------------------------------------------------------------------------
--  8. Self-check
-- ----------------------------------------------------------------------------
-- Both rows must report rls_enabled = true.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where oid in ('public.profiles'::regclass, 'public.tickets'::regclass);
