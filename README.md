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

1. 교사 명렬 정보로 입장하고 대시보드에서 해당 반의 `입장 열기` 선택(또는 `python scripts/open.py <반>`)
2. 학생은 위 주소에서 입장 → 마이크 테스트 → 본 평가
3. 수업 끝 해당 반의 `마감하기` 선택(또는 `python scripts/close.py <반>`)
4. `python scripts/download.py --class <반> "<출력 폴더>"` → `python scripts/transcribe.py "<출력 폴더>"` → `python scripts/score.py "<출력 폴더>"` `--note-config scripts/scoring_generous.json`

채점표는 `scripts/scoring.json`의 기본 기준(일치율 0.75, 최장 휴지 2.0초, 분당 60단어)으로 점수를 적고, `--note-config`로 준 후한 기준(0.6/2.5/50)에서 최종 점수가 달라지는 학생은 비고에 `후한 기준 적용 시 N점`을 덧붙인다.

학생은 제출 화면에서 `내 녹음 전체 재생하기`로 제출할 병합본을 차례대로 들을 수 있다. 모의 평가는 선택사항이다. 완료 후 `본 평가 시작하기`로 바로 진행하거나 `이전으로 돌아가기`로 입장 상태를 유지한 평가 선택 화면에 돌아간다. 평가 선택 화면에는 서버에 저장된 모의 평가 완료 여부를 표시한다.

입장 후 우측 상단 `퇴장하기`를 누를 수 있다. 본 평가 미제출 상태에서는 퇴장 확인에 본 평가 미응시 안내를 표시한다. 창 닫기·새로고침에는 브라우저 기본 경고를 사용한다. 브라우저 정책상 이 경고의 문구는 지정할 수 없으며, 모바일 앱 강제 종료에는 표시되지 않을 수 있다.

모바일에서는 브라우저가 지원하는 녹음 형식을 자동으로 선택한다. 마이크 테스트 중에는 실시간 파형과 빨간 녹음 표시를 보여 주며, 동작 줄이기 설정에서는 정적으로 표시한다. 마이크 테스트 음성이 자동으로 재생되지 않으면 표시된 오디오 재생 버튼을 누른다. 녹음 정지 후 같은 버튼에서 다시 녹음할 수 있으며, 다른 앱으로 이동하거나 화면을 잠그면 진행 중인 녹음을 정지해 보관한다. 대사는 화자별 파랑·자주색과 실선·이중선 테두리로 구분한다.

학급 개방은 모의 평가와 본 평가 참여를 함께 제어한다. 닫힌 반도 입장해 `내 점수 확인하기`로 게시된 결과를 볼 수 있지만 평가 시작·제출은 차단된다. 녹음 도중 닫히면 제출 화면에서 안내하고 녹음을 유지한다. 창을 닫지 않은 상태에서 교사가 다시 열면 제출을 재시도할 수 있다.

## 학생 점수 게시

`supabase/migrations/20261019012401_published_scores.sql`을 적용한 뒤 학생 확인용 인쇄 결과표를 게시한다.

```text
python scripts/publish_scores.py "<채점 결과 인쇄용 폴더>"
python scripts/publish_scores.py "<채점 결과 인쇄용 폴더>" --publish
```

첫 명령은 파일 형식·점수 범위·서버 명렬을 검증한다. `--publish`는 해당 폴더의 `3학년 N반 말하기 포트폴리오 결과표.xlsx` 값을 서버에 게시하고 전수 대조한다. 이후 인쇄표를 수정하거나 다른 반 파일을 추가했을 때 같은 명령으로 갱신한다. 파일의 최종 점수·대화별 점수·통과 표현 수·기준에 못 미친 표현 번호·비고를 그대로 사용하며 재계산하지 않는다. 빈 점수와 재응시·미제출 표기를 보존하고, 게시된 행이 없는 학생에게는 미게시 안내를 표시한다.

학생 입장은 `student_portal`, 평가 참여·제출 확인은 기존 `check_in`을 사용한다. `student_score`는 요청마다 반·번호·이름을 대조해 해당 학생의 결과 한 건만 반환한다. `published_scores`는 RLS를 활성화하고 일반 클라이언트 직접 조회·쓰기를 차단한다. 실제 이름과 점수 파일은 공개 저장소에 넣지 않는다. 기존 이름 기반 식별 방식이므로 타인의 반·번호·이름을 모두 알면 그 학생의 결과를 조회할 수 있다.

번호는 직접 입력하거나 아래·위 방향키로 탐색한 뒤 Enter 또는 Tab으로 선택한다. 목록이 열려 있으면 Home은 1번, End는 40번으로 이동한다. 목록이 닫혀 있으면 Home·End는 입력 커서를 이동한다. Escape는 선택 전 입력을 유지하며 목록을 닫는다.

제출 학생에게 재응시를 허용하려면 교사 대시보드에서 `제출 되돌려주기`를 선택하고 확인한다. 기존 제출과 녹음은 보관되며, 학생이 다시 입장하면 본 평가를 다시 할 수 있다. 반이 마감된 경우에는 교사가 별도로 개방해야 한다. 새 응시 녹음은 별도 경로에 저장된다.

## 교사 대시보드 설정

목록의 `최종 점수` 열에는 게시된 최종 점수만 표시한다. 점수 버튼을 선택하면 해당 학생의 대화별 점수·통과한 표현 수·기준에 못 미친 표현 번호·비고가 대화상자에 열린다. 닫기나 Escape로 닫으면 선택했던 점수 버튼으로 돌아간다. 점수가 비어 있으면 재응시 등의 상태를 표시하며, 게시 기록이 없으면 `미게시`로 표시한다. 새로고침하면 최근 게시값을 다시 불러온다. 이 기능에는 `supabase/migrations/20261019013957_teacher_scores.sql`을 적용한다.

`supabase/migrations/20261008212802_teacher_dashboard.sql`을 서버에 적용한 후 앱을 배포한다. 기존 명렬의 1반 40번 행을 교사로 지정하며, 교사 이름은 서버 명렬에서만 관리한다. 반·번호·이름을 서버가 확인하고, 조회·반 개방 변경·녹음 접근마다 교사 여부를 다시 검사한다. 별도 비밀번호나 Supabase Auth 계정은 사용하지 않는다.

되돌려주기에는 `supabase/migrations/20261008215138_return_submissions.sql`도 적용한다. `returned_submissions`에 제출 원본·반환 시각·처리 교사 정보를 보관하고 현재 제출에서 제외한다. 권한 확인과 보관·반환은 단일 트랜잭션으로 처리하며, 제출 ID로 대상을 지정해 중복 요청이 새 제출에 영향을 주지 않게 한다.

모의 평가 현황에는 `supabase/migrations/20261008234710_practice_progress.sql`도 적용한다. 대시보드는 교사 행을 제외한 반별 본 평가 제출·미제출 수와 학생 목록, 학생별 모의 평가 완료·미완료 상태를 표시한다. 모의 녹음은 모든 회차를 최신순으로 표시하며 본 평가 녹음과 함께 5분 유효한 서명 URL로 재생한다. 학생 명렬·제출 테이블의 일반 조회는 계속 차단된다. 이름 기반 식별이므로 교사 반·번호·이름을 아는 사람은 같은 권한으로 접근할 수 있다.
