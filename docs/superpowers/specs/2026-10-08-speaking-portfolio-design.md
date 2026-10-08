# 말하기 포트폴리오 녹음 평가 웹앱 설계

작성 2026-10-08. 2026학년도 2학기 신명중 3학년 영어B 말하기 포트폴리오(10점, Lesson 5~7)를 위한 학생 녹음 웹앱과 교사 채점 스크립트의 설계 정본이다. 사용자(헌용 쌤)와의 브레인스토밍에서 확정한 결정을 담았고, 구현 플랜은 `docs/superpowers/plans/`에 둔다.

## 1. 목표와 범위

학생이 크롬북에서 대화문 2편을 받아 턴별로 녹음하고 1회 제출한다. 교사는 제출 음원을 내려받아 전사하고 공식 채점표로 자동 채점한다.

범위 안:

- 정적 웹앱: 학생 입장·모의 평가·본 평가·제출, 교사 제출 현황·녹음 재생·반별 평가 개방.
- Supabase 프로젝트: 명렬·제출 기록·녹음 파일·공식 음원 보관.
- 교사 스크립트(Python, 로컬): 다운로드, 전사, 채점, 개방 제어, 재응시 초기화.
- 대화문 9편의 데이터와 표현 10개 지정.

범위 밖:

- 학생 안내문·쿨메시지 문안 작성. 구현 중 안내문 초안에 절차와 표현 목록을 반영하는 것만 포함한다.
- 플랭스쿨 연동. 플랭 기록은 성적에 쓰지 않는다.

## 2. 확정 결정

| 항목 | 결정 |
|---|---|
| 대화문 | 9편 = 2026 초안 8편 + Lesson 6 Real Life Talk 미술관 안내(독백). 플랭스쿨 낭독 활동 9개와 같은 세트 |
| 녹음 범위 | 학생 혼자 A·B 모든 턴을 낭독. 턴 단위 녹음, 턴별 공식 음원 불필요 |
| 채점 단위 | 편마다 핵심 표현 10개를 고정 지정. 공식 점수표 그대로 적용 |
| 만족 판정 | 전사 단어 일치율 + 유창성 지표(최장 휴지, 발화 속도) 결합. 성량은 기록만 |
| 학생 식별 | 반·번호·이름 입력 후 서버 명렬 대조. 로그인 없음 |
| 기기 | 학교 크롬북, 교실에서 반 전체 동시 진행, 지급 헤드폰(마이크 포함) |
| STT | ElevenLabs Scribe, 학교 프로젝트 키(Sinmyung MS). 총량 3~5시간, 수 달러 이내 |
| 최종 점수 | 두 대화 점수 평균을 반올림(0.5는 올림)한 정수. 평가계획 급간 안에 떨어짐 |
| 공식 음원 | Supabase Storage 비공개 버킷. 저장소에 커밋하지 않음 |
| 일정 | 첫 평가 304·306반 10/12(월) 유지. 학생 앱을 주말까지 완성 |
| 모의 평가 | 1편 무작위, 본 평가와 같은 화면, 재제출 가능, 항상 개방 |
| 본 평가 개방 | 반별 개방 플래그를 교사 스크립트로 켜고 끔 |
| 저장소 | 로컬 `Windows-Projects\Education\speaking-portfolio`, GitHub `Engccer/speaking-portfolio` 공개, Pages 배포 |
| Supabase 계정 | 학교 Google 계정(`sinmyung.sen.ms.kr` 도메인)으로 새 프로젝트 |

디폴트로 정한 것: 추첨은 반·번호 해시 기반 결정적 추첨(레슨 중복 허용), 대본은 영어 원문만 표시, 녹음 횟수·시간 제한 없음, 결시자 재응시는 교사가 행을 지워 허용, 평가계획 주석의 "표현당 오류 1개마다 1점 감점"은 점수표와 같은 규칙의 다른 표현으로 보아 이중 적용하지 않음.

## 3. 아키텍처

```
학생 크롬북 (GitHub Pages 정적 페이지, supabase-js anon)
   │ rpc check_in            │ storage download audio/*.mp3
   │ storage upload          │ insert submissions / practice_submissions
   ▼
Supabase (학교 계정 프로젝트)
   students · settings · submissions · practice_submissions
   Storage: audio(비공개) · recordings(비공개)
   ▲
   │ service role key (.env, 로컬만)
교사 PC (Python scripts/)
   open/close · download · transcribe(ElevenLabs Scribe) · score · reset
```

서버 코드는 없다. 브라우저가 Supabase에 직접 쓰고, 보안은 RLS와 `security definer` 함수가 맡는다. 재제출 금지는 DB 유일 제약이 강제한다.

## 4. 데이터 모델

### 4.1 테이블

`students`: `class smallint`, `number smallint`, `name text`, `is_teacher boolean default false`, PK(class, number). anon 직접 조회는 차단한다. 명렬은 `플랭스쿨 연습 기록/<N>반.csv`의 명렬 열에서 교사 스크립트로 적재한다. 기존 1반 40번 행에 교사 표시를 두고, 이름은 서버 명렬에서 관리한다.

`settings`: `class smallint PK`, `exam_open boolean default false`. anon 접근 차단, 함수로만 읽는다.

`submissions`: `id uuid`, `class`, `number`, `name`, `dialogue_ids text[2]`, `turn_offsets jsonb`, `files text[2]`, `durations numeric[2]`, `user_agent text`, `submitted_at timestamptz default now()`. UNIQUE(class, number). RLS: anon INSERT만 허용, SELECT·UPDATE·DELETE 불허. INSERT 정책은 `students`에 같은 (class, number, name)이 있고 `settings.exam_open`이 참일 때만 통과한다.

`practice_submissions`: `id uuid`, `class`, `number`, `name`, `dialogue_id text`, `turn_offsets jsonb`, `file text`, `duration numeric`, `submitted_at`. 유일 제약 없음. RLS: anon INSERT만, 명렬 일치 조건만 검사.

`returned_submissions`: 본 평가 제출 원본과 `returned_at`, `returned_by_class`, `returned_by_number`를 보관한다. 반환된 제출은 현재 `submissions`에서 제외하여 재응시를 허용하며, 원본 녹음 파일은 유지한다. 일반 클라이언트의 직접 조회·변경은 허용하지 않는다.

`turn_offsets` 형식: `[{"turn": 1, "start": 0.0, "end": 4.2}, ...]`. 병합 WAV 안에서 각 녹음 단위의 시작·끝 초.

### 4.2 함수

`check_in(p_class, p_number, p_name)` → `{ok boolean, exam_open boolean, submitted boolean, is_teacher boolean}`. `security definer`. 이름은 공백 제거 후 비교한다. `ok`가 거짓이면 평가 상태는 null, `is_teacher`는 false다. anon에 EXECUTE 허용. 호출 결과는 UI 분기용이고, 실제 보호는 INSERT 정책이 다시 검사한다.

`teacher_dashboard`와 `teacher_set_exam_open`은 반·번호·이름을 받아 서버 명렬의 교사 표시를 확인한다. 전자는 교사 행을 제외한 반별 학생·제출 기록·개방 상태를 반환하고, 후자는 지정 반의 개방 상태를 변경한다. 공개 RPC는 invoker로 두고 권한이 필요한 처리는 비공개 스키마의 definer 함수에서 수행한다. 비밀번호나 별도 Auth 계정은 쓰지 않는다.

`teacher_return_submission`은 교사 정보를 확인한 뒤 정확한 제출 ID의 원본을 보관하고 현재 제출에서 제외한다. 이미 반환한 ID의 재요청은 새 제출에 영향을 주지 않는다. 반의 개방 상태는 별도로 관리한다.

녹음 재생 요청은 교사 반·번호·이름을 HTTP 헤더로 전달한다. Storage RLS는 교사 자격과 제출 기록에 실제 참조된 경로를 확인하며, 앱은 300초 유효한 서명 URL을 발급받아 재생한다. 서비스 키는 브라우저에 제공하지 않는다.

### 4.3 Storage

- `audio` 버킷(비공개): `L5-1.mp3` … `L7-3.mp3` 9개. anon SELECT만. 원본은 `2학기 듣기/2025년도 자료/3. 과제 자료/교과서 듣기 음원/Lesson N/02_*_B.mp3, 04_*_B.mp3, 05_Real Life Talk.mp3`에서 복사한다.
- `recordings` 버킷(비공개): 일반 anon은 INSERT만, 교사 자격을 확인한 요청에는 현재·반환 제출에 참조된 파일의 SELECT도 허용한다. 덮어쓰기는 불가하다. 본 평가 새 경로는 `exam/3-04/3-04-12/<attempt-uuid>/1_L5-1.wav`, `exam/3-04/3-04-12/<attempt-uuid>/2_L7-3.wav`이며, 같은 제출의 업로드 재시도는 같은 경로를 쓴다. 모의 경로는 `practice/3-04/3-04-12/<timestamp>_L6-2.wav`. 파일 크기 제한 20MB.

### 4.4 비밀 정보

페이지에 노출되는 것은 프로젝트 URL과 anon 키뿐이다. 서비스 키와 ElevenLabs 키는 로컬 `.env`(gitignore)에 둔다. 학생 이름은 저장소에 들어가지 않는다.

## 5. 대화문 데이터 (`data/dialogues.json`)

```json
[{ "id": "L5-1", "title": "Jim Abbott", "source": "Lesson 5 / Listen and Speak 1 B / p.86",
   "audio": "L5-1.mp3",
   "units": [ { "n": 1, "speaker": "A", "text": "Jiho, what are you reading?" } ],
   "expressions": [ { "n": 1, "unit": 1, "text": "Jiho, what are you reading?" } ] }]
```

`expressions`는 항상 10개다. `scripts/build_dialogues.py`가 턴 CSV와 분할표로 생성한다.

- `units`는 녹음 단위다. 대화 8편은 턴 그대로(8·9·10개). 독백(ID `L6-3`, 미술관 안내)은 문장 단위이며 "Hello, students!"는 다음 문장과 합쳐 7개 단위로 한다.
- `expressions`는 채점 단위로 항상 10개다. 10턴 편은 턴=표현. 9턴 편은 긴 턴 1개를, 8턴 편은 긴 턴 2개를 문장·절·구 경계에서 둘로 나눈다(한 단어짜리 조각이 생기는 분할은 피하므로 반드시 가장 긴 턴은 아니다). 독백은 긴 문장을 절 경계에서 나눠 10개를 만든다. 각 표현은 정확히 하나의 unit에 속하고, 한 unit의 표현들을 이어 붙이면 unit 원문이 된다.
- 원문은 `3. 과제 자료/2026 초안/2026 말하기 대화문 모음.txt`와 `3. 교과서/2026/듣기 대본.txt` 103행을 그대로 쓴다. `−58℃`, `1995`, `$25`처럼 숫자·기호가 든 문장은 데이터에 원문만 두고, 채점기의 정규화 함수가 대본과 전사 양쪽을 같은 단어열("minus fifty eight degrees" 등)로 바꾼다. 앱과 채점기가 같은 JSON 파일을 읽는다.
- 표현 10개 지정 결과는 `scripts/export_expressions.py`로 표(Markdown)를 뽑아 학생 안내문에 싣는다.

## 6. 학생 앱

단일 페이지 `index.html` + `app.js` + `styles.css` + `lib/` + `data/dialogues.json`. 외부 의존은 supabase-js(jsdelivr 고정 버전)와 Google Fonts만.

### 6.1 화면 흐름

1. **입장**: 반(1~6 라디오), 번호(숫자), 이름. [확인] → `check_in`. 불일치면 "명렬에 없습니다. 반·번호·이름을 확인하세요". 일치하면 모드 선택.
2. **모드 선택**: [모의 평가]는 항상 활성. [본 평가]는 `exam_open`이 참이고 `submitted`가 거짓일 때만 활성. 이미 제출했으면 "본 평가를 이미 제출했습니다"를 표시하고 모의 평가만 남긴다. 닫혀 있으면 "본 평가는 수업 시간에 선생님이 열어 줍니다".
3. **마이크 준비**: 권한 요청 → 3초 테스트 녹음 → 재생. 실패하면 헤드폰 연결과 권한 안내.
4. **대화 녹음** (모의는 1편, 본 평가는 2편 순차):
   - 상단: 편 제목, 출처, [전체 듣기](공식 음원, 재생 중 [정지]로 바뀜), 전체 대본.
   - 단위 목록: 각 단위에 화자 표시와 원문, [녹음] [듣기] [삭제]. 녹음 중에는 해당 단위만 [정지] 활성, 나머지 단위와 상단 버튼 비활성. 녹음이 있으면 [듣기]·[삭제] 활성, [녹음]은 [다시 녹음]으로 라벨 변경. 녹음 상태를 텍스트로 표시("녹음됨 4.2초").
   - 모든 단위가 녹음되면 [다음 대화] 또는 [제출 화면으로] 활성. 본 평가 대화 2에서는 [대화 1로 돌아가기]도 제공한다.
5. **제출**: 요약(편 2개, 단위 수, 총 길이) + [제출]. 클릭 시 확인 대화상자(접근 가능한 모달): "제출하면 다시 녹음할 수 없습니다. 제출할까요?" [제출] [취소]. 모의 평가도 같은 문구를 쓴다.
6. **업로드**: 진행 텍스트("병합 중", "업로드 1/2", "기록 저장"). 완료 화면: "제출이 완료되었습니다. 창을 닫아도 됩니다". 실패 시 사유와 [다시 시도]. 녹음 데이터는 메모리에 남아 있으므로 재시도는 업로드만 반복한다.

### 6.2 추첨

본 평가: `seed = SHA-256("2026-2-speaking|{class}|{number}")`. seed로 결정적 PRNG를 돌려 9편에서 중복 없이 2편을 뽑는다. 새로 고침해도 같은 결과이고 저장이 필요 없다. 모의 평가: `crypto.getRandomValues`로 매번 1편.

### 6.3 녹음과 병합

- `MediaRecorder`(`audio/webm;codecs=opus`), 단위마다 Blob 하나. `echoCancellation`·`noiseSuppression` 켬.
- 제출 시 `AudioContext.decodeAudioData`로 각 Blob을 디코드 → 모노 16kHz로 리샘플 → 단위 사이 0.5초 무음을 넣어 이어 붙임 → PCM 16-bit WAV 인코드. 각 단위의 시작·끝 초를 `turn_offsets`로 기록한다.
- 업로드 순서: WAV 업로드(본 평가는 2개) → 행 INSERT. INSERT가 유일 제약 위반(23505)이면 "이미 제출된 기록이 있습니다"로 종료한다. 업로드만 성공하고 INSERT가 실패한 경로는 교사 스크립트가 행 없는 파일로 보고한다.
- `beforeunload`로 녹음이 있는 상태에서 이탈을 경고한다. 새로 고침 복구(IndexedDB)는 넣지 않는다.

### 6.4 접근성

사용자 홈의 접근성 헌장(`ACCESSIBILITY.md`)을 저장소 CLAUDE.md 머리에서 import한다. 핵심 계약: 모든 컨트롤이 네이티브 `button`·`input`이고 키보드만으로 전 과정 수행 가능, 화면 전환 시 제목에 포커스, 상태 알림은 `aria-live="polite"` 영역 하나, 녹음 중 상태는 텍스트로도 표시, 확인 대화상자는 포커스 트랩과 Esc 닫기, 컨트롤 라벨에 이모지 없음, 시각 텍스트를 덮는 aria-label 없음.

## 7. 교사 스크립트 (`scripts/`, Python 3.12)

공통: `.env`에서 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ELEVENLABS_API_KEY`를 읽는다. 의존은 `supabase`, `requests`, `openpyxl`만.

| 스크립트 | 동작 |
|---|---|
| `seed_students.py <반별 CSV 폴더>` | 플랭 반별 CSV의 번호·이름으로 `students` 적재(upsert). `settings` 6행 생성 |
| `upload_audio.py <음원 폴더>` | 공식 mp3 9개를 `audio` 버킷에 올림 |
| `open.py 4 6` / `close.py 4 6` | 해당 반 `exam_open` 토글. 인자 없는 `close.py`는 전 반 닫기 |
| `download.py [--class N] [--practice] <출력 폴더>` | 제출 행과 파일을 받아 `<출력>/3-N/3-N-NN 이름_1_L5-1.wav` 형태로 저장. `turn_offsets`를 같은 이름 `.json`으로 저장. 미제출자 목록 `미제출_3-N.txt`. 행 없는 고아 파일 보고 |
| `transcribe.py <폴더>` | WAV마다 Scribe 호출(`timestamps_granularity=word`, 언어 en), 결과 JSON을 WAV 옆에 캐시. 캐시가 있으면 호출하지 않음 |
| `score.py <폴더> [--config scoring.json]` | 7.1절 알고리즘으로 채점. 반별 xlsx, 표현별 CSV 산출 |
| `reset.py 4 12` | 해당 학생 `submissions` 행과 파일 삭제. 실행 전 대상 출력 + 확인 입력. 쌤 지시가 있을 때만 실행 |

출력 폴더 기본값은 말하기 폴더의 `4. 채점/녹음/`이다.

### 7.1 채점 알고리즘 (`score.py`)

1. 정규화: 소문자, 구두점 제거, 숫자·기호는 정규화 함수가 단어로 치환(`1995` → nineteen ninety five, `−58℃` → minus fifty eight degrees, `$25` → twenty five dollars, `5th` → fifth), 축약형(`I'm`/`I am`) 양쪽 허용.
2. 정렬: 전사 단어열과 대본 단어열을 Needleman-Wunsch로 정렬해 대본 단어마다 일치·대체·삭제를 표시한다. 표현 n의 단어 집합에 대해 `match_ratio = 일치 단어 / 대본 단어`.
3. 유창성: 표현에 정렬된 전사 단어들의 타임스탬프에서 `max_gap`(연속 단어 사이 최장 간격, 초)과 `wpm`(단어 수 ÷ 첫 단어 시작부터 마지막 단어 끝까지 분)을 구한다. 단위 경계(`turn_offsets`)를 넘는 간격은 세지 않는다.
4. 판정: `match_ratio ≥ 0.75 and max_gap ≤ 2.0 and wpm ≥ 60`이면 만족. 세 임계값은 `scoring.json`에 있고 기본값은 위와 같다. 정렬된 단어가 0개면 불만족.
5. 편 점수: 만족 수 9~10 → 10, N(1~8) → N+1, 0 → 1(제출함). 미제출 편은 0.
6. 최종: 두 편 평균 → `floor(x + 0.5)`. 미제출 학생은 0.
7. 비고: 표현별 판정 근거(`match_ratio`, `max_gap`, `wpm`)와 불만족 사유를 CSV에, 학생 행에는 불만족 표현 번호를 요약한다. 음량(RMS dBFS)은 참고 열로만 둔다.

보정 절차: 10/12 전 모의 녹음과 10/12 304·306 결과로 세 지표의 분포를 보고 임계값을 후하게 조정한 뒤(`scoring.json` 갱신), 전 반에 같은 값을 적용한다. 보정 전후 점수 변화는 CHANGELOG에 남긴다.

### 7.2 산출물

- `4. 채점/<N>반 말하기 채점.xlsx`: 번호, 이름, 대화1 ID·만족 수·점수, 대화2 ID·만족 수·점수, 최종, 비고, 제출 시각. 미제출은 0점과 "미제출".
- `4. 채점/표현별 상세.csv`: 반, 번호, 편, 표현 번호, 원문, 전사, match_ratio, max_gap, wpm, 판정.

## 8. 운영 절차 (수업 당일)

1. 수업 시작 전 `open.py <반>`. 학생은 `engccer.github.io/speaking-portfolio`에 접속해 입장.
2. 헤드폰 연결 → 마이크 테스트 → 본 평가.
3. 수업 종료 시 `close.py <반>`. 결시자는 추후 여유 차시에 그 반만 다시 열어 응시한다.
4. `download.py --class N` → `transcribe.py` → `score.py`.

## 9. 테스트

- 단위(Python, pytest): 정규화·정렬·표현 매핑·점수표·반올림. 대본과 동일한 전사는 10개 만족, 한 표현을 빈 전사로 바꾸면 9개, 경계 간격 미집계.
- 단위(JS, 브라우저 없이 Node): 결정적 추첨의 재현성과 중복 없음, WAV 인코더 길이·헤더, turn_offsets 계산.
- 통합: Supabase 테스트 프로젝트 또는 같은 프로젝트의 테스트 반(0반)으로 입장 → 녹음 → 제출 → 2회 제출 거부 → `download.py`로 수신 확인. 실기기 크롬북 시험 1회(10/12 오전).
- 접근성: 키보드만으로 전 과정, NVDA로 상태 알림 확인.

## 10. 실패 처리

- 마이크 권한 거부: 안내와 재시도 버튼. 녹음 불가 상태에서는 다음 단계 비활성.
- 업로드 실패: 녹음은 메모리에 보존, [다시 시도]. 네트워크가 끊긴 채 수업이 끝나면 교사가 그 학생을 결시 처리하고 재응시.
- 전사 실패: 해당 파일을 "전사 실패"로 표에 남기고 교사가 직접 듣고 채점한다.
- 고아 파일(업로드됐으나 행 없음): `download.py`가 보고하고, 교사가 확인 후 `reset.py` 없이 수동 INSERT 또는 재응시.

## 11. 비구현 사항

IndexedDB 복구, 학생 결과 열람, 턴별 공식 음원, 플랭스쿨 연동, 영상 녹화, 전달력의 시선 항목 판정.
