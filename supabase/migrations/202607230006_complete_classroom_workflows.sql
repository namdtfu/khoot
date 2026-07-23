alter table public.question_sets
  add column shuffle_questions boolean not null default false,
  add column shuffle_options boolean not null default false,
  add column scoring_mode text not null default 'speed'
    check (scoring_mode in ('speed', 'accuracy'));

alter table public.game_rooms
  drop constraint if exists game_rooms_status_check;
alter table public.game_rooms
  add constraint game_rooms_status_check
  check (status in ('waiting', 'countdown', 'playing', 'paused', 'reveal', 'finished'));

alter table public.game_rooms
  drop constraint if exists game_rooms_max_players_check;
alter table public.game_rooms
  add constraint game_rooms_max_players_check
  check (max_players between 1 and 100);

alter table public.game_rooms
  add column shuffle_questions boolean not null default false,
  add column shuffle_options boolean not null default false,
  add column scoring_mode text not null default 'speed'
    check (scoring_mode in ('speed', 'accuracy')),
  add column current_bonus_seconds integer not null default 0
    check (current_bonus_seconds between 0 and 300),
  add column paused_at timestamptz,
  add column paused_elapsed_ms integer
    check (paused_elapsed_ms is null or paused_elapsed_ms >= 0);

alter table public.game_players
  add column last_seen_at timestamptz not null default clock_timestamp();

create index if not exists game_players_room_last_seen_idx
  on public.game_players(room_id, last_seen_at desc);

create or replace function public.shuffle_question_options(
  p_options jsonb,
  p_correct_option smallint
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  with shuffled as materialized (
    select
      option.value,
      (option.ordinality - 1)::integer as original_index,
      random() as sort_key
    from jsonb_array_elements(p_options) with ordinality as option(value, ordinality)
  ),
  numbered as (
    select
      value,
      original_index,
      (row_number() over (order by sort_key) - 1)::integer as new_index
    from shuffled
  )
  select jsonb_build_object(
    'options', jsonb_agg(value order by new_index),
    'correct_option', max(new_index) filter (where original_index = p_correct_option)
  )
  from numbered;
$$;

alter function public.build_game_snapshot(uuid, uuid, boolean)
  rename to build_game_snapshot_with_time_limits;

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
  v_room public.game_rooms%rowtype;
  v_question public.game_questions%rowtype;
  v_players jsonb;
  v_current_limit integer;
  v_paused_remaining integer;
  v_question_json jsonb;
begin
  v_snapshot := public.build_game_snapshot_with_time_limits(
    p_room_id,
    p_player_token,
    p_include_answers
  );

  select * into v_room
  from public.game_rooms
  where id = p_room_id;

  select * into v_question
  from public.game_questions
  where room_id = p_room_id
    and position = v_room.current_question;

  v_current_limit := coalesce(v_question.time_limit_seconds, v_room.time_limit_seconds)
    + v_room.current_bonus_seconds;

  v_paused_remaining := case
    when v_room.status = 'paused' then greatest(
      0,
      ceil(
        (v_current_limit * 1000 - coalesce(v_room.paused_elapsed_ms, 0))::numeric / 1000
      )::integer
    )
    else null
  end;

  v_snapshot := jsonb_set(v_snapshot, '{room,current_time_limit_seconds}', to_jsonb(v_current_limit), true);
  v_snapshot := jsonb_set(v_snapshot, '{room,paused_remaining_seconds}', coalesce(to_jsonb(v_paused_remaining), 'null'::jsonb), true);
  v_snapshot := jsonb_set(v_snapshot, '{room,shuffle_questions}', to_jsonb(v_room.shuffle_questions), true);
  v_snapshot := jsonb_set(v_snapshot, '{room,shuffle_options}', to_jsonb(v_room.shuffle_options), true);
  v_snapshot := jsonb_set(v_snapshot, '{room,scoring_mode}', to_jsonb(v_room.scoring_mode), true);

  if v_room.status = 'paused' and v_question.id is not null then
    v_question_json := jsonb_build_object(
      'id', v_question.id,
      'position', v_question.position,
      'prompt', v_question.prompt,
      'options', v_question.options,
      'time_limit_seconds', v_question.time_limit_seconds
    );
    if p_include_answers then
      v_question_json := v_question_json
        || jsonb_build_object('correct_option', v_question.correct_option);
    end if;
    v_snapshot := jsonb_set(v_snapshot, '{question}', v_question_json, true);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', player.id,
        'name', player.name,
        'is_ready', player.is_ready,
        'score', player.score,
        'is_online', player.last_seen_at >= clock_timestamp() - interval '12 seconds',
        'answered', exists (
          select 1
          from public.game_answers as answer
          join public.game_questions as question
            on question.id = answer.game_question_id
          where answer.player_id = player.id
            and question.position = v_room.current_question
        )
      )
      order by player.score desc, player.joined_at
    ),
    '[]'::jsonb
  )
  into v_players
  from public.game_players as player
  where player.room_id = p_room_id;

  return jsonb_set(v_snapshot, '{players}', v_players, true);
end;
$$;

create or replace function public.sync_game_state_by_id(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question public.game_questions%rowtype;
  v_player_count integer;
  v_answer_count integer;
  v_changed boolean := false;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found or v_room.status in ('waiting', 'paused', 'finished') then
    return false;
  end if;

  if v_room.status = 'countdown'
    and clock_timestamp() >= v_room.question_started_at then
    update public.game_rooms
    set status = 'playing'
    where id = v_room.id;
    v_room.status := 'playing';
    v_changed := true;
  end if;

  if v_room.status = 'playing' then
    select * into v_question
    from public.game_questions
    where room_id = v_room.id
      and position = v_room.current_question;

    select count(*)::integer into v_player_count
    from public.game_players
    where room_id = v_room.id;

    select count(*)::integer into v_answer_count
    from public.game_answers
    where room_id = v_room.id
      and game_question_id = v_question.id;

    if (v_player_count > 0 and v_answer_count >= v_player_count)
      or clock_timestamp() >= v_room.question_started_at
        + make_interval(secs => v_question.time_limit_seconds + v_room.current_bonus_seconds) then
      update public.game_rooms
      set
        status = 'reveal',
        reveal_started_at = clock_timestamp()
      where id = v_room.id;
      v_room.status := 'reveal';
      v_room.reveal_started_at := clock_timestamp();
      v_changed := true;
    end if;
  end if;

  if v_room.status = 'reveal'
    and clock_timestamp() >= v_room.reveal_started_at + interval '3 seconds' then
    if v_room.current_question + 1 >= v_room.question_count then
      update public.game_rooms
      set
        status = 'finished',
        finished_at = clock_timestamp(),
        current_bonus_seconds = 0
      where id = v_room.id;
    else
      update public.game_rooms
      set
        status = 'playing',
        current_question = current_question + 1,
        question_started_at = clock_timestamp(),
        reveal_started_at = null,
        current_bonus_seconds = 0,
        paused_at = null,
        paused_elapsed_ms = null
      where id = v_room.id;
    end if;
    v_changed := true;
  end if;

  if v_changed then
    perform public.notify_game(v_room.id);
  end if;
  return v_changed;
end;
$$;

revoke execute on function public.shuffle_question_options(jsonb, smallint)
  from public, anon, authenticated;
revoke execute on function public.build_game_snapshot_with_time_limits(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.build_game_snapshot(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.sync_game_state_by_id(uuid)
  from public, anon, authenticated;

create or replace function public.get_host_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.game_rooms
    where id = p_room_id
      and host_id = auth.uid()
  ) then
    raise exception 'Bạn không có quyền xem phòng này.';
  end if;

  perform public.sync_game_state_by_id(p_room_id);
  return public.build_game_snapshot(p_room_id, null, true);
end;
$$;

create or replace function public.get_player_game(
  p_room_token uuid,
  p_player_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_player_id uuid;
begin
  select room.id, player.id
  into v_room_id, v_player_id
  from public.game_rooms as room
  join public.game_players as player
    on player.room_id = room.id
  where room.public_token = p_room_token
    and player.player_token = p_player_token;

  if v_room_id is null then
    raise exception 'Không tìm thấy người chơi trong phòng.';
  end if;

  update public.game_players
  set last_seen_at = clock_timestamp()
  where id = v_player_id;

  perform public.sync_game_state_by_id(v_room_id);
  return public.build_game_snapshot(v_room_id, p_player_token, false);
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
    select 1
    from public.game_players
    where room_id = v_room.id
      and lower(name) = lower(v_name)
      and player_token <> p_player_token
  ) then
    raise exception 'Tên này đã có người sử dụng. Bạn có thể chọn kết nối lại nếu đây là tên của mình.';
  end if;

  insert into public.game_players (
    room_id,
    player_token,
    name,
    last_seen_at
  )
  values (
    v_room.id,
    p_player_token,
    v_name,
    clock_timestamp()
  )
  on conflict (room_id, player_token)
  do update set
    name = excluded.name,
    last_seen_at = clock_timestamp()
  returning id into v_player_id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, p_player_token, false);
end;
$$;

create or replace function public.reclaim_game_player(
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
  v_player public.game_players%rowtype;
  v_name text := trim(p_name);
begin
  select * into v_room
  from public.game_rooms
  where public_token = p_room_token
  for update;

  if not found or v_room.status = 'finished' then
    raise exception 'Phiên thi đã kết thúc, không thể kết nối lại.';
  end if;

  select * into v_player
  from public.game_players
  where room_id = v_room.id
    and lower(name) = lower(v_name)
  for update;

  if not found then
    raise exception 'Không tìm thấy tên này trong phòng.';
  end if;

  if v_player.player_token <> p_player_token
    and v_player.last_seen_at >= clock_timestamp() - interval '15 seconds' then
    raise exception 'Tên này vẫn đang trực tuyến trên một thiết bị khác.';
  end if;

  delete from public.game_players
  where room_id = v_room.id
    and player_token = p_player_token
    and id <> v_player.id;

  update public.game_players
  set
    player_token = p_player_token,
    last_seen_at = clock_timestamp()
  where id = v_player.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, p_player_token, false);
end;
$$;

create or replace function public.submit_game_answer(
  p_room_token uuid,
  p_player_token uuid,
  p_selected_option smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question public.game_questions%rowtype;
  v_player_id uuid;
  v_response_ms integer;
  v_limit_seconds integer;
  v_is_correct boolean;
  v_points integer;
begin
  if p_selected_option < 0 or p_selected_option > 3 then
    raise exception 'Đáp án không hợp lệ.';
  end if;

  select * into v_room
  from public.game_rooms
  where public_token = p_room_token
  for update;

  if not found then
    raise exception 'Liên kết phòng không hợp lệ.';
  end if;

  if v_room.status <> 'playing' then
    raise exception 'Câu hỏi đang tạm dừng, chưa mở hoặc đã kết thúc.';
  end if;

  select * into v_question
  from public.game_questions
  where room_id = v_room.id
    and position = v_room.current_question;

  if not found then
    raise exception 'Không tìm thấy câu hỏi hiện tại.';
  end if;

  v_limit_seconds := v_question.time_limit_seconds + v_room.current_bonus_seconds;
  v_response_ms := greatest(
    0,
    floor(extract(epoch from (clock_timestamp() - v_room.question_started_at)) * 1000)::integer
  );

  if v_response_ms > v_limit_seconds * 1000 then
    raise exception 'Đã hết thời gian trả lời.';
  end if;

  select id into v_player_id
  from public.game_players
  where room_id = v_room.id
    and player_token = p_player_token;

  if v_player_id is null then
    raise exception 'Không tìm thấy người chơi.';
  end if;

  if exists (
    select 1 from public.game_answers
    where player_id = v_player_id
      and game_question_id = v_question.id
  ) then
    raise exception 'Bạn đã trả lời câu hỏi này.';
  end if;

  v_is_correct := p_selected_option = v_question.correct_option;
  v_points := case
    when not v_is_correct then 0
    when v_room.scoring_mode = 'accuracy' then 1000
    else 1000 + greatest(
      0,
      round(
        1000 * (
          1 - v_response_ms::numeric / (v_limit_seconds * 1000)
        )
      )::integer
    )
  end;

  insert into public.game_answers (
    room_id,
    game_question_id,
    player_id,
    selected_option,
    is_correct,
    response_ms,
    points
  )
  values (
    v_room.id,
    v_question.id,
    v_player_id,
    p_selected_option,
    v_is_correct,
    v_response_ms,
    v_points
  );

  update public.game_players
  set
    score = score + v_points,
    last_seen_at = clock_timestamp()
  where id = v_player_id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, p_player_token, false);
end;
$$;

create or replace function public.remove_game_player(
  p_room_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
    and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền quản lý phòng này.';
  end if;

  if v_room.status <> 'waiting' then
    raise exception 'Chỉ có thể xóa học sinh trước khi bắt đầu.';
  end if;

  delete from public.game_players
  where id = p_player_id
    and room_id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.start_game_now(p_room_id uuid)
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
  where id = p_room_id
    and host_id = auth.uid()
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

  if v_player_count < 1 or v_ready_count <> v_player_count then
    raise exception 'Cần ít nhất một học sinh và tất cả phải sẵn sàng.';
  end if;

  update public.game_rooms
  set
    max_players = v_player_count,
    status = 'countdown',
    started_at = clock_timestamp(),
    question_started_at = clock_timestamp() + interval '3 seconds'
  where id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

revoke execute on function public.get_host_game(uuid)
  from public, anon, authenticated;
grant execute on function public.get_host_game(uuid) to authenticated;
revoke execute on function public.get_player_game(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_player_game(uuid, uuid) to anon, authenticated;
revoke execute on function public.join_game(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.join_game(uuid, uuid, text) to anon, authenticated;
revoke execute on function public.reclaim_game_player(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reclaim_game_player(uuid, uuid, text) to anon, authenticated;
revoke execute on function public.submit_game_answer(uuid, uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.submit_game_answer(uuid, uuid, smallint) to anon, authenticated;
revoke execute on function public.remove_game_player(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_game_player(uuid, uuid) to authenticated;
revoke execute on function public.start_game_now(uuid)
  from public, anon, authenticated;
grant execute on function public.start_game_now(uuid) to authenticated;

create or replace function public.pause_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question public.game_questions%rowtype;
  v_elapsed_ms integer;
  v_limit_ms integer;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
    and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status = 'paused' then
    return public.build_game_snapshot(v_room.id, null, true);
  end if;

  if v_room.status <> 'playing' then
    raise exception 'Chỉ có thể tạm dừng khi câu hỏi đang diễn ra.';
  end if;

  select * into v_question
  from public.game_questions
  where room_id = v_room.id
    and position = v_room.current_question;

  v_limit_ms := (v_question.time_limit_seconds + v_room.current_bonus_seconds) * 1000;
  v_elapsed_ms := least(
    v_limit_ms,
    greatest(
      0,
      floor(extract(epoch from (clock_timestamp() - v_room.question_started_at)) * 1000)::integer
    )
  );

  update public.game_rooms
  set
    status = 'paused',
    paused_at = clock_timestamp(),
    paused_elapsed_ms = v_elapsed_ms
  where id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.resume_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
    and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status <> 'paused' then
    raise exception 'Phòng hiện không ở trạng thái tạm dừng.';
  end if;

  update public.game_rooms
  set
    status = 'playing',
    question_started_at = clock_timestamp()
      - make_interval(secs => coalesce(paused_elapsed_ms, 0) / 1000.0),
    paused_at = null,
    paused_elapsed_ms = null
  where id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.add_game_time(
  p_room_id uuid,
  p_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  if p_seconds < 1 or p_seconds > 60 then
    raise exception 'Mỗi lần chỉ có thể cộng từ 1 đến 60 giây.';
  end if;

  select * into v_room
  from public.game_rooms
  where id = p_room_id
    and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status not in ('playing', 'paused') then
    raise exception 'Chỉ có thể cộng giờ khi câu hỏi đang diễn ra hoặc tạm dừng.';
  end if;

  update public.game_rooms
  set current_bonus_seconds = least(300, current_bonus_seconds + p_seconds)
  where id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.skip_game_question(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
    and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status not in ('playing', 'paused', 'reveal') then
    raise exception 'Chưa thể bỏ qua câu hỏi ở trạng thái hiện tại.';
  end if;

  if v_room.current_question + 1 >= v_room.question_count then
    update public.game_rooms
    set
      status = 'finished',
      finished_at = clock_timestamp(),
      current_bonus_seconds = 0,
      paused_at = null,
      paused_elapsed_ms = null
    where id = v_room.id;
  else
    update public.game_rooms
    set
      status = 'playing',
      current_question = current_question + 1,
      question_started_at = clock_timestamp(),
      reveal_started_at = null,
      current_bonus_seconds = 0,
      paused_at = null,
      paused_elapsed_ms = null
    where id = v_room.id;
  end if;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.create_game(p_question_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.question_sets%rowtype;
  v_room public.game_rooms%rowtype;
  v_question public.questions%rowtype;
  v_question_count integer;
  v_position integer := 0;
  v_answer_data jsonb;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để mở phòng.';
  end if;

  select * into v_set
  from public.question_sets
  where id = p_question_set_id
    and owner_id = auth.uid();

  if not found then
    raise exception 'Không tìm thấy bộ đề.';
  end if;

  if not v_set.is_published then
    raise exception 'Hãy xuất bản bộ đề trước khi mở phòng.';
  end if;

  select count(*)::integer into v_question_count
  from public.questions
  where set_id = v_set.id;

  if v_question_count = 0 then
    raise exception 'Bộ đề chưa có câu hỏi.';
  end if;

  insert into public.game_rooms (
    host_id,
    question_set_id,
    title,
    time_limit_seconds,
    question_count,
    shuffle_questions,
    shuffle_options,
    scoring_mode
  )
  values (
    auth.uid(),
    v_set.id,
    v_set.title,
    v_set.time_limit_seconds,
    v_question_count,
    v_set.shuffle_questions,
    v_set.shuffle_options,
    v_set.scoring_mode
  )
  returning * into v_room;

  for v_question in
    select *
    from public.questions
    where set_id = v_set.id
    order by
      case when v_set.shuffle_questions then random() else position::double precision end,
      created_at
  loop
    v_answer_data := case
      when v_set.shuffle_options
        then public.shuffle_question_options(v_question.options, v_question.correct_option)
      else jsonb_build_object(
        'options', v_question.options,
        'correct_option', v_question.correct_option
      )
    end;

    insert into public.game_questions (
      room_id,
      position,
      prompt,
      options,
      correct_option,
      time_limit_seconds
    )
    values (
      v_room.id,
      v_position,
      v_question.prompt,
      v_answer_data -> 'options',
      (v_answer_data ->> 'correct_option')::smallint,
      coalesce(v_question.time_limit_seconds, v_set.time_limit_seconds)
    );

    v_position := v_position + 1;
  end loop;

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
  if p_max_players < 1 or p_max_players > 100 then
    raise exception 'Số học sinh phải từ 1 đến 100.';
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
  v_active_status text;
  v_snapshot jsonb;
  v_game_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để mở phòng.';
  end if;

  if p_max_players < 1 or p_max_players > 100 then
    raise exception 'Số học sinh phải từ 1 đến 100.';
  end if;

  insert into public.game_lobbies (owner_id)
  values (auth.uid())
  on conflict (owner_id)
  do update set updated_at = clock_timestamp()
  returning * into v_lobby;

  if v_lobby.active_game_id is not null then
    select status into v_active_status
    from public.game_rooms
    where id = v_lobby.active_game_id;

    if v_active_status in ('waiting', 'countdown', 'playing', 'paused', 'reveal') then
      raise exception 'Bạn đang có một phiên hoạt động. Hãy tiếp tục hoặc đóng phiên đó trước khi mở phiên mới.';
    end if;
  end if;

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

create or replace function public.list_game_history()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', summary.id,
        'title', summary.title,
        'created_at', summary.created_at,
        'started_at', summary.started_at,
        'finished_at', summary.finished_at,
        'question_count', summary.question_count,
        'player_count', summary.player_count,
        'average_score', summary.average_score,
        'answer_count', summary.answer_count,
        'correct_count', summary.correct_count,
        'scoring_mode', summary.scoring_mode
      )
      order by summary.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select
      room.id,
      room.title,
      room.created_at,
      room.started_at,
      room.finished_at,
      room.question_count,
      room.scoring_mode,
      (select count(*)::integer from public.game_players as history_player where history_player.room_id = room.id) as player_count,
      (select coalesce(round(avg(history_player.score))::integer, 0) from public.game_players as history_player where history_player.room_id = room.id) as average_score,
      (select count(*)::integer from public.game_answers as history_answer where history_answer.room_id = room.id) as answer_count,
      (select count(*)::integer from public.game_answers as history_answer where history_answer.room_id = room.id and history_answer.is_correct) as correct_count
    from public.game_rooms as room
    where room.host_id = auth.uid()
      and room.status = 'finished'
  ) as summary;
$$;

create or replace function public.get_game_history(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.game_rooms
    where id = p_room_id
      and host_id = auth.uid()
      and status = 'finished'
  ) then
    raise exception 'Không tìm thấy lịch sử phiên thi này.';
  end if;

  return public.build_game_snapshot(p_room_id, null, true);
end;
$$;

create or replace function public.move_question(
  p_question_id uuid,
  p_direction integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question public.questions%rowtype;
  v_neighbor public.questions%rowtype;
begin
  if p_direction not in (-1, 1) then
    raise exception 'Hướng sắp xếp không hợp lệ.';
  end if;

  select question.* into v_question
  from public.questions as question
  join public.question_sets as question_set on question_set.id = question.set_id
  where question.id = p_question_id
    and question_set.owner_id = auth.uid()
  for update of question;

  if not found then
    raise exception 'Không tìm thấy câu hỏi.';
  end if;

  if p_direction = -1 then
    select * into v_neighbor
    from public.questions
    where set_id = v_question.set_id
      and position < v_question.position
    order by position desc, created_at desc
    limit 1
    for update;
  else
    select * into v_neighbor
    from public.questions
    where set_id = v_question.set_id
      and position > v_question.position
    order by position, created_at
    limit 1
    for update;
  end if;

  if v_neighbor.id is null then
    return;
  end if;

  update public.questions
  set position = case
    when id = v_question.id then v_neighbor.position
    when id = v_neighbor.id then v_question.position
    else position
  end
  where id in (v_question.id, v_neighbor.id);
end;
$$;

create or replace function public.duplicate_question(p_question_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question public.questions%rowtype;
  v_new_id uuid;
  v_position integer;
begin
  select question.* into v_question
  from public.questions as question
  join public.question_sets as question_set on question_set.id = question.set_id
  where question.id = p_question_id
    and question_set.owner_id = auth.uid();

  if not found then
    raise exception 'Không tìm thấy câu hỏi.';
  end if;

  select coalesce(max(position), -1) + 1
  into v_position
  from public.questions
  where set_id = v_question.set_id;

  insert into public.questions (
    set_id,
    prompt,
    options,
    correct_option,
    time_limit_seconds,
    position
  )
  values (
    v_question.set_id,
    v_question.prompt,
    v_question.options,
    v_question.correct_option,
    v_question.time_limit_seconds,
    v_position
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

create or replace function public.duplicate_question_set(p_set_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.question_sets%rowtype;
  v_new_set_id uuid;
  v_position integer;
begin
  select * into v_set
  from public.question_sets
  where id = p_set_id
    and owner_id = auth.uid();

  if not found then
    raise exception 'Không tìm thấy bộ đề.';
  end if;

  select coalesce(max(position), -1) + 1
  into v_position
  from public.question_sets
  where owner_id = auth.uid()
    and folder_id is not distinct from v_set.folder_id;

  insert into public.question_sets (
    owner_id,
    title,
    topic,
    description,
    is_published,
    time_limit_seconds,
    folder_id,
    position,
    shuffle_questions,
    shuffle_options,
    scoring_mode
  )
  values (
    auth.uid(),
    left(v_set.title || ' (bản sao)', 120),
    v_set.topic,
    v_set.description,
    false,
    v_set.time_limit_seconds,
    v_set.folder_id,
    v_position,
    v_set.shuffle_questions,
    v_set.shuffle_options,
    v_set.scoring_mode
  )
  returning id into v_new_set_id;

  insert into public.questions (
    set_id,
    prompt,
    options,
    correct_option,
    time_limit_seconds,
    position
  )
  select
    v_new_set_id,
    prompt,
    options,
    correct_option,
    time_limit_seconds,
    position
  from public.questions
  where set_id = v_set.id
  order by position, created_at;

  return v_new_set_id;
end;
$$;

revoke execute on function public.pause_game(uuid) from public, anon, authenticated;
grant execute on function public.pause_game(uuid) to authenticated;
revoke execute on function public.resume_game(uuid) from public, anon, authenticated;
grant execute on function public.resume_game(uuid) to authenticated;
revoke execute on function public.add_game_time(uuid, integer) from public, anon, authenticated;
grant execute on function public.add_game_time(uuid, integer) to authenticated;
revoke execute on function public.skip_game_question(uuid) from public, anon, authenticated;
grant execute on function public.skip_game_question(uuid) to authenticated;
revoke execute on function public.create_game(uuid, integer) from public, anon, authenticated;
grant execute on function public.create_game(uuid, integer) to authenticated;
revoke execute on function public.create_game_session(uuid, integer) from public, anon, authenticated;
grant execute on function public.create_game_session(uuid, integer) to authenticated;
revoke execute on function public.list_game_history() from public, anon, authenticated;
grant execute on function public.list_game_history() to authenticated;
revoke execute on function public.get_game_history(uuid) from public, anon, authenticated;
grant execute on function public.get_game_history(uuid) to authenticated;
revoke execute on function public.move_question(uuid, integer) from public, anon, authenticated;
grant execute on function public.move_question(uuid, integer) to authenticated;
revoke execute on function public.duplicate_question(uuid) from public, anon, authenticated;
grant execute on function public.duplicate_question(uuid) to authenticated;
revoke execute on function public.duplicate_question_set(uuid) from public, anon, authenticated;
grant execute on function public.duplicate_question_set(uuid) to authenticated;
