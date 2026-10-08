# Supabase 설정

프로젝트는 학생 명렬과 녹음이 들어가므로 학교 계정 소유로 둔다. 아래는 새로 만들 때와 다른 PC에서 다시 연결할 때의 절차다.

## 1. 프로젝트와 키

1. 학교 계정으로 https://supabase.com 에 로그인해 새 프로젝트를 만든다(리전 Northeast Asia (Seoul)). Supabase MCP 플러그인이 학교 계정으로 인증돼 있으면 `create_project`로 만들어도 된다.
2. URL, anon 키, service_role 키를 `config.js`(URL·anon)와 `.env`(URL·service)에 넣는다. `config.example.js`·`.env.example`를 복사해 채운다.
   - 대시보드: Project Settings > API Keys
   - CLI: `supabase projects api-keys --project-ref <ref> --reveal --output json`

## 2. CLI를 개인 계정과 함께 쓸 때

CLI는 `--profile` 전역 플래그로 계정을 나눌 수 있다(v2.120 기준). 프로필 파일을 하나 만들고 로그인하면 토큰이 프로필 이름으로 따로 저장된다.

```yaml
# ~/.supabase/school.yml
name: school
api_url: https://api.supabase.com
dashboard_url: https://supabase.com/dashboard
docs_url: https://supabase.com/docs
project_host: supabase.co
pooler_host: supabase.com
regions: [ap-northeast-2]
```

```
supabase login --profile ~/.supabase/school.yml
supabase --profile ~/.supabase/school.yml projects list
```

환경변수 `SUPABASE_ACCESS_TOKEN`이 있으면 프로필 토큰보다 우선하므로, 학교 명령은 그 변수를 비운 채 실행한다. 로그인은 실제 터미널에서 해야 브라우저 승인 흐름이 동작한다.

## 3. 스키마·데이터

1. 마이그레이션 적용. 셋 중 하나:
   - MCP 플러그인 `apply_migration`에 `migrations/*.sql` 내용을 순서대로 전달
   - `supabase link --project-ref <ref>` → `supabase db push`
   - 대시보드 SQL Editor에 파일 전체를 붙여 넣고 실행
2. `pip install -r requirements.txt`
3. `python scripts/seed_students.py "<플랭스쿨 연습 기록 폴더>"` 로 명렬 적재.
4. `python scripts/upload_audio.py "<교과서 듣기 음원 폴더>"` 로 공식 음원 9개 업로드.
5. `python -m pytest tests/test_rls.py -q` 로 보안 정책 검증(실서버 호출, `.env`·`config.js` 필요).

## 4. 배포

저장소 Settings > Secrets and variables > Actions에 `SUPABASE_URL`·`SUPABASE_ANON_KEY`를 넣고(`gh secret set`도 됨) Settings > Pages의 Source를 "GitHub Actions"로 둔다. 이후 `main` push마다 자동 배포된다.

## 알아 둘 것

- `students`·`settings`에는 정책이 없어 anon이 읽지 못한다. 보안 어드바이저의 "RLS enabled no policy" 안내와 anon이 `check_in` 계열 security definer 함수를 부를 수 있다는 경고는 설계 의도다.
- anon은 `submissions`·`practice_submissions`에 INSERT만 허용된다. supabase-py로 삽입을 흉내 낼 때는 `returning="minimal"`을 줘야 한다. 기본값은 삽입 행을 되돌려 받는데 SELECT 정책이 없어 RLS 오류가 난다. 앱(supabase-js)은 `select()` 없이 삽입하므로 영향이 없다.
- 저장소 루트의 `supabase/` 폴더는 `supabase` Python 패키지가 설치되지 않았을 때 import를 가로채 `ImportError`를 낸다. 패키지를 설치하면 해결된다.
