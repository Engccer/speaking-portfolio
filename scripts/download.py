"""제출 녹음과 기록을 내려받는다.

사용: python scripts/download.py [--class N] [--practice] <출력 폴더>
"""
import argparse
import json
import re
from pathlib import Path

from common import service_client

PATH_RE = re.compile(r"^(exam|practice)/3-(\d\d)/3-\d\d-(\d\d)/(?:[^/]+/)?(?:(\d)_)?(?:[^_]+_)?(L\d-\d)\.wav$")


def local_stem(cls, num, name, idx, dialogue_id):
    return f"3-{cls:02d}-{num:02d} {name}_{idx}_{dialogue_id}"


def parse_storage_path(path):
    m = PATH_RE.match(path)
    if not m:
        raise ValueError(path)
    kind, cls, num, idx, did = m.groups()
    return int(cls), int(num), (int(idx) if idx else None), did


def storage_files(bucket, prefix):
    offset = 0
    while True:
        entries = bucket.list(prefix, {"limit": 1000, "offset": offset})
        for entry in entries:
            path = f"{prefix}/{entry['name']}"
            if entry.get("id") is None:
                yield from storage_files(bucket, path)
            else:
                yield path
        if len(entries) < 1000:
            break
        offset += len(entries)


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
    active_metadata = set()
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
            metadata = folder / f"{stem}.json"
            active_metadata.add(metadata)
            previous = json.loads(metadata.read_text(encoding="utf-8")) if metadata.exists() else {}
            if not wav.exists() or previous.get("source_file") != path:
                wav.write_bytes(bucket.download(path))
            metadata.write_text(json.dumps({
                "dialogue_id": dids[i], "turn_offsets": offsets[i], "duration": durs[i],
                "submitted_at": r["submitted_at"], "source_file": path}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{table}: {len(rows)}건")

    if not a.practice:
        # 이전 다운로드는 보존하되 현재 평가가 아닌 자료는 전사와 채점에서 제외한다.
        for metadata in out.glob("3-*/*.json"):
            if metadata.name.endswith(".scribe.json") or metadata in active_metadata:
                continue
            if a.cls is not None and metadata.parent.name != f"3-{a.cls:02d}":
                continue
            info = json.loads(metadata.read_text(encoding="utf-8"))
            if "dialogue_id" in info:
                info["returned"] = True
                metadata.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        returned_query = client.table("returned_submissions").select("files")
        if a.cls is not None:
            returned_query = returned_query.eq("class", a.cls)
        for returned in returned_query.execute().data:
            referenced.update(returned["files"])
        sq = client.table("students").select("class,number,name").eq("is_teacher", False)
        if a.cls is not None:
            sq = sq.eq("class", a.cls)
        submitted = {(r["class"], r["number"]) for r in rows}
        by_class = {}
        for s in sq.execute().data:
            by_class.setdefault(s["class"], [])
            if (s["class"], s["number"]) not in submitted:
                by_class[s["class"]].append(f"{s['number']:02d} {s['name']}")
        out.mkdir(parents=True, exist_ok=True)
        for cls, names in sorted(by_class.items()):
            (out / f"미제출_3-{cls:02d}.txt").write_text("\n".join(sorted(names)), encoding="utf-8")
            print(f"3-{cls:02d} 미제출 {len(names)}명")

        prefix = "exam" if a.cls is None else f"exam/3-{a.cls:02d}"
        orphans = sorted(p for p in storage_files(bucket, prefix) if p not in referenced)
        orphan_report = out / ("고아파일.txt" if a.cls is None else f"고아파일_3-{a.cls:02d}.txt")
        if orphans or orphan_report.exists():
            orphan_report.write_text("\n".join(orphans), encoding="utf-8")
        if orphans:
            print(f"행 없는 파일 {len(orphans)}개 → {orphan_report.name}")


if __name__ == "__main__":
    main()
