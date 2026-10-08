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
