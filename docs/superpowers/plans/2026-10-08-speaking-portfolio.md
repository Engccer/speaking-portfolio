# 말하기 포트폴리오 녹음 평가 웹앱 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생이 크롬북에서 대화문 2편을 턴별로 녹음해 1회 제출하는 정적 웹앱과, 제출 음원을 내려받아 전사·자동 채점하는 교사 스크립트를 만든다.

**Architecture:** GitHub Pages 정적 페이지가 supabase-js(anon 키)로 Supabase에 직접 쓰고, 보안은 RLS와 `security definer` 함수가 맡는다. 재제출 금지는 `submissions`의 UNIQUE(class, number)가 강제한다. 교사 작업은 서비스 키를 가진 로컬 Python 스크립트가 전담하며, 대화문 데이터는 `data/dialogues.json` 하나를 앱과 채점기가 공유한다.

**Tech Stack:** HTML/CSS/ES modules(빌드 없음), supabase-js 2(jsdelivr 고정 버전), Web Audio API, MediaRecorder, Node 24 `node --test`, Python 3.12 + `supabase` + `requests` + `openpyxl` + pytest, ElevenLabs Scribe(speech-to-text), Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-10-08-speaking-portfolio-design.md`

## Global Constraints

- 저장소는 공개. 학생 이름, 음원, 서비스 키, ElevenLabs 키, 사용자 홈 절대경로를 커밋하지 않는다. 커밋 전 `python ~/.claude/skills/sanitize-for-release/scripts/scan_traces.py .` 종료 코드 0.
- 페이지에 노출되는 비밀은 Supabase URL과 anon 키뿐(`config.js`).
- 외부 스크립트는 jsdelivr의 고정 버전 supabase-js 하나, 스타일시트는 Google Fonts만.
- UI 컨트롤 라벨에 이모지 금지, em dash(—) 금지(사람이 읽는 문구·안내문).
- 접근성: 네이티브 `button`/`input`, 키보드만으로 전 과정, 화면 전환 시 제목 포커스, `aria-live="polite"` 영역 하나, 시각 텍스트를 덮는 aria-label 금지.
- 학생 앱은 Chrome(크롬북)만 지원. 녹음 포맷 `audio/webm;codecs=opus`, 제출 포맷 16kHz 모노 PCM16 WAV.
- 채점 기본 임계값: `match_ratio >= 0.75`, `max_gap <= 2.0`, `wpm >= 60`. 편 점수표: 만족 9~10 → 10, N(1~8) → N+1, 0 → 1, 미제출 0. 최종 = 두 편 평균을 `floor(x + 0.5)`.
- 대화문 9편 ID와 순서: `L5-1, L5-2, L5-3, L6-1, L6-2, L6-3, L7-1, L7-2, L7-3`(L6-3은 미술관 안내 독백). 편마다 `expressions`는 정확히 10개.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git add -A` 금지, 경로를 명시해 커밋.
- 병렬 세션 분할 근거: Task 1~3이 끝나면 **앱 트랙(Task 4~6)** 과 **스크립트 트랙(Task 7~10)** 은 파일이 겹치지 않고 `data/dialogues.json`·`supabase/migrations/0001_init.sql`만 공유하므로 별도 세션(worktree)에서 병렬 진행 가능. Task 11은 둘 다 끝난 뒤.

## Review Focus

1. 이름에 공백·전각 공백이 섞인 입력("김 헌용")이 명렬과 일치해야 한다. → Task 3 `check_in` 테스트, Task 5a 클라이언트 정규화.
2. 업로드 2개는 성공했는데 INSERT가 네트워크로 실패한 뒤 [다시 시도]를 누르면, 같은 경로 재업로드가 거부(409)되어도 제출이 완료되어야 한다. → Task 5c: 업로드 409는 성공으로 간주.
3. 전사에 단어가 하나도 없는 편(무음 제출)은 예외 없이 만족 0개, 1점이어야 한다. → Task 9 테스트.
4. 숫자·기호(`1995`, `−58℃`, `25 dollars`, `November 5th`)가 전사에서 숫자로 오든 단어로 오든 같은 토큰으로 정규화되어야 한다. → Task 9 canonicalize 테스트.
5. 본 평가가 닫힌 반의 학생이 페이지를 조작해 INSERT를 시도해도 DB가 거부해야 한다(UI 비활성에 의존하지 않음). → Task 3 RLS 테스트.

---

### Task 1: 저장소 골격과 테스트 환경

**Files:**
- Create: `CLAUDE.md`, `README.md`, `package.json`, `requirements.txt`, `tests/conftest.py`, `tests/__init__.py`, `config.example.js`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `python -m pytest` 실행 환경(`scripts/`가 import 경로), `npm test`(`node --test tests/js/`).

- [ ] **Step 1: CLAUDE.md 작성 (접근성 헌장 import 포함)**

```markdown
@~/.claude/ACCESSIBILITY.md

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

- 공개 저장소다. 학생 이름·음원·키·사용자 홈 경로를 커밋하지 않는다. 커밋 전 `python ~/.claude/skills/sanitize-for-release/scripts/scan_traces.py .`.
- 접근성 헌장을 따른다. 라벨에 이모지 금지, em dash 금지.
- 채점 임계값은 `scripts/scoring.json`에만 둔다.
```

- [ ] **Step 2: 나머지 골격 파일**

`package.json`:
```json
{
  "name": "speaking-portfolio",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test tests/js/" }
}
```

`requirements.txt`:
```
supabase>=2.7
requests>=2.32
openpyxl>=3.1
pytest>=8
```

`tests/conftest.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
```

`tests/__init__.py`: 빈 파일.

`config.example.js`:
```js
export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

`.env.example`:
```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_KEY=
ELEVENLABS_API_KEY=
```

`.gitignore`에 추가:
```
config.js
node_modules/
.pytest_cache/
tests/fixtures/*.wav
```

`README.md`: 제목, 한 문단 설명, 위 명령 3개, 스펙·플랜 경로.

- [ ] **Step 3: 설치와 빈 테스트 실행**

Run: `pip install -r requirements.txt && python -m pytest -q && npm test`
Expected: pytest `no tests ran`, node `pass 0`(tests/js 비어 있으면 디렉터리를 먼저 만든다: `mkdir -p tests/js`).

- [ ] **Step 4: 커밋**

```bash
python ~/.claude/skills/sanitize-for-release/scripts/scan_traces.py .
git add CLAUDE.md README.md package.json requirements.txt tests/conftest.py tests/__init__.py config.example.js .env.example .gitignore
git commit -m "chore: 저장소 골격과 테스트 환경"
```

---

### Task 2: 대화문 데이터 빌드

**Files:**
- Create: `scripts/build_dialogues.py`, `data/dialogues.json`, `tests/test_dialogues.py`

**Interfaces:**
- Consumes: 턴 CSV `2026 말하기 대화별 턴 목록.csv`(UTF-8 BOM, 열 `대화ID,단원,교과서쪽,영역,턴,역할,원문화자,영어대사`). 경로는 인자로 받는다.
- Produces: `data/dialogues.json` =
  ```json
  [{"id":"L5-1","title":"Jim Abbott","source":"Lesson 5 / Listen and Speak 1 B / p.86","audio":"L5-1.mp3",
    "units":[{"n":1,"speaker":"A","text":"Jiho, what are you reading?"}],
    "expressions":[{"n":1,"unit":1,"text":"Jiho, what are you reading?"}]}]
  ```
  배열 순서는 Global Constraints의 ID 순서. 앱(Task 4~5)과 채점기(Task 9)가 이 형식을 읽는다.

- [ ] **Step 1: 실패하는 테스트**

`tests/test_dialogues.py`:
```python
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "dialogues.json"
IDS = ["L5-1", "L5-2", "L5-3", "L6-1", "L6-2", "L6-3", "L7-1", "L7-2", "L7-3"]


def load():
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_ids_and_order():
    assert [d["id"] for d in load()] == IDS


def test_each_has_ten_expressions_mapped_to_units():
    for d in load():
        assert len(d["expressions"]) == 10, d["id"]
        unit_ns = {u["n"] for u in d["units"]}
        assert all(e["unit"] in unit_ns for e in d["expressions"]), d["id"]
        assert [e["n"] for e in d["expressions"]] == list(range(1, 11))


def test_expressions_concatenate_to_unit_text():
    for d in load():
        for u in d["units"]:
            parts = [e["text"] for e in d["expressions"] if e["unit"] == u["n"]]
            assert " ".join(parts) == u["text"], (d["id"], u["n"])


def test_unit_counts():
    counts = {d["id"]: len(d["units"]) for d in load()}
    assert counts == {"L5-1": 9, "L5-2": 8, "L5-3": 10, "L6-1": 10, "L6-2": 10,
                      "L6-3": 7, "L7-1": 8, "L7-2": 9, "L7-3": 8}


def test_dialogue_units_alternate_speakers():
    for d in load():
        if d["id"] == "L6-3":
            assert all(u["speaker"] == "W" for u in d["units"])
            continue
        speakers = [u["speaker"] for u in d["units"]]
        assert speakers == ["A", "B"] * (len(speakers) // 2) + (["A"] if len(speakers) % 2 else [])
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_dialogues.py -q`
Expected: FAIL (`data/dialogues.json` 없음).

- [ ] **Step 3: 빌드 스크립트**

`scripts/build_dialogues.py`:
```python
"""턴 CSV와 독백 원문으로 data/dialogues.json을 만든다.

사용: python scripts/build_dialogues.py "<턴 목록 CSV 경로>"
"""
import csv
import json
import sys
from collections import OrderedDict
from pathlib import Path

ORDER = ["L5-1", "L5-2", "L5-3", "L6-1", "L6-2", "L6-3", "L7-1", "L7-2", "L7-3"]

META = {
    "L5-1": ("Jim Abbott", "Lesson 5 / Listen and Speak 1 B / p.86"),
    "L5-2": ("Singing Contest", "Lesson 5 / Listen and Speak 2 B / p.87"),
    "L5-3": ("Billy Elliot", "Lesson 5 / Real Life Talk / p.88"),
    "L6-1": ("Folk Village", "Lesson 6 / Listen and Speak 1 B / p.104"),
    "L6-2": ("Concert Tickets", "Lesson 6 / Listen and Speak 2 B / p.105"),
    "L6-3": ("Art Museum Tour", "Lesson 6 / Real Life Talk / p.106"),
    "L7-1": ("Baby Penguins", "Lesson 7 / Listen and Speak 1 B / p.122"),
    "L7-2": ("Namsan Hiking", "Lesson 7 / Listen and Speak 2 B / p.123"),
    "L7-3": ("Camels", "Lesson 7 / Real Life Talk / p.124"),
}

# 독백: 교과서 듣기 대본 p.106 원문. "Hello, students!"는 다음 문장과 한 단위로 묶는다.
MONOLOGUE_UNITS = [
    "Hello, students! Thank you for visiting our art museum.",
    "This museum opened in 1995.",
    "Since then, it has exhibited many famous artworks.",
    "Today, you will see some famous artworks from the art books.",
    "Before we begin the tour, let me remind you of a basic rule.",
    "You can take pictures of the artworks, but you're not allowed to touch them.",
    "Now let's start the tour.",
]

# 표현 10개를 맞추기 위한 분할. 키 (대화ID, 단위 번호) → 조각 목록. 조각을 공백으로 이으면 단위 원문.
SPLITS = {
    ("L5-1", 5): ["Yeah. His story was made into a movie.", "I'm going to watch it this Saturday."],
    ("L5-2", 5): ["Great. Can you play the guitar", "while I sing in the contest?"],
    ("L5-2", 6): ["I'd love to, but I can't.", "I hurt my hand in gym class yesterday."],
    ("L6-3", 1): ["Hello, students!", "Thank you for visiting our art museum."],
    ("L6-3", 5): ["Before we begin the tour,", "let me remind you of a basic rule."],
    ("L6-3", 6): ["You can take pictures of the artworks,", "but you're not allowed to touch them."],
    ("L7-1", 5): ["The average temperature is about −58℃ in July", "and −26℃ in December."],
    ("L7-1", 7): ["Yes. Although it's very cold there,", "it doesn't snow much."],
    ("L7-2", 2): ["I'm going to go hiking.", "Do you want to join me?"],
    ("L7-3", 4): ["I wonder how long camels can go", "without water in the desert."],
    ("L7-3", 7): ["Wow, that's amazing!", "Camels are really interesting animals."],
}


def read_turns(csv_path):
    units = OrderedDict()
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            units.setdefault(row["대화ID"], []).append(
                {"n": int(row["턴"]), "speaker": row["역할"], "text": row["영어대사"].strip()}
            )
    return units


def build(csv_path):
    units_by_id = read_turns(csv_path)
    units_by_id["L6-3"] = [{"n": i + 1, "speaker": "W", "text": t} for i, t in enumerate(MONOLOGUE_UNITS)]
    out = []
    for did in ORDER:
        units = sorted(units_by_id[did], key=lambda u: u["n"])
        expressions = []
        for u in units:
            pieces = SPLITS.get((did, u["n"]), [u["text"]])
            if " ".join(pieces) != u["text"]:
                raise SystemExit(f"{did} 단위 {u['n']}: 분할 조각이 원문과 다름")
            for p in pieces:
                expressions.append({"n": len(expressions) + 1, "unit": u["n"], "text": p})
        if len(expressions) != 10:
            raise SystemExit(f"{did}: 표현 {len(expressions)}개 (10개 필요)")
        title, source = META[did]
        out.append({"id": did, "title": title, "source": source, "audio": f"{did}.mp3",
                    "units": units, "expressions": expressions})
    return out


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    data = build(sys.argv[1])
    target = Path(__file__).resolve().parents[1] / "data" / "dialogues.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data)}편 → {target}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 빌드 실행과 테스트 통과**

Run (CSV 경로는 말하기 폴더의 `3. 과제 자료/2026 초안/2026 말하기 대화별 턴 목록.csv`):
```
python scripts/build_dialogues.py "<CSV 경로>"
python -m pytest tests/test_dialogues.py -q
```
Expected: `9편 → .../data/dialogues.json`, 5 passed. 실패하면 SPLITS 조각이 CSV 원문과 공백·구두점까지 같은지 확인한다(CSV 원문이 정본).

- [ ] **Step 5: 커밋**

```bash
git add scripts/build_dialogues.py data/dialogues.json tests/test_dialogues.py
git commit -m "feat: 대화문 9편 데이터와 표현 10개 지정"
```

---

### Task 3: Supabase 스키마·보안·시드

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/README.md`, `scripts/common.py`, `scripts/seed_students.py`, `scripts/upload_audio.py`, `tests/test_rls.py`

**Interfaces:**
- Consumes: 사용자가 학교 Google 계정으로 만든 Supabase 프로젝트의 URL, anon 키, 서비스 키(`.env`, `config.js`).
- Produces: 테이블 `students(class,number,name)`, `settings(class,exam_open)`, `submissions`, `practice_submissions`; 함수 `check_in(p_class int, p_number int, p_name text) returns jsonb` → `{"ok":bool,"exam_open":bool,"submitted":bool}`; 버킷 `audio`(anon select), `recordings`(anon insert). `scripts/common.py`의 `load_env()`, `service_client()`.

- [ ] **Step 1: 마이그레이션 SQL**

`supabase/migrations/0001_init.sql`:
```sql
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
```

- [ ] **Step 2: 적용 절차 문서**

`supabase/README.md`:
```markdown
# Supabase 설정

1. 학교 Google 계정으로 https://supabase.com 에 로그인해 새 프로젝트를 만든다(리전 Northeast Asia (Seoul)).
2. Project Settings > API에서 URL, anon 키, service_role 키를 복사해 `config.js`(URL·anon)와 `.env`(URL·service)에 넣는다.
3. 마이그레이션 적용. 둘 중 하나:
   - `supabase login`(학교 계정) → `supabase link --project-ref <ref>` → `supabase db push`
   - 또는 대시보드 SQL Editor에 `migrations/0001_init.sql` 전체를 붙여 넣고 실행
4. `python scripts/seed_students.py "<플랭스쿨 연습 기록 폴더>"` 로 명렬 적재.
5. `python scripts/upload_audio.py "<교과서 듣기 음원 폴더>"` 로 공식 음원 9개 업로드.
6. `python -m pytest tests/test_rls.py -q` 로 보안 정책 검증(실서버 호출, `.env`·`config.js` 필요).
```

- [ ] **Step 3: 공통 모듈과 시드·업로드 스크립트**

`scripts/common.py`:
```python
import os
from pathlib import Path

from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY") if not os.environ.get(k)]
    if missing:
        raise SystemExit(f".env에 없음: {', '.join(missing)}")


def service_client():
    load_env()
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def anon_config():
    """config.js에서 URL과 anon 키를 읽는다(테스트용)."""
    import re
    text = (ROOT / "config.js").read_text(encoding="utf-8")
    url = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', text).group(1)
    key = re.search(r'SUPABASE_ANON_KEY\s*=\s*"([^"]+)"', text).group(1)
    return url, key
```

`scripts/seed_students.py`:
```python
"""플랭스쿨 반별 CSV(<N>반.csv, 열 번호·이름)로 students를 적재하고 settings 6행을 만든다.

사용: python scripts/seed_students.py "<플랭스쿨 연습 기록 폴더>"
"""
import csv
import sys
from pathlib import Path

from common import service_client


def read_class(path, cls):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [{"class": cls, "number": int(r["번호"]), "name": r["이름"].strip()}
                for r in csv.DictReader(f) if r["번호"].strip()]


def main():
    folder = Path(sys.argv[1])
    client = service_client()
    rows = []
    for cls in range(1, 7):
        rows += read_class(folder / f"{cls}반.csv", cls)
    client.table("students").upsert(rows).execute()
    client.table("settings").upsert([{"class": c, "exam_open": False} for c in range(1, 7)]).execute()
    print(f"students {len(rows)}명, settings 6행")


if __name__ == "__main__":
    main()
```

`scripts/upload_audio.py`:
```python
"""교과서 듣기 음원 폴더(Lesson 5~7 하위)에서 9편의 B 섹션·Real Life Talk mp3를 audio 버킷에 올린다.

사용: python scripts/upload_audio.py "<교과서 듣기 음원 폴더>"
"""
import sys
from pathlib import Path

from common import service_client

FILES = {
    "L5-1": "Lesson 5/02_Listen and Speak 1_B.mp3",
    "L5-2": "Lesson 5/04_Listen and Speak 2_B.mp3",
    "L5-3": "Lesson 5/05_Real Life Talk.mp3",
    "L6-1": "Lesson 6/02_Listen and Speak 1_B.mp3",
    "L6-2": "Lesson 6/04_Listen and Speak 2_B.mp3",
    "L6-3": "Lesson 6/05_Real Life Talk.mp3",
    "L7-1": "Lesson 7/02_Listen and Speak 1_B.mp3",
    "L7-2": "Lesson 7/04_Listen and Speak 2_B.mp3",
    "L7-3": "Lesson 7/05_Real Life Talk.mp3",
}


def main():
    folder = Path(sys.argv[1])
    bucket = service_client().storage.from_("audio")
    for did, rel in FILES.items():
        data = (folder / rel).read_bytes()
        bucket.upload(f"{did}.mp3", data, {"content-type": "audio/mpeg", "upsert": "true"})
        print(did, len(data), "bytes")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: RLS 실서버 테스트 (사용자가 프로젝트를 만든 뒤 실행)**

`tests/test_rls.py`:
```python
"""실서버 보안 검증. .env와 config.js가 있어야 하고, 테스트 반 0을 쓴다."""
import os
import uuid

import pytest
from supabase import create_client

from common import anon_config, service_client

pytestmark = pytest.mark.skipif(not os.path.exists("config.js"), reason="config.js 없음")

TEST = {"class": 0, "number": 99, "name": "테스트 학생"}


@pytest.fixture(scope="module")
def svc():
    c = service_client()
    c.table("students").upsert(TEST).execute()
    c.table("settings").upsert({"class": 0, "exam_open": False}).execute()
    yield c
    c.table("submissions").delete().eq("class", 0).execute()
    c.table("practice_submissions").delete().eq("class", 0).execute()
    c.table("students").delete().eq("class", 0).execute()
    c.table("settings").delete().eq("class", 0).execute()


@pytest.fixture(scope="module")
def anon():
    url, key = anon_config()
    return create_client(url, key)


def row(**extra):
    base = {**TEST, "dialogue_ids": ["L5-1", "L6-2"], "turn_offsets": [],
            "files": [f"exam/x/{uuid.uuid4()}.wav", f"exam/x/{uuid.uuid4()}.wav"],
            "durations": [1, 1]}
    return {**base, **extra}


def test_check_in_name_with_spaces(anon, svc):
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "테스트  학생"}).execute()
    assert r.data["ok"] is True and r.data["exam_open"] is False and r.data["submitted"] is False


def test_check_in_wrong_name(anon, svc):
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "다른 이름"}).execute()
    assert r.data["ok"] is False


def test_anon_cannot_read_students(anon, svc):
    assert anon.table("students").select("*").execute().data == []


def test_insert_rejected_when_closed(anon, svc):
    with pytest.raises(Exception):
        anon.table("submissions").insert(row()).execute()


def test_insert_once_when_open_then_duplicate_rejected(anon, svc):
    svc.table("settings").update({"exam_open": True}).eq("class", 0).execute()
    anon.table("submissions").insert(row()).execute()
    with pytest.raises(Exception) as e:
        anon.table("submissions").insert(row()).execute()
    assert "23505" in str(e.value) or "duplicate" in str(e.value).lower()
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "테스트 학생"}).execute()
    assert r.data["submitted"] is True


def test_practice_insert_allowed_many_times(anon, svc):
    for _ in range(2):
        anon.table("practice_submissions").insert(
            {**TEST, "dialogue_id": "L5-1", "turn_offsets": [], "file": f"practice/x/{uuid.uuid4()}.wav",
             "duration": 1}).execute()


def test_anon_cannot_select_submissions(anon, svc):
    assert anon.table("submissions").select("*").execute().data == []
```

Run: `python -m pytest tests/test_rls.py -q` (프로젝트 생성·마이그레이션·`config.js`·`.env` 준비 후)
Expected: 7 passed. 프로젝트가 아직 없으면 skip 7.

- [ ] **Step 5: 시드·음원 업로드 실행 후 커밋**

```
python scripts/seed_students.py "<플랭스쿨 연습 기록 폴더>"
python scripts/upload_audio.py "<교과서 듣기 음원 폴더>"
git add supabase/ scripts/common.py scripts/seed_students.py scripts/upload_audio.py tests/test_rls.py
git commit -m "feat: Supabase 스키마·RLS·시드 스크립트"
```

---

### Task 4: 앱 순수 로직 (추첨, WAV 병합·인코딩)

**Files:**
- Create: `lib/draw.js`, `lib/wav.js`, `tests/js/draw.test.mjs`, `tests/js/wav.test.mjs`

**Interfaces:**
- Produces:
  - `drawExam(cls:number, num:number): Promise<[number, number]>` 9편 배열의 서로 다른 인덱스 2개, 같은 입력에 항상 같은 결과.
  - `drawPractice(): number` 0~8.
  - `mergeTracks(tracks: Float32Array[], sampleRate: number, gapSec = 0.5): {samples: Float32Array, offsets: {start:number,end:number}[]}`
  - `encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer` PCM16 모노.

- [ ] **Step 1: 실패하는 테스트**

`tests/js/draw.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawExam, drawPractice } from "../../lib/draw.js";

test("drawExam is deterministic and distinct", async () => {
  const a = await drawExam(4, 12);
  const b = await drawExam(4, 12);
  assert.deepEqual(a, b);
  assert.notEqual(a[0], a[1]);
  for (const i of a) assert.ok(i >= 0 && i < 9);
});

test("drawExam differs across students (sanity over 6 classes)", async () => {
  const seen = new Set();
  for (let c = 1; c <= 6; c++) for (let n = 1; n <= 28; n++) seen.add((await drawExam(c, n)).join(","));
  assert.ok(seen.size > 20);
});

test("drawPractice in range", () => {
  for (let i = 0; i < 100; i++) { const d = drawPractice(); assert.ok(d >= 0 && d < 9); }
});
```

`tests/js/wav.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTracks, encodeWav } from "../../lib/wav.js";

test("mergeTracks inserts gaps and reports offsets", () => {
  const sr = 16000;
  const t1 = new Float32Array(sr).fill(0.5);      // 1.0s
  const t2 = new Float32Array(sr / 2).fill(-0.5); // 0.5s
  const { samples, offsets } = mergeTracks([t1, t2], sr, 0.5);
  assert.equal(samples.length, sr + sr / 2 + sr / 2); // 1.0 + gap 0.5 + 0.5
  assert.deepEqual(offsets, [{ start: 0, end: 1 }, { start: 1.5, end: 2 }]);
  assert.equal(samples[sr + 10], 0); // gap is silence
});

test("encodeWav writes a valid 16-bit mono header", () => {
  const sr = 16000;
  const buf = encodeWav(new Float32Array([0, 1, -1, 0.5]), sr);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  assert.equal(tag(0), "RIFF"); assert.equal(tag(8), "WAVE"); assert.equal(tag(36), "data");
  assert.equal(v.getUint16(22, true), 1);      // channels
  assert.equal(v.getUint32(24, true), sr);     // sample rate
  assert.equal(v.getUint16(34, true), 16);     // bits
  assert.equal(v.getUint32(40, true), 8);      // data bytes = 4 samples * 2
  assert.equal(v.getInt16(46, true), 32767);   // sample 1 clipped max
  assert.equal(v.getInt16(48, true), -32768);  // sample -1
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../lib/draw.js'`.

- [ ] **Step 3: 구현**

`lib/draw.js`:
```js
const SEED_PREFIX = "2026-2-speaking";
const N = 9;

export async function drawExam(cls, num) {
  const data = new TextEncoder().encode(`${SEED_PREFIX}|${cls}|${num}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const first = hash[0] % N;
  let second = hash[1] % (N - 1);
  if (second >= first) second += 1;
  return [first, second];
}

export function drawPractice() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % N;
}
```

`lib/wav.js`:
```js
export function mergeTracks(tracks, sampleRate, gapSec = 0.5) {
  const gap = Math.round(gapSec * sampleRate);
  const total = tracks.reduce((s, t) => s + t.length, 0) + gap * Math.max(0, tracks.length - 1);
  const samples = new Float32Array(total);
  const offsets = [];
  let pos = 0;
  tracks.forEach((t, i) => {
    if (i > 0) pos += gap;
    samples.set(t, pos);
    offsets.push({ start: pos / sampleRate, end: (pos + t.length) / sampleRate });
    pos += t.length;
  });
  return { samples, offsets };
}

export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buf;
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

Run: `npm test` → Expected: 5 pass.
```bash
git add lib/draw.js lib/wav.js tests/js/draw.test.mjs tests/js/wav.test.mjs
git commit -m "feat: 결정적 추첨과 WAV 병합·인코딩"
```

---

### Task 5a: 학생 앱 화면 골격, 입장, 모드 선택, 마이크 준비

**Files:**
- Create: `index.html`, `styles.css`, `app.js`, `lib/supa.js`

**Interfaces:**
- Consumes: `check_in` RPC(Task 3), `config.js`.
- Produces: `app.js`의 상태 객체 `state = {cls, num, name, mode: "practice"|"exam", dialogues: [], current: 0, recordings: {}}`, 화면 전환 함수 `showScreen(id)`, 알림 `announce(text)`. `lib/supa.js`의 `getClient()`, `checkIn(cls, num, name)`, `downloadAudio(fileName): Promise<Blob>`.

- [ ] **Step 1: index.html**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>영어 말하기 녹음</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header><h1>3학년 영어B 말하기 포트폴리오</h1></header>
<main id="main">
  <div id="live" aria-live="polite" class="live"></div>

  <section id="screen-entry" class="screen">
    <h2 tabindex="-1">입장</h2>
    <form id="entry-form">
      <fieldset>
        <legend>반</legend>
        <label><input type="radio" name="cls" value="1" required> 1반</label>
        <label><input type="radio" name="cls" value="2"> 2반</label>
        <label><input type="radio" name="cls" value="3"> 3반</label>
        <label><input type="radio" name="cls" value="4"> 4반</label>
        <label><input type="radio" name="cls" value="5"> 5반</label>
        <label><input type="radio" name="cls" value="6"> 6반</label>
      </fieldset>
      <p><label>번호 <input type="number" name="num" min="1" max="40" required></label></p>
      <p><label>이름 <input type="text" name="name" autocomplete="off" required></label></p>
      <p id="entry-error" class="error"></p>
      <button type="submit">확인</button>
    </form>
  </section>

  <section id="screen-mode" class="screen" hidden>
    <h2 tabindex="-1">평가 선택</h2>
    <p id="mode-greeting"></p>
    <p id="mode-note"></p>
    <p>
      <button type="button" id="btn-practice">모의 평가</button>
      <button type="button" id="btn-exam" disabled>본 평가</button>
    </p>
  </section>

  <section id="screen-mic" class="screen" hidden>
    <h2 tabindex="-1">마이크 준비</h2>
    <p>헤드폰을 연결하고 [마이크 테스트]를 누르세요. 3초 동안 녹음한 뒤 자동으로 들려줍니다.</p>
    <p id="mic-status"></p>
    <p>
      <button type="button" id="btn-mic-test">마이크 테스트</button>
      <button type="button" id="btn-mic-next" disabled>시작</button>
    </p>
  </section>

  <section id="screen-record" class="screen" hidden>
    <h2 tabindex="-1" id="record-title"></h2>
    <p id="record-source"></p>
    <p><button type="button" id="btn-play-all">전체 듣기</button></p>
    <ol id="unit-list" class="units"></ol>
    <p>
      <button type="button" id="btn-prev-dialogue" hidden>대화 1로 돌아가기</button>
      <button type="button" id="btn-next" disabled></button>
    </p>
  </section>

  <section id="screen-submit" class="screen" hidden>
    <h2 tabindex="-1">제출</h2>
    <ul id="submit-summary"></ul>
    <p id="submit-status"></p>
    <p>
      <button type="button" id="btn-back-record">녹음으로 돌아가기</button>
      <button type="button" id="btn-submit">제출</button>
    </p>
  </section>

  <section id="screen-done" class="screen" hidden>
    <h2 tabindex="-1">제출 완료</h2>
    <p id="done-text"></p>
  </section>
</main>

<dialog id="confirm-dialog">
  <form method="dialog">
    <h2>제출 확인</h2>
    <p>제출하면 다시 녹음할 수 없습니다. 제출할까요?</p>
    <p><button value="cancel">취소</button> <button value="ok" id="confirm-ok">제출</button></p>
  </form>
</dialog>

<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: styles.css** (최소. 큰 글자, 충분한 대비, 포커스 링, 상태 색은 텍스트와 중복)

```css
:root { --bg:#fff; --fg:#1a1a1a; --accent:#1d4ed8; --muted:#555; --err:#b00020; --ok:#0a7a3b; }
body { margin:0; font-family:"Noto Sans KR",sans-serif; font-size:18px; background:var(--bg); color:var(--fg); }
header, main { max-width:900px; margin:0 auto; padding:16px; }
h1 { font-size:1.3rem; }
.screen h2 { font-size:1.5rem; }
button { font:inherit; font-size:1.05rem; padding:10px 18px; margin:4px; border:2px solid var(--accent); background:#fff; color:var(--accent); border-radius:8px; cursor:pointer; }
button[disabled] { opacity:.4; cursor:default; }
button:focus-visible, input:focus-visible { outline:3px solid #f59e0b; outline-offset:2px; }
input[type=number], input[type=text] { font:inherit; padding:8px; width:12em; }
fieldset label { margin-right:12px; }
.error { color:var(--err); min-height:1.4em; }
.live { position:absolute; left:-9999px; }
.units { list-style:none; padding:0; }
.units li { border:1px solid #ccc; border-radius:8px; padding:12px; margin:10px 0; }
.units .speaker { font-weight:700; margin-right:8px; }
.units .status { color:var(--muted); display:block; margin-top:6px; }
.units li.recording { border-color:var(--err); }
.units li.recorded { border-color:var(--ok); }
dialog { border:2px solid var(--fg); border-radius:12px; padding:20px; font-size:1.05rem; }
dialog::backdrop { background:rgba(0,0,0,.5); }
```

- [ ] **Step 3: lib/supa.js**

```js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

let client;
export function getClient() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export async function checkIn(cls, num, name) {
  const { data, error } = await getClient().rpc("check_in", { p_class: cls, p_number: num, p_name: name });
  if (error) throw error;
  return data; // {ok, exam_open, submitted}
}

export async function downloadAudio(fileName) {
  const { data, error } = await getClient().storage.from("audio").download(fileName);
  if (error) throw error;
  return data; // Blob
}
```

버전 `2.45.4`는 구현 시 `npm view @supabase/supabase-js version`으로 확인한 2주 이상 지난 2.x 버전으로 바꿔도 된다. `+esm` 경로를 쓴다.

- [ ] **Step 4: app.js (입장 → 모드 → 마이크까지)**

```js
import { checkIn, downloadAudio } from "./lib/supa.js";
import { drawExam, drawPractice } from "./lib/draw.js";

export const state = { cls: 0, num: 0, name: "", mode: "", dialogues: [], current: 0, recordings: {}, stream: null };
let DIALOGUES = [];

const $ = (id) => document.getElementById(id);
const live = $("live");
export function announce(text) { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 50); }

export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== id; });
  $(id).querySelector("h2").focus();
}

const normName = (s) => s.replace(/[\s　]/g, "");

// 입장
$("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const cls = Number(f.get("cls")), num = Number(f.get("num")), name = String(f.get("name") || "").trim();
  $("entry-error").textContent = "";
  try {
    const r = await checkIn(cls, num, name);
    if (!r.ok) { $("entry-error").textContent = "명렬에 없습니다. 반, 번호, 이름을 확인하세요."; return; }
    Object.assign(state, { cls, num, name: normName(name) });
    $("mode-greeting").textContent = `${cls}반 ${num}번 ${name}`;
    const examBtn = $("btn-exam");
    if (r.submitted) { examBtn.disabled = true; $("mode-note").textContent = "본 평가를 이미 제출했습니다. 모의 평가만 할 수 있습니다."; }
    else if (!r.exam_open) { examBtn.disabled = true; $("mode-note").textContent = "본 평가는 수업 시간에 선생님이 열어 줍니다."; }
    else { examBtn.disabled = false; $("mode-note").textContent = "본 평가는 대화 2편을 녹음하고 한 번만 제출할 수 있습니다."; }
    showScreen("screen-mode");
  } catch (err) {
    $("entry-error").textContent = "서버에 연결할 수 없습니다. 선생님에게 알리세요.";
    console.error(err);
  }
});

async function loadDialogues() {
  if (DIALOGUES.length) return;
  DIALOGUES = await (await fetch("data/dialogues.json")).json();
}

async function chooseMode(mode) {
  await loadDialogues();
  state.mode = mode;
  state.recordings = {};
  state.current = 0;
  if (mode === "exam") {
    const [a, b] = await drawExam(state.cls, state.num);
    state.dialogues = [DIALOGUES[a], DIALOGUES[b]];
  } else {
    state.dialogues = [DIALOGUES[drawPractice()]];
  }
  showScreen("screen-mic");
}
$("btn-practice").addEventListener("click", () => chooseMode("practice"));
$("btn-exam").addEventListener("click", () => chooseMode("exam"));

// 마이크 준비
$("btn-mic-test").addEventListener("click", async () => {
  const status = $("mic-status");
  try {
    state.stream = state.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    status.textContent = "녹음 중 (3초)";
    const rec = new MediaRecorder(state.stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: "audio/webm" }));
      const audio = new Audio(url);
      status.textContent = "들려줍니다";
      audio.onended = () => { status.textContent = "마이크가 잘 됩니다. [시작]을 누르세요."; $("btn-mic-next").disabled = false; announce("마이크 준비 완료"); };
      audio.play();
    };
    rec.start();
    setTimeout(() => rec.stop(), 3000);
  } catch (err) {
    status.textContent = "마이크를 사용할 수 없습니다. 헤드폰 연결과 브라우저 마이크 권한을 확인한 뒤 다시 누르세요.";
    console.error(err);
  }
});
$("btn-mic-next").addEventListener("click", () => { showRecordScreen(); });

export function showRecordScreen() { /* Task 5b에서 구현 */ }
```

- [ ] **Step 5: 로컬 확인**

`config.js`를 만들고(Task 3 값) `python -m http.server 8765` → `http://localhost:8765`. 명렬에 있는 테스트 학생(0반 99번은 반 라디오에 없으므로 1반의 실제 번호·이름 또는 임시로 `students`에 1반 99번 "테스트" 행을 넣어 확인) 입장 → 모드 선택 → 마이크 테스트까지 키보드만으로 진행. 콘솔 오류 0.

- [ ] **Step 6: 커밋**

```bash
git add index.html styles.css app.js lib/supa.js
git commit -m "feat: 학생 앱 입장·모드 선택·마이크 준비"
```

---

### Task 5b: 녹음 화면 (턴별 녹음·듣기·삭제, 전체 듣기, 대화 이동)

**Files:**
- Modify: `app.js` (`showRecordScreen` 구현과 녹음 로직)

**Interfaces:**
- Consumes: `state`, `showScreen`, `announce`, `downloadAudio`.
- Produces: `state.recordings[dialogueIndex][unitIndex] = Blob`, 모든 단위가 녹음되면 `btn-next` 활성. 본 평가 2편째에서 [제출 화면으로] 클릭 시 `showSubmitScreen()`(Task 5c) 호출.

- [ ] **Step 1: 구현 (app.js의 `showRecordScreen` 자리에 대체)**

```js
let recorder = null;          // 진행 중인 MediaRecorder
let playingAll = null;        // 전체 듣기 Audio
const audioCache = {};        // 대화 ID → object URL

function fmt(sec) { return `${sec.toFixed(1)}초`; }

async function blobDuration(blob) {
  return new Promise((res) => {
    const a = new Audio(URL.createObjectURL(blob));
    a.onloadedmetadata = () => { if (isFinite(a.duration)) res(a.duration); else { a.currentTime = 1e9; a.ontimeupdate = () => res(a.duration); } };
  });
}

export function showRecordScreen() {
  const d = state.dialogues[state.current];
  const isExam = state.mode === "exam";
  $("record-title").textContent = `${isExam ? `대화 ${state.current + 1} / 2` : "모의 평가"}: ${d.title}`;
  $("record-source").textContent = d.source;
  $("btn-prev-dialogue").hidden = !(isExam && state.current === 1);
  $("btn-next").textContent = (isExam && state.current === 0) ? "다음 대화" : "제출 화면으로";
  state.recordings[state.current] = state.recordings[state.current] || {};
  renderUnits();
  showScreen("screen-record");
}

function renderUnits() {
  const d = state.dialogues[state.current];
  const recs = state.recordings[state.current];
  const list = $("unit-list");
  list.innerHTML = "";
  d.units.forEach((u, i) => {
    const li = document.createElement("li");
    li.dataset.index = i;
    const text = document.createElement("p");
    const sp = document.createElement("span"); sp.className = "speaker"; sp.textContent = u.speaker;
    text.append(sp, document.createTextNode(u.text));
    const btnRec = document.createElement("button"); btnRec.type = "button"; btnRec.textContent = recs[i] ? "다시 녹음" : "녹음"; btnRec.dataset.action = "rec";
    const btnPlay = document.createElement("button"); btnPlay.type = "button"; btnPlay.textContent = "듣기"; btnPlay.dataset.action = "play"; btnPlay.disabled = !recs[i];
    const btnDel = document.createElement("button"); btnDel.type = "button"; btnDel.textContent = "삭제"; btnDel.dataset.action = "del"; btnDel.disabled = !recs[i];
    const status = document.createElement("span"); status.className = "status"; status.textContent = recs[i] ? `녹음됨 ${fmt(recs[i].duration)}` : "녹음 전";
    li.append(text, btnRec, btnPlay, btnDel, status);
    if (recs[i]) li.classList.add("recorded");
    list.append(li);
  });
  updateNext();
}

function updateNext() {
  const d = state.dialogues[state.current];
  const recs = state.recordings[state.current];
  $("btn-next").disabled = d.units.some((_, i) => !recs[i]) || !!recorder;
}

function setBusy(busy, activeIndex) {
  document.querySelectorAll("#unit-list button").forEach((b) => {
    const li = b.closest("li");
    const isActive = Number(li.dataset.index) === activeIndex;
    if (busy) b.disabled = !(isActive && b.dataset.action === "rec");
  });
  $("btn-play-all").disabled = busy;
  $("btn-prev-dialogue").disabled = busy;
  if (busy) $("btn-next").disabled = true; else renderUnits();
}

$("unit-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button"); if (!btn) return;
  const li = btn.closest("li"); const i = Number(li.dataset.index);
  const recs = state.recordings[state.current];
  const action = btn.dataset.action;
  if (action === "rec") {
    if (recorder) { recorder.stop(); return; }
    const chunks = [];
    recorder = new MediaRecorder(state.stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (ev) => chunks.push(ev.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      blob.duration = await blobDuration(blob);
      recs[i] = blob;
      recorder = null;
      li.classList.remove("recording");
      setBusy(false);
      announce(`${i + 1}번 녹음됨 ${fmt(blob.duration)}`);
      list_focusRec(i);
    };
    recorder.start();
    li.classList.add("recording");
    btn.textContent = "정지";
    li.querySelector(".status").textContent = "녹음 중";
    setBusy(true, i);
    announce(`${i + 1}번 녹음 시작`);
  } else if (action === "play") {
    new Audio(URL.createObjectURL(recs[i])).play();
  } else if (action === "del") {
    delete recs[i];
    renderUnits();
    announce(`${i + 1}번 녹음 삭제됨`);
    list_focusRec(i);
  }
});

function list_focusRec(i) {
  const li = $("unit-list").querySelector(`li[data-index="${i}"]`);
  li.querySelector('button[data-action="rec"]').focus();
}

$("btn-play-all").addEventListener("click", async () => {
  const btn = $("btn-play-all");
  if (playingAll) { playingAll.pause(); playingAll = null; btn.textContent = "전체 듣기"; return; }
  const d = state.dialogues[state.current];
  try {
    if (!audioCache[d.id]) audioCache[d.id] = URL.createObjectURL(await downloadAudio(d.audio));
    playingAll = new Audio(audioCache[d.id]);
    btn.textContent = "정지";
    playingAll.onended = () => { playingAll = null; btn.textContent = "전체 듣기"; };
    await playingAll.play();
  } catch (err) { announce("음원을 불러오지 못했습니다"); console.error(err); }
});

$("btn-prev-dialogue").addEventListener("click", () => { state.current = 0; showRecordScreen(); });

$("btn-next").addEventListener("click", () => {
  if (playingAll) { playingAll.pause(); playingAll = null; $("btn-play-all").textContent = "전체 듣기"; }
  if (state.mode === "exam" && state.current === 0) { state.current = 1; showRecordScreen(); }
  else showSubmitScreen();
});

window.addEventListener("beforeunload", (e) => {
  const has = Object.values(state.recordings).some((r) => Object.keys(r).length);
  if (has && !state.submitted) { e.preventDefault(); e.returnValue = ""; }
});

export function showSubmitScreen() { /* Task 5c */ }
```

- [ ] **Step 2: 로컬 확인**

모의 평가로 진입해 (1) 녹음 → 정지 → 듣기 → 삭제 → 다시 녹음, (2) 녹음 중 다른 단위 버튼이 비활성인지, (3) 전체 듣기 재생·정지, (4) 모든 단위 녹음 후 [제출 화면으로] 활성, (5) Tab만으로 모든 조작, (6) 녹음 중 새로 고침 시 경고. 본 평가(`open.py`로 테스트 반 열기 또는 settings 직접 수정)로 대화 1 → 다음 대화 → 대화 1로 돌아가기 때 녹음이 보존되는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add app.js
git commit -m "feat: 턴별 녹음·듣기·삭제와 전체 듣기"
```

---

### Task 5c: 제출 (확인 대화상자, 병합, 업로드, 기록)

**Files:**
- Modify: `app.js` (`showSubmitScreen`과 제출 로직)

**Interfaces:**
- Consumes: `mergeTracks`, `encodeWav`(Task 4), `getClient()`.
- Produces: Storage `recordings/exam/3-04/3-04-12/1_L5-1.wav`, `.../2_L7-3.wav`(본 평가) 또는 `recordings/practice/3-04/3-04-12/<ISO시각>_L6-2.wav`; `submissions` 또는 `practice_submissions` 행. `turn_offsets`는 본 평가 `[[{turn,start,end},...],[...]]`(편별 배열), 모의 `[{turn,start,end},...]`.

- [ ] **Step 1: 구현 (app.js의 `showSubmitScreen` 자리에 대체)**

```js
import { mergeTracks, encodeWav } from "./lib/wav.js";
import { getClient } from "./lib/supa.js";

const SR = 16000;

export function showSubmitScreen() {
  const ul = $("submit-summary"); ul.innerHTML = "";
  state.dialogues.forEach((d, di) => {
    const recs = state.recordings[di];
    const total = Object.values(recs).reduce((s, b) => s + b.duration, 0);
    const li = document.createElement("li");
    li.textContent = `${d.title}: ${d.units.length}개 단위, ${fmt(total)}`;
    ul.append(li);
  });
  $("submit-status").textContent = "";
  $("btn-submit").disabled = false;
  showScreen("screen-submit");
}

$("btn-back-record").addEventListener("click", () => showRecordScreen());

$("btn-submit").addEventListener("click", () => {
  const dlg = $("confirm-dialog");
  dlg.returnValue = "";
  dlg.showModal();
  $("confirm-ok").focus();
  dlg.onclose = () => { if (dlg.returnValue === "ok") submit(); else $("btn-submit").focus(); };
});

async function decodeToMono(blob) {
  const ctx = new AudioContext({ sampleRate: SR });
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  await ctx.close();
  return out;
}

async function buildWav(di) {
  const d = state.dialogues[di];
  const tracks = [];
  for (let i = 0; i < d.units.length; i++) tracks.push(await decodeToMono(state.recordings[di][i]));
  const { samples, offsets } = mergeTracks(tracks, SR, 0.5);
  const turnOffsets = offsets.map((o, i) => ({ turn: d.units[i].n, start: +o.start.toFixed(3), end: +o.end.toFixed(3) }));
  return { blob: new Blob([encodeWav(samples, SR)], { type: "audio/wav" }), turnOffsets, duration: +(samples.length / SR).toFixed(2) };
}

async function uploadWav(path, blob) {
  const { error } = await getClient().storage.from("recordings").upload(path, blob, { contentType: "audio/wav", upsert: false });
  // 이미 올라간 파일(재시도)은 성공으로 본다.
  if (error && !(error.statusCode === "409" || error.statusCode === 409 || /already exists/i.test(error.message))) throw error;
}

async function submit() {
  const status = $("submit-status");
  $("btn-submit").disabled = true;
  $("btn-back-record").disabled = true;
  const sid = `3-0${state.cls}/3-0${state.cls}-${String(state.num).padStart(2, "0")}`;
  try {
    status.textContent = "병합 중"; announce("병합 중");
    const built = [];
    for (let di = 0; di < state.dialogues.length; di++) built.push(await buildWav(di));
    const client = getClient();
    if (state.mode === "exam") {
      const paths = built.map((_, di) => `exam/${sid}/${di + 1}_${state.dialogues[di].id}.wav`);
      for (let di = 0; di < built.length; di++) {
        status.textContent = `업로드 ${di + 1}/${built.length}`; announce(status.textContent);
        await uploadWav(paths[di], built[di].blob);
      }
      status.textContent = "기록 저장"; announce("기록 저장");
      const { error } = await client.from("submissions").insert({
        class: state.cls, number: state.num, name: state.name,
        dialogue_ids: state.dialogues.map((d) => d.id),
        turn_offsets: built.map((b) => b.turnOffsets),
        files: paths, durations: built.map((b) => b.duration),
        user_agent: navigator.userAgent,
      });
      if (error) {
        if (error.code === "23505") { finish("이미 제출된 기록이 있습니다. 선생님에게 확인하세요."); return; }
        throw error;
      }
      finish("제출이 완료되었습니다. 창을 닫아도 됩니다.");
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `practice/${sid}/${stamp}_${state.dialogues[0].id}.wav`;
      status.textContent = "업로드 1/1"; announce(status.textContent);
      await uploadWav(path, built[0].blob);
      const { error } = await client.from("practice_submissions").insert({
        class: state.cls, number: state.num, name: state.name,
        dialogue_id: state.dialogues[0].id, turn_offsets: built[0].turnOffsets,
        file: path, duration: built[0].duration, user_agent: navigator.userAgent,
      });
      if (error) throw error;
      finish("모의 평가 제출이 완료되었습니다. 다시 하려면 페이지를 새로 고치세요.");
    }
  } catch (err) {
    console.error(err);
    status.textContent = `제출에 실패했습니다 (${err.message || err}). 네트워크를 확인하고 [다시 시도]를 누르세요.`;
    $("btn-submit").textContent = "다시 시도";
    $("btn-submit").disabled = false;
    $("btn-back-record").disabled = false;
    announce("제출 실패");
  }
}

function finish(text) {
  state.submitted = true;
  $("done-text").textContent = text;
  showScreen("screen-done");
  announce(text);
}
```
`import` 두 줄은 app.js 맨 위 기존 import 옆에 둔다. `state`에 `submitted: false`를 추가한다.

- [ ] **Step 2: 로컬 확인**

모의 평가 제출 → Supabase 대시보드 Storage에 `practice/...wav`, `practice_submissions` 행 확인, WAV를 내려받아 재생(단위 사이 0.5초 무음). 본 평가 제출 → `exam/...` 2개와 `submissions` 행, 같은 학생으로 재입장 시 [본 평가] 비활성·안내 문구. 확인 대화상자에서 Esc·[취소]로 돌아오면 포커스가 [제출]로.

- [ ] **Step 3: 커밋**

```bash
git add app.js
git commit -m "feat: 제출 확인·병합·업로드·기록"
```

---

### Task 6: GitHub Pages 배포와 통합 시험

**Files:**
- Modify: `README.md`(배포 주소), `.github/workflows/pages.yml` 생성

**Interfaces:**
- Produces: `https://engccer.github.io/speaking-portfolio/`. `config.js`는 저장소에 없으므로 **배포 워크플로가 GitHub Secrets에서 생성**한다.

- [ ] **Step 1: 워크플로**

`.github/workflows/pages.yml`:
```yaml
name: pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: ${{ steps.d.outputs.page_url }} }
    steps:
      - uses: actions/checkout@v4
      - name: write config.js
        run: |
          printf 'export const SUPABASE_URL = "%s";\nexport const SUPABASE_ANON_KEY = "%s";\n' "${{ secrets.SUPABASE_URL }}" "${{ secrets.SUPABASE_ANON_KEY }}" > config.js
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }
      - id: d
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 시크릿과 Pages 설정**

```
gh secret set SUPABASE_URL --body "<URL>"
gh secret set SUPABASE_ANON_KEY --body "<anon>"
gh api -X POST repos/Engccer/speaking-portfolio/pages -f build_type=workflow
git add .github/workflows/pages.yml README.md
git commit -m "ci: GitHub Pages 배포"
git push
gh run watch
```
Expected: 워크플로 성공, 배포 주소 접속 시 입장 화면.

- [ ] **Step 3: 통합 시험**

배포 주소에서 테스트 학생으로 모의 평가 1회, 본 평가 1회 제출. `python scripts/download.py --class 0`(Task 7 완료 후) 또는 대시보드에서 파일·행 확인. 끝나면 `python scripts/reset.py 0 99`로 테스트 제출 삭제(Task 10). 크롬북 실기기에서 10/12 오전에 같은 절차를 1회 반복한다.

---

### Task 7: 교사 스크립트: 개방 제어와 다운로드

**Files:**
- Create: `scripts/open.py`, `scripts/close.py`, `scripts/download.py`, `tests/test_download_naming.py`

**Interfaces:**
- Consumes: `common.service_client()`.
- Produces: `download.py`가 만드는 로컬 구조 `<out>/3-N/3-N-NN 이름_1_L5-1.wav` + 같은 이름 `.json`(`{"dialogue_id","turn_offsets","duration","submitted_at"}`), `<out>/미제출_3-N.txt`, `<out>/고아파일.txt`. `naming.local_stem(cls, num, name, idx, dialogue_id) -> str`를 Task 10이 재사용한다.

- [ ] **Step 1: 실패하는 테스트**

`tests/test_download_naming.py`:
```python
from download import local_stem, parse_storage_path


def test_local_stem():
    assert local_stem(4, 7, "김헌용", 1, "L5-1") == "3-04-07 김헌용_1_L5-1"


def test_parse_storage_path():
    assert parse_storage_path("exam/3-04/3-04-07/2_L7-3.wav") == (4, 7, 2, "L7-3")
    assert parse_storage_path("practice/3-01/3-01-12/2026-10-09T01-02-03-000Z_L6-2.wav") == (1, 12, None, "L6-2")
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_download_naming.py -q` → FAIL (`download` 없음).

- [ ] **Step 3: 구현**

`scripts/open.py`:
```python
"""본 평가 개방. 사용: python scripts/open.py 4 6"""
import sys
from common import service_client

classes = [int(a) for a in sys.argv[1:]]
if not classes:
    raise SystemExit("반 번호를 하나 이상 주세요")
c = service_client()
for cls in classes:
    c.table("settings").upsert({"class": cls, "exam_open": True}).execute()
print("열림:", classes)
```

`scripts/close.py`:
```python
"""본 평가 닫기. 사용: python scripts/close.py [반 ...]  (인자 없으면 전 반)"""
import sys
from common import service_client

classes = [int(a) for a in sys.argv[1:]] or list(range(0, 7))
c = service_client()
for cls in classes:
    c.table("settings").upsert({"class": cls, "exam_open": False}).execute()
print("닫힘:", classes)
```

`scripts/download.py`:
```python
"""제출 녹음과 기록을 내려받는다.

사용: python scripts/download.py [--class N] [--practice] <출력 폴더>
"""
import argparse
import json
import re
from pathlib import Path

from common import service_client

PATH_RE = re.compile(r"^(exam|practice)/3-(\d\d)/3-\d\d-(\d\d)/(?:(\d)_)?(?:[^_]+_)?(L\d-\d)\.wav$")


def local_stem(cls, num, name, idx, dialogue_id):
    return f"3-{cls:02d}-{num:02d} {name}_{idx}_{dialogue_id}"


def parse_storage_path(path):
    m = PATH_RE.match(path)
    if not m:
        raise ValueError(path)
    kind, cls, num, idx, did = m.groups()
    return int(cls), int(num), (int(idx) if idx else None), did


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--class", dest="cls", type=int)
    ap.add_argument("--practice", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    client = service_client()
    bucket = client.storage.from_("recordings")

    table = "practice_submissions" if a.practice else "submissions"
    q = client.table(table).select("*")
    if a.cls is not None:
        q = q.eq("class", a.cls)
    rows = q.order("class").order("number").execute().data

    referenced = set()
    for r in rows:
        files = [r["file"]] if a.practice else r["files"]
        offsets = [r["turn_offsets"]] if a.practice else r["turn_offsets"]
        dids = [r["dialogue_id"]] if a.practice else r["dialogue_ids"]
        durs = [r["duration"]] if a.practice else r["durations"]
        for i, path in enumerate(files):
            referenced.add(path)
            cls, num, _, did = parse_storage_path(path)
            folder = out / ("practice" if a.practice else "") / f"3-{cls:02d}"
            folder.mkdir(parents=True, exist_ok=True)
            idx = Path(path).stem.rsplit("_", 1)[0] if a.practice else i + 1  # 모의는 시각 스탬프
            stem = local_stem(cls, num, r["name"], idx, did)
            wav = folder / f"{stem}.wav"
            if not wav.exists():
                wav.write_bytes(bucket.download(path))
            (folder / f"{stem}.json").write_text(json.dumps({
                "dialogue_id": dids[i], "turn_offsets": offsets[i], "duration": durs[i],
                "submitted_at": r["submitted_at"]}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{table}: {len(rows)}건")

    if not a.practice:
        sq = client.table("students").select("class,number,name")
        if a.cls is not None:
            sq = sq.eq("class", a.cls)
        submitted = {(r["class"], r["number"]) for r in rows}
        by_class = {}
        for s in sq.execute().data:
            if (s["class"], s["number"]) not in submitted:
                by_class.setdefault(s["class"], []).append(f"{s['number']:02d} {s['name']}")
        for cls, names in sorted(by_class.items()):
            (out / f"미제출_3-{cls:02d}.txt").write_text("\n".join(sorted(names)) + "\n", encoding="utf-8")
            print(f"3-{cls:02d} 미제출 {len(names)}명")

        orphans = []
        for cls_dir in bucket.list("exam"):
            for stu_dir in bucket.list(f"exam/{cls_dir['name']}"):
                for f in bucket.list(f"exam/{cls_dir['name']}/{stu_dir['name']}"):
                    p = f"exam/{cls_dir['name']}/{stu_dir['name']}/{f['name']}"
                    if p not in referenced and (a.cls is None or cls_dir["name"] == f"3-{a.cls:02d}"):
                        orphans.append(p)
        if orphans:
            (out / "고아파일.txt").write_text("\n".join(orphans) + "\n", encoding="utf-8")
            print(f"행 없는 파일 {len(orphans)}개 → 고아파일.txt")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 통과 확인, 실서버 확인, 커밋**

Run: `python -m pytest tests/test_download_naming.py -q` → 2 passed. `python scripts/download.py --class 0 "<임시 폴더>"`로 Task 6 테스트 제출이 내려오는지 확인.
```bash
git add scripts/open.py scripts/close.py scripts/download.py tests/test_download_naming.py
git commit -m "feat: 개방 제어와 제출 다운로드 스크립트"
```

---

### Task 8: 전사 (ElevenLabs Scribe)

**Files:**
- Create: `scripts/transcribe.py`, `tests/test_transcribe_cache.py`

**Interfaces:**
- Consumes: `.env`의 `ELEVENLABS_API_KEY`.
- Produces: WAV 옆 `<stem>.scribe.json` = Scribe 응답 원문(`{"text": str, "words": [{"text","start","end","type"}]}`). `transcribe_file(wav: Path) -> dict`.

- [ ] **Step 1: 실패하는 테스트 (캐시 동작만, API 호출 없음)**

`tests/test_transcribe_cache.py`:
```python
import json
from pathlib import Path

import transcribe


def test_uses_cache_without_calling_api(tmp_path, monkeypatch):
    wav = tmp_path / "a.wav"; wav.write_bytes(b"RIFF")
    cache = tmp_path / "a.scribe.json"; cache.write_text(json.dumps({"text": "hi", "words": []}), encoding="utf-8")
    monkeypatch.setattr(transcribe, "call_scribe", lambda p: (_ for _ in ()).throw(AssertionError("호출 금지")))
    assert transcribe.transcribe_file(wav)["text"] == "hi"


def test_calls_api_and_writes_cache(tmp_path, monkeypatch):
    wav = tmp_path / "b.wav"; wav.write_bytes(b"RIFF")
    monkeypatch.setattr(transcribe, "call_scribe", lambda p: {"text": "yo", "words": [{"text": "yo", "start": 0, "end": 0.3, "type": "word"}]})
    assert transcribe.transcribe_file(wav)["text"] == "yo"
    assert json.loads((tmp_path / "b.scribe.json").read_text(encoding="utf-8"))["text"] == "yo"
```

- [ ] **Step 2: 실패 확인** → `python -m pytest tests/test_transcribe_cache.py -q` FAIL.

- [ ] **Step 3: 구현**

`scripts/transcribe.py`:
```python
"""폴더의 WAV를 ElevenLabs Scribe로 전사해 <stem>.scribe.json으로 캐시한다. 캐시가 있으면 호출하지 않는다.

사용: python scripts/transcribe.py <폴더>
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

from common import load_env

URL = "https://api.elevenlabs.io/v1/speech-to-text"


def call_scribe(wav: Path) -> dict:
    load_env()
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit(".env에 ELEVENLABS_API_KEY 없음")
    for attempt in range(3):
        with open(wav, "rb") as f:
            r = requests.post(URL, headers={"xi-api-key": key},
                              data={"model_id": "scribe_v1", "language_code": "en",
                                    "timestamps_granularity": "word", "diarize": "false",
                                    "tag_audio_events": "false"},
                              files={"file": (wav.name, f, "audio/wav")}, timeout=300)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503) and attempt < 2:
            time.sleep(5 * (attempt + 1))
            continue
        raise RuntimeError(f"{wav.name}: {r.status_code} {r.text[:200]}")


def transcribe_file(wav: Path) -> dict:
    cache = wav.with_name(wav.stem + ".scribe.json")
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    data = call_scribe(wav)
    cache.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def main():
    folder = Path(sys.argv[1])
    wavs = sorted(folder.rglob("*.wav"))
    done = called = 0
    for w in wavs:
        had = w.with_name(w.stem + ".scribe.json").exists()
        try:
            transcribe_file(w)
            done += 1
            called += 0 if had else 1
            print(("캐시 " if had else "전사 ") + w.name)
        except Exception as e:
            print("실패", w.name, e)
    print(f"{done}/{len(wavs)} 완료, API 호출 {called}회")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 통과 확인, 실호출 1회, 커밋**

`python -m pytest tests/test_transcribe_cache.py -q` → 2 passed. Task 6의 테스트 녹음 1개로 `python scripts/transcribe.py "<폴더>"` 실행해 `words`에 `start`/`end`가 있는지 확인(과금 1건).
```bash
git add scripts/transcribe.py tests/test_transcribe_cache.py
git commit -m "feat: ElevenLabs Scribe 전사와 캐시"
```

---

### Task 9: 채점 로직

**Files:**
- Create: `scripts/scoring.py`, `scripts/scoring.json`, `tests/test_scoring.py`

**Interfaces:**
- Consumes: `data/dialogues.json`의 `units`/`expressions`, Scribe JSON(`words`), `turn_offsets`.
- Produces:
  - `canonical(text: str) -> list[str]`
  - `align(ref: list[str], hyp: list[str]) -> list[tuple[int|None, int|None]]` (ref 인덱스, hyp 인덱스) 쌍. 둘 다 있으면 일치 또는 대체, 한쪽만 있으면 삭제/삽입. 일치 여부는 토큰 비교로 판단.
  - `score_dialogue(dialogue: dict, scribe: dict, turn_offsets: list, cfg: dict) -> dict` = `{"satisfied": int, "score": int, "expressions": [{"n","text","transcript","match_ratio","max_gap","wpm","ok","reason"}]}`
  - `dialogue_score(satisfied: int) -> int`, `final_score(scores: list[int]) -> int`

- [ ] **Step 1: 실패하는 테스트**

`tests/test_scoring.py`:
```python
import json
from pathlib import Path

import pytest

from scoring import align, canonical, dialogue_score, final_score, score_dialogue, DEFAULT_CFG

DATA = json.loads((Path(__file__).resolve().parents[1] / "data" / "dialogues.json").read_text(encoding="utf-8"))
BY_ID = {d["id"]: d for d in DATA}


def words_from(text_units, offsets, wpm=120):
    """단위별 텍스트를 균등 간격 단어 타임스탬프로 만든다."""
    words = []
    for unit_text, off in zip(text_units, offsets):
        toks = unit_text.split()
        step = 60 / wpm
        t = off["start"]
        for tok in toks:
            words.append({"text": tok, "start": round(t, 3), "end": round(t + step * 0.8, 3), "type": "word"})
            t += step
    return {"text": " ".join(text_units), "words": words}


def offsets_for(d, unit_sec=12.0, gap=0.5):
    out, t = [], 0.0
    for u in d["units"]:
        out.append({"turn": u["n"], "start": t, "end": t + unit_sec}); t += unit_sec + gap
    return out


@pytest.mark.parametrize("src,expected", [
    ("Jiho, what are you reading?", ["jiho", "what", "are", "you", "reading"]),
    ("I'm going to watch it.", ["i'm", "going", "to", "watch", "it"]),
    ("This museum opened in 1995.", ["this", "museum", "opened", "in", "nineteen", "ninety", "five"]),
    ("about −58℃ in July", ["about", "minus", "fifty", "eight", "degrees", "in", "july"]),
    ("about -58°C in July", ["about", "minus", "fifty", "eight", "degrees", "in", "july"]),
    ("November 5th", ["november", "fifth"]),
    ("25 dollars", ["twenty", "five", "dollars"]),
    ("$25", ["twenty", "five", "dollars"]),
    ("for 3 years", ["for", "three", "years"]),
    ("He's 10.", ["he's", "ten"]),
    ("I am going", ["i'm", "going"]),
])
def test_canonical(src, expected):
    assert canonical(src) == expected


def test_align_substitution_and_deletion():
    pairs = align(["a", "b", "c", "d"], ["a", "x", "d"])
    assert (0, 0) in pairs and (3, 2) in pairs
    ref_idx = [r for r, h in pairs if r is not None]
    assert sorted(ref_idx) == [0, 1, 2, 3]


def test_perfect_reading_scores_ten():
    d = BY_ID["L5-3"]
    offs = offsets_for(d)
    scribe = words_from([u["text"] for u in d["units"]], offs)
    r = score_dialogue(d, scribe, offs, DEFAULT_CFG)
    assert r["satisfied"] == 10 and r["score"] == 10
    assert all(e["ok"] for e in r["expressions"])


def test_one_unit_silent_gives_nine():
    d = BY_ID["L5-3"]
    offs = offsets_for(d)
    texts = [u["text"] for u in d["units"]]
    texts[2] = ""
    r = score_dialogue(d, words_from(texts, offs), offs, DEFAULT_CFG)
    assert r["satisfied"] == 9 and r["score"] == 10
    assert r["expressions"][2]["ok"] is False and r["expressions"][2]["reason"] == "no_words"


def test_split_expressions_scored_separately():
    d = BY_ID["L7-2"]  # 단위 2가 표현 2개로 나뉨
    offs = offsets_for(d)
    texts = [u["text"] for u in d["units"]]
    texts[1] = "I'm going to go hiking."  # 뒷 문장 누락
    r = score_dialogue(d, words_from(texts, offs), offs, DEFAULT_CFG)
    ok = [e["ok"] for e in r["expressions"]]
    assert ok[1] is True and ok[2] is False and sum(ok) == 9


def test_long_pause_fails_fluency():
    d = BY_ID["L6-1"]
    offs = offsets_for(d)
    scribe = words_from([u["text"] for u in d["units"]], offs)
    # 단위 5("I liked the folk village most.")의 셋째 단어를 3초 뒤로 민다
    idx = [i for i, w in enumerate(scribe["words"]) if w["start"] >= offs[4]["start"]][2]
    for w in scribe["words"][idx:idx + 3]:
        w["start"] += 3.0; w["end"] += 3.0
    r = score_dialogue(d, scribe, offs, DEFAULT_CFG)
    assert r["expressions"][4]["ok"] is False and r["expressions"][4]["reason"] == "max_gap"


def test_slow_speech_fails_wpm():
    d = BY_ID["L6-2"]
    offs = offsets_for(d, unit_sec=60.0)
    scribe = words_from([u["text"] for u in d["units"]], offs, wpm=30)
    r = score_dialogue(d, scribe, offs, DEFAULT_CFG)
    assert r["satisfied"] == 0 and r["score"] == 1
    assert {e["reason"] for e in r["expressions"]} == {"wpm"}


def test_empty_transcript_scores_one():
    d = BY_ID["L5-1"]
    r = score_dialogue(d, {"text": "", "words": []}, offsets_for(d), DEFAULT_CFG)
    assert r["satisfied"] == 0 and r["score"] == 1


@pytest.mark.parametrize("n,s", [(10, 10), (9, 10), (8, 9), (5, 6), (1, 2), (0, 1)])
def test_dialogue_score_table(n, s):
    assert dialogue_score(n) == s


@pytest.mark.parametrize("scores,final", [([10, 9], 10), ([9, 8], 9), ([8, 7], 8), ([1, 1], 1), ([10, 0], 5), ([0, 0], 0)])
def test_final_score_round_half_up(scores, final):
    assert final_score(scores) == final
```

- [ ] **Step 2: 실패 확인** → `python -m pytest tests/test_scoring.py -q` FAIL.

- [ ] **Step 3: 구현**

`scripts/scoring.json`:
```json
{ "match_ratio_min": 0.75, "max_gap_sec": 2.0, "wpm_min": 60 }
```

`scripts/scoring.py`:
```python
"""전사 결과를 대본과 정렬해 표현별 만족 여부와 점수를 계산한다."""
import json
import re
from pathlib import Path

DEFAULT_CFG = json.loads((Path(__file__).with_name("scoring.json")).read_text(encoding="utf-8"))

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
ORDINAL = {"1": "first", "2": "second", "3": "third", "5": "fifth", "8": "eighth", "9": "ninth", "12": "twelfth"}
CONTRACTIONS = {("i", "am"): "i'm", ("it", "is"): "it's", ("he", "is"): "he's", ("she", "is"): "she's",
                ("that", "is"): "that's", ("what", "is"): "what's", ("let", "us"): "let's", ("i", "have"): "i've",
                ("i", "will"): "i'll", ("i", "would"): "i'd", ("you", "are"): "you're", ("do", "not"): "don't",
                ("does", "not"): "doesn't", ("can", "not"): "can't", ("is", "not"): "isn't", ("i", "had"): "i'd"}


def num_words(n: int) -> list[str]:
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], "hundred"] + (num_words(n % 100) if n % 100 else [])
    if 1100 <= n < 2000 and n % 100:  # 1995 → nineteen ninety five
        return num_words(n // 100) + num_words(n % 100)
    if n < 10000:
        return num_words(n // 1000) + ["thousand"] + (num_words(n % 1000) if n % 1000 else [])
    return [str(n)]


def ordinal_words(n: str) -> list[str]:
    if n in ORDINAL:
        return [ORDINAL[n]]
    w = num_words(int(n))
    last = w[-1]
    if last.endswith("y"):
        w[-1] = last[:-1] + "ieth"
    elif last == "one":
        w[-1] = "first"
    elif last == "two":
        w[-1] = "second"
    elif last == "three":
        w[-1] = "third"
    else:
        w[-1] = last + "th"
    return w


def canonical(text: str) -> list[str]:
    t = text.lower()
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"[−–-]\s*(?=\d)", " minus ", t)          # −58 → minus 58
    t = re.sub(r"\$\s*(\d+)", r"\1 dollars", t)          # $25 → 25 dollars
    t = re.sub(r"(\d+)\s*(℃|°\s*c|degrees?\s+celsius)", r"\1 degrees", t)
    t = re.sub(r"(\d+)(st|nd|rd|th)\b", lambda m: " ".join(ordinal_words(m.group(1))), t)
    t = re.sub(r"\d+", lambda m: " ".join(num_words(int(m.group(0)))), t)
    t = re.sub(r"[^a-z' ]+", " ", t)
    toks = [w.strip("'") for w in t.split()]
    toks = [w for w in toks if w]
    out = []
    i = 0
    while i < len(toks):
        if i + 1 < len(toks) and (toks[i], toks[i + 1]) in CONTRACTIONS:
            out.append(CONTRACTIONS[(toks[i], toks[i + 1])]); i += 2
        else:
            out.append(toks[i]); i += 1
    return out


def align(ref: list[str], hyp: list[str]) -> list[tuple]:
    """Needleman-Wunsch. 일치 +2, 대체 -1, 삽입/삭제 -1."""
    n, m = len(ref), len(hyp)
    score = [[0] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = -i; back[i][0] = "up"
    for j in range(1, m + 1):
        score[0][j] = -j; back[0][j] = "left"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            diag = score[i - 1][j - 1] + (2 if ref[i - 1] == hyp[j - 1] else -1)
            up = score[i - 1][j] - 1
            left = score[i][j - 1] - 1
            best = max(diag, up, left)
            score[i][j] = best
            back[i][j] = "diag" if best == diag else ("up" if best == up else "left")
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        b = back[i][j]
        if b == "diag":
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif b == "up":
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    return list(reversed(pairs))


def expand_words(words: list[dict]) -> list[dict]:
    """Scribe 단어를 정규화 토큰으로 펼친다(한 단어가 여러 토큰이 되면 타임스탬프 공유)."""
    out = []
    for w in words:
        if w.get("type", "word") != "word":
            continue
        for tok in canonical(w["text"]):
            out.append({"tok": tok, "start": float(w["start"]), "end": float(w["end"])})
    return out


def score_dialogue(dialogue: dict, scribe: dict, turn_offsets: list, cfg: dict) -> dict:
    hyp_all = expand_words(scribe.get("words", []))
    offsets = {o["turn"]: o for o in turn_offsets}
    results = []
    for u in dialogue["units"]:
        off = offsets[u["n"]]
        hyp = [w for w in hyp_all if off["start"] - 0.25 <= w["start"] <= off["end"] + 0.25]
        exprs = [e for e in dialogue["expressions"] if e["unit"] == u["n"]]
        ref, owner = [], []
        for e in exprs:
            toks = canonical(e["text"])
            ref += toks; owner += [e["n"]] * len(toks)
        pairs = align(ref, [w["tok"] for w in hyp])
        for e in exprs:
            idxs = [k for k, o in enumerate(owner) if o == e["n"]]
            matched = [(r, h) for r, h in pairs if r in idxs and h is not None]
            hits = sum(1 for r, h in matched if ref[r] == hyp[h]["tok"])
            aligned = sorted({h for _, h in matched})
            match_ratio = hits / len(idxs) if idxs else 0.0
            transcript = " ".join(hyp[h]["tok"] for h in aligned)
            if not aligned:
                results.append({"n": e["n"], "text": e["text"], "transcript": "", "match_ratio": 0.0,
                                "max_gap": None, "wpm": None, "ok": False, "reason": "no_words"})
                continue
            gaps = [hyp[b]["start"] - hyp[a]["end"] for a, b in zip(aligned, aligned[1:])]
            max_gap = max(gaps) if gaps else 0.0
            span = hyp[aligned[-1]]["end"] - hyp[aligned[0]]["start"]
            wpm = (len(aligned) / (span / 60)) if (span > 0 and len(aligned) > 1) else None
            reason = ""
            if match_ratio < cfg["match_ratio_min"]:
                reason = "match_ratio"
            elif max_gap > cfg["max_gap_sec"]:
                reason = "max_gap"
            elif wpm is not None and wpm < cfg["wpm_min"]:
                reason = "wpm"
            results.append({"n": e["n"], "text": e["text"], "transcript": transcript,
                            "match_ratio": round(match_ratio, 3), "max_gap": round(max_gap, 2),
                            "wpm": (round(wpm, 1) if wpm is not None else None), "ok": reason == "", "reason": reason})
    results.sort(key=lambda r: r["n"])
    satisfied = sum(1 for r in results if r["ok"])
    return {"satisfied": satisfied, "score": dialogue_score(satisfied), "expressions": results}


def dialogue_score(satisfied: int) -> int:
    if satisfied >= 9:
        return 10
    if satisfied >= 1:
        return satisfied + 1
    return 1


def final_score(scores: list[int]) -> int:
    if not scores:
        return 0
    x = sum(scores) / len(scores)
    return int(x + 0.5)
```

- [ ] **Step 4: 통과 확인 후 커밋**

Run: `python -m pytest tests/test_scoring.py -q` → 전부 passed. `canonical` 테스트가 깨지면 정규식 순서(minus → dollars → degrees → ordinal → digits)를 지키며 고친다.
```bash
git add scripts/scoring.py scripts/scoring.json tests/test_scoring.py
git commit -m "feat: 전사 정렬과 표현별 채점 로직"
```

---

### Task 10: 채점 CLI(xlsx·CSV)와 재응시 초기화

**Files:**
- Create: `scripts/score.py`, `scripts/reset.py`, `tests/test_score_cli.py`

**Interfaces:**
- Consumes: Task 7의 폴더 구조(`<stem>.wav`, `<stem>.json`, `<stem>.scribe.json`), Task 9 함수들.
- Produces: `<out>/<N>반 말하기 채점.xlsx`(열: 번호, 이름, 대화1, 만족1, 점수1, 대화2, 만족2, 점수2, 최종, 비고, 제출시각), `<out>/표현별 상세.csv`(반, 번호, 이름, 편, 대화ID, 표현, 원문, 전사, match_ratio, max_gap, wpm, 판정, 사유). `collect(folder) -> dict[(cls,num)] -> {"name","dialogues":[{...}]}`.

- [ ] **Step 1: 실패하는 테스트**

`tests/test_score_cli.py`:
```python
import json
from pathlib import Path

from openpyxl import load_workbook

import score

DATA = json.loads((Path(__file__).resolve().parents[1] / "data" / "dialogues.json").read_text(encoding="utf-8"))
L51 = next(d for d in DATA if d["id"] == "L5-1")


def make_student(folder, cls, num, name, ids, perfect=True):
    cdir = folder / f"3-{cls:02d}"; cdir.mkdir(parents=True, exist_ok=True)
    for i, did in enumerate(ids, 1):
        d = next(x for x in DATA if x["id"] == did)
        stem = f"3-{cls:02d}-{num:02d} {name}_{i}_{did}"
        offs, words, t = [], [], 0.0
        for u in d["units"]:
            offs.append({"turn": u["n"], "start": t, "end": t + 10})
            if perfect:
                tt = t
                for tok in u["text"].split():
                    words.append({"text": tok, "start": tt, "end": tt + 0.3, "type": "word"}); tt += 0.4
            t += 10.5
        (cdir / f"{stem}.wav").write_bytes(b"RIFF")
        (cdir / f"{stem}.json").write_text(json.dumps({"dialogue_id": did, "turn_offsets": offs, "duration": t, "submitted_at": "2026-10-12T01:00:00Z"}), encoding="utf-8")
        (cdir / f"{stem}.scribe.json").write_text(json.dumps({"text": "", "words": words}), encoding="utf-8")


def test_score_cli_writes_xlsx_and_csv(tmp_path):
    make_student(tmp_path, 4, 1, "가나다", ["L5-1", "L6-2"])
    make_student(tmp_path, 4, 2, "라마바", ["L5-3", "L7-1"], perfect=False)
    (tmp_path / "미제출_3-04.txt").write_text("03 사아자\n", encoding="utf-8")
    score.run(tmp_path, tmp_path, score.DEFAULT_CFG)
    wb = load_workbook(tmp_path / "4반 말하기 채점.xlsx")
    rows = list(wb.active.iter_rows(values_only=True))
    assert rows[0][:3] == ("번호", "이름", "대화1")
    by_num = {r[0]: r for r in rows[1:]}
    assert by_num[1][8] == 10            # 최종
    assert by_num[2][8] == 1             # 무음 2편 → 1, 1 → 1
    assert by_num[3][8] == 0 and by_num[3][9] == "미제출"
    csv_text = (tmp_path / "표현별 상세.csv").read_text(encoding="utf-8-sig")
    assert csv_text.count("\n") == 1 + 40  # 헤더 + 2명 × 2편 × 10표현
```

- [ ] **Step 2: 실패 확인** → `python -m pytest tests/test_score_cli.py -q` FAIL.

- [ ] **Step 3: 구현**

`scripts/score.py`:
```python
"""다운로드 폴더의 전사 결과를 채점해 반별 xlsx와 표현별 CSV를 만든다.

사용: python scripts/score.py <다운로드 폴더> [--out <출력 폴더>] [--config scripts/scoring.json]
"""
import argparse
import csv
import json
import re
from pathlib import Path

from openpyxl import Workbook

from scoring import DEFAULT_CFG, final_score, score_dialogue

ROOT = Path(__file__).resolve().parents[1]
DIALOGUES = {d["id"]: d for d in json.loads((ROOT / "data" / "dialogues.json").read_text(encoding="utf-8"))}
STEM_RE = re.compile(r"^3-(\d\d)-(\d\d) (.+)_([^_]+)_(L\d-\d)$")


def collect(folder: Path) -> dict:
    """본 평가(idx 1·2)는 dialogues에, 모의(idx가 시각 스탬프)는 practice 목록에 모은다."""
    students = {}
    for meta in sorted(folder.glob("**/3-*/*.json")):
        if meta.name.endswith(".scribe.json"):
            continue
        m = STEM_RE.match(meta.stem)
        if not m:
            continue
        cls, num, name, idx, did = int(m[1]), int(m[2]), m[3], m[4], m[5]
        info = json.loads(meta.read_text(encoding="utf-8"))
        scribe_path = meta.with_name(meta.stem + ".scribe.json")
        scribe = json.loads(scribe_path.read_text(encoding="utf-8")) if scribe_path.exists() else None
        entry = {"id": did, "turn_offsets": info["turn_offsets"], "scribe": scribe,
                 "submitted_at": info.get("submitted_at", "")}
        s = students.setdefault((cls, num), {"name": name, "dialogues": {}, "practice": []})
        if idx.isdigit():
            s["dialogues"][int(idx)] = entry
        else:
            s["practice"].append(entry)
    return students


def missing(folder: Path) -> dict:
    out = {}
    for f in folder.glob("미제출_3-*.txt"):
        cls = int(f.stem.split("-")[1])
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                num, name = line.split(" ", 1)
                out[(cls, int(num))] = name
    return out


def run(folder: Path, out: Path, cfg: dict):
    students = collect(folder)
    absent = missing(folder)
    detail_rows = []
    by_class = {}
    for (cls, num), s in students.items():
        for p in s["practice"]:  # 모의 녹음은 임계값 보정용으로 상세 CSV에만 적는다
            if p["scribe"] is not None:
                r = score_dialogue(DIALOGUES[p["id"]], p["scribe"], p["turn_offsets"], cfg)
                for e in r["expressions"]:
                    detail_rows.append([cls, num, s["name"], "모의", p["id"], e["n"], e["text"], e["transcript"],
                                        e["match_ratio"], e["max_gap"], e["wpm"], "만족" if e["ok"] else "불만족", e["reason"]])
        if not s["dialogues"]:
            continue
        row = {"번호": num, "이름": s["name"], "최종": 0, "비고": [], "제출시각": ""}
        scores = []
        for idx in (1, 2):
            d = s["dialogues"].get(idx)
            if not d:
                row[f"대화{idx}"] = ""; row[f"만족{idx}"] = ""; row[f"점수{idx}"] = 0; scores.append(0); row["비고"].append(f"대화{idx} 없음")
                continue
            row[f"대화{idx}"] = d["id"]; row["제출시각"] = d["submitted_at"]
            if d["scribe"] is None:
                row[f"만족{idx}"] = ""; row[f"점수{idx}"] = ""; row["비고"].append(f"대화{idx} 전사 실패"); continue
            r = score_dialogue(DIALOGUES[d["id"]], d["scribe"], d["turn_offsets"], cfg)
            row[f"만족{idx}"] = r["satisfied"]; row[f"점수{idx}"] = r["score"]; scores.append(r["score"])
            bad = [str(e["n"]) for e in r["expressions"] if not e["ok"]]
            if bad:
                row["비고"].append(f"대화{idx} 불만족 {','.join(bad)}")
            for e in r["expressions"]:
                detail_rows.append([cls, num, s["name"], idx, d["id"], e["n"], e["text"], e["transcript"],
                                    e["match_ratio"], e["max_gap"], e["wpm"], "만족" if e["ok"] else "불만족", e["reason"]])
        row["최종"] = final_score(scores) if len(scores) == 2 else ""
        row["비고"] = "; ".join(row["비고"])
        by_class.setdefault(cls, []).append(row)
    for (cls, num), name in absent.items():
        by_class.setdefault(cls, []).append({"번호": num, "이름": name, "대화1": "", "만족1": "", "점수1": 0,
                                             "대화2": "", "만족2": "", "점수2": 0, "최종": 0, "비고": "미제출", "제출시각": ""})

    out.mkdir(parents=True, exist_ok=True)
    cols = ["번호", "이름", "대화1", "만족1", "점수1", "대화2", "만족2", "점수2", "최종", "비고", "제출시각"]
    for cls, rows in sorted(by_class.items()):
        wb = Workbook(); ws = wb.active; ws.title = f"3-{cls}"
        ws.append(cols)
        for r in sorted(rows, key=lambda r: r["번호"]):
            ws.append([r.get(c, "") for c in cols])
        wb.save(out / f"{cls}반 말하기 채점.xlsx")
    with open(out / "표현별 상세.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["반", "번호", "이름", "편", "대화ID", "표현", "원문", "전사", "match_ratio", "max_gap", "wpm", "판정", "사유"])
        w.writerows(detail_rows)
    print(f"{len(students)}명 채점, 미제출 {len(absent)}명, 반 {sorted(by_class)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder"); ap.add_argument("--out"); ap.add_argument("--config")
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text(encoding="utf-8")) if a.config else DEFAULT_CFG
    run(Path(a.folder), Path(a.out or a.folder), cfg)


if __name__ == "__main__":
    main()
```

`scripts/reset.py`:
```python
"""학생 1명의 본 평가 제출(행과 파일)을 삭제해 재응시를 허용한다. 쌤 지시가 있을 때만 실행.

사용: python scripts/reset.py <반> <번호>
"""
import sys
from common import service_client

cls, num = int(sys.argv[1]), int(sys.argv[2])
c = service_client()
rows = c.table("submissions").select("*").eq("class", cls).eq("number", num).execute().data
if not rows:
    raise SystemExit("제출 기록 없음")
r = rows[0]
print(f"삭제 대상: {cls}반 {num}번 {r['name']} {r['dialogue_ids']} {r['submitted_at']}")
if input("정말 삭제할까요? (yes 입력) ").strip() != "yes":
    raise SystemExit("취소")
c.storage.from_("recordings").remove(r["files"])
c.table("submissions").delete().eq("id", r["id"]).execute()
print("삭제 완료. 학생이 다시 입장하면 본 평가가 가능합니다(반이 열려 있어야 함).")
```

- [ ] **Step 4: 통과 확인, 실데이터 1회, 커밋**

`python -m pytest -q` → 전부 passed. Task 6~8의 테스트 제출로 `python scripts/score.py "<폴더>"` 실행해 xlsx·CSV 열어 보기. `python scripts/reset.py 0 99`로 테스트 제출 삭제.
```bash
git add scripts/score.py scripts/reset.py tests/test_score_cli.py
git commit -m "feat: 채점 CLI와 재응시 초기화"
```

---

### Task 11: 안내문 표현 목록과 말하기 폴더 문서 갱신

**Files:**
- Create: `scripts/export_expressions.py`
- Modify (말하기 폴더, 저장소 밖): `2. 안내문/2026 말하기 포트폴리오 안내문 초안.md`, `progress.md`, `CHANGELOG.md`, `CLAUDE.md`

**Interfaces:**
- Produces: 표현 10개 표(Markdown)를 안내문에 삽입.

- [ ] **Step 1: 표현 표 생성 스크립트**

`scripts/export_expressions.py`:
```python
"""data/dialogues.json의 표현 10개를 대화별 Markdown 표로 출력한다. 사용: python scripts/export_expressions.py > 표현목록.md"""
import json
from pathlib import Path

data = json.loads((Path(__file__).resolve().parents[1] / "data" / "dialogues.json").read_text(encoding="utf-8"))
for d in data:
    print(f"### {d['id']} {d['title']} ({d['source']})\n")
    print("| 번호 | 역할 | 표현 |\n|---|---|---|")
    sp = {u["n"]: u["speaker"] for u in d["units"]}
    for e in d["expressions"]:
        print(f"| {e['n']} | {sp[e['unit']]} | {e['text']} |")
    print()
```

- [ ] **Step 2: 안내문 갱신**

안내문 초안에 "평가 방법" 절을 추가한다(결과만, 경위 없이): 크롬북 접속 주소, 입장(반·번호·이름), 모의 평가는 몇 번이든 가능, 본 평가는 대화 2편이 무작위로 나오고 턴별 녹음·듣기·삭제·재녹음 가능, 제출은 한 번뿐, 채점은 대화별 표현 10개 기준으로 공식 점수표 적용 후 두 편 평균. 이어서 Step 1의 표 9개를 "평가 범위와 핵심 표현" 절로 붙인다. 날짜·요일을 쓰면 `python -c "import datetime; ..."`로 검증한다.

- [ ] **Step 3: progress.md·CHANGELOG.md·CLAUDE.md 갱신**

말하기 폴더 `progress.md`: "현재 단계"를 웹앱 구현 완료·배포 주소·운영 절차(open/close, download, transcribe, score)로 바꾸고, 미결 항목에서 채점 방식·절차·대화 조합·표현 10개를 확정으로 옮긴다. `CHANGELOG.md`에 날짜별 항목 추가. `CLAUDE.md`의 자료 관리 절에 저장소 경로(`Windows-Projects\Education\speaking-portfolio`)와 `4. 채점/녹음/` 구조를 추가한다. 학교 폴더 루트에서 `python sync_agent_docs.py`로 AGENTS.md 동기화.

- [ ] **Step 4: 커밋 (저장소 쪽만)**

```bash
git add scripts/export_expressions.py
git commit -m "feat: 안내문용 표현 목록 출력"
git push
```

---

## 실행 순서와 병렬화

```
Task 1 → Task 2 → Task 3 (사용자: Supabase 프로젝트 생성·키 전달이 선행)
          ├─ 앱 트랙:     Task 4 → 5a → 5b → 5c → 6
          └─ 스크립트 트랙: Task 7 → 8 → 9 → 10
Task 11 (둘 다 끝난 뒤)
```

앱 트랙과 스크립트 트랙은 수정 파일이 겹치지 않는다(앱: `index.html`, `styles.css`, `app.js`, `lib/`, `.github/`; 스크립트: `scripts/*.py`(common 제외), `tests/test_*.py`). 병렬 세션은 `git worktree`로 분리하고 각자 main에 rebase 후 fast-forward push한다. 10/12(월) 수업 전 최소 완료선은 Task 1~6이며, Task 7~10은 수업 중·후에 끝내도 채점에 지장이 없다(녹음은 Supabase에 남는다).
