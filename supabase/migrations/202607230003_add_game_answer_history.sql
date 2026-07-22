alter function public.build_game_snapshot(uuid, uuid, boolean)
  rename to build_game_snapshot_with_lobby;

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
  v_history jsonb := '[]'::jsonb;
begin
  v_snapshot := public.build_game_snapshot_with_lobby(
    p_room_id,
    p_player_token,
    p_include_answers
  );

  select room.status
  into v_room_status
  from public.game_rooms as room
  where room.id = p_room_id;

  if coalesce(p_include_answers, false) and v_room_status = 'finished' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'position', question.position,
          'prompt', question.prompt,
          'options', question.options,
          'correct_option', question.correct_option,
          'answers', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'player_id', answer.player_id,
                  'selected_option', answer.selected_option,
                  'is_correct', answer.is_correct,
                  'response_ms', answer.response_ms,
                  'points', answer.points
                )
                order by answer.answered_at
              )
              from public.game_answers as answer
              where answer.room_id = p_room_id
                and answer.game_question_id = question.id
            ),
            '[]'::jsonb
          )
        )
        order by question.position
      ),
      '[]'::jsonb
    )
    into v_history
    from public.game_questions as question
    where question.room_id = p_room_id;
  end if;

  return jsonb_set(v_snapshot, '{history}', v_history, true);
end;
$$;

revoke execute on function public.build_game_snapshot_with_lobby(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.build_game_snapshot(uuid, uuid, boolean)
  from public, anon, authenticated;
