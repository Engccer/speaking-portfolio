import json
from pathlib import Path

import pytest
from openpyxl import load_workbook

import score

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "dialogues.json"
pytestmark = pytest.mark.skipif(not DATA_PATH.exists(), reason="data/dialogues.json 없음: scripts/build_dialogues.py 실행 필요")


def make_student(folder, cls, num, name, ids, perfect=True, practice=False):
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    cdir = folder / ("practice" if practice else "") / f"3-{cls:02d}"; cdir.mkdir(parents=True, exist_ok=True)
    for i, did in enumerate(ids, 1):
        d = next(x for x in data if x["id"] == did)
        idx = "2026-10-09T01-02-03-000Z" if practice else i
        stem = f"3-{cls:02d}-{num:02d} {name}_{idx}_{did}"
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


def test_practice_goes_to_csv_only(tmp_path):
    make_student(tmp_path, 4, 5, "모의만", ["L6-2"], practice=True)
    score.run(tmp_path, tmp_path, score.DEFAULT_CFG)
    assert not (tmp_path / "4반 말하기 채점.xlsx").exists()
    rows = (tmp_path / "표현별 상세.csv").read_text(encoding="utf-8-sig").splitlines()
    assert len(rows) == 11 and rows[1].split(",")[3] == "모의"


def test_returned_submission_is_missing_without_stale_score(tmp_path):
    make_student(tmp_path, 4, 1, "가나다", ["L5-1", "L6-2"])
    for metadata in (tmp_path / "3-04").glob("*.json"):
        if not metadata.name.endswith(".scribe.json"):
            info = json.loads(metadata.read_text(encoding="utf-8"))
            info["returned"] = True
            metadata.write_text(json.dumps(info), encoding="utf-8")
    (tmp_path / "미제출_3-04.txt").write_text("01 가나다", encoding="utf-8")
    score.run(tmp_path, tmp_path, score.DEFAULT_CFG)
    rows = list(load_workbook(tmp_path / "4반 말하기 채점.xlsx").active.iter_rows(values_only=True))
    assert len(rows) == 2
    assert rows[1][0] == 1 and rows[1][8] == 0 and rows[1][9] == "미제출"
    assert len((tmp_path / "표현별 상세.csv").read_text(encoding="utf-8-sig").splitlines()) == 1
