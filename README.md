# speaking-portfolio

신명중 3학년 영어B 말하기 포트폴리오 녹음 평가 도구. 학생은 크롬북에서 대화문 2편을 턴별로 녹음해 한 번 제출하고, 교사는 로컬 스크립트로 제출 음원을 내려받아 전사하고 공식 점수표로 자동 채점한다.

## 명령

- `python -m pytest -q` : Python 테스트(채점·다운로드·전사 캐시, 실서버 보안 검증)
- `npm test` : 앱 순수 로직 테스트(추첨, WAV 병합·인코딩)
- `python -m http.server 8765` 후 `http://localhost:8765` : 로컬 실행(`config.example.js`를 `config.js`로 복사해 채운다)

## 문서

- 설계: `docs/superpowers/specs/2026-10-08-speaking-portfolio-design.md`
- 구현 플랜: `docs/superpowers/plans/2026-10-08-speaking-portfolio.md`
- Supabase 설정: `supabase/README.md`
