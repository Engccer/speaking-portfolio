alter table public.students add column is_teacher boolean not null default false;
update public.students set is_teacher = true where class = 1 and number = 40;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon;

create function private.is_teacher(p_class int, p_number int, p_name text)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1 from public.students s
    where s.class = p_class and s.number = p_number and s.is_teacher
      and public.norm_name(s.name) = public.norm_name(p_name)
      and public.norm_name(p_name) <> ''
  )
$$;

create or replace function public.check_in(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if not public.is_valid_student(p_class, p_number, p_name) then
    return jsonb_build_object('ok', false, 'exam_open', null, 'submitted', null, 'is_teacher', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'exam_open', public.is_exam_open(p_class),
    'submitted', exists (select 1 from public.submissions where class = p_class and number = p_number),
    'is_teacher', private.is_teacher(p_class, p_number, p_name)
  );
end $$;

create function private.teacher_dashboard(p_class int, p_number int, p_name text)
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
        'number', s.number, 'name', s.name, 'submitted_at', sub.submitted_at,
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

create function public.teacher_dashboard(p_class int, p_number int, p_name text)
returns jsonb language sql security invoker set search_path = '' stable as $$
  select private.teacher_dashboard(p_class, p_number, p_name)
$$;

create function private.teacher_set_exam_open(p_class int, p_number int, p_name text, p_target_class int, p_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_teacher(p_class, p_number, p_name) then
    raise exception '교사 정보를 확인해 주세요.' using errcode = '42501';
  end if;
  if p_open is null or not exists (
    select 1 from public.students s where s.class = p_target_class and not s.is_teacher
  ) then
    raise exception '반 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  insert into public.settings(class, exam_open) values (p_target_class, p_open)
  on conflict (class) do update set exam_open = excluded.exam_open;
  return jsonb_build_object('class', p_target_class, 'exam_open', p_open);
end $$;

create function public.teacher_set_exam_open(p_class int, p_number int, p_name text, p_target_class int, p_open boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.teacher_set_exam_open(p_class, p_number, p_name, p_target_class, p_open)
$$;

-- HTTP 헤더의 한글 이름을 encodeURIComponent 형식에서 복원한다.
create function private.decode_header_name(encoded text)
returns text language plpgsql immutable strict set search_path = '' as $$
declare
  bytes bytea := ''::bytea;
  pos int := 1;
  piece text;
begin
  if length(encoded) > 1024 then return null; end if;
  while pos <= length(encoded) loop
    piece := substr(encoded, pos, 1);
    if piece = '%' then
      if substr(encoded, pos + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
      bytes := bytes || decode(substr(encoded, pos + 1, 2), 'hex');
      pos := pos + 3;
    else
      bytes := bytes || convert_to(piece, 'UTF8');
      pos := pos + 1;
    end if;
  end loop;
  return convert_from(bytes, 'UTF8');
exception when character_not_in_repertoire or untranslatable_character then
  return null;
end $$;

create function private.teacher_can_read_recording(p_path text)
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
    or exists (select 1 from public.practice_submissions where file = p_path);
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end $$;

revoke all on function private.is_teacher(int, int, text) from public;
revoke all on function private.teacher_dashboard(int, int, text) from public;
revoke all on function private.teacher_set_exam_open(int, int, text, int, boolean) from public;
revoke all on function private.decode_header_name(text) from public;
revoke all on function private.teacher_can_read_recording(text) from public;
revoke all on function public.teacher_dashboard(int, int, text) from public;
revoke all on function public.teacher_set_exam_open(int, int, text, int, boolean) from public;
grant execute on function private.teacher_dashboard(int, int, text) to anon;
grant execute on function private.teacher_set_exam_open(int, int, text, int, boolean) to anon;
grant execute on function private.teacher_can_read_recording(text) to anon;
grant execute on function public.teacher_dashboard(int, int, text) to anon;
grant execute on function public.teacher_set_exam_open(int, int, text, int, boolean) to anon;

create policy "teacher read submitted recordings" on storage.objects
  for select to anon
  using (bucket_id = 'recordings' and private.teacher_can_read_recording(name));
