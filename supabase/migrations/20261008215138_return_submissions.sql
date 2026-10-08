-- 되돌린 평가의 원본과 녹음 경로를 보존한다. 학생별 unique 제약은 복사하지 않는다.
create table public.returned_submissions (
  like public.submissions including constraints,
  returned_at timestamptz not null default now(),
  returned_by_class smallint not null,
  returned_by_number smallint not null,
  primary key (id)
);
alter table public.returned_submissions enable row level security;
revoke all on public.returned_submissions from public, anon, authenticated;
grant select on public.returned_submissions to service_role;

create function private.teacher_return_submission(p_class int, p_number int, p_name text, p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare original public.submissions%rowtype;
begin
  if not private.is_teacher(p_class, p_number, p_name) then
    raise exception '교사 정보를 확인해 주세요.' using errcode = '42501';
  end if;
  if p_submission_id is null then
    raise exception '제출 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  -- 정확한 제출 ID에만 적용하여 오래된 화면이나 중복 요청이 새 제출에 영향을 주지 않게 한다.
  delete from public.submissions where id = p_submission_id returning * into original;
  if not found then
    return jsonb_build_object('returned', false, 'submission_id', p_submission_id);
  end if;
  insert into public.returned_submissions (
    id, class, number, name, dialogue_ids, turn_offsets, files, durations, user_agent, submitted_at,
    returned_by_class, returned_by_number
  ) values (
    original.id, original.class, original.number, original.name, original.dialogue_ids,
    original.turn_offsets, original.files, original.durations, original.user_agent, original.submitted_at,
    p_class, p_number
  );
  return jsonb_build_object('returned', true, 'submission_id', original.id,
    'class', original.class, 'number', original.number, 'exam_open', public.is_exam_open(original.class));
end $$;

create function public.teacher_return_submission(p_class int, p_number int, p_name text, p_submission_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.teacher_return_submission(p_class, p_number, p_name, p_submission_id)
$$;
revoke all on function private.teacher_return_submission(int, int, text, uuid) from public, anon, authenticated;
revoke all on function public.teacher_return_submission(int, int, text, uuid) from public, anon, authenticated;
grant execute on function private.teacher_return_submission(int, int, text, uuid) to anon;
grant execute on function public.teacher_return_submission(int, int, text, uuid) to anon;

create or replace function private.teacher_dashboard(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare result jsonb;
begin
  if not private.is_teacher(p_class, p_number, p_name) then
    raise exception '교사 정보를 확인해 주세요.' using errcode = '42501';
  end if;
  select jsonb_build_object('classes', coalesce(jsonb_agg(c.item order by c.class), '[]'::jsonb)) into result
  from (
    select s.class, jsonb_build_object(
      'class', s.class,
      'exam_open', coalesce(st.exam_open, false),
      'students', jsonb_agg(jsonb_build_object(
        'number', s.number, 'name', s.name, 'submission_id', sub.id, 'submitted_at', sub.submitted_at,
        'dialogue_ids', coalesce(sub.dialogue_ids, '{}'::text[]),
        'files', coalesce(sub.files, '{}'::text[]),
        'durations', coalesce(sub.durations, '{}'::numeric[])
      ) order by s.number)
    ) as item
    from public.students s
    left join public.settings st on st.class = s.class
    left join public.submissions sub on sub.class = s.class and sub.number = s.number
    where not s.is_teacher
    group by s.class, st.exam_open
  ) c;
  return result;
end $$;

create or replace function private.teacher_can_read_recording(p_path text)
returns boolean language plpgsql security definer set search_path = '' stable as $$
declare headers jsonb;
begin
  headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if not coalesce(private.is_teacher(
    (headers ->> 'x-teacher-class')::int,
    (headers ->> 'x-teacher-number')::int,
    private.decode_header_name(headers ->> 'x-teacher-name')
  ), false) then return false; end if;
  return exists (select 1 from public.submissions where p_path = any(files))
    or exists (select 1 from public.returned_submissions where p_path = any(files))
    or exists (select 1 from public.practice_submissions where file = p_path);
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end $$;
