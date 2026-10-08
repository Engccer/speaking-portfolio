@~/.claude/ACCESSIBILITY.md <!-- sanitize: allow 저자 머신 전용 작업 지침 -->

# speaking-portfolio

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 작업할 때 참고하는 가이드다.

신명중 3학년 영어B 말하기 포트폴리오 녹음 평가 웹앱(학생용 정적 페이지)과 교사 채점 스크립트. 설계 정본은 `docs/superpowers/specs/2026-10-08-speaking-portfolio-design.md`, 구현 플랜은 `docs/superpowers/plans/2026-10-08-speaking-portfolio.md`.

## 구조

- `index.html`, `styles.css`, `app.js`, `lib/` : 학생 앱(빌드 없음, ES modules). `config.js`는 gitignore, `config.example.js`를 복사해 채운다.
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
