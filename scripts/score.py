"""다운로드 폴더의 전사 결과를 채점해 반별 xlsx와 표현별 CSV를 만든다.

사용: python scripts/score.py <다운로드 폴더> [--out <출력 폴더>] [--config scripts/scoring.json]
"""
import argparse
import csv
import json
import re
from functools import cache
from pathlib import Path

from openpyxl import Workbook

from scoring import DEFAULT_CFG, final_score, score_dialogue

ROOT = Path(__file__).resolve().parents[1]
STEM_RE = re.compile(r"^3-(\d\d)-(\d\d) (.+)_([^_]+)_(L\d-\d)$")


@cache
def dialogues() -> dict:
    return {d["id"]: d for d in json.loads((ROOT / "data" / "dialogues.json").read_text(encoding="utf-8"))}


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


def detail(cls, num, name, which, did, e):
    return [cls, num, name, which, did, e["n"], e["text"], e["transcript"],
            e["match_ratio"], e["max_gap"], e["wpm"], "만족" if e["ok"] else "불만족", e["reason"]]


def run(folder: Path, out: Path, cfg: dict):
    students = collect(folder)
    absent = missing(folder)
    detail_rows = []
    by_class = {}
    for (cls, num), s in sorted(students.items()):
        for p in s["practice"]:  # 모의 녹음은 임계값 보정용으로 상세 CSV에만 적는다
            if p["scribe"] is not None:
                r = score_dialogue(dialogues()[p["id"]], p["scribe"], p["turn_offsets"], cfg)
                detail_rows += [detail(cls, num, s["name"], "모의", p["id"], e) for e in r["expressions"]]
        if not s["dialogues"]:
            continue
        row = {"번호": num, "이름": s["name"], "최종": 0, "비고": [], "제출시각": ""}
        scores = []
        for idx in (1, 2):
            d = s["dialogues"].get(idx)
            if not d:
                row[f"대화{idx}"] = ""; row[f"만족{idx}"] = ""; row[f"점수{idx}"] = 0; scores.append(0)
                row["비고"].append(f"대화{idx} 없음")
                continue
            row[f"대화{idx}"] = d["id"]; row["제출시각"] = d["submitted_at"]
            if d["scribe"] is None:
                row[f"만족{idx}"] = ""; row[f"점수{idx}"] = ""; row["비고"].append(f"대화{idx} 전사 실패")
                continue
            r = score_dialogue(dialogues()[d["id"]], d["scribe"], d["turn_offsets"], cfg)
            row[f"만족{idx}"] = r["satisfied"]; row[f"점수{idx}"] = r["score"]; scores.append(r["score"])
            bad = [str(e["n"]) for e in r["expressions"] if not e["ok"]]
            if bad:
                row["비고"].append(f"대화{idx} 불만족 {','.join(bad)}")
            detail_rows += [detail(cls, num, s["name"], idx, d["id"], e) for e in r["expressions"]]
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
