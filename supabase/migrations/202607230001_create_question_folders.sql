create table if not exists public.question_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.question_folders(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 100),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.question_sets
  add column if not exists folder_id uuid references public.question_folders(id) on delete restrict;

alter table public.question_sets
  add column if not exists position integer not null default 0 check (position >= 0);

with ranked_sets as (
  select
    id,
    row_number() over (
      partition by owner_id
      order by updated_at desc, id
    ) - 1 as next_position
  from public.question_sets
)
update public.question_sets as question_set
set position = ranked_sets.next_position
from ranked_sets
where ranked_sets.id = question_set.id;

create index if not exists question_folders_owner_parent_position_idx
  on public.question_folders(owner_id, parent_id, position);

create index if not exists question_sets_owner_folder_position_idx
  on public.question_sets(owner_id, folder_id, position);

drop trigger if exists question_folders_set_updated_at on public.question_folders;
create trigger question_folders_set_updated_at
before update on public.question_folders
for each row execute function public.set_updated_at();

create or replace function public.validate_question_folder_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_owner_id uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Thư mục không thể nằm bên trong chính nó.';
  end if;

  select owner_id into v_parent_owner_id
  from public.question_folders
  where id = new.parent_id;

  if not found or v_parent_owner_id <> new.owner_id then
    raise exception 'Thư mục cha không hợp lệ.';
  end if;

  if exists (
    with recursive descendants as (
      select id
      from public.question_folders
      where parent_id = new.id

      union all

      select child.id
      from public.question_folders as child
      join descendants on child.parent_id = descendants.id
    )
    select 1
    from descendants
    where id = new.parent_id
  ) then
    raise exception 'Không thể chuyển thư mục vào một thư mục con của nó.';
  end if;

  return new;
end;
$$;

drop trigger if exists question_folders_validate_parent on public.question_folders;
create trigger question_folders_validate_parent
before insert or update of parent_id, owner_id on public.question_folders
for each row execute function public.validate_question_folder_parent();

create or replace function public.validate_question_set_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder_owner_id uuid;
begin
  if new.folder_id is null then
    return new;
  end if;

  select owner_id into v_folder_owner_id
  from public.question_folders
  where id = new.folder_id;

  if not found or v_folder_owner_id <> new.owner_id then
    raise exception 'Thư mục của bộ đề không hợp lệ.';
  end if;

  return new;
end;
$$;

drop trigger if exists question_sets_validate_folder on public.question_sets;
create trigger question_sets_validate_folder
before insert or update of folder_id, owner_id on public.question_sets
for each row execute function public.validate_question_set_folder();

alter table public.question_folders enable row level security;

revoke all on public.question_folders from anon;
grant select, insert, update, delete on public.question_folders to authenticated;

drop policy if exists "Owners manage their question folders" on public.question_folders;
create policy "Owners manage their question folders"
on public.question_folders
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners manage their question sets" on public.question_sets;
create policy "Owners manage their question sets"
on public.question_sets
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create or replace function public.move_question_set(
  p_set_id uuid,
  p_folder_id uuid,
  p_position integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.question_sets%rowtype;
  v_target_count integer;
  v_target_position integer;
begin
  if p_position < 0 then
    raise exception 'Vị trí bộ đề không hợp lệ.';
  end if;

  select * into v_set
  from public.question_sets
  where id = p_set_id
    and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'Không tìm thấy bộ đề.';
  end if;

  if p_folder_id is not null and not exists (
    select 1
    from public.question_folders
    where id = p_folder_id
      and owner_id = auth.uid()
  ) then
    raise exception 'Thư mục đích không hợp lệ.';
  end if;

  update public.question_sets
  set position = position - 1
  where owner_id = v_set.owner_id
    and folder_id is not distinct from v_set.folder_id
    and id <> v_set.id
    and position > v_set.position;

  select count(*)::integer into v_target_count
  from public.question_sets
  where owner_id = v_set.owner_id
    and folder_id is not distinct from p_folder_id
    and id <> v_set.id;

  v_target_position := greatest(0, least(p_position, v_target_count));

  update public.question_sets
  set position = position + 1
  where owner_id = v_set.owner_id
    and folder_id is not distinct from p_folder_id
    and id <> v_set.id
    and position >= v_target_position;

  update public.question_sets
  set
    folder_id = p_folder_id,
    position = v_target_position
  where id = v_set.id;

  return true;
end;
$$;

create or replace function public.move_question_folder(
  p_folder_id uuid,
  p_parent_id uuid,
  p_position integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder public.question_folders%rowtype;
  v_target_count integer;
  v_target_position integer;
begin
  if p_position < 0 then
    raise exception 'Vị trí thư mục không hợp lệ.';
  end if;

  select * into v_folder
  from public.question_folders
  where id = p_folder_id
    and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'Không tìm thấy thư mục.';
  end if;

  if p_parent_id = v_folder.id then
    raise exception 'Thư mục không thể nằm bên trong chính nó.';
  end if;

  if p_parent_id is not null and not exists (
    select 1
    from public.question_folders
    where id = p_parent_id
      and owner_id = auth.uid()
  ) then
    raise exception 'Thư mục cha không hợp lệ.';
  end if;

  if p_parent_id is not null and exists (
    with recursive descendants as (
      select id
      from public.question_folders
      where parent_id = v_folder.id

      union all

      select child.id
      from public.question_folders as child
      join descendants on child.parent_id = descendants.id
    )
    select 1
    from descendants
    where id = p_parent_id
  ) then
    raise exception 'Không thể chuyển thư mục vào một thư mục con của nó.';
  end if;

  update public.question_folders
  set position = position - 1
  where owner_id = v_folder.owner_id
    and parent_id is not distinct from v_folder.parent_id
    and id <> v_folder.id
    and position > v_folder.position;

  select count(*)::integer into v_target_count
  from public.question_folders
  where owner_id = v_folder.owner_id
    and parent_id is not distinct from p_parent_id
    and id <> v_folder.id;

  v_target_position := greatest(0, least(p_position, v_target_count));

  update public.question_folders
  set position = position + 1
  where owner_id = v_folder.owner_id
    and parent_id is not distinct from p_parent_id
    and id <> v_folder.id
    and position >= v_target_position;

  update public.question_folders
  set
    parent_id = p_parent_id,
    position = v_target_position
  where id = v_folder.id;

  return true;
end;
$$;

revoke execute on function public.validate_question_folder_parent()
  from public, anon, authenticated;
revoke execute on function public.validate_question_set_folder()
  from public, anon, authenticated;
revoke execute on function public.move_question_set(uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.move_question_folder(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.move_question_set(uuid, uuid, integer)
  to authenticated;
grant execute on function public.move_question_folder(uuid, uuid, integer)
  to authenticated;
