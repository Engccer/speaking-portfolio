#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_agent_docs.py — 에이전트 지침·스킬 단방향 동기화

정본(canonical) → 생성물(generated):
  1. CLAUDE.md            → AGENTS.md            (루트 및 모든 하위 폴더. Codex·Antigravity 가 네이티브로 읽는 지침 파일)
  2. .claude/skills/      → .agents/skills/      (Codex·Antigravity 가 네이티브로 자동 인식하는 스킬 폴더)

설계 결정 (멀티 에이전트 호환성 작업):
- 단방향만 지원. 역방향 동기화는 하지 않는다.
  (Google Drive 동기화 폴더에서 mtime 신뢰 불가 → 변경 감지·병합이 불가능에 가까움.
   따라서 "정본 → 생성물" 한 방향만, 내용(바이트) 비교로 동작한다.)
- 생성물은 "빌드 산출물"로 취급. 직접 수정하지 않는다.
- AGENTS.md 발산 경고(divergence guard): 직전 동기화 이후 손으로 수정됐으면 mtime 이 아니라
  "내용 해시"로 감지한다. 발산해도 전체 실행을 멈추지 않는다 — 경고를 출력하고 "그 파일 하나만"
  건너뛴 뒤 나머지 문서·스킬은 정상 동기화한다(--force 면 발산 파일도 정본 기준으로 덮어쓴다).
  발산이 하나라도 있으면 종료 코드 2 로 "건너뛴 파일 있음(확인 필요)"을 알린다. 상태는 .agent-docs-sync.json 에 저장.
- 상태 키는 항상 NFC 로 정규화한다(norm_key). 상태 파일이 Google Drive 로 머신 간 동기화되면
  macOS(NFD)·Windows(NFC)가 같은 한글 경로를 다른 키로 저장해 고아 정리가 오폭한다.
  또한 고아 삭제 전 형제 CLAUDE.md 실존을 직접 확인한다(has_sibling_canonical) — 키 비교가
  어떤 이유로든 어긋나도 살아 있는 쌍은 지우지 않는 최종 가드(Drive 동기화 폴더의 오삭제 사고 재발 방지).
- 스킬 폴더는 정본을 그대로 미러링한다: 새/변경 파일은 복사, 정본에서 사라진 파일은 생성물에서도 정리.
  단 자격증명·캐시·OS 잡파일은 보안·청결을 위해 제외한다(아래 SKILL_EXCLUDE_*).
  스킬 트리는 파일 수가 많아 개별 발산 경고는 두지 않는다(정본 기준 무조건 미러링).
- 스킬 검증(validate_skills): 미러링과 별개로 정본 각 SKILL.md 의 frontmatter 가
  agentskills.io 표준(Codex·Antigravity 가 쓰는 엄격한 파서)에서 깨지지 않는지 점검한다.
  PyYAML 이 있으면 정식 파싱으로, 없으면 휴리스틱으로 frontmatter 부재·plain scalar 콜론·
  name↔폴더명 불일치를 잡아 경고한다(동기화 자체는 차단하지 않음). 가장 흔한 함정:
  description 값에 ': '(콜론+공백)이 든 plain scalar 는 엄격한 파서에서 'mapping values are
  not allowed here' 로 실패한다 → 'description: >-' block scalar 로 감싸면 안전하다.
  (Claude Code 자체 파서는 관대해 이를 그냥 로드하므로, 이 검증이 없으면 다른 에이전트에서만
   조용히 깨진다.)

사용법 (프로젝트 폴더 어디서 실행하든 스크립트 위치 기준으로 동작):
    python sync_agent_docs.py            # 동기화 (발산한 AGENTS.md만 건너뛰고 나머지는 모두 반영)
    python sync_agent_docs.py --check    # 드라이런: 무엇이 바뀔지만 출력
    python sync_agent_docs.py --force    # 발산 경고를 무시하고 발산 파일도 정본 기준으로 덮어쓰기

종료 코드:
  0  전부 최신이거나 정상 반영됨(발산·스킬 검증 경고 없음)
  2  발산 파일이나 접근 불가 경로를 건너뜀, 원본을 지울 수 있는 링크 때문에 스킬 미러링을 건너뜀,
     또는 스킬 frontmatter 검증 경고가 있음 — 나머지는 정상 동기화됨.
     실패가 아니라 "확인 필요" 신호.
     (무관한 폴더의 발산이 떠 있어도 내가 방금 고친 CLAUDE.md 의 AGENTS.md 는 그대로 생성/갱신된다.)
  1  기타 오류(정본 CLAUDE.md 부재 등)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import sys
import unicodedata
from fnmatch import fnmatch
from pathlib import Path

# Windows 콘솔(cp949 등)에서 한글 출력이 깨지지 않도록 UTF-8 로 재설정.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

# ── 설정: 지침 파일 ──────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
CANONICAL = ROOT / "CLAUDE.md"   # 루트 정본
STATE_FILE = ROOT / ".agent-docs-sync.json"

# walk 가 junction 을 따라 ROOT 밖으로 나갔는지(symlink 폴더는 따라가지 않는다) 판정하기 위한 기준 경로.
# (.resolve() 로 ROOT 는 이미 symlink 해소된 절대경로이며, 대소문자 무관 비교를 위해 normcase.)
ROOT_REAL = os.path.normcase(str(ROOT))

# 재귀 문서 동기화에서 제외할 디렉터리(스킬 트리·VCS·캐시).
# 루트뿐 아니라 모든 하위 폴더의 CLAUDE.md 마다 형제 AGENTS.md 를 생성하되,
# 아래 폴더 안쪽은 walk 에서 가지치기해 건드리지 않는다.
# (.claude/.agents 안의 CLAUDE.md 는 스킬 트리 소속 → 스킬 동기화가 따로 미러링.)
DOC_EXCLUDE_DIRS = {".claude", ".agents", ".git", "__pycache__", "node_modules", ".venv", ".idea"}

BODY_MARKER = "<!-- SYNC-BODY-START: 이 줄 아래 본문은 CLAUDE.md 와 100% 동일하게 자동 생성됨 -->"

BANNER = (
    "> 🤖 **이 파일은 자동 생성됩니다. 직접 수정하지 마세요.**\n"
    "> 정본은 `CLAUDE.md` 입니다. 내용을 바꾸려면 `CLAUDE.md` 를 수정한 뒤\n"
    "> 프로젝트 루트에서 `python sync_agent_docs.py` 를 실행하세요.\n"
    "> 이 파일을 직접 고치면 다음 동기화 때 경고와 함께 건너뛰며, --force 로 실행하면 덮어써집니다.\n"
    "\n"
    f"{BODY_MARKER}\n"
)

# ── 설정: 스킬 폴더 ──────────────────────────────────────────────────────
SKILLS_SRC = ROOT / ".claude" / "skills"
SKILLS_DST = ROOT / ".agents" / "skills"

# 보안: 자격증명 디렉터리/파일은 생성물로 복제하지 않는다(노출면·회전 부담 2배 방지).
# 청결: 캐시·OS 잡파일도 제외.
SKILL_EXCLUDE_DIRS = {"credentials", "secrets", "__pycache__", ".git", ".idea", "node_modules", ".venv"}
SKILL_EXCLUDE_FILES = {"desktop.ini", ".DS_Store", "accounts.json", ".envrc", "secrets"}
SKILL_EXCLUDE_GLOBS = (
    "*.pyc", "*.pyo",
    "*token*.json", "client_secret*.json", "*.token", "*.key", "*.pem",
    ".env", ".env.*", "secrets.*", "credentials*.json", "*service*account*.json", "*.p12", "*.pfx",
)
# 고아 정리에서 "무시"할 OS/캐시 잡파일. Google Drive 는 폴더마다 desktop.ini 를 자동
# 생성하므로, 이를 고아로 보고 지우면 Drive 가 다시 만들어 매 실행이 churn 된다 → 그냥 둔다.
# (자격증명은 여기 넣지 않는다. 생성물에 남아 있으면 보안상 지우는 게 맞으므로 고아로 처리.)
SKILL_IGNORE_IN_TARGET_DIRS = {"__pycache__"}
SKILL_IGNORE_IN_TARGET_FILES = {"desktop.ini", ".DS_Store"}
SKILL_IGNORE_IN_TARGET_GLOBS = ("*.pyc", "*.pyo")

# 동기화 스크립트가 생성물 루트에 남기는 안내 파일(고아 정리 대상에서 보호).
SKILLS_README_NAME = "_GENERATED.md"
SKILLS_README = (
    "# (자동 생성) `.agents/skills/`\n"
    "\n"
    "이 폴더는 `.claude/skills/`(Claude Code 정본)에서 `python sync_agent_docs.py` 로 "
    "미러링된 **생성물**입니다. 직접 수정하지 마세요. 다음 동기화에서 정본 기준으로 덮어쓰입니다.\n"
    "\n"
    "- Codex·Antigravity 가 이 경로(`<repo-root>/.agents/skills/`)를 **네이티브로 자동 인식**합니다.\n"
    "  (둘 다 `agentskills.io` 오픈 표준 = `SKILL.md` + `name`·`description` 프런트매터)\n"
    "- **자격증명**(`credentials/`·`accounts.json` 등)은 보안상 동기화에서 **제외**됩니다.\n"
    "  필요한 스킬은 정본 `.claude/skills/<스킬명>/` 의 자격증명을 참조하세요"
    "(스크립트는 대개 환경변수 override 지원).\n"
    "- 호출 문법: Claude `/스킬`, Codex `$스킬`, Antigravity `@스킬` (자동 활성화는 공통).\n"
)


# ── 공통 유틸 ────────────────────────────────────────────────────────────
def norm_key(s: str) -> str:
    """상태 파일·비교용 경로 키를 NFC 로 정규화한다.

    상태 파일이 Google Drive 등으로 머신 간 동기화되는 환경에서, macOS 실행은
    walk 가 NFD 파일명을 돌려줘 NFD 키를, Windows 는 NFC 키를 만든다. 정규화
    없이는 같은 경로가 두 키로 갈라지고, 고아 정리가 NFD 구키를 고아로 오판한다.
    결정타: Google Drive 파일시스템은 NFD 별형 경로도 NFC 실파일로 해석하므로,
    살아 있는 AGENTS.md 가 구키 경유로 실제 삭제된다(실제로 일어난 사고)."""
    return unicodedata.normalize("NFC", s)


def has_sibling_canonical(folder: Path) -> bool:
    """폴더에 정본 CLAUDE.md(대소문자 무관)가 실존하는지 확인한다.
    고아 정리의 최종 안전 가드: 키 비교가 어떤 이유로든 어긋나도
    (정규화 차이·Drive 유령 경로 등) 살아 있는 쌍은 절대 지우지 않는다.
    폴더를 읽지 못하면 OSError 를 그대로 던진다. False("없음 → 삭제 가능")로
    삼키면 가드가 열린 채로 실패하므로, 호출부가 판정 보류로 처리한다."""
    return any(
        f.is_file() and f.name.lower() == "claude.md" for f in folder.iterdir()
    )


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_text(path: Path) -> str:
    # 개행을 LF 로 정규화해 해시 비교가 OS·드라이브 차이에 흔들리지 않게 한다.
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")


def write_text(path: Path, text: str) -> None:
    # 생성물(AGENTS.md 등)이 정본(CLAUDE.md)을 가리키는 symlink 로 존재하면,
    # 그대로 쓰면 link 를 따라가(follow) 정본을 덮어써 오염시킨다. symlink 는
    # 먼저 끊고 실제 파일로 대체한다(write-through 정본 오염 방지).
    if path.is_symlink():
        path.unlink()
    path.write_text(text, encoding="utf-8", newline="\n")


def extract_body(generated_text: str) -> str:
    """생성물에서 배너를 떼고 본문만 돌려준다. 마커가 없으면 전체를 본문으로 본다."""
    idx = generated_text.find(BODY_MARKER)
    if idx == -1:
        return generated_text
    return generated_text[idx + len(BODY_MARKER):].lstrip("\n")


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        # 키를 NFC 로 정규화(norm_key docstring 참조). NFD/NFC 중복 키는 하나로 합쳐진다.
        return {norm_key(k): v for k, v in raw.items()}
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


# ── 지침 파일 동기화 (CLAUDE.md → AGENTS.md, 루트 + 모든 하위 폴더) ─────────
def iter_nested_canonicals() -> tuple[list[Path], list[Path]]:
    """루트 CLAUDE.md 를 제외한 하위 폴더의 CLAUDE.md 상대경로 목록과, walk 가
    들어가지 못한 폴더의 상대경로 목록을 돌려준다.
    스킬 트리(.claude/.agents)·VCS·캐시 폴더는 walk 에서 가지치기한다.
    파일명 비교는 대소문자 무관(Windows 파일시스템 호환).

    os.walk 는 기본값으로 열지 못한 폴더를 조용히 건너뛴다. 그러면 그 안의 살아 있는
    CLAUDE.md 가 목록에서 빠지고 고아 정리가 그 AGENTS.md 를 고아로 오판하므로,
    접근 불가 폴더를 따로 모아 고아 정리에서 제외시킨다. 실례: SSH 세션의
    RedirectionGuard 가 클라우드 드라이브로 가는 junction 통과를 막는다(WinError 448).

    os.walk 기본값(followlinks=False)이라 symlink 폴더는 따라가지 않고, Windows junction 은
    islink 가 False 라 따라간다. ROOT 밖을 가리키는 junction 도 그대로 따라간다(의도적으로
    외부 폴더를 프로젝트에 link 해 함께 동기화하는 경우가 있으므로). 다만 그런
    경로의 AGENTS.md 는 프로젝트 트리 밖(다른 드라이브·동기화 폴더 등)에
    생성/갱신되므로, 조용히 외부를 건드리지 않도록 [외부] 경고로 가시화한다."""
    found: list[Path] = []
    external: list[tuple[Path, str]] = []
    seen_ext: set[str] = set()
    unreachable: list[Path] = []

    def on_walk_error(err: OSError) -> None:
        # 어느 폴더인지 모르면 ROOT(".") 로 기록해 고아 정리 전체를 보류시킨다.
        try:
            rel = Path(err.filename).relative_to(ROOT)
        except (TypeError, ValueError):
            rel = Path(".")
        unreachable.append(rel)
        print(
            f"[접근 불가] {rel.as_posix()}/ 폴더를 열 수 없어 건너뜁니다: {err.strerror or err}",
            file=sys.stderr,
        )

    for dirpath, dirnames, _filenames in os.walk(ROOT, onerror=on_walk_error):
        dirnames[:] = [d for d in dirnames if d not in DOC_EXCLUDE_DIRS]
        # Windows 에서 claude.md / CLAUDE.MD 등 대소문자 변형도 인식.
        actual = next((f for f in _filenames if f.lower() == "claude.md"), None)
        if actual is not None:
            rel = (Path(dirpath) / actual).relative_to(ROOT)
            if rel.parent == Path("."):
                continue  # 루트는 아래에서 별도 처리
            found.append(rel)
            # junction 으로 ROOT 밖을 가리키면 외부 쓰기 → 경고 대상.
            real = os.path.normcase(os.path.realpath(dirpath))
            try:
                inside = os.path.commonpath([real, ROOT_REAL]) == ROOT_REAL
            except ValueError:
                inside = False  # 다른 드라이브(C: vs G:) → 외부
            if not inside and real not in seen_ext:
                seen_ext.add(real)
                external.append((rel.parent, os.path.realpath(dirpath)))
    for relparent, target in external:
        print(
            f"[외부] {relparent.as_posix()}/ 는 junction 으로 ROOT 밖을 가리킵니다 → {target}"
        )
        print(
            "       이 경로의 AGENTS.md 는 프로젝트 트리 밖에 생성/갱신됩니다. 의도한 것인지 확인하세요"
            " (그 폴더가 자체 동기화를 갖는 별도 프로젝트라면 여기서 제외하는 게 좋습니다)."
        )
    return sorted(found, key=lambda p: str(p).lower()), unreachable


def _sync_doc_pair(canonical: Path, target: Path, state_key: str, state: dict, args) -> tuple[bool, bool]:
    """CLAUDE.md 한 개 → 형제 AGENTS.md 한 개 동기화. 반환: (diverged, written)."""
    source = read_text(canonical)
    source_hash = sha256(source)
    generated = BANNER + source
    prev_hash = state.get(state_key)  # 직전 동기화 시 정본 본문 해시

    if not target.exists():
        print(f"[생성] {state_key} 신규 생성")
        if not args.check:
            target.parent.mkdir(parents=True, exist_ok=True)
            write_text(target, generated)
            state[state_key] = source_hash
            return False, True
        return False, False

    existing = read_text(target)
    existing_body_hash = sha256(extract_body(existing))

    # 이미 최신이면 건너뜀. 본문이 정본과 일치하면 상태 해시가 낡았어도 발산이 아니다
    # (다른 머신에서 생성된 AGENTS.md 를 pull 한 직후 등): 상태만 따라잡는다.
    if existing_body_hash == source_hash:
        if prev_hash == source_hash:
            print(f"[최신] {state_key} 변경 없음")
            return False, False
        print(f"[최신] {state_key} 본문 이미 정본과 일치, 상태 해시만 갱신")
        if not args.check:
            state[state_key] = source_hash
            return False, True
        return False, False

    # 발산 감지: 본문이 "직전 동기화 시 정본"과 다르면 = 손으로 수정됨(또는 관리 밖에서 생성).
    untouched = (prev_hash is not None and existing_body_hash == prev_hash)

    if not untouched and not args.force:
        rel_src = canonical.relative_to(ROOT)
        print(
            f"[발산 경고] {state_key} 이(가) 직전 동기화 이후 직접 수정됐거나, "
            f"동기화 관리 밖에서 만들어진 것으로 보입니다.\n"
            f"            정본({rel_src})에서 생성한 내용과 본문이 다릅니다.\n"
            f"            이 파일은 생성물이므로 살릴 내용은 정본으로 옮긴 뒤 --force 로 덮어쓰세요\n"
            f"            (수정을 버려도 되면 바로 --force).",
            file=sys.stderr,
        )
        return True, False

    action = "강제 덮어쓰기" if (not untouched and args.force) else "갱신"
    print(f"[{action}] {state_key} ← {canonical.relative_to(ROOT)}")
    if not args.check:
        write_text(target, generated)
        state[state_key] = source_hash
        return False, True
    return False, False


def sync_docs(args, state) -> tuple[list[str], bool, list[str]]:
    """루트 + 모든 하위 폴더의 CLAUDE.md → 형제 AGENTS.md.
    반환: (diverged_keys, any_written, skipped_paths).

    diverged_keys: 발산으로 "건너뛴" AGENTS.md 상태키 목록(있어도 나머지는 모두 동기화됨).
    skipped_paths: 접근 불가로 건너뛴 폴더·고아 후보(상태키는 보존해 다음 실행에 넘긴다).
    루트 상태키는 하위 호환을 위해 그대로 "AGENTS.md", 하위는 POSIX 상대경로를 쓴다."""
    diverged_keys: list[str] = []
    skipped: list[str] = []
    any_written = False

    nested, unreachable = iter_nested_canonicals()
    skipped.extend(f"{rel.as_posix()}/" for rel in unreachable)
    # ROOT 자체(".")를 못 열었으면 빈 접두어 = 모든 키 판정 보류.
    unreachable_prefixes = [
        "" if rel == Path(".") else norm_key(rel.as_posix()) + "/" for rel in unreachable
    ]

    # 동기화 대상 쌍: (정본 CLAUDE.md, 생성 AGENTS.md, 상태키).
    pairs: list[tuple[Path, Path, str]] = [(CANONICAL, ROOT / "AGENTS.md", "AGENTS.md")]
    for rel in nested:
        target_rel = rel.parent / "AGENTS.md"
        # 파일 I/O 는 walk 가 준 원형 경로로, 상태 키만 NFC 로 통일한다.
        pairs.append((ROOT / rel, ROOT / target_rel, norm_key(target_rel.as_posix())))

    managed = {key for _, _, key in pairs}

    for canonical, target, key in pairs:
        diverged, written = _sync_doc_pair(canonical, target, key, state, args)
        if diverged:
            diverged_keys.append(key)
        any_written = any_written or written

    # 고아 정리: 직전에 우리가 생성·관리하던 AGENTS.md 중 대응 CLAUDE.md 가 사라진 것.
    # 우리가 만든 생성물(배너 마커 포함)일 때만 안전하게 삭제한다(수동 파일은 건드리지 않음).
    # 삭제 전 형제 CLAUDE.md 실존을 직접 확인한다 — 키 비교(managed)가 정규화 차이나
    # Drive 유령 경로로 어긋나도, 살아 있는 쌍은 절대 지우지 않는 최종 가드.
    for key in [k for k in state if k == "AGENTS.md" or k.endswith("/AGENTS.md")]:
        if key in managed:
            continue
        # walk 가 못 들어간 폴더 안이면 CLAUDE.md 가 살아 있는지 알 수 없다 → 판정 보류.
        if any(key.startswith(p) for p in unreachable_prefixes):
            continue
        orphan = ROOT / key
        try:
            if (
                orphan.exists()
                and not has_sibling_canonical(orphan.parent)
                and BODY_MARKER in read_text(orphan)
            ):
                print(f"[정리] {key} (대응 CLAUDE.md 없음 → 생성물 삭제)")
                if not args.check:
                    orphan.unlink()
                    any_written = True
        except OSError as e:
            # 한 경로가 막혀도 나머지 정리는 계속한다. 상태키는 남겨 다음 실행에서 재판정.
            print(f"[접근 불가] {key} 고아 판정을 건너뜁니다: {e.strerror or e}", file=sys.stderr)
            skipped.append(key)
            continue
        if not args.check:
            del state[key]

    return diverged_keys, any_written, skipped


# ── 스킬 폴더 동기화 (.claude/skills/ → .agents/skills/) ──────────────────
def is_excluded_skill_file(fn: str) -> bool:
    """미러링에서 뺄 파일인가. 패턴은 대소문자를 무시한다(.ENV·Secrets.yaml 도 제외)."""
    low = fn.lower()
    return fn in SKILL_EXCLUDE_FILES or any(fnmatch(low, g) for g in SKILL_EXCLUDE_GLOBS)


def is_link_dir(p: Path) -> bool:
    """symlink 또는 Windows junction 인가. Path.is_junction 이 없는 3.11 이하 Windows 는
    lstat 의 reparse tag 로 판정한다(OneDrive 등 다른 reparse point 는 junction 이 아니다)."""
    if p.is_symlink():
        return True
    if hasattr(p, "is_junction"):
        return p.is_junction()
    try:
        tag = getattr(os.lstat(p), "st_reparse_tag", 0)
    except OSError:
        return False
    return tag != 0 and tag == getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", -1)


def same_or_inside(path: Path, base: Path) -> bool:
    """path 의 실체가 base 의 실체와 같거나 그 안에 있는가. 경로 문자열이 아니라 파일 동일성
    (st_dev·st_ino)으로 비교해 대소문자만 다른 링크(대소문자 무시 파일시스템)도 잡는다."""
    try:
        b = os.stat(base)
    except OSError:
        return False
    real = Path(os.path.realpath(path))
    if b.st_ino == 0:  # 파일 식별자를 주지 않는 파일시스템: 경로 문자열로 대신한다
        base_real = os.path.normcase(os.path.realpath(base))
        try:
            return os.path.commonpath([os.path.normcase(str(real)), base_real]) == base_real
        except ValueError:
            return False
    for q in (real, *real.parents):
        try:
            s = os.stat(q)
        except OSError:
            continue
        if (s.st_dev, s.st_ino) == (b.st_dev, b.st_ino):
            return True
    return False


def skill_direction_problems() -> list[str]:
    """스킬 미러링이 원본이나 프로젝트 밖을 지우거나 덮을 수 있는 링크 구성을 찾아 설명 목록으로
    돌려준다(빈 목록 = 안전). 고아 정리는 생성물 트리를 walk 하며 지우고 복사는 생성물 경로에
    쓰므로, 두 트리에 링크가 섞이면 멈추는 것을 원칙으로 한다.

    - .claude/skills 와 .agents/skills 가 실체로 겹친다(어느 층의 링크든).
    - 생성물(.agents/skills)이 프로젝트 밖 실체이거나 그 안에 링크(파일·폴더, junction 포함)가
      있다. 스크립트는 생성물에 링크를 만들지 않으므로 있으면 누군가 건 것이다.
    - .agents 나 .agents/skills 자체가 링크다(프로젝트 안 다른 폴더를 가리켜도 그 폴더를 지운다).
    - 원본(.claude/skills) 안의 폴더 링크가 생성물과 얽혀 있거나(서로 안쪽을 가리킴),
      symlink 라 walk 가 따라가지 못한다(그 내용이 원본 목록에서 빠져 고아 정리가 생성물의
      같은 경로를 지운다). 밖을 가리키는 Windows junction 은 walk 가 따라가 정상 미러링된다.
    - 원본 안의 파일 symlink: 원본 저장소엔 링크만 있는데 생성물엔 가리키는 내용(밖의 비밀 등)이
      그대로 복제된다. 복제하지 않는 제외 이름은 링크여도 문제 삼지 않는다.
    """
    if same_or_inside(SKILLS_SRC, SKILLS_DST) or same_or_inside(SKILLS_DST, SKILLS_SRC):
        return [f".claude/skills 와 .agents/skills 가 같은 실체를 가리킴 ({os.path.realpath(SKILLS_SRC)})"]
    problems: list[str] = []
    for q in (ROOT / ".agents", SKILLS_DST):
        if is_link_dir(q):
            problems.append(f"{q.relative_to(ROOT).as_posix()} 가 링크 → {os.path.realpath(q)}")
    if problems:
        return problems
    if not same_or_inside(SKILLS_DST, ROOT):
        problems.append(f".agents/skills 가 프로젝트 밖 실체 → {os.path.realpath(SKILLS_DST)}")
    elif SKILLS_DST.exists():
        for dirpath, dirnames, filenames in os.walk(SKILLS_DST):
            for name in dirnames + filenames:
                full = Path(dirpath) / name
                if is_link_dir(full) or full.is_symlink():
                    rel = full.relative_to(SKILLS_DST).as_posix()
                    problems.append(f".agents/skills/{rel} (링크 → {os.path.realpath(full)})")
            dirnames[:] = [d for d in dirnames if not is_link_dir(Path(dirpath) / d)]
    for dirpath, dirnames, filenames in os.walk(SKILLS_SRC):
        for fn in filenames:
            full = Path(dirpath) / fn
            if full.is_symlink() and not is_excluded_skill_file(fn):
                rel = full.relative_to(SKILLS_SRC).as_posix()
                problems.append(f".claude/skills/{rel} (파일 symlink → {os.path.realpath(full)})")
        keep = []
        for d in dirnames:
            full = Path(dirpath) / d
            if d in SKILL_EXCLUDE_DIRS:
                continue  # 복제하지 않는 폴더는 링크여도 위험이 없다
            if is_link_dir(full):
                rel = full.relative_to(SKILLS_SRC).as_posix()
                if same_or_inside(full, SKILLS_DST) or same_or_inside(SKILLS_DST, full):
                    problems.append(f".claude/skills/{rel} (링크가 .agents/skills 와 얽힘)")
                    continue
                if full.is_symlink():
                    problems.append(f".claude/skills/{rel} (symlink → {os.path.realpath(full)})")
                    continue
            keep.append(d)
        dirnames[:] = keep
    return problems


def iter_source_skill_files() -> list[Path]:
    """제외 규칙을 적용해 동기화 대상 파일의 상대경로 목록을 돌려준다."""
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(SKILLS_SRC):
        # 제외 디렉터리는 walk 자체에서 가지치기.
        dirnames[:] = [d for d in dirnames if d not in SKILL_EXCLUDE_DIRS]
        for fn in filenames:
            if is_excluded_skill_file(fn):
                continue
            rel = (Path(dirpath) / fn).relative_to(SKILLS_SRC)
            files.append(rel)
    return files


def prune_empty_dirs(root: Path) -> None:
    for dirpath, _dirnames, _filenames in os.walk(root, topdown=False):
        p = Path(dirpath)
        if p == root:
            continue
        try:
            if not any(p.iterdir()):
                p.rmdir()
        except OSError:
            pass


def sync_skills(args) -> tuple[bool, list[str]]:
    """반환: (any_written, linked). 정본을 .agents/skills/ 로 미러링(자격증명 제외).

    linked: 미러링이 원본을 지울 수 있는 링크 구성(skill_direction_problems). 하나라도 있으면
    미러링 전체를 건너뛴다."""
    if not SKILLS_SRC.exists():
        print(f"[건너뜀] 스킬 정본 폴더 없음: {SKILLS_SRC}")
        return False, []

    linked = skill_direction_problems()
    if linked:
        print(
            "[스킬 방향 경고] 미러링이 원본을 지울 수 있는 링크가 있어 스킬 미러링을 건너뜁니다:\n"
            + "\n".join(f"          - {x}" for x in linked)
            + "\n        ↳ 원본과 생성물이 링크로 얽혔으면 정본 방향부터 확인하세요(역전이면 미러링이 필요 없습니다).\n"
            "          생성물(.agents/skills) 안의 링크는 지우고, 원본 안의 symlink 폴더는 실제 폴더로 두어야 미러링됩니다.",
            file=sys.stderr,
        )
        return False, linked

    src_files = iter_source_skill_files()
    src_set = set(src_files)
    created = updated = removed = 0

    # 1) 새/변경 파일 복사.
    for rel in src_files:
        s = SKILLS_SRC / rel
        d = SKILLS_DST / rel
        if not d.exists():
            created += 1
            if not args.check:
                d.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(s, d)
        elif file_sha(s) != file_sha(d):
            updated += 1
            if not args.check:
                shutil.copyfile(s, d)

    # 2) 고아 정리: 정본에 없는 생성물 파일 삭제(생성 안내 파일은 보호).
    protected = {Path(SKILLS_README_NAME)}
    if SKILLS_DST.exists():
        for dirpath, dirnames, filenames in os.walk(SKILLS_DST):
            # OS/캐시 잡파일은 정리 대상에서 제외(Drive 가 재생성하는 desktop.ini 등).
            dirnames[:] = [d for d in dirnames if d not in SKILL_IGNORE_IN_TARGET_DIRS]
            for fn in filenames:
                if fn in SKILL_IGNORE_IN_TARGET_FILES:
                    continue
                if any(fnmatch(fn, g) for g in SKILL_IGNORE_IN_TARGET_GLOBS):
                    continue
                rel = (Path(dirpath) / fn).relative_to(SKILLS_DST)
                if rel in protected or rel in src_set:
                    continue
                removed += 1
                if not args.check:
                    (Path(dirpath) / fn).unlink()
        if not args.check:
            prune_empty_dirs(SKILLS_DST)

    # 3) 생성 안내 파일 기록.
    if not args.check:
        SKILLS_DST.mkdir(parents=True, exist_ok=True)
        write_text(SKILLS_DST / SKILLS_README_NAME, SKILLS_README)

    if created or updated or removed:
        verb = "(예정)" if args.check else ""
        print(
            f"[미러링{verb}] .agents/skills/ ← .claude/skills/ "
            f"(신규 {created} · 갱신 {updated} · 삭제 {removed} · 대상 {len(src_files)})"
        )
        return not args.check, []
    print(f"[최신] .agents/skills/ 변경 없음 (대상 {len(src_files)})")
    return False, []


# ── 스킬 frontmatter 검증 (생성물이 Codex·Antigravity 표준에서 깨지지 않는지) ──
def _load_frontmatter(text: str) -> tuple[str, dict | None, str]:
    """SKILL.md 본문에서 frontmatter 블록을 점검한다.
    반환: (status, data, detail)
      status = "ok" | "no_frontmatter" | "unclosed" | "yaml_error" | "not_mapping"
    PyYAML 이 있으면 정식 파싱(엄격한 Codex 파서와 같은 실패를 재현)하고,
    없으면 최소 휴리스틱(frontmatter 유무 + plain scalar 콜론 + name 추출)으로 폴백한다.
    어느 쪽이든 우리가 실제로 겪은 함정(콜론 깨짐·frontmatter 부재·name 불일치)은 잡는다."""
    if not text.startswith("---"):
        return "no_frontmatter", None, ""
    parts = text.split("---", 2)
    if len(parts) < 3:
        return "unclosed", None, ""
    fm = parts[1]
    try:
        import yaml  # type: ignore
    except ImportError:
        # 폴백: PyYAML 없는 PC. 모든 top-level plain scalar 필드의 ': '(콜론+공백)를
        # 휴리스틱으로 잡는다. description 뿐 아니라 compatibility 등 임의 필드 포함 —
        # 실제로 겪은 함정: liteparse 의 'compatibility: Requires … macOS: Homebrew …' 처럼
        # description 이 아닌 필드의 콜론이 frontmatter 전체 파싱을 깨뜨린다.
        import re as _re
        data: dict = {}
        for line in fm.splitlines():
            # 들여쓰기 줄(매핑 하위 항목·block scalar 본문)은 검사 대상이 아니다.
            if not line[:1] or line[0] in (" ", "\t"):
                continue
            m = _re.match(r"^([A-Za-z_][\w-]*):(.*)$", line)
            if not m:
                continue
            key, val = m.group(1), m.group(2).strip()
            # plain scalar(따옴표·block scalar·flow 컬렉션·매핑 헤더가 아님) 값에 ': ' 가
            # 있으면 엄격한 파서에서 'mapping values are not allowed here' 로 실패한다.
            if val and val[:1] not in ('"', "'", ">", "|", "[", "{") and ": " in val:
                return ("yaml_error", None,
                        f"'{key}' 필드의 plain scalar 값에 ': '(콜론+공백)이 있음 — "
                        "block scalar '>-' 로 감싸세요")
            if key == "name":
                data["name"] = val
            elif key == "description":
                # block scalar 면 본문이 다음 줄에 오므로 존재만 표시(빈값 오탐 방지).
                data["description"] = val if (val and val[:1] not in (">", "|")) else "(block scalar)"
        return ("ok", data, "") if data else ("not_mapping", None, "")
    try:
        data = yaml.safe_load(fm)
    except yaml.YAMLError as e:
        return "yaml_error", None, str(e).replace("\n", " ")[:100]
    if not isinstance(data, dict):
        return "not_mapping", None, ""
    return "ok", data, ""


def validate_skills() -> list[str]:
    """정본 .claude/skills/<skill>/SKILL.md 가 agentskills.io 표준(Codex·Antigravity)에서
    깨지지 않는지 점검하고, 문제 메시지 목록을 돌려준다(빈 목록 = 전부 통과).
    동기화를 차단하진 않지만, 생성물이 다른 에이전트에서 조용히 무시될 위험을 사전 경고한다.

    주의: name 의 비-ASCII(한글) 여부는 검사하지 않는다. 한글 호출명(/스킬)을 의도적으로
    유지하는 프로젝트가 있고, Antigravity 는 name 미준수 시 폴더명으로 폴백하므로 차단 사유가 아니다.
    표준 위반으로 '깨지는' 것(파싱 실패·frontmatter 부재·name↔폴더명 불일치)만 잡는다."""
    problems: list[str] = []
    if not SKILLS_SRC.exists():
        return problems
    for child in sorted(SKILLS_SRC.iterdir()):
        if not child.is_dir() or child.name in SKILL_EXCLUDE_DIRS:
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.exists():
            # SKILL.md 가 없으면 스킬 폴더가 아닌 것으로 보고 건너뛴다(참고자료 폴더 등).
            continue
        status, data, detail = _load_frontmatter(read_text(skill_md))
        rel = f"{child.name}/SKILL.md"
        if status == "no_frontmatter":
            problems.append(f"{rel}: frontmatter(--- 블록)가 없음 → 표준 에이전트가 스킬로 인식 못 함")
            continue
        if status == "unclosed":
            problems.append(f"{rel}: frontmatter 닫는 --- 가 없음")
            continue
        if status == "yaml_error":
            problems.append(f"{rel}: YAML 파싱 실패 — {detail}")
            continue
        if status == "not_mapping":
            problems.append(f"{rel}: frontmatter 가 key:value 매핑이 아님")
            continue
        name = str(data.get("name", "")).strip() if data else ""
        desc = data.get("description", "") if data else ""
        if not name:
            problems.append(f"{rel}: name 필드가 없음")
        elif name != child.name:
            problems.append(f"{rel}: name('{name}')가 폴더명('{child.name}')과 불일치 (표준은 일치 요구)")
        if not isinstance(desc, str) or not desc.strip():
            problems.append(f"{rel}: description 이 비어 있음")
        elif len(desc) > 1024:
            problems.append(f"{rel}: description {len(desc)}자 — 표준 권장 상한(1024자) 초과")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="CLAUDE.md → AGENTS.md · .claude/skills → .agents/skills 단방향 동기화")
    parser.add_argument("--check", action="store_true", help="드라이런: 변경 사항만 출력하고 쓰지 않음")
    parser.add_argument("--force", action="store_true", help="AGENTS.md 발산 경고를 무시하고 강제 덮어쓰기")
    args = parser.parse_args()

    if not CANONICAL.exists():
        print(f"[오류] 정본을 찾을 수 없음: {CANONICAL}", file=sys.stderr)
        return 1

    state = load_state()
    diverged_keys, docs_written, skipped_paths = sync_docs(args, state)
    skills_written, skill_links = sync_skills(args)

    if (docs_written or skills_written) and not args.check:
        save_state(state)

    # 정본 스킬 frontmatter 검증(생성물이 다른 에이전트에서 조용히 깨지지 않는지 사전 경고).
    skill_problems = validate_skills()
    if skill_problems:
        print(
            f"\n[스킬 검증 경고] 아래 SKILL.md 는 Codex·Antigravity 의 엄격한 파서에서 "
            f"깨질 수 있습니다 ({len(skill_problems)}건):",
            file=sys.stderr,
        )
        for p in skill_problems:
            print(f"  - {p}", file=sys.stderr)
        print(
            "        ↳ 정본 .claude/skills/ 를 고친 뒤 다시 실행하세요. description 에 ': '(콜론+공백)이\n"
            "          있으면 'description: >-' block scalar 로 감싸면 안전합니다(Claude Code 는 관대해 그냥\n"
            "          로드하지만 다른 에이전트에서만 조용히 깨집니다).",
            file=sys.stderr,
        )

    if skipped_paths:
        print(
            f"\n[요약] 접근 불가로 건너뛴 경로 {len(skipped_paths)}개: "
            + ", ".join(skipped_paths)
            + "\n        ↳ 나머지는 정상 동기화됨(종료 코드 2 = 확인 필요, 실패 아님). 상태 기록은 보존했습니다."
            + "\n        ↳ SSH 세션 등에서 junction 통과가 막힌 경우라면 로컬 세션에서 다시 실행하세요."
        )
    if skill_links:
        print(
            f"\n[요약] 링크 구성 {len(skill_links)}건 때문에 스킬 미러링을 건너뜀: "
            + ", ".join(skill_links)
            + "\n        ↳ 문서 동기화는 정상 완료됨(종료 코드 2 = 확인 필요). 정본 방향을 먼저 확인하세요."
        )
    if diverged_keys:
        # 발산은 "부분 성공" — 건너뛴 파일만 빼고 나머지는 모두 반영됐다. 전체가 멈춘 게 아님을 명시한다.
        print(
            f"\n[요약] 발산으로 건너뛴 AGENTS.md {len(diverged_keys)}개: "
            + ", ".join(diverged_keys)
            + "\n        ↳ 나머지 문서·스킬은 정상 동기화됨(종료 코드 2 = 건너뛴 파일 확인 필요, 실패 아님)."
            + "\n        ↳ 정본이 맞으면 --force 로 덮어쓰고, 생성물에 살릴 내용이 있으면 CLAUDE.md 로 옮긴 뒤 --force 로 재실행."
        )
        return 2
    if skill_problems:
        # 발산은 없지만 스킬 검증 경고가 있으면 같은 "확인 필요" 신호로 종료 코드 2.
        print(
            f"\n[요약] 스킬 검증 경고 {len(skill_problems)}건 — 문서·스킬 동기화 자체는 정상 완료됨"
            "(종료 코드 2 = 확인 필요, 실패 아님)."
        )
        return 2
    if skipped_paths or skill_links:
        return 2
    if args.check:
        print("\n(--check 모드: 실제로 쓰지 않았습니다.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
