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
        out.mkdir(parents=True, exist_ok=True)
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
