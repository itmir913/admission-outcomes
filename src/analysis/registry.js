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

/**
 * 숫자 하나를 화면 글자로.
 *
 * 표와 검색과 값 목록이 **같은 글자**를 써야 한다. 표에는 2.35가 보이는데 검색이
 * 2.345만 받으면, 보고 그대로 친 사람에게 「그런 건이 없다」고 답한다 (§5).
 */
export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '');
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * 값 목록 한 줄의 이름. **그 줄이 무엇을 품고 있는지까지 적는다.**
 *
 * 결과 열은 저장값 하나에 화면 글자가 여럿 달린다 — `none`에는 「기록 없음」과
 * 「1단계 불합격」이, `unknown`에는 사전에 없는 표기들이 섞인다. 묶인 이름만
 * 적으면, 표에서 본 말로 목록을 찾은 사람은 그런 항목이 없다고 읽는다. 읽지
 * 못한 표기는 사람이 사전에 넣어야 할 말이라 더욱 보여야 한다 (§5).
 *
 * @param {string} key
 * @param {unknown} value
 * @param {string[]} 품은글자 그 줄에 묶인 행들의 화면 글자
 * @returns {{label: string, terms: string[]}} 적을 이름과, 목록 안 찾기가 함께 볼 말들
 */
export function bucketLabel(key, value, 품은글자 = []) {
  const 바탕 = valueLabel(key, value);
  const 섞인것 = [...new Set(품은글자.filter((text) => text && text !== 바탕))];
  if (섞인것.length === 0) return { label: 바탕, terms: [바탕] };
  /*
   * 전부가 그 표기인 줄(`unknown`)과 일부만 그런 줄(`none`)은 다르게 적는다.
   * 「기록 없음(1단계 불합격)」은 그 줄 전부가 1단계 탈락이라는 뜻이 되어 버린다.
   */
  // 비어 있거나 알 수 없는 글자가 섞이면 「전부」라고 단정하지 않는다
  const 전부 = 품은글자.length > 0 && 품은글자.every((text) => text && text !== 바탕);
  const 보일것 = 섞인것.slice(0, 2).join('·');
  const 나머지 = 섞인것.length > 2 ? ` 외 ${섞인것.length - 2}` : '';
  return {
    label: `${바탕}(${보일것}${나머지}${전부 ? '' : ' 포함'})`,
    // 「외 2」로 접힌 표기도 목록 안 찾기로 찾을 수 있어야 한다
    terms: [바탕, ...섞인것]
  };
}

/** enum 값을 화면 말로 바꾼다. */
export function valueLabel(key, value) {
  // 1단계는 통과·탈락·해당 없음 셋이고, 셋째가 `null`이다.
  // 빈칸으로 접으면 "1단계가 없는 전형"과 "아직 안 적힌 칸"이 한 덩어리가 된다
  if (key === 'stage1Passed') return value === true ? '통과' : value === false ? '탈락' : '해당 없음';
  if (isBlank(value)) return '(빈칸)';
  if (key === 'outcome') return outcomeLabel(String(value));
  if (key === 'registered') return outcomeLabel(String(value));
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

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
      /*
       * **화면에 적히는 글자로 센다.**
       *
       * 같은 열이 파일에 따라 숫자 `10`과 글자 `'10'`으로 올 때가 있다. 값 그대로
       * 세면 한 가지가 두 가지로 보이고, 값 목록에 똑같이 적힌 두 줄이 생긴다.
       */
      const bucket = valueLabel(key, value);
      const seen = stat.counts.get(bucket);
      stat.counts.set(bucket, { value: seen?.value ?? value, count: (seen?.count ?? 0) + 1 });
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

    list.push({
      key,
      label: fieldLabel(key),
      group: groupOf(key),
      type,
      filled: stat.filled,
      cardinality: stat.counts.size,
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
