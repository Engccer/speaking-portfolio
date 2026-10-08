# Supabase 설정

1. 학교 Google 계정으로 https://supabase.com 에 로그인해 새 프로젝트를 만든다(리전 Northeast Asia (Seoul)).
2. Project Settings > API에서 URL, anon 키, service_role 키를 복사해 `config.js`(URL·anon)와 `.env`(URL·service)에 넣는다.
3. 마이그레이션 적용. 둘 중 하나:
   - `supabase login`(학교 계정) → `supabase link --project-ref <ref>` → `supabase db push`
   - 또는 대시보드 SQL Editor에 `migrations/0001_init.sql` 전체를 붙여 넣고 실행
4. `python scripts/seed_students.py "<플랭스쿨 연습 기록 폴더>"` 로 명렬 적재.
5. `python scripts/upload_audio.py "<교과서 듣기 음원 폴더>"` 로 공식 음원 9개 업로드.
6. `python -m pytest tests/test_rls.py -q` 로 보안 정책 검증(실서버 호출, `.env`·`config.js` 필요).
