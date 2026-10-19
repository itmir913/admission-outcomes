/**
 * 행 합치기 · 레지스트리 · 필터/정렬 테스트.
 *
 * 이 계층이 조용히 틀리면 표에 뜬 스무 건이 사실은 다른 스무 건이 된다.
 */

import { describe, it, expect } from 'vitest';
import { buildRows } from '../src/analysis/rows.js';
import { buildRegistry, defaultColumns, fieldLabel, valueLabel } from '../src/analysis/registry.js';
import {
  applyQuery, matchesFilter, sortRows, toggleSort, describeFilter, searchHaystack
} from '../src/analysis/query.js';

const dataset = {
  students: [
    { sid: '2024-AAAA-1111', cohortYear: 2024, keyHashes: ['h1'], gpa: { 전교과: 2.1, 국영수: 1.9 } },
    { sid: '2024-BBBB-2222', cohortYear: 2024, keyHashes: ['h2'], gpa: { 전교과: 3.4 } }
  ],
  applications: [
    {
      id: 1, sid: '2024-AAAA-1111', cohortYear: 2024, univ: '가온대학교', dept: '컴퓨터공학과',
      admType: '학생부위주(교과)', stage1: '합격', final: '합격', register: '등록',
      extra: { 학교유형: '일반대' }, fileHash: 'f1', sourceFile: 'a.xlsx', sourceSheet: 'Sheet1'
    },
    {
      id: 2, sid: '2024-AAAA-1111', cohortYear: 2024, univ: '나린대학교', dept: '경영학과',
      admType: '논술위주', stage1: null, final: '불', fileHash: 'f1', sourceFile: 'a.xlsx'
    },
    {
      id: 3, sid: '2024-BBBB-2222', cohortYear: 2024, univ: '가온대학교', dept: '수학과',
      admType: '학생부위주(종합)', stage1: '합격', final: '충원합격', fileHash: 'f1', sourceFile: 'a.xlsx'
    }
  ],
  suneung: [
    { sid: '2024-AAAA-1111', area: '국어', grade: 2, percentile: 93 },
    { sid: '2024-AAAA-1111', area: '수학', grade: 3 }
  ]
};

describe('세 갈래를 표 한 장으로 합치기', () => {
  const rows = buildRows(dataset);

  it('지원 한 건이 행 하나가 된다', () => {
    expect(rows).toHaveLength(3);
  });

  it('학생의 내신·수능이 그 학생의 모든 행에 실린다', () => {
    expect(rows[0]['gpa.전교과']).toBe(2.1);
    expect(rows[1]['gpa.전교과']).toBe(2.1);
    expect(rows[0]['suneung.국어.grade']).toBe(2);
    expect(rows[0]['suneung.국어.percentile']).toBe(93);
    // 다른 학생의 값이 새어 들어오지 않는다
    expect(rows[2]['gpa.전교과']).toBe(3.4);
    expect(rows[2]['suneung.국어.grade']).toBeUndefined();
  });

  it('해석하지 못한 열도 그대로 열이 된다', () => {
    // §4의 귀결. 내년 엑셀에 새 열이 생겨도 코드를 고치지 않는다
    expect(rows[0]['extra.학교유형']).toBe('일반대');
  });

  it('결과를 파생 열로 붙인다', () => {
    expect(rows[0].outcome).toBe('pass');
    expect(rows[1].outcome).toBe('fail');
    expect(rows[2].outcome).toBe('waitPass');
    expect(rows[0].registered).toBe('registered');
    expect(rows[1].stage1Passed).toBe(null);
  });

  it('보관용 열은 표에 내보내지 않는다', () => {
    for (const key of ['id', 'extra', 'fileHash', 'sourceSheet', 'keyHashes']) {
      expect(rows[0][key], key).toBeUndefined();
    }
  });
});

describe('레지스트리', () => {
  const registry = buildRegistry(buildRows(dataset));
  const find = (key) => registry.find((field) => field.key === key);

  it('자료에 있는 열만 등록한다', () => {
    expect(find('univ')).toBeTruthy();
    expect(find('gpa.전교과')).toBeTruthy();
    expect(find('extra.학교유형')).toBeTruthy();
    // 이 자료에 없는 열은 목록에 없다
    expect(find('quota')).toBeUndefined();
  });

  it('값의 가짓수와 건수를 센다', () => {
    const univ = find('univ');
    expect(univ.cardinality).toBe(2);
    expect(univ.values[0]).toEqual({ value: '가온대학교', count: 2 });
  });

  it('전부 숫자인 열만 숫자로 본다', () => {
    expect(find('gpa.전교과').numeric).toBe(true);
    expect(find('gpa.전교과').range).toEqual({ min: 2.1, max: 3.4 });
    expect(find('univ').numeric).toBe(false);
    expect(find('univ').range).toBe(null);
  });

  it('숫자와 글자가 섞인 열은 숫자로 보지 않는다', () => {
    // 크기 비교가 뜻을 잃는다. `-`가 섞인 열이 실제 양식에 있다
    const mixed = buildRegistry([{ 'extra.점수': 3 }, { 'extra.점수': '-' }]);
    expect(mixed[0].numeric).toBe(false);
  });

  it('모르는 열에 이름을 지어 붙이지 않는다', () => {
    expect(fieldLabel('extra.면접일자')).toBe('면접일자');
    expect(fieldLabel('univ')).toBe('대학명');
    expect(fieldLabel('suneung.국어.percentile')).toBe('국어 백분위');
  });

  it('파생 열 값을 화면 말로 바꾼다', () => {
    expect(valueLabel('outcome', 'waitPass')).toBe('충원합격');
    expect(valueLabel('stage1Passed', null)).toBe('해당 없음');
    expect(valueLabel('univ', null)).toBe('(빈칸)');
  });

  it('처음 보이는 열은 상담에서 먼저 보는 것들이다', () => {
    const columns = defaultColumns(registry);
    expect(columns).toContain('sid');
    expect(columns).toContain('univ');
    expect(columns).toContain('outcome');
    // 내신 조합이 여럿이어도 기본은 가장 많이 채워진 하나만
    expect(columns.filter((key) => key.startsWith('gpa.'))).toHaveLength(1);
    expect(columns).toContain('gpa.전교과');
  });
});

describe('필터', () => {
  const rows = buildRows(dataset);

  it('선택한 값만 남긴다', () => {
    const kept = applyQuery(rows, { filters: [{ key: 'univ', op: 'in', values: ['가온대학교'] }] });
    expect(kept).toHaveLength(2);
  });

  it('아무것도 고르지 않으면 아무것도 거르지 않는다', () => {
    // 체크를 다 풀었을 때 화면이 갑자기 비면 사람은 자료가 사라졌다고 여긴다
    expect(applyQuery(rows, { filters: [{ key: 'univ', op: 'in', values: [] }] })).toHaveLength(3);
  });

  it('여러 필터는 함께 좁힌다', () => {
    const kept = applyQuery(rows, {
      filters: [
        { key: 'univ', op: 'in', values: ['가온대학교'] },
        { key: 'outcome', op: 'in', values: ['pass'] }
      ]
    });
    expect(kept).toHaveLength(1);
    expect(kept[0].dept).toBe('컴퓨터공학과');
  });

  it('숫자 범위는 양 끝을 포함한다', () => {
    expect(matchesFilter({ g: 2.1 }, { key: 'g', op: 'range', min: 2.1, max: 3 })).toBe(true);
    expect(matchesFilter({ g: 3 }, { key: 'g', op: 'range', min: 2.1, max: 3 })).toBe(true);
    expect(matchesFilter({ g: 3.01 }, { key: 'g', op: 'range', min: 2.1, max: 3 })).toBe(false);
    // 값이 없는 행은 범위에 들지 않는다
    expect(matchesFilter({}, { key: 'g', op: 'range', min: 1, max: 9 })).toBe(false);
  });

  it('한쪽만 준 범위도 받는다', () => {
    expect(matchesFilter({ g: 5 }, { key: 'g', op: 'range', min: 3, max: null })).toBe(true);
    expect(matchesFilter({ g: 5 }, { key: 'g', op: 'range', min: null, max: 3 })).toBe(false);
  });

  it('빈칸만 남길 수 있다', () => {
    expect(applyQuery(rows, { filters: [{ key: 'register', op: 'blank' }] })).toHaveLength(2);
    expect(applyQuery(rows, { filters: [{ key: 'register', op: 'filled' }] })).toHaveLength(1);
  });

  it('빈칸도 고를 값의 하나로 다룬다', () => {
    expect(matchesFilter({ a: null }, { key: 'a', op: 'in', values: [null] })).toBe(true);
    expect(matchesFilter({ a: '' }, { key: 'a', op: 'in', values: [null] })).toBe(true);
    expect(matchesFilter({ a: '값' }, { key: 'a', op: 'in', values: [null] })).toBe(false);
  });

  it('숫자와 글자로 적힌 같은 값을 같게 본다', () => {
    // 레지스트리의 값 목록은 자료에서 나오고, 자료에는 둘이 섞여 있다
    expect(matchesFilter({ y: 2024 }, { key: 'y', op: 'in', values: ['2024'] })).toBe(true);
  });
});

describe('검색', () => {
  const rows = buildRows(dataset);

  it('여러 낱말은 모두 포함(AND)으로 좁힌다', () => {
    expect(applyQuery(rows, { search: '가온 수학' })).toHaveLength(1);
    expect(applyQuery(rows, { search: '가온' })).toHaveLength(2);
    // 한쪽만 맞으면 걸리지 않는다
    expect(applyQuery(rows, { search: '가온 없는말' })).toHaveLength(0);
  });

  it('화면에 보이는 말로 찾는다', () => {
    // 표에는 `충원합격`이라 떠 있다. `waitPass`로 치라고 할 수 없다
    expect(applyQuery(rows, { search: '충원합격' })).toHaveLength(1);
  });

  it('내부용 열은 훑지 않는다', () => {
    expect(searchHaystack({ univ: '가온대학교', '#fileHash': 'abcdef' })).not.toContain('abcdef');
  });

  it('빈 검색어는 아무것도 거르지 않는다', () => {
    expect(applyQuery(rows, { search: '   ' })).toHaveLength(3);
  });
});

describe('정렬', () => {
  const sample = [
    { n: '다', v: 2 }, { n: '가', v: 1 }, { n: '나', v: null }, { n: '라', v: 1 }
  ];

  it('빈칸은 어느 방향이든 뒤로 간다', () => {
    // 내림차순으로 뒤집었을 때 빈칸이 맨 위를 덮으면 표를 읽을 수 없다
    expect(sortRows(sample, [{ key: 'v', dir: 'asc' }]).at(-1).n).toBe('나');
    expect(sortRows(sample, [{ key: 'v', dir: 'desc' }]).at(-1).n).toBe('나');
  });

  it('앞선 키가 같을 때만 다음 키를 본다', () => {
    const sorted = sortRows(sample, [{ key: 'v', dir: 'asc' }, { key: 'n', dir: 'desc' }]);
    expect(sorted.map((row) => row.n)).toEqual(['라', '가', '다', '나']);
  });

  it('정렬 키가 같은 행끼리는 원래 차례를 지킨다', () => {
    // 원본 차례가 곧 엑셀의 행 차례다. 흔들리면 사람이 표를 못 믿는다
    const sorted = sortRows(sample, [{ key: 'v', dir: 'asc' }]);
    expect(sorted.slice(0, 2).map((row) => row.n)).toEqual(['가', '라']);
  });

  it('한글을 사전 차례로 견준다', () => {
    const sorted = sortRows([{ n: '하' }, { n: '가' }, { n: '나' }], [{ key: 'n', dir: 'asc' }]);
    expect(sorted.map((row) => row.n)).toEqual(['가', '나', '하']);
  });

  it('입력 배열을 건드리지 않는다', () => {
    const original = [...sample];
    sortRows(sample, [{ key: 'v', dir: 'asc' }]);
    expect(sample).toEqual(original);
  });
});

describe('헤더 클릭', () => {
  it('오름차순 → 내림차순 → 해제로 돈다', () => {
    let sorts = toggleSort([], 'univ');
    expect(sorts).toEqual([{ key: 'univ', dir: 'asc' }]);
    sorts = toggleSort(sorts, 'univ');
    expect(sorts).toEqual([{ key: 'univ', dir: 'desc' }]);
    sorts = toggleSort(sorts, 'univ');
    expect(sorts).toEqual([]);
  });

  it('그냥 누르면 1순위 · 2순위로 쌓인다', () => {
    // 먼저 누른 열이 1순위다. 쌓으려고 Shift를 요구하면 아무도 쌓지 않는다
    let sorts = toggleSort([], 'univ');
    sorts = toggleSort(sorts, 'dept');
    sorts = toggleSort(sorts, 'gpa.전교과');
    expect(sorts.map((sort) => sort.key)).toEqual(['univ', 'dept', 'gpa.전교과']);
  });

  it('쌓인 정렬 하나만 방향을 바꿔도 순번은 그 자리다', () => {
    // 헤더의 ①②③ 배지가 방향을 바꿀 때마다 뒤바뀌면 왜 저렇게 섞였는지 설명할 수 없다
    let sorts = [{ key: 'univ', dir: 'asc' }, { key: 'dept', dir: 'asc' }];
    sorts = toggleSort(sorts, 'univ');
    expect(sorts.map((sort) => sort.key)).toEqual(['univ', 'dept']);
    expect(sorts.find((sort) => sort.key === 'univ').dir).toBe('desc');
  });

  it('Shift를 누른 채면 이 열만 남는다', () => {
    const sorts = toggleSort([{ key: 'univ', dir: 'asc' }], 'dept', true);
    expect(sorts).toEqual([{ key: 'dept', dir: 'asc' }]);
  });

  it('Shift로 같은 열을 끝까지 누르면 정렬이 사라진다', () => {
    let sorts = toggleSort([{ key: 'univ', dir: 'asc' }], 'univ', true);
    expect(sorts).toEqual([{ key: 'univ', dir: 'desc' }]);
    sorts = toggleSort(sorts, 'univ', true);
    expect(sorts).toEqual([]);
  });
});

describe('필터를 문장으로', () => {
  it('무엇이 걸려 있는지 읽히게 적는다', () => {
    expect(describeFilter({ key: 'univ', op: 'in', values: ['가온대학교'] }, '대학명'))
      .toBe('대학명: 가온대학교');
    expect(describeFilter({ key: 'univ', op: 'in', values: ['가', '나', '다', '라'] }, '대학명'))
      .toBe('대학명: 가, 나, 다 외 1');
    expect(describeFilter({ key: 'g', op: 'range', min: 1, max: 3 }, '전교과'))
      .toBe('전교과 1 ~ 3');
    expect(describeFilter({ key: 'g', op: 'range', min: 2, max: null }, '전교과'))
      .toBe('전교과 2 이상');
    expect(describeFilter({ key: 'outcome', op: 'in', values: ['pass'] }, '결과'))
      .toBe('결과: 합격');
  });
});
