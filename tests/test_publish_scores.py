import openpyxl
import pytest
from publish_scores import read_scores, validate_roster, payload


def workbook(tmp_path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '3-4'
    ws.append(['3학년 4반 말하기 포트폴리오 수행평가 결과표'])
    ws.append(['번호', '이름', '첫 번째 대화', None, None, None, '두 번째 대화', None, None, None, '최종 점수\n(10점 만점)', '비고'])
    ws.append([None, None, '대화문', '통과한 표현\n(10개 중)', '기준에 못 미친\n표현 번호', '점수', '대화문', '통과한 표현\n(10개 중)', '기준에 못 미친\n표현 번호', '점수'])
    for row in rows:
        ws.append(row)
    ws.append(['설명 문단'])
    wb.save(tmp_path / '3학년 4반 말하기 포트폴리오 결과표.xlsx')


def scored(num=1):
    return [num, '학생 예시', 'Lesson 5-1', 8, '2, 3', 9, 'Lesson 7-2', 10, None, 10, 10, None]


def test_exact_values_and_blank_statuses(tmp_path):
    workbook(tmp_path, [scored(), [2, '학생 둘'] + [None] * 8 + [None, '재응시'],
                        [3, '학생 셋'] + [None] * 8 + [None, '미제출']])
    rows = read_scores(tmp_path)
    assert rows[0]['dialogues'][0] == {'title': 'Lesson 5-1', 'passed': 8, 'missed': '2, 3', 'score': 9}
    assert rows[0]['final_score'] == 10
    assert rows[1]['final_score'] is None and rows[1]['note'] == '재응시'
    assert rows[2]['final_score'] is None and rows[2]['note'] == '미제출'
    assert all('name' not in r for r in payload(rows))


@pytest.mark.parametrize('change', ['duplicate', 'formula', 'out_of_range', 'bad_header', 'blank_score'])
def test_invalid_source_is_rejected(tmp_path, change):
    row = scored()
    rows = [row]
    if change == 'duplicate': rows.append(scored())
    if change == 'formula': row[10] = '=10'
    if change == 'out_of_range': row[10] = 11
    if change == 'blank_score': row[10] = None
    workbook(tmp_path, rows)
    if change == 'bad_header':
        path = next(tmp_path.glob('*.xlsx'))
        wb = openpyxl.load_workbook(path)
        wb.active['F3'] = '다른 열'
        wb.save(path)
    with pytest.raises(ValueError): read_scores(tmp_path)


def test_roster_validation(tmp_path):
    workbook(tmp_path, [scored()])
    rows = read_scores(tmp_path)
    roster = [{'class': 4, 'number': 1, 'name': '학 생　예시', 'is_teacher': False}]
    validate_roster(rows, roster)
    roster[0]['name'] = '다른 학생'
    with pytest.raises(ValueError): validate_roster(rows, roster)
    with pytest.raises(ValueError): validate_roster(rows, [])
