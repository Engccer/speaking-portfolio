"""턴 CSV와 독백 원문으로 data/dialogues.json을 만든다.

사용: python scripts/build_dialogues.py "<턴 목록 CSV 경로>"
"""
import csv
import json
import sys
from collections import OrderedDict
from pathlib import Path

ORDER = ["L5-1", "L5-2", "L5-3", "L6-1", "L6-2", "L6-3", "L7-1", "L7-2", "L7-3"]

META = {
    "L5-1": ("Jim Abbott", "Lesson 5 / Listen and Speak 1 B / p.86"),
    "L5-2": ("Singing Contest", "Lesson 5 / Listen and Speak 2 B / p.87"),
    "L5-3": ("Billy Elliot", "Lesson 5 / Real Life Talk / p.88"),
    "L6-1": ("Folk Village", "Lesson 6 / Listen and Speak 1 B / p.104"),
    "L6-2": ("Concert Tickets", "Lesson 6 / Listen and Speak 2 B / p.105"),
    "L6-3": ("Art Museum Tour", "Lesson 6 / Real Life Talk / p.106"),
    "L7-1": ("Baby Penguins", "Lesson 7 / Listen and Speak 1 B / p.122"),
    "L7-2": ("Namsan Hiking", "Lesson 7 / Listen and Speak 2 B / p.123"),
    "L7-3": ("Camels", "Lesson 7 / Real Life Talk / p.124"),
}

# 독백: 교과서 듣기 대본 p.106 원문. "Hello, students!"는 다음 문장과 한 단위로 묶는다.
MONOLOGUE_UNITS = [
    "Hello, students! Thank you for visiting our art museum.",
    "This museum opened in 1995.",
    "Since then, it has exhibited many famous artworks.",
    "Today, you will see some famous artworks from the art books.",
    "Before we begin the tour, let me remind you of a basic rule.",
    "You can take pictures of the artworks, but you're not allowed to touch them.",
    "Now let's start the tour.",
]

# 표현 10개를 맞추기 위한 분할. 키 (대화ID, 단위 번호) → 조각 목록. 조각을 공백으로 이으면 단위 원문.
SPLITS = {
    ("L5-1", 5): ["Yeah. His story was made into a movie.", "I'm going to watch it this Saturday."],
    ("L5-2", 5): ["Great. Can you play the guitar", "while I sing in the contest?"],
    ("L5-2", 6): ["I'd love to, but I can't.", "I hurt my hand in gym class yesterday."],
    ("L6-3", 1): ["Hello, students!", "Thank you for visiting our art museum."],
    ("L6-3", 5): ["Before we begin the tour,", "let me remind you of a basic rule."],
    ("L6-3", 6): ["You can take pictures of the artworks,", "but you're not allowed to touch them."],
    ("L7-1", 5): ["The average temperature is about −58℃ in July", "and −26℃ in December."],
    ("L7-1", 7): ["Yes. Although it's very cold there,", "it doesn't snow much."],
    ("L7-2", 2): ["I'm going to go hiking.", "Do you want to join me?"],
    ("L7-3", 4): ["I wonder how long camels can go", "without water in the desert."],
    ("L7-3", 7): ["Wow, that's amazing!", "Camels are really interesting animals."],
}


def read_turns(csv_path):
    units = OrderedDict()
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            units.setdefault(row["대화ID"], []).append(
                {"n": int(row["턴"]), "speaker": row["역할"], "text": row["영어대사"].strip()}
            )
    return units


def build(csv_path):
    units_by_id = read_turns(csv_path)
    units_by_id["L6-3"] = [{"n": i + 1, "speaker": "W", "text": t} for i, t in enumerate(MONOLOGUE_UNITS)]
    out = []
    for did in ORDER:
        units = sorted(units_by_id[did], key=lambda u: u["n"])
        expressions = []
        for u in units:
            pieces = SPLITS.get((did, u["n"]), [u["text"]])
            if " ".join(pieces) != u["text"]:
                raise SystemExit(f"{did} 단위 {u['n']}: 분할 조각이 원문과 다름")
            for p in pieces:
                expressions.append({"n": len(expressions) + 1, "unit": u["n"], "text": p})
        if len(expressions) != 10:
            raise SystemExit(f"{did}: 표현 {len(expressions)}개 (10개 필요)")
        title, source = META[did]
        out.append({"id": did, "title": title, "source": source, "audio": f"{did}.mp3",
                    "units": units, "expressions": expressions})
    return out


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    data = build(sys.argv[1])
    target = Path(__file__).resolve().parents[1] / "data" / "dialogues.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data)}편 → {target}")


if __name__ == "__main__":
    main()
