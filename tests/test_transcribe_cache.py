import json

import transcribe


def test_uses_cache_without_calling_api(tmp_path, monkeypatch):
    wav = tmp_path / "a.wav"; wav.write_bytes(b"RIFF")
    cache = tmp_path / "a.scribe.json"; cache.write_text(json.dumps({"text": "hi", "words": []}), encoding="utf-8")
    monkeypatch.setattr(transcribe, "call_scribe", lambda p: (_ for _ in ()).throw(AssertionError("호출 금지")))
    assert transcribe.transcribe_file(wav)["text"] == "hi"


def test_calls_api_and_writes_cache(tmp_path, monkeypatch):
    wav = tmp_path / "b.wav"; wav.write_bytes(b"RIFF")
    monkeypatch.setattr(transcribe, "call_scribe", lambda p: {"text": "yo", "words": [{"text": "yo", "start": 0, "end": 0.3, "type": "word"}]})
    assert transcribe.transcribe_file(wav)["text"] == "yo"
    assert json.loads((tmp_path / "b.scribe.json").read_text(encoding="utf-8"))["text"] == "yo"
