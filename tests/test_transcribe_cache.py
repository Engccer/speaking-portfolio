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


def test_changed_audio_invalidates_transcript_cache(tmp_path, monkeypatch):
    wav = tmp_path / "attempt.wav"
    wav.write_bytes(b"first")
    (tmp_path / "attempt.json").write_text(json.dumps({"source_file": "exam/attempt/1.wav"}), encoding="utf-8")
    calls = []

    def fake_scribe(path):
        calls.append(path.read_bytes())
        return {"text": path.read_bytes().decode(), "words": [{"text": "w", "type": "word"}]}

    monkeypatch.setattr(transcribe, "call_scribe", fake_scribe)
    assert transcribe.transcribe_file(wav)["text"] == "first"
    assert transcribe.transcribe_file(wav)["text"] == "first"
    wav.write_bytes(b"second")
    assert transcribe.cached_transcript(wav) is None
    assert transcribe.transcribe_file(wav)["text"] == "second"
    assert calls == [b"first", b"second"]


def _words(n):
    return [{"text": "w", "start": i, "end": i + 0.3, "type": "word"} for i in range(n)]


def test_retries_failed_transcript_until_valid(tmp_path, monkeypatch):
    wav = tmp_path / "c.wav"; wav.write_bytes(b"RIFF")
    replies = iter([
        {"text": "-", "words": _words(1), "audio_duration_secs": 25.0},
        {"text": "änner Петер 蜀", "words": _words(30), "audio_duration_secs": 25.0},
        {"text": "Hello, students.", "words": _words(60), "audio_duration_secs": 25.0},
    ])
    monkeypatch.setattr(transcribe, "call_scribe", lambda p: next(replies))
    data = transcribe.transcribe_file(wav)
    assert data["text"] == "Hello, students." and "_suspect" not in data


def test_keeps_best_and_marks_suspect_after_max_attempts(tmp_path, monkeypatch):
    wav = tmp_path / "d.wav"; wav.write_bytes(b"RIFF")
    replies = iter([{"text": "", "words": [], "audio_duration_secs": 22.0},
                    {"text": "Wow.", "words": _words(2), "audio_duration_secs": 22.0},
                    {"text": "", "words": [], "audio_duration_secs": 22.0}])
    calls = []
    monkeypatch.setattr(transcribe, "call_scribe", lambda p: calls.append(1) or next(replies))
    data = transcribe.transcribe_file(wav)
    assert len(calls) == transcribe.MAX_ATTEMPTS
    assert data["text"] == "Wow." and data["_suspect"] is True
    assert json.loads((tmp_path / "d.scribe.json").read_text(encoding="utf-8"))["_suspect"] is True


def test_suspicious_rules():
    assert not transcribe.suspicious({"text": "Hi, Tony.", "words": _words(50), "audio_duration_secs": 30.0})
    assert transcribe.suspicious({"text": "Hi.", "words": _words(10), "audio_duration_secs": 30.0})
    assert transcribe.suspicious({"text": "T - подсс局", "words": _words(50), "audio_duration_secs": 30.0})
    assert transcribe.suspicious({"text": "", "words": []})
    assert not transcribe.suspicious({"text": "Thank you. 죄송합니다 끝", "words": _words(50), "audio_duration_secs": 30.0})
