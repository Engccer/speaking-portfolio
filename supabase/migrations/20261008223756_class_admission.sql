-- exam_open 저장값은 호환성을 위해 유지하며, 연습과 실전의 공통 입장 상태로 사용한다.
create or replace function public.check_in(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  class_open boolean;
  teacher boolean;
begin
  if not public.is_valid_student(p_class, p_number, p_name) then
    return jsonb_build_object('ok', false, 'reason', null,
      'class_open', null, 'exam_open', null, 'submitted', null, 'is_teacher', false);
  end if;
  class_open := public.is_exam_open(p_class);
  teacher := private.is_teacher(p_class, p_number, p_name);
  return jsonb_build_object(
    'ok', class_open or teacher,
    'reason', case when not class_open and not teacher then 'class_closed' else null end,
    'class_open', class_open,
    'exam_open', class_open,
    'submitted', exists (select 1 from public.submissions where class = p_class and number = p_number),
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

create function public.teacher_set_class_open(p_class int, p_number int, p_name text, p_target_class int, p_open boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select result || jsonb_build_object('class_open', result -> 'exam_open')
  from (select private.teacher_set_exam_open(p_class, p_number, p_name, p_target_class, p_open) as result) changed
$$;
revoke all on function public.teacher_set_class_open(int, int, text, int, boolean) from public, anon, authenticated;
grant execute on function public.teacher_set_class_open(int, int, text, int, boolean) to anon;

drop policy "anon insert practice submission" on public.practice_submissions;
create policy "anon insert practice submission" on public.practice_submissions
  for insert to anon
  with check (
    public.is_valid_student(class, number, name)
    and public.is_exam_open(class)
  );

-- 앱 경로: exam/3-반/3-반-번호/시도/파일.wav 또는 practice/3-반/3-반-번호/파일.wav.
-- 잘못된 경로는 형 변환 전에 거절하고, 상위·하위 폴더의 반이 같은지 확인한다.
create function private.recording_class_is_open(p_path text)
returns boolean language plpgsql security invoker set search_path = '' stable as $$
declare parts text[];
begin
  parts := regexp_match(p_path,
    '^(exam|practice)/3-([0-9]{2,5})/3-([0-9]{2,5})-[0-9]{2,5}/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?[.]wav$');
  if parts is null or parts[2] <> parts[3] then return false; end if;
  return public.is_exam_open(parts[2]::int);
end $$;
revoke all on function private.recording_class_is_open(text) from public, anon, authenticated;
grant execute on function private.recording_class_is_open(text) to anon;

drop policy "anon upload recordings" on storage.objects;
create policy "anon upload recordings" on storage.objects
  for insert to anon
  with check (bucket_id = 'recordings' and private.recording_class_is_open(name));
