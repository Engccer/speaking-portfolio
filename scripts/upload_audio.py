"""교과서 듣기 음원 폴더(Lesson 5~7 하위)에서 9편의 B 섹션·Real Life Talk mp3를 audio 버킷에 올린다.

사용: python scripts/upload_audio.py "<교과서 듣기 음원 폴더>"
"""
import sys
from pathlib import Path

from common import service_client

FILES = {
    "L5-1": "Lesson 5/02_Listen and Speak 1_B.mp3",
    "L5-2": "Lesson 5/04_Listen and Speak 2_B.mp3",
    "L5-3": "Lesson 5/05_Real Life Talk.mp3",
    "L6-1": "Lesson 6/02_Listen and Speak 1_B.mp3",
    "L6-2": "Lesson 6/04_Listen and Speak 2_B.mp3",
    "L6-3": "Lesson 6/05_Real Life Talk.mp3",
    "L7-1": "Lesson 7/02_Listen and Speak 1_B.mp3",
    "L7-2": "Lesson 7/04_Listen and Speak 2_B.mp3",
    "L7-3": "Lesson 7/05_Real Life Talk.mp3",
}


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    folder = Path(sys.argv[1])
    bucket = service_client().storage.from_("audio")
    for did, rel in FILES.items():
        data = (folder / rel).read_bytes()
        bucket.upload(f"{did}.mp3", data, {"content-type": "audio/mpeg", "upsert": "true"})
        print(did, len(data), "bytes")


if __name__ == "__main__":
    main()
