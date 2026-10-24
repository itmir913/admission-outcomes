/**
 * 대학×전형 요약표의 계산 (roadmap.md 1단계).
 *
 * **표와 같은 행 집합을 받는다.** 지금 걸린 필터·검색을 거친 `applyQuery` 결과를 그대로
 * 넘겨야 요약표의 합계가 요약 띠와 같아진다. 여기서 조건을 따로 두면 같은 자료가 두
 * 조건으로 세어지고, 어긋나도 아무도 모른다 (§5).
 *
 * 판정은 요약 띠와 같은 `tallyOutcomes`로 센다. 한쪽만 고쳐도 숫자가 어긋나는 일을 막는다.
 */

import { tallyOutcomes, passRate, ratePercent } from '../ui/outcome.js';
import { STAGE1_FAIL_LABEL } from '../core/outcome.js';
import { isBlank, formatNumber } from './registry.js';

/** 이보다 적으면 비율을 내지 않고, 내신은 범위 대신 값을 늘어놓는다 */
export const SMALL_SAMPLE = 5;

/** 묶음 기준. 대학만으로 묶으면 학종·교과·논술 합격자의 내신이 한 범위에 섞인다 */
export const GROUPINGS = {
  univAdm: { label: '대학×전형', keys: ['univ', 'admType'] },
  univ: { label: '대학', keys: ['univ'] }
};

const 숫자 = (value) => {
  if (isBlank(value)) return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
};

/**
 * 합격선에 쓰는 내신 값들을 적을 모양으로 바꾼다.
 *
 * 5건 미만이면 **값을 그대로 늘어놓는다.** 범위로 적으면 1~2건이 「선」처럼 보인다.
 * 5건 이상이면 최저·중앙값·최고. 최저~최고만 적으면 특별전형 한 건이 범위를 끌고 간다.
 *
 * @param {number[]} values
 * @returns {{kind: 'none'} | {kind: 'list', values: number[]} | {kind: 'spread', min: number, median: number, max: number}}
 */
export function gpaSpread(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return { kind: 'none' };
  if (sorted.length < SMALL_SAMPLE) return { kind: 'list', values: sorted };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { kind: 'spread', min: sorted[0], median, max: sorted[sorted.length - 1] };
}

/**
 * 행을 묶어 센다.
 *
 * @param {object[]} rows 필터·검색을 거친 행
 * @param {object} options
 * @param {string[]} options.keys 묶음 열
 * @param {string|null} options.gpaKey 합격선에 쓸 내신 열. 없으면 내신 칸을 비운다
 */
export function summarize(rows, { keys, gpaKey }) {
  /** @type {Map<string, {values: unknown[], rows: object[]}>} */
  const groups = new Map();
  for (const row of rows) {
    const values = keys.map((key) => (isBlank(row[key]) ? null : row[key]));
    // 구분자는 셀 값에 나올 수 없는 글자로 둔다. `A|B`라는 대학명이 두 칸으로 나뉘지 않게
    const id = values.map((value) => String(value ?? '')).join('\u001f');
    const group = groups.get(id) ?? { values, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }

  // 자료에 그 열이 해석되어 있을 때만 칸을 만든다. 빈 칸이 늘어선 열은 「0」처럼 보인다
  const hasRegister = rows.some((row) => row.registered && row.registered !== 'none');
  const hasWaitRank = rows.some((row) => 숫자(row.waitRank) !== null);

  const result = [...groups.values()].map(({ values, rows: members }) => {
    const tally = tallyOutcomes(members);
    const passed = members.filter((row) => row['#outcome']?.code === 'pass' || row['#outcome']?.code === 'waitPass');
    const gpaValues = [];
    let gpaBlank = 0;
    if (gpaKey) {
      /*
       * **내신은 학생마다 한 번만 센다.** 내신은 지원 건이 아니라 학생에 붙은 값이라,
       * 한 학생이 같은 줄에 두 번 붙으면 같은 값이 두 번 들어가 「2.68 · 2.68」이 되고
       * 5명 기준도 실제보다 커진다.
       */
      const seen = new Set();
      for (const row of passed) {
        if (row.sid) {
          if (seen.has(row.sid)) continue;
          seen.add(row.sid);
        }
        const value = 숫자(row[gpaKey]);
        if (value === null) gpaBlank += 1;
        else gpaValues.push(value);
      }
    }
    const waitRanks = members
      .filter((row) => row['#outcome']?.code === 'waitPass')
      .map((row) => 숫자(row.waitRank))
      .filter((value) => value !== null);
    const judged = tally.합격 + tally.충원합격 + tally.불합격;
    return {
      values,
      rows: members,
      tally,
      // 1단계 불합격은 판정 미상 자리에 있다(분모를 맞추려고). 학부모 눈에는 곧 탈락이라 따로 센다
      stage1Fail: members.filter((row) => row['#outcome']?.label === STAGE1_FAIL_LABEL).length,
      judged,
      // 표본이 적으면 비율을 내지 않는다. 1/1 = 100%가 합격선처럼 보인다
      rate: judged < SMALL_SAMPLE ? null : passRate(tally),
      gpa: gpaKey ? gpaSpread(gpaValues) : null,
      gpaBlank,
      registered: hasRegister && passed.length > 0 ? passed.filter((row) => row.registered === 'registered').length : null,
      maxWaitRank: hasWaitRank && waitRanks.length > 0 ? Math.max(...waitRanks) : null
    };
  });

  const years = rows.map((row) => 숫자(row.cohortYear)).filter((year) => year !== null);
  return {
    groups: result,
    hasRegister,
    hasWaitRank,
    years: years.length === 0 ? null : { from: Math.min(...years), to: Math.max(...years) }
  };
}

/**
 * 묶음 결과를 표 한 줄씩으로 편다. 지원 목록과 **같은 표 컴포넌트**로 그리기 위해서다 —
 * 정렬·열 너비·열 순서·열 고정을 두 표에서 똑같이 다뤄야 상담 중에 손이 헷갈리지 않는다.
 *
 * 숫자 칸에는 **숫자만** 담는다. 「표본 2건」 같은 글자를 섞으면 그 열의 정렬이 뜻을 잃는다.
 * 비율을 내지 않은 자리는 빈칸이고, 왜 빈칸인지는 「최종 판정」 칸과 각주가 말한다.
 *
 * @param {ReturnType<typeof summarize>} summary
 * @param {{keys: string[], gpaLabel: string|null}} options
 * @returns {{rows: object[], fields: {key: string, label: string, group: string, type: string, numeric: boolean}[]}}
 */
export function summaryRows(summary, { keys, gpaLabel }) {
  const 숫자칸 = (key, label) => ({ key, label, group: 'summary', type: 'number', numeric: true });
  const fields = [
    ...keys.map((key) => ({ key, label: key === 'univ' ? '대학' : '전형', group: 'summary', type: 'text', numeric: false })),
    숫자칸('sum.지원', '지원 건수'),
    숫자칸('sum.학생', '지원 학생 수'),
    숫자칸('sum.합격', '● 합격'),
    숫자칸('sum.충원합격', '△ 충원합격'),
    숫자칸('sum.불합격', '✕ 불합격'),
    숫자칸('sum.1단계불합격', '1단계 불합격'),
    숫자칸('sum.판정', '최종 판정'),
    숫자칸('sum.합격률', '합격률(%)'),
    ...(gpaLabel ? [
      { key: 'sum.내신', label: `합격자 내신 (${gpaLabel})`, group: 'summary', type: 'text', numeric: false },
      숫자칸('sum.내신빈칸', '내신 빈칸')
    ] : []),
    ...(summary.hasRegister ? [숫자칸('sum.등록', '등록')] : []),
    ...(summary.hasWaitRank ? [숫자칸('sum.예비순위', '충원 예비순위(최대)')] : [])
  ];

  const 내신글자 = (gpa) => {
    if (!gpa || gpa.kind === 'none') return null;
    if (gpa.kind === 'list') return gpa.values.map(formatNumber).join(' · ');
    return `${formatNumber(gpa.min)} / 중앙 ${formatNumber(gpa.median)} / ${formatNumber(gpa.max)}`;
  };

  const rows = summary.groups.map((group) => {
    const row = { '#values': group.values };
    keys.forEach((key, index) => { row[key] = group.values[index]; });
    row['sum.지원'] = group.tally.지원;
    row['sum.학생'] = group.tally.학생;
    row['sum.합격'] = group.tally.합격;
    row['sum.충원합격'] = group.tally.충원합격;
    row['sum.불합격'] = group.tally.불합격;
    row['sum.1단계불합격'] = group.stage1Fail;
    row['sum.판정'] = group.judged;
    // 소수 첫째 자리까지만 — 표본이 수십 건인 자리에서 그 아래 자릿수는 뜻이 없다
    // 요약 띠와 같은 함수로 적는다. 따로 반올림하면 .x5 자리에서 0.1씩 어긋난다
    row['sum.합격률'] = group.rate === null ? null : ratePercent(group.tally);
    if (gpaLabel) {
      row['sum.내신'] = 내신글자(group.gpa);
      row['sum.내신빈칸'] = group.gpaBlank;
    }
    if (summary.hasRegister) row['sum.등록'] = group.registered;
    if (summary.hasWaitRank) row['sum.예비순위'] = group.maxWaitRank;
    return row;
  });
  return { rows, fields };
}
