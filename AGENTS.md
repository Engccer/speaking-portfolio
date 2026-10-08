> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**
> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤
> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.
> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 건너뛰며, --force 로 실행하면 덮어써집니다.

<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->
@~/.claude/ACCESSIBILITY.md <!-- sanitize: allow 저자 머신 전용 작업 지침 -->

# speaking-portfolio

이 지침은 Claude Code·Codex 등 모든 코딩 에이전트에 적용한다. 정본은 `CLAUDE.md`이며, 형제 `AGENTS.md`는 자동 생성물이다. 하위 폴더에서는 해당 폴더와 상위 폴더의 지침을 함께 읽고, 더 구체적인 지침을 우선한다.

정본이나 하위 `CLAUDE.md`를 수정하면 프로젝트 루트에서 `python sync_agent_docs.py`를 실행한다. `AGENTS.md`는 직접 수정하지 않으며, `python sync_agent_docs.py --check`로 동기화 상태를 확인한다.

신명중 3학년 영어B 말하기 포트폴리오 녹음 평가 웹앱과 교사 채점 스크립트. 설계 정본은 `docs/superpowers/specs/2026-10-08-speaking-portfolio-design.md`, 구현 플랜은 `docs/superpowers/plans/2026-10-08-speaking-portfolio.md`.

## 구조

- `index.html`, `styles.css`, `app.js`, `lib/` : 웹앱(빌드 없음, ES modules). 화면 로직은 `app.js`, Supabase 연동은 `lib/supa.js`에 둔다. `config.js`는 gitignore, `config.example.js`를 복사해 채운다.
- `data/dialogues.json` : 대화문 9편. `scripts/build_dialogues.py`로 생성하며 손으로 고치지 않는다.
- `supabase/migrations/` : 스키마·RLS·함수.
- `scripts/` : 교사 스크립트. `.env`(gitignore)에서 키를 읽는다.
- `tests/` : pytest(`tests/test_*.py`), node --test(`tests/js/*.test.mjs`).

## 명령

- `python -m pytest -q`
- `npm test`
- 로컬 실행: `python -m http.server 8765` 후 `http://localhost:8765`

## 규칙

- 공개 저장소다. 학생 이름·음원·키·사용자 홈 경로를 커밋하지 않는다. 커밋 전 `python ~/.claude/skills/sanitize-for-release/scripts/scan_traces.py .`. <!-- sanitize: allow 저자 머신 전용 작업 지침 -->
- 접근성 헌장을 따른다. 라벨에 이모지 금지, em dash 금지.
- 채점 임계값은 `scripts/scoring.json`에만 둔다.
- `main`에 직접 커밋하는 운영 방식을 따른다. `main` 푸시는 `.github/workflows/pages.yml`을 통해 GitHub Pages 배포를 실행하므로 배포 승인을 받은 뒤 진행한다.
- 운영 진행 상황과 변경 이력의 정본은 학교 업무 공유 폴더에 있는 이 프로젝트의 `PROGRESS.md`·`CHANGELOG.md`다. 공개 저장소에는 개인 경로와 학생 운영 데이터를 옮기지 않는다.
