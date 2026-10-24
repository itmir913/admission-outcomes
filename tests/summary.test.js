import { describe, it, expect } from 'vitest';
import { summarize, gpaSpread, GROUPINGS } from '../src/analysis/summary.js';
import { tallyOutcomes } from '../src/ui/outcome.js';
import { buildRows } from '../src/analysis/rows.js';

/** 지원 한 건. 판정은 실제 분류기를 거치게 원본 표기로 넣는다 */
function app(sid, univ, admType, final, extra = {}) {
  return { id: `${sid}-${univ}-${admType}-${Math.random()}`, sid, cohortYear: 2025, univ, admType, final, ...extra };
}

function rowsOf(applications, gpa = {}) {
  const students = [...new Set(applications.map((item) => item.sid))]
    .map((sid) => ({ sid, gpa: gpa[sid] === undefined ? {} : { 전교과: gpa[sid] } }));
  return buildRows({ students, applications, suneung: [] });
}

const byKey = (summary, ...values) => summary.groups.find((group) => group.values.join('|') === values.join('|'));

describe('대학×전형으로 묶는다', () => {
  const rows = rowsOf([
    app('a', '가대학', '학생부종합', '합'),
    app('b', '가대학', '논술', '합'),
    app('c', '가대학', '학생부종합', '불'),
    app('a', '나대학', '학생부교과', '불')
  ], { a: 1.5, b: 6.2, c: 2.1 });

  it('같은 대학이라도 전형이 다르면 다른 줄이다 — 논술 합격자 내신이 교과 범위에 섞이지 않는다', () => {
    const summary = summarize(rows, { keys: GROUPINGS.univAdm.keys, gpaKey: 'gpa.전교과' });
    expect(summary.groups).toHaveLength(3);
    expect(byKey(summary, '가대학', '학생부종합').gpa).toEqual({ kind: 'list', values: [1.5] });
    expect(byKey(summary, '가대학', '논술').gpa).toEqual({ kind: 'list', values: [6.2] });
  });

  it('대학만으로 접을 수도 있다', () => {
    const summary = summarize(rows, { keys: GROUPINGS.univ.keys, gpaKey: 'gpa.전교과' });
    expect(summary.groups).toHaveLength(2);
    expect(byKey(summary, '가대학').tally.지원).toBe(3);
  });

  it('줄을 다 더하면 요약 띠와 같다 — 같은 행을 같은 함수로 센다', () => {
    const summary = summarize(rows, { keys: GROUPINGS.univAdm.keys, gpaKey: null });
    const whole = tallyOutcomes(rows);
    for (const name of ['지원', '합격', '충원합격', '불합격', '미상']) {
      expect(summary.groups.reduce((sum, group) => sum + group.tally[name], 0), name).toBe(whole[name]);
    }
  });

  it('학생 수와 지원 건수를 따로 센다 — 한 학생이 두 모집단위를 쓰면 2건 1명이다', () => {
    const twice = rowsOf([app('a', '가대학', '논술', '불'), app('a', '가대학', '논술', '합')]);
    const group = summarize(twice, { keys: GROUPINGS.univAdm.keys, gpaKey: null }).groups[0];
    expect(group.tally.지원).toBe(2);
    expect(group.tally.학생).toBe(1);
  });
});

describe('표본이 적은 자리를 합격선처럼 보이게 하지 않는다', () => {
  it('판정이 5건 미만이면 합격률을 내지 않는다', () => {
    const rows = rowsOf([app('a', '가', '교과', '합')]);
    expect(summarize(rows, { keys: ['univ'], gpaKey: null }).groups[0].rate).toBeNull();
  });

  it('5건 이상이면 합격률을 낸다', () => {
    const rows = rowsOf(['합', '합', '불', '불', '불'].map((final, index) => app(`s${index}`, '가', '교과', final)));
    expect(summarize(rows, { keys: ['univ'], gpaKey: null }).groups[0].rate).toBeCloseTo(0.4);
  });

  it('5건 미만이면 내신을 범위가 아니라 값으로 늘어놓는다', () => {
    expect(gpaSpread([3.9, 2.1, 2.4])).toEqual({ kind: 'list', values: [2.1, 2.4, 3.9] });
  });

  it('5건 이상이면 최저·중앙값·최고를 낸다', () => {
    expect(gpaSpread([1, 2, 3, 4, 9])).toEqual({ kind: 'spread', min: 1, median: 3, max: 9 });
    expect(gpaSpread([1, 2, 3, 4, 5, 9])).toEqual({ kind: 'spread', min: 1, median: 3.5, max: 9 });
  });
});

describe('합격선은 합격·충원합격만으로 내고, 빠진 것을 밝힌다', () => {
  const rows = rowsOf([
    app('a', '가', '교과', '합'),
    app('b', '가', '교과', '충원합격'),
    app('c', '가', '교과', '불'),
    app('d', '가', '교과', '합')
  ], { a: 1.5, b: 2.0, c: 1.1 });
  const group = summarize(rows, { keys: ['univ'], gpaKey: 'gpa.전교과' }).groups[0];

  it('불합격자의 내신은 합격선에 넣지 않는다', () => {
    expect(group.gpa).toEqual({ kind: 'list', values: [1.5, 2.0] });
  });

  it('합격했는데 내신이 빈 건수를 센다 — 「합격 3건, 1.5~2.0」이 실은 2건의 범위다', () => {
    expect(group.gpaBlank).toBe(1);
  });
});

describe('내신은 학생 단위로 센다', () => {
  it('한 학생이 같은 줄에 두 번 붙어도 내신은 한 번만 들어간다', () => {
    const rows = rowsOf([app('a', '가', '논술', '합'), app('a', '가', '논술', '합'), app('b', '가', '논술', '합')], { a: 2.68, b: 3.1 });
    expect(summarize(rows, { keys: ['univ'], gpaKey: 'gpa.전교과' }).groups[0].gpa).toEqual({ kind: 'list', values: [2.68, 3.1] });
  });
});

describe('1단계 불합격을 따로 센다', () => {
  it('미상 자리에 있지만 학부모 눈에는 곧 탈락이다', () => {
    const rows = rowsOf([app('a', '가', '종합', null, { stage1: '불' }), app('b', '가', '종합', '합')]);
    const group = summarize(rows, { keys: ['univ'], gpaKey: null }).groups[0];
    expect(group.stage1Fail).toBe(1);
    expect(group.tally.미상).toBe(1);
  });
});

describe('자료에 있을 때만 붙이는 칸', () => {
  it('등록 열이 없으면 칸을 만들지 않는다 — 빈 칸이 0처럼 보인다', () => {
    const summary = summarize(rowsOf([app('a', '가', '교과', '합')]), { keys: ['univ'], gpaKey: null });
    expect(summary.hasRegister).toBe(false);
    expect(summary.groups[0].registered).toBeNull();
  });

  it('등록 열이 있으면 합격한 사람 중 등록한 수를 센다', () => {
    const rows = rowsOf([
      app('a', '가', '교과', '합', { register: '등록' }),
      app('b', '가', '교과', '합', { register: '미등록' })
    ]);
    const summary = summarize(rows, { keys: ['univ'], gpaKey: null });
    expect(summary.hasRegister).toBe(true);
    expect(summary.groups[0].registered).toBe(1);
  });

  it('충원합격자의 가장 뒤 예비 순위를 낸다 — 몇 번까지 돌았나', () => {
    const rows = rowsOf([
      app('a', '가', '교과', '충원합격', { waitRank: 3 }),
      app('b', '가', '교과', '충원합격', { waitRank: '12' }),
      app('c', '가', '교과', '불', { waitRank: 40 })
    ]);
    const summary = summarize(rows, { keys: ['univ'], gpaKey: null });
    expect(summary.hasWaitRank).toBe(true);
    expect(summary.groups[0].maxWaitRank).toBe(12);
  });
});

describe('합친 고3 년도 범위를 돌려준다', () => {
  it('여러 해를 합쳤다는 사실이 숨지 않게 한다', () => {
    const rows = rowsOf([app('a', '가', '교과', '합', { cohortYear: 2023 }), app('b', '가', '교과', '합', { cohortYear: 2025 })]);
    expect(summarize(rows, { keys: ['univ'], gpaKey: null }).years).toEqual({ from: 2023, to: 2025 });
  });
});

describe('표 한 줄씩으로 편다 — 지원 목록과 같은 표로 그리기 위해', () => {
  const rows = rowsOf([app('a', '가', '교과', '합'), app('b', '가', '교과', '불')], { a: 2.1 });
  const summary = summarize(rows, { keys: ['univ', 'admType'], gpaKey: 'gpa.전교과' });

  it('숫자 칸에는 숫자만 담는다 — 글자가 섞이면 정렬이 뜻을 잃는다', async () => {
    const { summaryRows } = await import('../src/analysis/summary.js');
    const { rows: flat, fields } = summaryRows(summary, { keys: ['univ', 'admType'], gpaLabel: '전교과' });
    for (const field of fields.filter((item) => item.numeric)) {
      const value = flat[0][field.key];
      expect(value === null || typeof value === 'number', field.key).toBe(true);
    }
    // 판정 2건뿐이라 합격률은 비운다
    expect(flat[0]['sum.합격률']).toBeNull();
    expect(flat[0]['sum.판정']).toBe(2);
    expect(flat[0]['#values']).toEqual(['가', '교과']);
  });

  it('자료에 없는 칸은 열로 만들지 않는다', async () => {
    const { summaryRows } = await import('../src/analysis/summary.js');
    const { fields } = summaryRows(summary, { keys: ['univ'], gpaLabel: null });
    const keys = fields.map((field) => field.key);
    expect(keys).not.toContain('admType');
    expect(keys).not.toContain('sum.내신');
    expect(keys).not.toContain('sum.등록');
    expect(fields.find((field) => field.key === 'sum.학생').label).toBe('지원 학생 수');
  });
});
