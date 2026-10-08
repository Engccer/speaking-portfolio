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
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
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
