/**
 * 필드 레지스트리 (§6).
 *
 * 화면에 어떤 열이 있는지를 **코드가 아니라 자료가 정한다.** 축 목록을 하드코딩하면
 * 내년 엑셀에 열이 하나 늘 때마다 코드를 고쳐야 하고, 그러면 §4가 무너진다.
 *
 * 그래서 불러온 행을 훑어 열마다 무엇인지 — 어떤 값이 몇 가지 있는지, 숫자인지 —
 * 를 직접 알아낸다. `extra`로 보존한 미지 열도 똑같이 등록되므로 그대로 정렬·필터·축이 된다.
 */

import fields from '../dict/fields.json' with { type: 'json' };
import { outcomeLabel } from '../core/outcome.js';

const SCALAR_LABEL = new Map(fields.scalars.map((field) => [field.key, field.label]));
const SCALAR_GROUP = new Map(fields.scalars.map((field) => [field.key, field.group]));

/**
 * 원본 엑셀에 없는 열들 — 우리가 만든 것과 출처 표시.
 * 사전(fields.json)은 엑셀에서 읽어 오는 열만 다루므로 여기서 이름을 준다.
 */
const DERIVED = {
  sid: { label: '익명 ID', group: 'student', type: 'text' },
  outcome: { label: '결과', group: 'application', type: 'enum' },
  registered: { label: '등록', group: 'application', type: 'enum' },
  stage1Passed: { label: '1단계 통과', group: 'application', type: 'enum' },
  sourceFile: { label: '원본 파일', group: 'source', type: 'text' }
};

/** 열 묶음이 화면에 늘어서는 순서. */
export const GROUP_ORDER = ['student', 'application', 'gpa', 'suneung', 'extra', 'source'];

export const GROUP_LABEL = {
  student: '학생',
  application: '지원',
  gpa: '내신',
  suneung: '수능',
  extra: '원본 그대로',
  source: '출처'
};

/**
 * 열 하나가 어느 묶음에 속하는지.
 * @param {string} key
 */
function groupOf(key) {
  const head = key.split('.')[0];
  if (head === 'gpa' || head === 'suneung' || head === 'extra') return head;
  if (key === 'sourceFile') return 'source';
  return DERIVED[key]?.group ?? SCALAR_GROUP.get(key) ?? 'extra';
}

/**
 * 사람이 읽을 열 이름.
 *
 * 사전에 있으면 사전 이름을, 없으면 **원본 헤더 이름 그대로** 쓴다.
 * 모르는 열에 그럴듯한 이름을 지어 붙이면 그 열이 무엇인지 영영 알 수 없게 된다.
 *
 * @param {string} key
 */
export function fieldLabel(key) {
  if (DERIVED[key]) return DERIVED[key].label;
  if (SCALAR_LABEL.has(key)) return SCALAR_LABEL.get(key);

  const parts = key.split('.');
  if (parts[0] === 'gpa') return parts.slice(1).join('.');
  if (parts[0] === 'extra') return parts.slice(1).join('.');
  if (parts[0] === 'suneung') {
    const partLabel = { subject: '과목', stdScore: '표점', percentile: '백분위', grade: '등급' };
    return `${parts[1]} ${partLabel[parts[2]] ?? parts[2]}`;
  }
  return key;
}

/** 값이 비었는지. 빈 문자열과 null을 한 가지로 본다. */
export function isBlank(value) {
  return value === null || value === undefined || value === '';
}

/** enum 값을 화면 말로 바꾼다. */
export function valueLabel(key, value) {
  // 1단계는 통과·탈락·해당 없음 셋이고, 셋째가 `null`이다.
  // 빈칸으로 접으면 "1단계가 없는 전형"과 "아직 안 적힌 칸"이 한 덩어리가 된다
  if (key === 'stage1Passed') return value === true ? '통과' : value === false ? '탈락' : '해당 없음';
  if (isBlank(value)) return '(빈칸)';
  if (key === 'outcome') return outcomeLabel(String(value));
  if (key === 'registered') return outcomeLabel(String(value));
  return String(value);
}

/** 값이 몇 가지나 되면 목록 대신 검색으로 고르게 할지. */
const MANY_VALUES = 40;

/**
 * @typedef {object} Field
 * @property {string} key
 * @property {string} label
 * @property {string} group
 * @property {'number'|'text'|'enum'|'year'} type
 * @property {number} filled 값이 있는 행 수
 * @property {number} cardinality 서로 다른 값의 가짓수
 * @property {{value: unknown, count: number}[]} values 값과 건수. 가짓수가 많으면 잘려 있다
 * @property {boolean} truncated 값 목록이 잘렸는지
 * @property {{min: number, max: number}|null} range 숫자 열의 범위
 * @property {boolean} numeric 숫자로 다룰 수 있는지 (정렬·산점도 축)
 */

/**
 * 행들을 훑어 열 목록을 만든다.
 *
 * @param {object[]} rows
 * @returns {Field[]}
 */
export function buildRegistry(rows) {
  /** @type {Map<string, {counts: Map<unknown, number>, filled: number, numbers: number, min: number, max: number}>} */
  const stats = new Map();

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      // `#`로 시작하는 것은 화면 내부용이다 (원본 결과 객체 등)
      if (key.startsWith('#')) continue;
      let stat = stats.get(key);
      if (!stat) {
        stat = { counts: new Map(), filled: 0, numbers: 0, min: Infinity, max: -Infinity };
        stats.set(key, stat);
      }
      if (isBlank(value)) continue;
      stat.filled += 1;
      stat.counts.set(value, (stat.counts.get(value) ?? 0) + 1);
      if (typeof value === 'number' && Number.isFinite(value)) {
        stat.numbers += 1;
        if (value < stat.min) stat.min = value;
        if (value > stat.max) stat.max = value;
      }
    }
  }

  const list = [];
  for (const [key, stat] of stats) {
    // 값이 전부 숫자일 때만 숫자 열로 본다. 하나라도 글자가 섞이면
    // 크기 비교가 뜻을 잃는다 ('-'가 섞인 열이 실제로 있다)
    const numeric = stat.filled > 0 && stat.numbers === stat.filled;
    const declared = DERIVED[key]?.type ?? (SCALAR_LABEL.has(key)
      ? fields.scalars.find((field) => field.key === key)?.type
      : null);
    const type = declared ?? (numeric ? 'number' : 'text');

    const sorted = [...stat.counts.entries()]
      .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), 'ko'));

    list.push({
      key,
      label: fieldLabel(key),
      group: groupOf(key),
      type,
      filled: stat.filled,
      cardinality: stat.counts.size,
      values: sorted.slice(0, MANY_VALUES).map(([value, count]) => ({ value, count })),
      truncated: sorted.length > MANY_VALUES,
      range: numeric && stat.filled > 0 ? { min: stat.min, max: stat.max } : null,
      numeric
    });
  }

  const groupRank = (field) => {
    const index = GROUP_ORDER.indexOf(field.group);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  return list.sort((left, right) => groupRank(left) - groupRank(right)
    || left.label.localeCompare(right.label, 'ko'));
}

/**
 * 표를 처음 열었을 때 보일 열.
 *
 * 대교협은 81열이다. 전부 표시해 놓고 시작하면 아무것도 읽을 수 없다.
 * 상담에서 먼저 보는 것부터 내놓고 나머지는 열 선택으로 켜게 한다.
 *
 * @param {Field[]} registry
 * @returns {string[]}
 */
export function defaultColumns(registry) {
  const has = new Set(registry.map((field) => field.key));
  const gpa = primaryGpaField(registry);

  // 앞의 셋은 좌측에 고정되므로(prefs.js), **넷째가 가로로 밀어도 처음 보이는 열**이다.
  // 상담에서 대학 다음에 보는 것은 합·불과 내신이지 모집단위가 아니다.
  return [
    'sid', 'cohortYear', 'univ',
    'outcome', gpa?.key, 'dept', 'track', 'admType', 'admName', 'stage1'
  ].filter((key) => key && has.has(key));
}

/**
 * 내신 조합 하나를 대표로 정한다.
 *
 * 조합이 스무 개 넘게 오는 양식이 있어서 전부 표시할 수 없다. 전과목 평균을 먼저 찾는다 —
 * 반영 조합 중 하나를 무작정 고르면 '과학 6.88'처럼 그 학생을 대표하지 않는 값이
 * 첫눈에 들어온다. 양식마다 이름이 `전교과`이기도 `전과목`이기도 하다.
 *
 * @param {Field[]} registry
 * @returns {Field|undefined}
 */
export function primaryGpaField(registry) {
  const candidates = registry.filter((field) => field.group === 'gpa' && field.filled > 0);
  return candidates.find((field) => /^gpa\.(전교과|전과목)$/.test(field.key))
    ?? [...candidates].sort((left, right) => right.filled - left.filled)[0];
}
