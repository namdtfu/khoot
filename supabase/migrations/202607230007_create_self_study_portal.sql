create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student'
    check (role in ('admin', 'student')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.user_profiles (id, role)
select
  auth_user.id,
  case
    when exists (
      select 1 from public.question_sets where owner_id = auth_user.id
    ) or exists (
      select 1 from public.game_lobbies where owner_id = auth_user.id
    )
      then 'admin'
    else 'student'
  end
from auth.users as auth_user
on conflict (id) do update
set role = case
  when excluded.role = 'admin' then 'admin'
  else public.user_profiles.role
end;

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, role)
  values (new.id, 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from public, anon, authenticated;
grant select on public.user_profiles to authenticated;

create policy "Users read their own profile"
on public.user_profiles
for select
to authenticated
using (id = (select auth.uid()));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.get_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập.';
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid();

  if v_role is null then
    insert into public.user_profiles (id, role)
    values (auth.uid(), 'student')
    on conflict (id) do nothing;
    v_role := 'student';
  end if;

  return jsonb_build_object(
    'id', auth.uid(),
    'role', v_role
  );
end;
$$;

drop policy if exists "Owners manage their question folders" on public.question_folders;
create policy "Admins manage their question folders"
on public.question_folders
for all
to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_admin()
)
with check (
  owner_id = (select auth.uid())
  and public.is_admin()
);

drop policy if exists "Owners manage their question sets" on public.question_sets;
create policy "Admins manage their question sets"
on public.question_sets
for all
to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_admin()
)
with check (
  owner_id = (select auth.uid())
  and public.is_admin()
);

drop policy if exists "Owners manage questions in their sets" on public.questions;
create policy "Admins manage questions in their sets"
on public.questions
for all
to authenticated
using (
  public.is_admin()
  and exists (
    select 1
    from public.question_sets
    where question_sets.id = questions.set_id
      and question_sets.owner_id = (select auth.uid())
  )
)
with check (
  public.is_admin()
  and exists (
    select 1
    from public.question_sets
    where question_sets.id = questions.set_id
      and question_sets.owner_id = (select auth.uid())
  )
);

drop policy if exists "Hosts read their permanent lobby" on public.game_lobbies;
create policy "Admins read their permanent lobby"
on public.game_lobbies
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_admin()
);

create table public.study_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  review_stage smallint not null default 0
    check (review_stage between 0 and 5),
  known_count integer not null default 0
    check (known_count >= 0),
  again_count integer not null default 0
    check (again_count >= 0),
  next_review_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index study_progress_user_next_review_idx
  on public.study_progress(user_id, next_review_at);

create trigger study_progress_set_updated_at
before update on public.study_progress
for each row execute function public.set_updated_at();

alter table public.study_progress enable row level security;
revoke all on public.study_progress from public, anon, authenticated;
grant select on public.study_progress to authenticated;

create policy "Students read their own study progress"
on public.study_progress
for select
to authenticated
using (user_id = (select auth.uid()));

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon, authenticated;
revoke execute on function public.get_my_profile() from public, anon, authenticated;
grant execute on function public.get_my_profile() to authenticated;

create or replace function public.list_study_sets()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để học.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', summary.id,
        'title', summary.title,
        'topic', summary.topic,
        'description', summary.description,
        'question_count', summary.question_count,
        'learned_count', summary.learned_count,
        'due_count', summary.due_count,
        'updated_at', summary.updated_at
      )
      order by summary.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      question_set.id,
      question_set.title,
      question_set.topic,
      question_set.description,
      question_set.updated_at,
      count(question.id)::integer as question_count,
      count(question.id) filter (
        where progress.review_stage > 0
      )::integer as learned_count,
      count(question.id) filter (
        where progress.question_id is null
          or progress.next_review_at <= clock_timestamp()
      )::integer as due_count
    from public.question_sets as question_set
    join public.user_profiles as owner_profile
      on owner_profile.id = question_set.owner_id
      and owner_profile.role = 'admin'
    join public.questions as question
      on question.set_id = question_set.id
    left join public.study_progress as progress
      on progress.question_id = question.id
      and progress.user_id = auth.uid()
    where question_set.is_published
    group by question_set.id
  ) as summary;

  return v_result;
end;
$$;

create or replace function public.get_study_set(p_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.question_sets%rowtype;
  v_questions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để học.';
  end if;

  select question_set.* into v_set
  from public.question_sets as question_set
  join public.user_profiles as owner_profile
    on owner_profile.id = question_set.owner_id
    and owner_profile.role = 'admin'
  where question_set.id = p_set_id
    and question_set.is_published;

  if not found then
    raise exception 'Không tìm thấy bộ đề đã xuất bản.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', question.id,
        'position', question.position,
        'prompt', question.prompt,
        'options', question.options,
        'correct_option', question.correct_option,
        'review_stage', coalesce(progress.review_stage, 0),
        'known_count', coalesce(progress.known_count, 0),
        'again_count', coalesce(progress.again_count, 0),
        'next_review_at', progress.next_review_at,
        'last_reviewed_at', progress.last_reviewed_at,
        'is_due', progress.question_id is null
          or progress.next_review_at <= clock_timestamp()
      )
      order by question.position, question.created_at
    ),
    '[]'::jsonb
  )
  into v_questions
  from public.questions as question
  left join public.study_progress as progress
    on progress.question_id = question.id
    and progress.user_id = auth.uid()
  where question.set_id = v_set.id;

  return jsonb_build_object(
    'id', v_set.id,
    'title', v_set.title,
    'topic', v_set.topic,
    'description', v_set.description,
    'questions', v_questions
  );
end;
$$;

create or replace function public.record_study_review(
  p_question_id uuid,
  p_rating text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.study_progress%rowtype;
  v_stage smallint;
  v_next_review timestamptz;
  v_known_count integer;
  v_again_count integer;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để lưu tiến độ.';
  end if;

  if p_rating not in ('again', 'known') then
    raise exception 'Mức đánh giá không hợp lệ.';
  end if;

  if not exists (
    select 1
    from public.questions as question
    join public.question_sets as question_set
      on question_set.id = question.set_id
    join public.user_profiles as owner_profile
      on owner_profile.id = question_set.owner_id
      and owner_profile.role = 'admin'
    where question.id = p_question_id
      and question_set.is_published
  ) then
    raise exception 'Không tìm thấy thuật ngữ trong bộ đề đã xuất bản.';
  end if;

  select * into v_current
  from public.study_progress
  where user_id = auth.uid()
    and question_id = p_question_id
  for update;

  if p_rating = 'again' then
    v_stage := 0;
    v_next_review := clock_timestamp() + interval '10 minutes';
    v_known_count := coalesce(v_current.known_count, 0);
    v_again_count := coalesce(v_current.again_count, 0) + 1;
  else
    v_stage := least(coalesce(v_current.review_stage, 0) + 1, 5);
    v_next_review := clock_timestamp() + make_interval(days => case v_stage
      when 1 then 1
      when 2 then 3
      when 3 then 7
      when 4 then 14
      else 30
    end);
    v_known_count := coalesce(v_current.known_count, 0) + 1;
    v_again_count := coalesce(v_current.again_count, 0);
  end if;

  insert into public.study_progress (
    user_id,
    question_id,
    review_stage,
    known_count,
    again_count,
    next_review_at,
    last_reviewed_at
  )
  values (
    auth.uid(),
    p_question_id,
    v_stage,
    v_known_count,
    v_again_count,
    v_next_review,
    clock_timestamp()
  )
  on conflict (user_id, question_id)
  do update set
    review_stage = excluded.review_stage,
    known_count = excluded.known_count,
    again_count = excluded.again_count,
    next_review_at = excluded.next_review_at,
    last_reviewed_at = excluded.last_reviewed_at;

  return jsonb_build_object(
    'question_id', p_question_id,
    'review_stage', v_stage,
    'known_count', v_known_count,
    'again_count', v_again_count,
    'next_review_at', v_next_review,
    'last_reviewed_at', clock_timestamp()
  );
end;
$$;

create or replace function public.reset_study_set_progress(p_set_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để đặt lại tiến độ.';
  end if;

  if not exists (
    select 1
    from public.question_sets as question_set
    join public.user_profiles as owner_profile
      on owner_profile.id = question_set.owner_id
      and owner_profile.role = 'admin'
    where question_set.id = p_set_id
      and question_set.is_published
  ) then
    raise exception 'Không tìm thấy bộ đề đã xuất bản.';
  end if;

  delete from public.study_progress as progress
  using public.questions as question
  where progress.user_id = auth.uid()
    and progress.question_id = question.id
    and question.set_id = p_set_id;

  return true;
end;
$$;

revoke execute on function public.list_study_sets() from public, anon, authenticated;
grant execute on function public.list_study_sets() to authenticated;
revoke execute on function public.get_study_set(uuid) from public, anon, authenticated;
grant execute on function public.get_study_set(uuid) to authenticated;
revoke execute on function public.record_study_review(uuid, text) from public, anon, authenticated;
grant execute on function public.record_study_review(uuid, text) to authenticated;
revoke execute on function public.reset_study_set_progress(uuid) from public, anon, authenticated;
grant execute on function public.reset_study_set_progress(uuid) to authenticated;
