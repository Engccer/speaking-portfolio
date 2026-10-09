create extension if not exists pgcrypto;

create table public.students (
  class smallint not null,
  number smallint not null,
  name text not null,
  primary key (class, number)
);

create table public.settings (
  class smallint primary key,
  exam_open boolean not null default false
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  class smallint not null,
  number smallint not null,
  name text not null,
  dialogue_ids text[] not null check (cardinality(dialogue_ids) = 2),
  turn_offsets jsonb not null,
  files text[] not null check (cardinality(files) = 2),
  durations numeric[] not null check (cardinality(durations) = 2),
  user_agent text,
  submitted_at timestamptz not null default now(),
  unique (class, number)
);

create table public.practice_submissions (
  id uuid primary key default gen_random_uuid(),
  class smallint not null,
  number smallint not null,
  name text not null,
  dialogue_id text not null,
  turn_offsets jsonb not null,
  file text not null,
  duration numeric not null,
  user_agent text,
  submitted_at timestamptz not null default now()
);

alter table public.students enable row level security;
alter table public.settings enable row level security;
alter table public.submissions enable row level security;
alter table public.practice_submissions enable row level security;

-- 프로젝트 기본 권한에 기대지 않고 anon이 쓸 수 있는 것을 명시한다. 행 단위 허용은 아래 정책이 정한다.
grant insert on public.submissions to anon;
grant insert on public.practice_submissions to anon;

-- 이름 비교: 모든 공백(반각·전각) 제거
create or replace function public.norm_name(t text) returns text
language sql immutable as $$
  select regexp_replace(coalesce(t, ''), '[[:space:]　]', '', 'g')
$$;

create or replace function public.is_valid_student(p_class int, p_number int, p_name text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.students s
    where s.class = p_class and s.number = p_number
      and public.norm_name(s.name) = public.norm_name(p_name)
  )
$$;

create or replace function public.is_exam_open(p_class int)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select exam_open from public.settings where class = p_class), false)
$$;

create or replace function public.check_in(p_class int, p_number int, p_name text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
begin
  if not public.is_valid_student(p_class, p_number, p_name) then
    return jsonb_build_object('ok', false, 'exam_open', null, 'submitted', null);
  end if;
  return jsonb_build_object(
    'ok', true,
    'exam_open', public.is_exam_open(p_class),
    'submitted', exists (select 1 from public.submissions
                         where class = p_class and number = p_number)
  );
end $$;

revoke all on function public.norm_name(text) from public;
revoke all on function public.is_valid_student(int, int, text) from public;
revoke all on function public.is_exam_open(int) from public;
revoke all on function public.check_in(int, int, text) from public;
grant execute on function public.norm_name(text) to anon;
grant execute on function public.check_in(int, int, text) to anon;
-- RLS 정책 본문은 anon 권한으로 아래 두 함수를 호출하므로 실행 권한이 필요하다.
grant execute on function public.is_valid_student(int, int, text) to anon;
grant execute on function public.is_exam_open(int) to anon;

-- students, settings: 정책 없음 → anon 전면 차단.
create policy "anon insert exam submission" on public.submissions
  for insert to anon
  with check (
    public.is_valid_student(class, number, name)
    and public.is_exam_open(class)
  );

create policy "anon insert practice submission" on public.practice_submissions
  for insert to anon
  with check (public.is_valid_student(class, number, name));

-- Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 20971520, array['audio/mpeg']),
       ('recordings', 'recordings', false, 20971520, array['audio/wav', 'audio/x-wav', 'audio/wave']);

create policy "anon read official audio" on storage.objects
  for select to anon using (bucket_id = 'audio');

create policy "anon upload recordings" on storage.objects
  for insert to anon
  with check (bucket_id = 'recordings'
              and (name like 'exam/%' or name like 'practice/%'));
