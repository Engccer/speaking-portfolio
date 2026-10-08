"""실서버 보안 검증. .env와 config.js가 있어야 하고, 테스트 반 0을 쓴다."""
import uuid

import pytest

from common import ROOT, anon_config, service_client

pytestmark = pytest.mark.skipif(not (ROOT / "config.js").exists(), reason="config.js 없음")

TEST = {"class": 0, "number": 99, "name": "테스트 학생"}


@pytest.fixture(scope="module")
def svc():
    c = service_client()
    c.table("students").upsert(TEST).execute()
    c.table("settings").upsert({"class": 0, "exam_open": False}).execute()
    yield c
    c.table("submissions").delete().eq("class", 0).execute()
    c.table("practice_submissions").delete().eq("class", 0).execute()
    c.table("students").delete().eq("class", 0).execute()
    c.table("settings").delete().eq("class", 0).execute()


@pytest.fixture(scope="module")
def anon():
    from supabase import create_client

    url, key = anon_config()
    return create_client(url, key)


def row(**extra):
    base = {**TEST, "dialogue_ids": ["L5-1", "L6-2"], "turn_offsets": [],
            "files": [f"exam/x/{uuid.uuid4()}.wav", f"exam/x/{uuid.uuid4()}.wav"],
            "durations": [1, 1]}
    return {**base, **extra}


def test_check_in_name_with_spaces(anon, svc):
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "테스트  학생"}).execute()
    assert r.data["ok"] is True and r.data["exam_open"] is False and r.data["submitted"] is False


def test_check_in_fullwidth_space(anon, svc):
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "테스트　학생"}).execute()
    assert r.data["ok"] is True


def test_check_in_wrong_name(anon, svc):
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "다른 이름"}).execute()
    assert r.data["ok"] is False


def blocked_select(anon, table):
    """RLS로 빈 결과가 오거나 테이블 권한 오류가 나면 차단으로 본다."""
    try:
        return anon.table(table).select("*").execute().data == []
    except Exception:
        return True


def test_anon_cannot_read_students(anon, svc):
    assert blocked_select(anon, "students")


def test_insert_rejected_when_closed(anon, svc):
    with pytest.raises(Exception):
        anon.table("submissions").insert(row()).execute()


def test_insert_once_when_open_then_duplicate_rejected(anon, svc):
    svc.table("settings").update({"exam_open": True}).eq("class", 0).execute()
    anon.table("submissions").insert(row()).execute()
    with pytest.raises(Exception) as e:
        anon.table("submissions").insert(row()).execute()
    assert "23505" in str(e.value) or "duplicate" in str(e.value).lower()
    r = anon.rpc("check_in", {"p_class": 0, "p_number": 99, "p_name": "테스트 학생"}).execute()
    assert r.data["submitted"] is True


def test_practice_insert_allowed_many_times(anon, svc):
    for _ in range(2):
        anon.table("practice_submissions").insert(
            {**TEST, "dialogue_id": "L5-1", "turn_offsets": [], "file": f"practice/x/{uuid.uuid4()}.wav",
             "duration": 1}).execute()


def test_anon_cannot_select_submissions(anon, svc):
    assert blocked_select(anon, "submissions")
