alter table public.question_sets
  add column if not exists time_limit_seconds smallint not null default 20
  check (time_limit_seconds between 5 and 120);

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  question_set_id uuid references public.question_sets(id) on delete set null,
  title text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'countdown', 'playing', 'reveal', 'finished')),
  time_limit_seconds smallint not null check (time_limit_seconds between 5 and 120),
  current_question integer not null default 0 check (current_question >= 0),
  question_count integer not null check (question_count > 0),
  question_started_at timestamptz,
  reveal_started_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.game_questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  position integer not null check (position >= 0),
  prompt text not null,
  options jsonb not null check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) = 4
  ),
  correct_option smallint not null check (correct_option between 0 and 3),
  unique (room_id, position)
);

create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  player_token uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 30),
  is_ready boolean not null default false,
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  unique (room_id, player_token)
);

create unique index if not exists game_players_room_name_idx
  on public.game_players (room_id, lower(name));

create table if not exists public.game_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  game_question_id uuid not null references public.game_questions(id) on delete cascade,
  player_id uuid not null references public.game_players(id) on delete cascade,
  selected_option smallint not null check (selected_option between 0 and 3),
  is_correct boolean not null,
  response_ms integer not null check (response_ms >= 0),
  points integer not null check (points >= 0),
  answered_at timestamptz not null default now(),
  unique (player_id, game_question_id)
);

create index if not exists game_rooms_host_created_idx
  on public.game_rooms (host_id, created_at desc);
create index if not exists game_players_room_joined_idx
  on public.game_players (room_id, joined_at);
create index if not exists game_answers_room_question_idx
  on public.game_answers (room_id, game_question_id);

alter table public.game_rooms enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_players enable row level security;
alter table public.game_answers enable row level security;

revoke all on public.game_rooms from anon;
revoke all on public.game_questions from anon;
revoke all on public.game_players from anon;
revoke all on public.game_answers from anon;

grant select on public.game_rooms to authenticated;
grant select on public.game_questions to authenticated;
grant select on public.game_players to authenticated;
grant select on public.game_answers to authenticated;

create policy "Hosts read their game rooms"
on public.game_rooms for select to authenticated
using ((select auth.uid()) = host_id);

create policy "Hosts read their game questions"
on public.game_questions for select to authenticated
using (
  exists (
    select 1 from public.game_rooms
    where game_rooms.id = game_questions.room_id
      and game_rooms.host_id = (select auth.uid())
  )
);

create policy "Hosts read their game players"
on public.game_players for select to authenticated
using (
  exists (
    select 1 from public.game_rooms
    where game_rooms.id = game_players.room_id
      and game_rooms.host_id = (select auth.uid())
  )
);

create policy "Hosts read their game answers"
on public.game_answers for select to authenticated
using (
  exists (
    select 1 from public.game_rooms
    where game_rooms.id = game_answers.room_id
      and game_rooms.host_id = (select auth.uid())
  )
);

create or replace function public.notify_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_token uuid;
begin
  select public_token into v_public_token
  from public.game_rooms
  where id = p_room_id;

  if v_public_token is not null then
    perform realtime.send(
      jsonb_build_object('room_id', p_room_id, 'changed_at', clock_timestamp()),
      'state',
      'game:' || v_public_token::text,
      false
    );
  end if;
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

  v_response_ms := greatest(
    0,
    floor(extract(epoch from (clock_timestamp() - v_room.question_started_at)) * 1000)::integer
  );

  if v_response_ms > v_room.time_limit_seconds * 1000 then
    raise exception 'Đã hết thời gian trả lời.';
  end if;

  select * into v_question
  from public.game_questions
  where room_id = v_room.id
    and position = v_room.current_question;

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
            1 - v_response_ms::numeric / (v_room.time_limit_seconds * 1000)
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

  if v_player_count <> 5 or v_ready_count <> 5 then
    raise exception 'Cần đủ 5 người chơi ở trạng thái sẵn sàng.';
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

create or replace function public.activate_game(p_room_id uuid)
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
  where id = p_room_id and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status = 'playing' then
    return public.build_game_snapshot(v_room.id, null, true);
  end if;

  if v_room.status <> 'countdown' or clock_timestamp() < v_room.question_started_at then
    raise exception 'Chưa hết thời gian đếm ngược.';
  end if;

  update public.game_rooms
  set status = 'playing'
  where id = v_room.id;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
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
  v_question_id uuid;
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

  select id into v_question_id
  from public.game_questions
  where room_id = v_room.id
    and position = v_room.current_question;

  select count(*)::integer into v_player_count
  from public.game_players
  where room_id = v_room.id;

  select count(*)::integer into v_answer_count
  from public.game_answers
  where room_id = v_room.id
    and game_question_id = v_question_id;

  if v_answer_count < v_player_count
    and clock_timestamp() < v_room.question_started_at
      + make_interval(secs => v_room.time_limit_seconds) then
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

create or replace function public.advance_game(p_room_id uuid)
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
  where id = p_room_id and host_id = auth.uid()
  for update;

  if not found then
    raise exception 'Bạn không có quyền điều khiển phòng này.';
  end if;

  if v_room.status = 'finished' then
    return public.build_game_snapshot(v_room.id, null, true);
  end if;

  if v_room.status <> 'reveal'
    or clock_timestamp() < v_room.reveal_started_at + interval '3 seconds' then
    raise exception 'Chưa đến lúc chuyển câu.';
  end if;

  if v_room.current_question + 1 >= v_room.question_count then
    update public.game_rooms
    set
      status = 'finished',
      finished_at = clock_timestamp()
    where id = v_room.id;
  else
    update public.game_rooms
    set
      status = 'playing',
      current_question = current_question + 1,
      question_started_at = clock_timestamp(),
      reveal_started_at = null
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
    correct_option
  )
  select
    v_room.id,
    row_number() over (order by q.position, q.created_at) - 1,
    q.prompt,
    q.options,
    q.correct_option
  from public.questions q
  where q.set_id = v_set.id
  order by q.position, q.created_at;

  perform public.notify_game(v_room.id);
  return public.build_game_snapshot(v_room.id, null, true);
end;
$$;

create or replace function public.get_host_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.game_rooms
    where id = p_room_id and host_id = auth.uid()
  ) then
    raise exception 'Bạn không có quyền quản lý phòng này.';
  end if;

  return public.build_game_snapshot(p_room_id, null, true);
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
  ) >= 5 then
    raise exception 'Phòng đã đủ 5 người chơi.';
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
begin
  select r.id into v_room_id
  from public.game_rooms r
  join public.game_players p on p.room_id = r.id
  where r.public_token = p_room_token
    and p.player_token = p_player_token;

  if v_room_id is null then
    raise exception 'Bạn chưa tham gia phòng này.';
  end if;

  return public.build_game_snapshot(v_room_id, p_player_token, false);
end;
$$;

create or replace function public.set_player_ready(
  p_room_token uuid,
  p_player_token uuid,
  p_is_ready boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  select id into v_room_id
  from public.game_rooms
  where public_token = p_room_token
    and status = 'waiting'
  for update;

  if v_room_id is null then
    raise exception 'Phòng không còn nhận trạng thái sẵn sàng.';
  end if;

  update public.game_players
  set is_ready = p_is_ready
  where room_id = v_room_id
    and player_token = p_player_token;

  if not found then
    raise exception 'Không tìm thấy người chơi.';
  end if;

  perform public.notify_game(v_room_id);
  return public.build_game_snapshot(v_room_id, p_player_token, false);
end;
$$;

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
  v_room public.game_rooms%rowtype;
  v_players jsonb;
  v_question jsonb;
  v_self jsonb;
  v_stats jsonb;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id;

  if not found then
    raise exception 'Phòng không tồn tại.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'is_ready', p.is_ready,
        'score', p.score,
        'answered', exists (
          select 1
          from public.game_answers a
          join public.game_questions q on q.id = a.game_question_id
          where a.player_id = p.id
            and q.position = v_room.current_question
        )
      )
      order by p.score desc, p.joined_at
    ),
    '[]'::jsonb
  )
  into v_players
  from public.game_players p
  where p.room_id = p_room_id;

  v_question := null;
  if v_room.status in ('playing', 'reveal') then
    select
      jsonb_build_object(
        'id', q.id,
        'position', q.position,
        'prompt', q.prompt,
        'options', q.options
      )
      || case
        when v_room.status = 'reveal' or p_include_answers
          then jsonb_build_object('correct_option', q.correct_option)
        else '{}'::jsonb
      end
    into v_question
    from public.game_questions q
    where q.room_id = p_room_id
      and q.position = v_room.current_question;
  end if;

  v_self := null;
  if p_player_token is not null then
    select jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'is_ready', p.is_ready,
      'score', p.score,
      'selected_option', a.selected_option,
      'points', a.points,
      'is_correct', case when v_room.status in ('reveal', 'finished') then a.is_correct else null end
    )
    into v_self
    from public.game_players p
    left join public.game_questions q
      on q.room_id = p.room_id
      and q.position = v_room.current_question
    left join public.game_answers a
      on a.player_id = p.id
      and a.game_question_id = q.id
    where p.room_id = p_room_id
      and p.player_token = p_player_token;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', s.player_id,
        'name', s.name,
        'score', s.score,
        'answered_count', s.answered_count,
        'correct_count', s.correct_count,
        'average_response_ms', s.average_response_ms
      )
      order by s.score desc, s.average_response_ms, s.joined_at
    ),
    '[]'::jsonb
  )
  into v_stats
  from (
    select
      p.id as player_id,
      p.name,
      p.score,
      p.joined_at,
      count(a.id)::integer as answered_count,
      count(a.id) filter (where a.is_correct)::integer as correct_count,
      coalesce(round(avg(a.response_ms))::integer, 0) as average_response_ms
    from public.game_players p
    left join public.game_answers a on a.player_id = p.id
    where p.room_id = p_room_id
    group by p.id, p.name, p.score, p.joined_at
  ) s;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id,
      'public_token', v_room.public_token,
      'title', v_room.title,
      'status', v_room.status,
      'time_limit_seconds', v_room.time_limit_seconds,
      'current_question', v_room.current_question,
      'question_count', v_room.question_count,
      'question_started_at', v_room.question_started_at,
      'reveal_started_at', v_room.reveal_started_at,
      'started_at', v_room.started_at,
      'finished_at', v_room.finished_at
    ),
    'players', v_players,
    'question', v_question,
    'self', v_self,
    'stats', v_stats
  );
end;
$$;

revoke execute on function public.notify_game(uuid) from public, anon, authenticated;
revoke execute on function public.build_game_snapshot(uuid, uuid, boolean) from public, anon, authenticated;

revoke execute on function public.create_game(uuid) from public, anon, authenticated;
revoke execute on function public.get_host_game(uuid) from public, anon, authenticated;
revoke execute on function public.start_game(uuid) from public, anon, authenticated;
revoke execute on function public.activate_game(uuid) from public, anon, authenticated;
revoke execute on function public.reveal_game(uuid) from public, anon, authenticated;
revoke execute on function public.advance_game(uuid) from public, anon, authenticated;
revoke execute on function public.join_game(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.get_player_game(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_player_ready(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.submit_game_answer(uuid, uuid, smallint) from public, anon, authenticated;

grant execute on function public.create_game(uuid) to authenticated;
grant execute on function public.get_host_game(uuid) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.activate_game(uuid) to authenticated;
grant execute on function public.reveal_game(uuid) to authenticated;
grant execute on function public.advance_game(uuid) to authenticated;

grant execute on function public.join_game(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_player_game(uuid, uuid) to anon, authenticated;
grant execute on function public.set_player_ready(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.submit_game_answer(uuid, uuid, smallint) to anon, authenticated;
