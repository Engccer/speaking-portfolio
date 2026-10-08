"""data/dialogues.json의 표현 10개를 대화별 Markdown 표로 출력한다. 사용: python scripts/export_expressions.py > 표현목록.md"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
data = json.loads((Path(__file__).resolve().parents[1] / "data" / "dialogues.json").read_text(encoding="utf-8"))
for d in data:
    print(f"### {d['id']} {d['title']} ({d['source']})\n")
    print("| 번호 | 역할 | 표현 |\n|---|---|---|")
    sp = {u["n"]: u["speaker"] for u in d["units"]}
    for e in d["expressions"]:
        print(f"| {e['n']} | {sp[e['unit']]} | {e['text']} |")
    print()
