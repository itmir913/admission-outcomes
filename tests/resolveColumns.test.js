/**
 * **열 해석의 주 경로는 이름이다** (§4).
 *
 * 번호로 먼저 읽던 시절의 결함이 실제로 터졌다. 대교협 양식에 5등급제 열 하나가
 * 끼어들자 뒤따르는 논리 필드 53개가 한 칸씩 밀렸고, 지문이 어긋나 파일 전체가
 * 거절됐다 — **열 이름은 하나도 바뀌지 않았는데도.**
 *
 * 그래서 여기서 재는 것은 두 가지다.
 *
 * 1. 열이 끼어들거나 빠져도 **이름이 같으면 같은 답**이 나오는가
 * 2. 이름이 같아도 **뜻이 다른 자리**를 구별하는가 (내신 국어 ≠ 수능 국어)
 *
 * plan.md §10의 2단계 완료 기준이 1번이다 — "샘플 파일의 헤더를 한 열만 바꿔 넣었을 때
 * 조용히 틀린 값을 읽으면 실패다."
 */

import { describe, it, expect } from 'vitest';

import {
  resolveSheet, resolveColumns, findSections, normalizeLabel, scoreLabel,
  gpaKeyOf, suneungKeyOf, fitRatio, namesAScalar
} from '../src/ingest/resolveColumns.js';
import { buildHeaderLabels } from '../src/ingest/headerBlock.js';
import { kcueGrid, senjinhakGrid } from './helpers/workbook.js';

/**
 * 대교협 계열의 두 줄 헤더. 내신 구역과 수능 구역에 `국어`가 각각 한 번씩 있다.
 *
 * 값 행을 함께 넣는다 — 값 교차검증이 도는지까지 봐야 한다.
 */
function twoRowGrid({ insertAt = null, insertLabel = '(5등급)·일반등급' } = {}) {
  const top = ['학년', '반', '번호', '이름', '지역', '대학명', '모집시기', '전형유형', '전형명(대)',
    '모집단위', '계열', '1단계', '최종단계', '불합격사유', '최초후보순위', '등록여부', '최종발표일',
    '국어', '영어', '수학', '전교과', '전교과', '국영수사/과',
    '한국사', '국어', '국어', '국어', '국어', '영어'];
  const sub = ['', '', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '', '',
    '100', '100', '100', '100', '2/4/4', '100',
    '등급', '과목', '표점', '백분위', '등급', '등급'];
  const body = [3, 5, 7, '최윤슬', '서울', '고려대학교(서울)', '수시', '학생부위주(종합)', '일반전형',
    '사회학과', '인문', '합격', '불합격', '수능최저미충족', 3, '미등록', '2026-01-20',
    2.1, 2.4, 3.0, 2.5, 2.6, 2.4,
    5, '화법과작문', 128, 88, 2, 3];

  if (insertAt !== null) {
    top.splice(insertAt, 0, insertLabel.split('·')[0]);
    sub.splice(insertAt, 0, insertLabel.split('·')[1] ?? '');
    body.splice(insertAt, 0, 4.2);
  }
  return [top, sub, body, body];
}

describe('라벨 정리', () => {
  it('괄호를 걷어낸 모양과 글자만 지운 모양을 함께 돌려준다', () => {
    expect(normalizeLabel('전형명(대)')).toEqual({ tight: '전형명대', base: '전형명' });
  });

  it('괄호 안이 값인 라벨은 괄호를 걷어내도 남는 것이 있다', () => {
    // `전교과(2/4/4)`의 괄호 안은 뜻을 나르는 값이다. tight 쪽이 그것을 지킨다
    expect(normalizeLabel('전교과(2/4/4)').tight).toBe('전교과2/4/4');
  });

  it('라벨이 통째로 괄호면 괄호 안을 쓴다 - 빈 이름으로 만들지 않는다', () => {
    expect(normalizeLabel('(9등급)').base).toBe('9등급');
  });
});

describe('이름 점수 매기기', () => {
  const final = { exact: ['최종단계', '최종'], affix: ['최종단계'], partial: [] };

  it('그대로 같으면 가장 높다', () => {
    expect(scoreLabel(normalizeLabel('최종단계'), final)).toBe(100);
  });

  it('긴 이름이 짧은 말을 앞에 달고 있다고 잡지 않는다', () => {
    // `최종발표일`이 `최종`으로 시작한다는 이유로 최종단계가 되면,
    // 합격 여부 자리에 날짜가 들어앉는다. 틀린 티가 안 나는 쪽이다
    expect(scoreLabel(normalizeLabel('최종발표일'), final)).toBe(0);
  });

  it('사전에 없는 이름은 0이다', () => {
    expect(scoreLabel(normalizeLabel('비고'), final)).toBe(0);
  });
});

describe('구역 판정', () => {
  const labelsOf = (grid, rows) => buildHeaderLabels(grid, rows);

  it('내신 구역과 수능 구역을 구분한다', () => {
    const sections = findSections(labelsOf(twoRowGrid(), 2));
    expect(sections.gpa).toEqual({ start: 17, end: 23 });
    expect(sections.suneung).toEqual({ start: 23, end: 29 });
  });

  it('수능 구역이 없으면 내신 구역을 사전에 있는 이름에서 끊는다', () => {
    // 끊지 않으면 `1단계`·`최종`까지 내신으로 삼킨다
    const sections = findSections(labelsOf([senjinhakGrid(2026)[0]], 1));
    expect(sections.suneung).toBeNull();
    expect(sections.gpa.start).toBe(9);
    expect(sections.gpa.end).toBe(10);
  });

  it('사전에 있는 이름인지 구별한다', () => {
    expect(namesAScalar({ top: '1단계', sub: '', label: '1단계' })).toBe(true);
    expect(namesAScalar({ top: '전교과', sub: '100', label: '전교과·100' })).toBe(false);
  });
});

describe('구역 안에서 키 만들기', () => {
  it('반영비가 전체면 조합 이름만 쓴다', () => {
    expect(gpaKeyOf({ top: '전교과', sub: '100' })).toBe('gpa.전교과');
    expect(gpaKeyOf({ top: '전과목', sub: '' })).toBe('gpa.전과목');
  });

  it('반영비가 따로 있으면 괄호로 붙여 다른 열로 남긴다', () => {
    // 붙이지 않으면 전교과 네 열이 한 열로 겹쳐 셋이 사라진다
    expect(gpaKeyOf({ top: '전교과', sub: '2/4/4' })).toBe('gpa.전교과(2/4/4)');
  });

  it('수능 항목 이름이 없으면 등급으로 본다 - 등급만 싣는 양식이 있다', () => {
    expect(suneungKeyOf({ top: '국어', sub: '' })).toBe('suneung.국어.grade');
    expect(suneungKeyOf({ top: '국어', sub: '백분위' })).toBe('suneung.국어.percentile');
  });
});

describe('값으로 교차검증', () => {
  it('범위에 드는 비율을 센다', () => {
    expect(fitRatio([1.2, 3.4, 9.0], { min: 1, max: 9 })).toBe(1);
    expect(fitRatio([1.2, 300], { min: 1, max: 9 })).toBe(0.5);
  });

  it('값이 하나도 없으면 null이다 - 검증할 거리가 없다는 뜻이다', () => {
    expect(fitRatio([null, '', undefined], { min: 1, max: 9 })).toBeNull();
  });
});

describe('두 줄 헤더를 해석한다', () => {
  const resolved = resolveSheet(twoRowGrid());

  it('머리글이 두 줄인 것을 알아낸다', () => {
    expect(resolved.headerRows).toBe(2);
    expect(resolved.headerStart).toBe(0);
  });

  it('내신 국어와 수능 국어를 다른 열로 둔다', () => {
    // 구역을 구분하지 않으면 둘 중 하나가 다른 하나를 덮는다. 이게 이 파일의 핵심이다
    expect(resolved.columns['gpa.국어']).toBe(17);
    expect(resolved.columns['suneung.국어.grade']).toBe(27);
    expect(resolved.columns['suneung.국어.percentile']).toBe(26);
  });

  it('반영비가 다른 전교과 둘을 함께 살린다', () => {
    expect(resolved.columns['gpa.전교과']).toBe(20);
    expect(resolved.columns['gpa.전교과(2/4/4)']).toBe(21);
  });

  it('최종발표일을 최종단계로 잡지 않는다', () => {
    expect(resolved.columns.final).toBe(12);
    expect(resolved.unresolved.map((item) => item.label)).toContain('최종발표일');
  });

  it('해석하지 못한 열을 버리지 않고 이유와 함께 들고 온다', () => {
    const 최종발표일 = resolved.unresolved.find((item) => item.label === '최종발표일');
    expect(최종발표일.reason).toBeTruthy();
    expect(최종발표일.index).toBe(16);
  });
});

describe('열이 끼어들어도 같은 답이 나온다', () => {
  /**
   * plan.md §10 2단계의 완료 기준.
   *
   * 번호로 읽던 때라면 끼어든 자리 뒤의 모든 열이 한 칸씩 밀려 **조용히 틀린 값**을 읽었다.
   */
  const before = resolveSheet(twoRowGrid());
  const after = resolveSheet(twoRowGrid({ insertAt: 17 }));

  it('끼어든 열 뒤의 필드가 모두 한 칸씩 밀려서 잡힌다', () => {
    const 밀린것 = [];
    for (const [key, index] of Object.entries(before.columns)) {
      const expected = index >= 17 ? index + 1 : index;
      if (after.columns[key] !== expected) 밀린것.push(`${key}: 기대 ${expected} 실제 ${after.columns[key]}`);
    }
    expect(밀린것).toEqual([]);
  });

  it('푼 필드의 목록 자체는 똑같다', () => {
    expect(Object.keys(after.columns).sort()).toEqual(Object.keys(before.columns).sort());
  });

  it('열이 빠져도 마찬가지다', () => {
    const grid = twoRowGrid();
    // 「불합격사유」를 통째로 뺀다
    for (const row of grid) row.splice(13, 1);
    const trimmed = resolveSheet(grid);
    expect(trimmed.columns.failReason).toBeUndefined();
    expect(trimmed.columns.univ).toBe(5);
    expect(trimmed.columns.register).toBe(before.columns.register - 1);
    expect(trimmed.columns['suneung.국어.grade']).toBe(before.columns['suneung.국어.grade'] - 1);
  });
});

describe('이름 매칭과 손으로 적은 프로파일이 같은 답을 낸다', () => {
  /**
   * 두 경로가 어긋나면 **어느 쪽이 맞는지 알 방법이 없다.** 지문이 맞는 날은 프로파일이,
   * 어긋나는 날은 이름 매칭이 읽으므로, 둘이 다르면 같은 자료가 날에 따라 달라진다.
   */
  it('대교협 계열 표본에서 어긋나지 않는다', () => {
    const resolved = resolveSheet(kcueGrid());
    expect(resolved.headerRows).toBe(2);
    expect(resolved.columns.univ).toBe(4);
    expect(resolved.columns['identity.name']).toBe(3);
    expect(resolved.columns['gpa.전교과']).toBe(10);
    expect(resolved.columns['suneung.한국사.grade']).toBe(11);
    expect(resolved.columns['suneung.국어.stdScore']).toBe(13);
  });

  it('센진학 계열 표본에서 어긋나지 않는다', () => {
    const resolved = resolveSheet(senjinhakGrid(2026));
    expect(resolved.headerRows).toBe(1);
    expect(resolved.columns.univ).toBe(4);
    expect(resolved.columns['gpa.전과목']).toBe(9);
    expect(resolved.columns.stage1).toBe(10);
    expect(resolved.columns.final).toBe(11);
  });

  it('`학년` 열에 연도가 실린 것을 값으로 알아챈다', () => {
    // 대교협의 `학년`에는 3이, 센진학의 같은 이름 열에는 2026이 들어 있다 (§3의 함정).
    // 이름으로는 구분되지 않으므로 값으로 구별한다
    expect(resolveSheet(senjinhakGrid(2026)).columns.sourceYear).toBe(0);
    expect(resolveSheet(senjinhakGrid(2026)).columns.schoolYear).toBeUndefined();
    expect(resolveSheet(kcueGrid()).columns.schoolYear).toBe(0);
    expect(resolveSheet(kcueGrid()).columns.sourceYear).toBeUndefined();
  });
});

describe('배정하지 않고 넘어가는 자리', () => {
  it('이름이 맞아도 값이 딴 세상이면 배정을 지운다', () => {
    // `모집인원` 자리에 연도가 들어 있는 양식을 가정한다
    const grid = [
      ['대학명', '모집단위', '모집인원'],
      ['서울대학교', '컴퓨터공학부', 20260101],
      ['연세대학교', '인공지능학과', 20260102]
    ];
    const resolved = resolveColumns(grid, 1);
    expect(resolved.columns.quota).toBeUndefined();
    expect(resolved.notes.join(' ')).toContain('배정하지 않았습니다');
  });

  it('값이 비어 있으면 취소하지 않는다 - 검증할 거리가 없는 것과 틀린 것은 다르다', () => {
    const grid = [['대학명', '모집인원'], ['서울대학교', null]];
    expect(resolveColumns(grid, 1).columns.quota).toBe(1);
  });
});

describe('대학명을 못 찾는 경우', () => {
  it('아무것도 지어내지 않는다', () => {
    const resolved = resolveSheet([['쪽지', '메모'], ['가', '나']]);
    expect(resolved.columns.univ).toBeUndefined();
    expect(resolved.unresolved.map((item) => item.label)).toEqual(['쪽지', '메모']);
  });
});
