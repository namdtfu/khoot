alter table public.questions
  add column time_limit_seconds smallint
  check (time_limit_seconds between 5 and 120);

alter table public.game_questions
  add column time_limit_seconds smallint;

update public.game_questions as question
set time_limit_seconds = room.time_limit_seconds
from public.game_rooms as room
where room.id = question.room_id
  and question.time_limit_seconds is null;

alter table public.game_questions
  alter column time_limit_seconds set not null;

alter table public.game_questions
  add constraint game_questions_time_limit_seconds_check
  check (time_limit_seconds between 5 and 120);

alter function public.build_game_snapshot(uuid, uuid, boolean)
  rename to build_game_snapshot_with_answer_history;

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
  v_room_status text;
  v_default_time_limit smallint;
  v_question_time_limit smallint;
  v_current_time_limit smallint;
begin
  v_snapshot := public.build_game_snapshot_with_answer_history(
    p_room_id,
    p_player_token,
    p_include_answers
  );

  select
    room.status,
    room.time_limit_seconds,
    question.time_limit_seconds
  into
    v_room_status,
    v_default_time_limit,
    v_question_time_limit
  from public.game_rooms as room
  left join public.game_questions as question
    on question.room_id = room.id
    and question.position = room.current_question
  where room.id = p_room_id;

  v_current_time_limit := case
    when v_room_status in ('playing', 'reveal')
      then coalesce(v_question_time_limit, v_default_time_limit)
    else v_default_time_limit
  end;

  v_snapshot := jsonb_set(
    v_snapshot,
    '{room,current_time_limit_seconds}',
    to_jsonb(v_current_time_limit),
    true
  );

  if jsonb_typeof(v_snapshot -> 'question') = 'object' then
    v_snapshot := jsonb_set(
      v_snapshot,
      '{question,time_limit_seconds}',
      to_jsonb(coalesce(v_question_time_limit, v_default_time_limit)),
      true
    );
  end if;

  return v_snapshot;
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
    raise exception 'Câu hỏi chưa mở hoặc đã kết thúc.';
  end if;

  select * into v_question
  from public.game_questions
  where room_id = v_room.id
    and position = v_room.current_question;

  if not found then
    raise exception 'Không tìm thấy câu hỏi hiện tại.';
  end if;

  v_response_ms := greatest(
    0,
    floor(extract(epoch from (clock_timestamp() - v_room.question_started_at)) * 1000)::integer
  );

  if v_response_ms > v_question.time_limit_seconds * 1000 then
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
    when v_is_correct then
      1000 + greatest(
        0,
        round(
          1000 * (
            1 - v_response_ms::numeric / (v_question.time_limit_seconds * 1000)
          )
        )::integer
      )
    else 0
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
  set score = score + v_points
  where id = v_player_id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, p_player_token, false);
end;
$$;

create or replace function public.reveal_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_question public.game_questions%rowtype;
  v_player_count integer;
  v_answer_count integer;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status = 'reveal' then
    return public.build_game_snapshot(v_room.id, null, true);
  end if;

  if v_room.status <> 'playing' then
    raise exception 'Câu hỏi chưa bắt đầu.';
  end if;

  select * into v_question
  from public.game_questions
  where room_id = v_room.id
    and position = v_room.current_question;

  if not found then
    raise exception 'Không tìm thấy câu hỏi hiện tại.';
  end if;

  select count(*)::integer into v_player_count
  from public.game_players
  where room_id = v_room.id;

  select count(*)::integer into v_answer_count
  from public.game_answers
  where room_id = v_room.id
    and game_question_id = v_question.id;

  if v_answer_count < v_player_count
    and clock_timestamp() < v_room.question_started_at
      + make_interval(secs => v_question.time_limit_seconds) then
    raise exception 'Câu hỏi vẫn đang diễn ra.';
  end if;

  update public.game_rooms
  set
    status = 'reveal',
    reveal_started_at = clock_timestamp()
  where id = v_room.id;

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
  v_question_count integer;
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
    question_count
  )
  values (
    auth.uid(),
    v_set.id,
    v_set.title,
    v_set.time_limit_seconds,
    v_question_count
  )
  returning * into v_room;

  insert into public.game_questions (
    room_id,
    position,
    prompt,
    options,
    correct_option,
    time_limit_seconds
  )
  select
    v_room.id,
    row_number() over (order by question.position, question.created_at) - 1,
    question.prompt,
    question.options,
    question.correct_option,
    coalesce(question.time_limit_seconds, v_set.time_limit_seconds)
  from public.questions as question
  where question.set_id = v_set.id
  order by question.position, question.created_at;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

revoke execute on function public.build_game_snapshot_with_answer_history(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.build_game_snapshot(uuid, uuid, boolean)
  from public, anon, authenticated;

revoke execute on function public.submit_game_answer(uuid, uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.submit_game_answer(uuid, uuid, smallint)
  to anon, authenticated;

revoke execute on function public.reveal_game(uuid)
  from public, anon, authenticated;
grant execute on function public.reveal_game(uuid)
  to authenticated;
