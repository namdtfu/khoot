create extension if not exists pgcrypto;

create table if not exists public.question_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  topic text not null default 'Tổng hợp' check (char_length(trim(topic)) between 1 and 80),
  description text not null default '',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.question_sets(id) on delete cascade,
  prompt text not null check (char_length(trim(prompt)) > 0),
  options jsonb not null check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) = 4
  ),
  correct_option smallint not null check (correct_option between 0 and 3),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists question_sets_owner_id_idx
  on public.question_sets(owner_id);
create index if not exists questions_set_id_position_idx
  on public.questions(set_id, position);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists question_sets_set_updated_at on public.question_sets;
create trigger question_sets_set_updated_at
before update on public.question_sets
for each row execute function public.set_updated_at();

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

alter table public.question_sets enable row level security;
alter table public.questions enable row level security;

revoke all on public.question_sets from anon;
revoke all on public.questions from anon;
grant select, insert, update, delete on public.question_sets to authenticated;
grant select, insert, update, delete on public.questions to authenticated;

drop policy if exists "Owners manage their question sets" on public.question_sets;
create policy "Owners manage their question sets"
on public.question_sets
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners manage questions in their sets" on public.questions;
create policy "Owners manage questions in their sets"
on public.questions
for all
to authenticated
using (
  exists (
    select 1
    from public.question_sets
    where question_sets.id = questions.set_id
      and question_sets.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.question_sets
    where question_sets.id = questions.set_id
      and question_sets.owner_id = (select auth.uid())
  )
);
