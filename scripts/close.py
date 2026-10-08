"""학급 입장 닫기(모의·본 평가). 사용: python scripts/close.py [반 ...]  (인자 없으면 전 반)"""
import sys
from common import service_client

classes = [int(a) for a in sys.argv[1:]] or list(range(0, 7))
c = service_client()
for cls in classes:
    c.table("settings").upsert({"class": cls, "exam_open": False}).execute()
print("닫힘:", classes)
