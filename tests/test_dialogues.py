import json
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[1] / "data" / "dialogues.json"
IDS = ["L5-1", "L5-2", "L5-3", "L6-1", "L6-2", "L6-3", "L7-1", "L7-2", "L7-3"]

pytestmark = pytest.mark.skipif(not DATA.exists(), reason="data/dialogues.json 없음: scripts/build_dialogues.py 실행 필요")


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
