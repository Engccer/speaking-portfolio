"""폴더의 WAV를 ElevenLabs Scribe로 전사한다. 현재 음원과 일치하는 캐시를 재사용한다.

사용: python scripts/transcribe.py <폴더>
"""
import json
import hashlib
import os
import sys
import time
from pathlib import Path

import requests

URL = "https://api.elevenlabs.io/v1/speech-to-text"


def api_key():
    from common import ROOT

    env = ROOT / ".env"
    if not os.environ.get("ELEVENLABS_API_KEY") and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                os.environ["ELEVENLABS_API_KEY"] = line.split("=", 1)[1].strip()
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit(".env에 ELEVENLABS_API_KEY 없음")
    return key


def call_scribe(wav: Path) -> dict:
    key = api_key()
    for attempt in range(3):
        with open(wav, "rb") as f:
            r = requests.post(URL, headers={"xi-api-key": key},
                              data={"model_id": "scribe_v1", "language_code": "en",
                                    "timestamps_granularity": "word", "diarize": "false",
                                    "tag_audio_events": "false"},
                              files={"file": (wav.name, f, "audio/wav")}, timeout=300)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503) and attempt < 2:
            time.sleep(5 * (attempt + 1))
            continue
        raise RuntimeError(f"{wav.name}: {r.status_code} {r.text[:200]}")


def recording_metadata(wav: Path) -> dict:
    metadata = wav.with_suffix(".json")
    return json.loads(metadata.read_text(encoding="utf-8")) if metadata.exists() else {}


def cached_transcript(wav: Path) -> dict | None:
    info = recording_metadata(wav)
    if info.get("returned"):
        return None
    cache = wav.with_name(wav.stem + ".scribe.json")
    if cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
        digest = data.get("_source_sha256")
        if digest is None and not info.get("source_file"):
            return data
        if digest is not None and wav.exists() and digest == hashlib.sha256(wav.read_bytes()).hexdigest():
            return data
    return None


def transcribe_file(wav: Path) -> dict | None:
    if recording_metadata(wav).get("returned"):
        return None
    cached = cached_transcript(wav)
    if cached is not None:
        return cached
    digest = hashlib.sha256(wav.read_bytes()).hexdigest()
    data = call_scribe(wav)
    data["_source_sha256"] = digest
    cache = wav.with_name(wav.stem + ".scribe.json")
    cache.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    folder = Path(sys.argv[1])
    wavs = sorted(w for w in folder.rglob("*.wav") if not recording_metadata(w).get("returned"))
    done = called = 0
    for w in wavs:
        had = cached_transcript(w) is not None
        try:
            transcribe_file(w)
            done += 1
            called += 0 if had else 1
            print(("캐시 " if had else "전사 ") + w.name)
        except Exception as e:
            print("실패", w.name, e)
    print(f"{done}/{len(wavs)} 완료, API 호출 {called}회")


if __name__ == "__main__":
    main()
