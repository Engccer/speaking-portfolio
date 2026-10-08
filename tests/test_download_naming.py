from download import local_stem, parse_storage_path


def test_local_stem():
    assert local_stem(4, 7, "김헌용", 1, "L5-1") == "3-04-07 김헌용_1_L5-1"


def test_parse_storage_path():
    assert parse_storage_path("exam/3-04/3-04-07/2_L7-3.wav") == (4, 7, 2, "L7-3")
    assert parse_storage_path("practice/3-01/3-01-12/2026-10-09T01-02-03-000Z_L6-2.wav") == (1, 12, None, "L6-2")
