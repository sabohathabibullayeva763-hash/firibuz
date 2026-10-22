-- Run in the Supabase SQL Editor. Each user can access only their own rows.
create table if not exists public.scan_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

alter table public.scan_history enable row level security;
revoke all on table public.scan_history from anon, authenticated;
grant select, insert, update, delete on table public.scan_history to authenticated;

drop policy if exists "Users can read own scan history" on public.scan_history;
create policy "Users can read own scan history" on public.scan_history for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert own scan history" on public.scan_history;
create policy "Users can insert own scan history" on public.scan_history for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own scan history" on public.scan_history;
create policy "Users can update own scan history" on public.scan_history for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete own scan history" on public.scan_history;
create policy "Users can delete own scan history" on public.scan_history for delete to authenticated using ((select auth.uid()) = user_id);
