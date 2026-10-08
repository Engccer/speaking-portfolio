# speaking-portfolio

신명중 3학년 영어B 말하기 포트폴리오 녹음 평가 도구. 학생은 크롬북에서 대화문 2편을 턴별로 녹음해 한 번 제출한다. 교사는 웹 대시보드에서 제출 현황·녹음을 확인하고 평가를 개방하며, 로컬 스크립트로 전사하고 공식 점수표로 자동 채점한다.

## 명령

- `pip install -r requirements.txt` : 교사 스크립트·테스트 의존성
- `python -m pytest -q` : Python 테스트(채점·다운로드·전사 캐시, 실서버 보안 검증은 `.env`·`config.js`가 있을 때만)
- `npm ci` 후 `npm test` : 추첨·WAV, 학생·교사 화면 흐름, 격리된 PostgreSQL(PGlite) 권한 테스트(Node.js 22.13 이상 또는 24 이상)
- `python -m pytest -q --ignore=tests/test_rls.py` : 운영 서버를 변경하지 않는 Python 테스트
- `python sync_agent_docs.py` : `CLAUDE.md`에서 `AGENTS.md` 재생성, `--check`로 동기화 확인
- `python -m http.server 8765` 후 `http://localhost:8765` : 로컬 실행(`config.example.js`를 `config.js`로 복사해 채운다)

## 문서

- 설계: `docs/superpowers/specs/2026-10-08-speaking-portfolio-design.md`
- 구현 플랜: `docs/superpowers/plans/2026-10-08-speaking-portfolio.md`
- Supabase 설정: `supabase/README.md`

## 배포

`main`에 push하면 `.github/workflows/pages.yml`이 GitHub Secrets(`SUPABASE_URL`, `SUPABASE_ANON_KEY`)로 `config.js`를 만들어 앱 파일만 GitHub Pages에 올린다. 주소: https://engccer.github.io/speaking-portfolio/

처음 한 번: 저장소 Settings > Secrets and variables > Actions에 두 시크릿을 넣고, Settings > Pages의 Source를 "GitHub Actions"로 바꾼다. Supabase 프로젝트·키·계정 분리는 `supabase/README.md`.

## 수업 당일 운영

1. 교사 명렬 정보로 입장하고 대시보드에서 해당 반의 `본 평가 개방하기` 선택(또는 `python scripts/open.py <반>`)
2. 학생은 위 주소에서 입장 → 마이크 테스트 → 본 평가
3. 수업 끝 해당 반의 `본 평가 마감하기` 선택(또는 `python scripts/close.py <반>`)
4. `python scripts/download.py --class <반> "<출력 폴더>"` → `python scripts/transcribe.py "<출력 폴더>"` → `python scripts/score.py "<출력 폴더>"`

학생은 제출 화면에서 `내 녹음 전체 재생하기`로 제출할 병합본을 차례대로 들을 수 있다. 모의 평가를 마친 뒤에는 `처음부터 참여하기`로 입장 화면으로 돌아간다.

## 교사 대시보드 설정

`supabase/migrations/20261008212802_teacher_dashboard.sql`을 서버에 적용한 후 앱을 배포한다. 기존 명렬의 1반 40번 행을 교사로 지정하며, 교사 이름은 서버 명렬에서만 관리한다. 반·번호·이름을 서버가 확인하고, 조회·반 개방 변경·녹음 접근마다 교사 여부를 다시 검사한다. 별도 비밀번호나 Supabase Auth 계정은 사용하지 않는다.

대시보드는 교사 행을 제외한 반별 본 평가 제출·미제출 수와 학생 목록을 표시한다. 학생별 대화 녹음은 5분 유효한 서명 URL로 재생한다. 학생 명렬·제출 테이블의 일반 조회는 계속 차단된다. 이름 기반 식별이므로 교사 반·번호·이름을 아는 사람은 같은 권한으로 접근할 수 있다.
