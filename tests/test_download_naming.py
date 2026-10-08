from download import local_stem, parse_storage_path
import json
import sys
from types import SimpleNamespace

import download
import score
import transcribe


def test_local_stem():
    assert local_stem(4, 7, "김헌용", 1, "L5-1") == "3-04-07 김헌용_1_L5-1"


def test_parse_storage_path():
    assert parse_storage_path("exam/3-04/3-04-07/2_L7-3.wav") == (4, 7, 2, "L7-3")
    assert parse_storage_path("practice/3-01/3-01-12/2026-10-09T01-02-03-000Z_L6-2.wav") == (1, 12, None, "L6-2")
    assert parse_storage_path("exam/3-01/3-01-12/ab40e95f-2233-45cb-b5cb-6c66d442851a/2_L6-2.wav") == (1, 12, 2, "L6-2")


def test_resubmission_download_replaces_previous_audio_and_preserves_archive(monkeypatch, tmp_path):
    old = "exam/3-01/3-01-01/1_old_L5-1.wav"
    new = "exam/3-01/3-01-01/ab40e95f-2233-45cb-b5cb-6c66d442851a/1_L5-1.wav"
    downloads = []
    tables = {
        "submissions": [{"class": 1, "number": 1, "name": "학생 예시", "files": [new],
                         "dialogue_ids": ["L5-1"], "turn_offsets": [[]], "durations": [15],
                         "submitted_at": "2026-10-09T00:00:00Z"}],
        "returned_submissions": [{"files": [old]}],
        "students": [{"class": 1, "number": 1, "name": "학생 예시", "is_teacher": False},
                     {"class": 1, "number": 40, "name": "교사 예시", "is_teacher": True}],
    }

    class Query:
        def __init__(self, table):
            self.table = table
            self.filters = []

        def select(self, *_):
            return self

        def order(self, *_):
            return self

        def eq(self, field, value):
            self.filters.append((field, value))
            return self

        def execute(self):
            return SimpleNamespace(data=[row for row in tables[self.table]
                                         if all(row[field] == value for field, value in self.filters)])

    class Bucket:
        def download(self, path):
            downloads.append(path)
            return b"new recording"

        def list(self, path, options):
            children = {}
            for file in [old, new]:
                if file.startswith(path + "/"):
                    relative = file[len(path) + 1:]
                    children[relative.split("/")[0]] = None if "/" in relative else "file-id"
            return [{"name": name, "id": file_id} for name, file_id in children.items()]

    bucket = Bucket()
    monkeypatch.setattr(download, "service_client", lambda: SimpleNamespace(
        table=Query, storage=SimpleNamespace(from_=lambda _: bucket)))
    monkeypatch.setattr(sys, "argv", ["download.py", str(tmp_path)])
    folder = tmp_path / "3-01"
    folder.mkdir()
    stem = local_stem(1, 1, "학생 예시", 1, "L5-1")
    wav = folder / f"{stem}.wav"
    metadata = folder / f"{stem}.json"
    wav.write_bytes(b"old recording")
    metadata.write_text(json.dumps({"source_file": old}), encoding="utf-8")
    (folder / f"{stem}.scribe.json").write_text(json.dumps({"text": "old transcript", "words": []}), encoding="utf-8")
    (tmp_path / "미제출_3-01.txt").write_text("01 학생 예시", encoding="utf-8")
    download.main()
    assert wav.read_bytes() == b"new recording"
    assert json.loads(metadata.read_text(encoding="utf-8"))["source_file"] == new
    assert not (tmp_path / "고아파일.txt").exists()
    assert (tmp_path / "미제출_3-01.txt").read_text(encoding="utf-8") == ""
    assert score.collect(tmp_path)[(1, 1)]["dialogues"][1]["scribe"] is None
    download.main()
    assert downloads == [new]

    submitted = tables["submissions"]
    tables["submissions"] = []
    tables["returned_submissions"][0]["files"].append(new)
    download.main()
    assert json.loads(metadata.read_text(encoding="utf-8"))["returned"] is True
    assert wav.read_bytes() == b"new recording"
    assert score.collect(tmp_path) == {}
    assert transcribe.transcribe_file(wav) is None
    assert (tmp_path / "미제출_3-01.txt").read_text(encoding="utf-8") == "01 학생 예시"
    tables["submissions"] = submitted
    download.main()
    assert "returned" not in json.loads(metadata.read_text(encoding="utf-8"))
    assert score.missing(tmp_path) == {}
