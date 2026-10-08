create or replace function public.check_in(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  class_open boolean;
  teacher boolean;
begin
  if not public.is_valid_student(p_class, p_number, p_name) then
    return jsonb_build_object('ok', false, 'reason', null,
      'class_open', null, 'exam_open', null, 'submitted', null,
      'practice_completed', null, 'is_teacher', false);
  end if;
  class_open := public.is_exam_open(p_class);
  teacher := private.is_teacher(p_class, p_number, p_name);
  return jsonb_build_object(
    'ok', class_open or teacher,
    'reason', case when not class_open and not teacher then 'class_closed' else null end,
    'class_open', class_open,
    'exam_open', class_open,
    'submitted', exists (select 1 from public.submissions where class = p_class and number = p_number),
    'practice_completed', exists (
      select 1 from public.practice_submissions where class = p_class and number = p_number
    ),
    'is_teacher', teacher
  );
end $$;

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
      'class_open', coalesce(st.exam_open, false),
      'exam_open', coalesce(st.exam_open, false),
      'students', jsonb_agg(jsonb_build_object(
        'number', s.number, 'name', s.name, 'submission_id', sub.id, 'submitted_at', sub.submitted_at,
        'dialogue_ids', coalesce(sub.dialogue_ids, '{}'::text[]),
        'files', coalesce(sub.files, '{}'::text[]),
        'durations', coalesce(sub.durations, '{}'::numeric[]),
        'practice_submissions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', practice.id, 'dialogue_id', practice.dialogue_id,
            'file', practice.file, 'submitted_at', practice.submitted_at
          ) order by practice.submitted_at desc, practice.id desc), '[]'::jsonb)
          from public.practice_submissions practice
          where practice.class = s.class and practice.number = s.number
        )
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
