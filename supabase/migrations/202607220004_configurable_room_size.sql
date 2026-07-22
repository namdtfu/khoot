alter table public.game_rooms
  add column if not exists max_players integer not null default 5
  check (max_players > 0);

alter function public.build_game_snapshot(uuid, uuid, boolean)
  rename to build_game_snapshot_base;

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
  v_max_players integer;
begin
  v_snapshot := public.build_game_snapshot_base(
    p_room_id,
    p_player_token,
    p_include_answers
  );

  select max_players into v_max_players
  from public.game_rooms
  where id = p_room_id;

  return jsonb_set(
    v_snapshot,
    '{room,max_players}',
    to_jsonb(v_max_players),
    true
  );
end;
$$;

create or replace function public.join_game(
  p_room_token uuid,
  p_player_token uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_player_id uuid;
  v_name text := trim(p_name);
begin
  if p_player_token is null then
    raise exception 'Thiếu mã người chơi.';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception 'Tên phải có từ 1 đến 30 ký tự.';
  end if;

  select * into v_room
  from public.game_rooms
  where public_token = p_room_token
  for update;

  if not found then
    raise exception 'Liên kết phòng không hợp lệ.';
  end if;

  if v_room.status <> 'waiting' then
    raise exception 'Trận đấu đã bắt đầu.';
  end if;

  select id into v_player_id
  from public.game_players
  where room_id = v_room.id
    and player_token = p_player_token;

  if v_player_id is null and (
    select count(*) from public.game_players where room_id = v_room.id
  ) >= v_room.max_players then
    raise exception 'Phòng đã đủ số học sinh.';
  end if;

  if exists (
    select 1 from public.game_players
    where room_id = v_room.id
      and lower(name) = lower(v_name)
      and player_token <> p_player_token
  ) then
    raise exception 'Tên này đã có người sử dụng.';
  end if;

  insert into public.game_players (room_id, player_token, name)
  values (v_room.id, p_player_token, v_name)
  on conflict (room_id, player_token)
  do update set name = excluded.name
  returning id into v_player_id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, p_player_token, false);
end;
$$;

create or replace function public.start_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_player_count integer;
  v_ready_count integer;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền bắt đầu phòng này.';
  end if;

  if v_room.status <> 'waiting' then
    return public.build_game_snapshot(v_room.id, null, true);
  end if;

  select count(*)::integer, count(*) filter (where is_ready)::integer
  into v_player_count, v_ready_count
  from public.game_players
  where room_id = v_room.id;

  if v_player_count <> v_room.max_players
    or v_ready_count <> v_room.max_players then
    raise exception 'Cần đủ số học sinh ở trạng thái sẵn sàng.';
  end if;

  update public.game_rooms
  set
    status = 'countdown',
    started_at = clock_timestamp(),
    question_started_at = clock_timestamp() + interval '3 seconds'
  where id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.create_game(
  p_question_set_id uuid,
  p_max_players integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_room_id uuid;
begin
  if p_max_players < 1 then
    raise exception 'Số học sinh phải lớn hơn 0.';
  end if;

  v_snapshot := public.create_game(p_question_set_id);
  v_room_id := (v_snapshot -> 'room' ->> 'id')::uuid;

  update public.game_rooms
  set max_players = p_max_players
  where id = v_room_id;

  perform public.notify_game(v_room_id);
  return public.build_game_snapshot(v_room_id, null, true);
end;
$$;

revoke execute on function public.build_game_snapshot_base(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.build_game_snapshot(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.create_game(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.join_game(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.start_game(uuid)
  from public, anon, authenticated;

grant execute on function public.create_game(uuid, integer) to authenticated;
grant execute on function public.join_game(uuid, uuid, text) to anon, authenticated;
grant execute on function public.start_game(uuid) to authenticated;
