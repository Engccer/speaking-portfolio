"""학생 1명의 본 평가 제출(행과 파일)을 삭제해 재응시를 허용한다. 쌤 지시가 있을 때만 실행.

사용: python scripts/reset.py <반> <번호>
"""
import sys
from common import service_client

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
cls, num = int(sys.argv[1]), int(sys.argv[2])
c = service_client()
rows = c.table("submissions").select("*").eq("class", cls).eq("number", num).execute().data
if not rows:
    raise SystemExit("제출 기록 없음")
r = rows[0]
print(f"삭제 대상: {cls}반 {num}번 {r['name']} {r['dialogue_ids']} {r['submitted_at']}")
if input("정말 삭제할까요? (yes 입력) ").strip() != "yes":
    raise SystemExit("취소")
c.storage.from_("recordings").remove(r["files"])
c.table("submissions").delete().eq("id", r["id"]).execute()
print("삭제 완료. 학생이 다시 입장하면 본 평가가 가능합니다(반이 열려 있어야 함).")
