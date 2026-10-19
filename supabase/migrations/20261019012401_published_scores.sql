create table public.published_scores (
  class smallint not null,
  number smallint not null,
  final_score smallint check (final_score between 0 and 10),
  dialogues jsonb not null check (jsonb_typeof(dialogues) = 'array'),
  note text not null default '',
  published_at timestamptz not null default now(),
  primary key (class, number),
  foreign key (class, number) references public.students(class, number)
);
alter table public.published_scores enable row level security;
revoke all on public.published_scores from public, anon, authenticated;
grant select, insert, update on public.published_scores to service_role;

-- 평가 참여용 check_in은 기존 마감 계약을 유지한다.
create function private.student_portal(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare result jsonb;
begin
  result := public.check_in(p_class, p_number, p_name);
  if result->>'reason' = 'class_closed' then
    result := result || jsonb_build_object('ok', true, 'reason', null);
  end if;
  return result;
end $$;

create function public.student_portal(p_class int, p_number int, p_name text)
returns jsonb language sql security invoker set search_path = '' stable as $$
  select private.student_portal(p_class, p_number, p_name)
$$;

create function private.student_score(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare result jsonb;
begin
  if not public.is_valid_student(p_class, p_number, p_name) then
    raise exception '반, 번호, 이름을 확인하세요.' using errcode = '42501';
  end if;
  select jsonb_build_object('final_score', s.final_score, 'dialogues', s.dialogues,
    'note', s.note, 'published_at', s.published_at) into result
  from public.published_scores s where s.class = p_class and s.number = p_number;
  return result;
end $$;

create function public.student_score(p_class int, p_number int, p_name text)
returns jsonb language sql security invoker set search_path = '' stable as $$
  select private.student_score(p_class, p_number, p_name)
$$;

revoke all on function private.student_portal(int,int,text), public.student_portal(int,int,text),
  private.student_score(int,int,text), public.student_score(int,int,text) from public, authenticated;
grant execute on function private.student_portal(int,int,text), public.student_portal(int,int,text),
  private.student_score(int,int,text), public.student_score(int,int,text) to anon;
