create table if not exists public.game_lobbies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  name text not null default 'Phòng học của tôi' check (char_length(trim(name)) between 1 and 100),
  active_game_id uuid references public.game_rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_rooms
  add column if not exists lobby_id uuid references public.game_lobbies(id) on delete set null;

create index if not exists game_rooms_lobby_id_created_at_idx
  on public.game_rooms(lobby_id, created_at desc);

drop trigger if exists game_lobbies_set_updated_at on public.game_lobbies;
create trigger game_lobbies_set_updated_at
before update on public.game_lobbies
for each row execute function public.set_updated_at();

alter table public.game_lobbies enable row level security;

revoke all on public.game_lobbies from anon;
grant select on public.game_lobbies to authenticated;

drop policy if exists "Hosts read their permanent lobby" on public.game_lobbies;
create policy "Hosts read their permanent lobby"
on public.game_lobbies
for select
to authenticated
using ((select auth.uid()) = owner_id);

alter function public.build_game_snapshot(uuid, uuid, boolean)
  rename to build_game_snapshot_with_capacity;

create or replace function public.build_game_snapshot(
  p_room_id uuid,
  p_player_token uuid,
  p_include_answers boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_lobby_token uuid;
  v_lobby_name text;
begin
  v_snapshot := public.build_game_snapshot_with_capacity(
    p_room_id,
    p_player_token,
    p_include_answers
  );

  select lobby.public_token, lobby.name
  into v_lobby_token, v_lobby_name
  from public.game_rooms as room
  left join public.game_lobbies as lobby on lobby.id = room.lobby_id
  where room.id = p_room_id;

  v_snapshot := jsonb_set(
    v_snapshot,
    '{room,lobby_token}',
    coalesce(to_jsonb(v_lobby_token), 'null'::jsonb),
    true
  );

  return jsonb_set(
    v_snapshot,
    '{room,lobby_name}',
    coalesce(to_jsonb(v_lobby_name), 'null'::jsonb),
    true
  );
end;
$$;

create or replace function public.notify_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_token uuid;
  v_lobby_token uuid;
begin
  select room.public_token, lobby.public_token
  into v_public_token, v_lobby_token
  from public.game_rooms as room
  left join public.game_lobbies as lobby on lobby.id = room.lobby_id
  where room.id = p_room_id;

  if v_public_token is not null then
    perform realtime.send(
      jsonb_build_object('room_id', p_room_id, 'changed_at', clock_timestamp()),
      'state',
      'game:' || v_public_token::text,
      false
    );
  end if;

  if v_lobby_token is not null then
    perform realtime.send(
      jsonb_build_object('room_id', p_room_id, 'changed_at', clock_timestamp()),
      'state',
      'lobby:' || v_lobby_token::text,
      false
    );
  end if;
end;
$$;

create or replace function public.get_or_create_game_lobby()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lobby public.game_lobbies%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để mở phòng cố định.';
  end if;

  insert into public.game_lobbies (owner_id)
  values (auth.uid())
  on conflict (owner_id)
  do update set updated_at = clock_timestamp()
  returning * into v_lobby;

  return jsonb_build_object(
    'id', v_lobby.id,
    'public_token', v_lobby.public_token,
    'name', v_lobby.name,
    'active_game_id', v_lobby.active_game_id
  );
end;
$$;

create or replace function public.resolve_game_lobby(p_lobby_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_game public.game_rooms%rowtype;
  v_is_host boolean;
  v_active_game jsonb;
begin
  select * into v_lobby
  from public.game_lobbies
  where public_token = p_lobby_token;

  if not found then
    raise exception 'Liên kết phòng không hợp lệ.';
  end if;

  if v_lobby.active_game_id is not null then
    select * into v_game
    from public.game_rooms
    where id = v_lobby.active_game_id;
  end if;

  v_is_host := coalesce(auth.uid() = v_lobby.owner_id, false);

  if v_game.id is null then
    v_active_game := null;
  else
    v_active_game := jsonb_build_object(
      'id', case when v_is_host then v_game.id else null end,
      'public_token', v_game.public_token,
      'title', v_game.title,
      'status', v_game.status,
      'max_players', v_game.max_players,
      'created_at', v_game.created_at
    );
  end if;

  return jsonb_build_object(
    'lobby', jsonb_build_object(
      'id', case when v_is_host then v_lobby.id else null end,
      'public_token', v_lobby.public_token,
      'name', v_lobby.name
    ),
    'active_game', v_active_game,
    'is_host', v_is_host
  );
end;
$$;

create or replace function public.create_game_session(
  p_question_set_id uuid,
  p_max_players integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lobby public.game_lobbies%rowtype;
  v_snapshot jsonb;
  v_game_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để mở phòng.';
  end if;

  insert into public.game_lobbies (owner_id)
  values (auth.uid())
  on conflict (owner_id)
  do update set updated_at = clock_timestamp()
  returning * into v_lobby;

  v_snapshot := public.create_game(p_question_set_id, p_max_players);
  v_game_id := (v_snapshot -> 'room' ->> 'id')::uuid;

  update public.game_rooms
  set lobby_id = v_lobby.id
  where id = v_game_id
    and host_id = auth.uid();

  update public.game_lobbies
  set
    active_game_id = v_game_id,
    updated_at = clock_timestamp()
  where id = v_lobby.id;

  perform public.notify_game(v_game_id);
  return public.build_game_snapshot(v_game_id, null, true);
end;
$$;

revoke execute on function public.build_game_snapshot_with_capacity(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.build_game_snapshot(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.notify_game(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_or_create_game_lobby()
  from public, anon, authenticated;
revoke execute on function public.resolve_game_lobby(uuid)
  from public, anon, authenticated;
revoke execute on function public.create_game_session(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.get_or_create_game_lobby()
  to authenticated;
grant execute on function public.resolve_game_lobby(uuid)
  to anon, authenticated;
grant execute on function public.create_game_session(uuid, integer)
  to authenticated;
