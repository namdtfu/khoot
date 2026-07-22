create or replace function public.close_game_session(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_lobby_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để đóng phòng.';
  end if;

  select *
  into v_room
  from public.game_rooms
  where id = p_room_id
    and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền đóng phòng này.';
  end if;

  update public.game_rooms
  set
    status = 'finished',
    finished_at = coalesce(finished_at, clock_timestamp())
  where id = v_room.id;

  update public.game_lobbies
  set
    active_game_id = null,
    updated_at = clock_timestamp()
  where active_game_id = v_room.id
    and owner_id = auth.uid()
  returning public_token into v_lobby_token;

  if v_lobby_token is null and v_room.lobby_id is not null then
    select public_token
    into v_lobby_token
    from public.game_lobbies
    where id = v_room.lobby_id
      and owner_id = auth.uid();
  end if;

  perform public.notify_game(v_room.id);

  return jsonb_build_object(
    'room_id', v_room.id,
    'lobby_token', v_lobby_token,
    'closed', true
  );
end;
$$;

revoke execute on function public.close_game_session(uuid)
  from public, anon, authenticated;
grant execute on function public.close_game_session(uuid)
  to authenticated;
