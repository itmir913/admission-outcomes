/**
 * 필터 · 검색 · 정렬 (§6, §7).
 *
 * 순수 함수만 둔다. 화면이 없어도 검증할 수 있어야 하는 계층이다 —
 * 여기가 조용히 틀리면 표에 뜬 스무 건이 사실은 다른 스무 건이 된다.
 *
 * **축과 필터에 개수 제한을 두지 않는다.** 필터는 배열이고, 정렬 키도 배열이다.
 */

import { isBlank, valueLabel } from './registry.js';

/**
 * @typedef {object} Filter
 * @property {string} key 어느 열인지
 * @property {'in'|'range'|'blank'|'filled'} op
 * @property {unknown[]} [values] `in`일 때 선택한 값들
 * @property {number|null} [min] `range`일 때 하한 (포함)
 * @property {number|null} [max] `range`일 때 상한 (포함)
 */

/**
 * @typedef {object} Sort
 * @property {string} key
 * @property {'asc'|'desc'} dir
 */

/**
 * 그 칸에 **실제로 그려진 글자.**
 *
 * 결과 열은 저장값(`fail`)도 이름표(`불합격`)도 아닌 제3의 글자가 보일 때가 있다 —
 * 「1단계 불합격」, 그리고 읽지 못한 표기는 원문 그대로. 화면에 적힌 말로 찾았는데
 * 행이 사라지면 사람은 「그런 건이 없다」로 읽는다.
 */
function 화면글자(row, key, value) {
  const outcome = row?.['#outcome'];
  if (key === 'outcome' && outcome?.label) return String(outcome.label);
  return valueLabel(key, value);
}

/**
 * 필터 하나가 행 하나를 통과시키는지.
 * @param {object} row
 * @param {Filter} filter
 */
/**
 * 선택한 값들의 라벨. 같은 목록으로 수천 행을 거르므로 한 번만 만든다.
 *
 * **키는 `values` 배열이다.** 필터 객체를 키로 두면 「필터를 제자리에서 고치지
 * 않는다」가 적히지 않은 불변식이 되고, 어기는 날 예외도 테스트 실패도 없이
 * 거르는 결과만 틀린다. 배열을 키로 두면 `filter.values = […]`가 캐시 미스가 된다.
 */
const 라벨집합 = new WeakMap();

export function matchesFilter(row, filter) {
  const value = row[filter.key];

  if (filter.op === 'blank') return isBlank(value);
  if (filter.op === 'filled') return !isBlank(value);

  if (filter.op === 'range') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (filter.min !== null && filter.min !== undefined && value < filter.min) return false;
    if (filter.max !== null && filter.max !== undefined && value > filter.max) return false;
    return true;
  }

  /*
   * `contains`. 열 이름 줄의 열별 검색칸이 쓴다.
   *
   * 화면에 보이는 글자로 찾는다 — `outcome`처럼 저장값(`pass`)과 화면 글자(`합격`)가
   * 다른 열이 있어서, 저장값으로 찾으면 사람이 본 적 없는 말을 적어야 한다.
   */
  if (filter.op === 'contains') {
    const needle = String(filter.text ?? '').trim().toLowerCase();
    if (needle === '') return true;
    // 1단계의 `null`은 빈칸이 아니라 「해당 없음」이다. 표에 그렇게 적혀 있으므로 찾혀야 한다
    if (isBlank(value) && !뜻순서[filter.key]) return false;
    return 화면글자(row, filter.key, value).toLowerCase().includes(needle);
  }

  // `in`. 선택한 것이 없으면 아무것도 거르지 않는다 —
  // 빈 목록을 "전부 제외"로 읽으면 체크를 다 해제했을 때 화면이 갑자기 빈다
  const chosen = filter.values ?? [];
  if (chosen.length === 0) return true;
  // 빈칸을 선택할 수 있어야 한다. `null`과 `''`을 한 가지로 본다
  if (isBlank(value)) return chosen.some((candidate) => isBlank(candidate));
  /*
   * **값 목록에 적힌 글자로 견준다.**
   *
   * 값 목록은 화면 글자로 묶어 세는데(`facetCounts`) 거르는 쪽이 원값을 보면,
   * 「2건」이라 적힌 줄을 눌렀을 때 1행만 남는다 — 2.345와 2.344는 표에도 목록에도
   * 같은 2.35로 적히지만 원값은 다르다. 세는 기준과 거르는 기준은 하나여야 한다.
   */
  const label = valueLabel(filter.key, value);
  // 선택값마다 라벨을 다시 만들면 셈이 행 × 선택 수가 된다. 한 번 만들어 둔다
  let labels = 라벨집합.get(chosen);
  if (!labels) {
    labels = new Set(chosen.filter((candidate) => !isBlank(candidate))
      .map((candidate) => valueLabel(filter.key, candidate)));
    라벨집합.set(chosen, labels);
  }
  return labels.has(label);
}

/**
 * 검색어를 낱말로 나눈다. 여러 낱말은 모두 포함(AND)이다.
 * @param {string} text
 */
export function searchTokens(text) {
  return String(text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * 행을 검색 대상 문자열 하나로 눕힌다.
 *
 * 화면에 보이는 말로 찾을 수 있어야 한다. `pass`가 아니라 `합격`으로 친다.
 *
 * @param {object} row
 * @param {string[]} keys 훑을 열. 주지 않으면 행의 모든 열
 */
export function searchHaystack(row, keys) {
  const list = keys ?? Object.keys(row).filter((key) => !key.startsWith('#'));
  const parts = [];
  for (const key of list) {
    const value = row[key];
    // 뜻이 있는 열의 빈칸은 「해당 없음」처럼 화면에 글자가 적힌다. 건너뛰면 그 글자로 못 찾는다
    if (isBlank(value) && !뜻순서[key]) continue;
    const label = 화면글자(row, key, value);
    parts.push(label.toLowerCase());
    /*
     * **저장 코드는 훑지 않는다.** `pass`·`none` 같은 글자는 화면 어디에도 적혀
     * 있지 않은데, 그걸로 검색이 걸리면 사람이 본 적 없는 말로 행이 걸러진다.
     * 글자 그대로 보관한 열(`extra`)은 이름표가 곧 원문이라 그대로 걸린다.
     */
    if (!뜻순서[key] && label !== String(value)) parts.push(String(value).toLowerCase());
  }
  return parts.join(' ');
}

/*
 * 뜻에 차례가 있는 열들.
 *
 * 저장값을 글자순으로 세우면 불합격이 합격 위에 오고(`fail` < `pass`), 등록 열은
 * 포기가 맨 위에 등록이 맨 아래에 선다(`declined` < `none` < `registered`).
 * 어느 쪽도 사람이 기대하는 차례가 아니고, 틀려도 틀린 티가 나지 않는다 (§5).
 */
/*
 * 이 목록은 세 가지를 한꺼번에 뜻한다. 열을 더할 때 셋을 다 생각해야 한다.
 *   1. 정렬 차례가 글자순이 아니라 여기 적힌 차례다
 *   2. 빈칸에도 화면에 적히는 글자가 있다 (검색이 그 글자를 훑는다)
 *   3. 저장 코드(`pass`·`none`)는 검색에서 훑지 않는다
 */
const 뜻순서 = {
  outcome: ['pass', 'waitPass', 'fail', 'unknown', 'none'],
  registered: ['registered', 'declined', 'unknown', 'none'],
  stage1Passed: [true, false, null]
};
/**
 * **뜻 순서가 정해진 열인가.** 값 목록을 그 순서로 세우는 쪽(`filters.js`)도 이 답을 쓴다 —
 * 순서를 두 군데 적어 두면 표와 목록이 서로 다른 차례로 서는 날이 온다.
 */
export const 뜻있는열 = (key) => Boolean(뜻순서[key]);

export const 뜻차례 = (key, value) => {
  const order = 뜻순서[key];
  const at = order.findIndex((item) => item === value || String(item) === String(value));
  return at === -1 ? order.length : at;
};

/**
 * 값이 있는 것끼리 견준다. 빈칸 처리는 방향을 뒤집기 전에 따로 한다.
 */
/** 비교마다 새로 만들면 1만 행 정렬이 0.5초를 넘는다. 한 번 만들어 쓴다 */
const 한글순서 = new Intl.Collator('ko', { numeric: true });

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return Number(right === true) - Number(left === true);
  }
  return 한글순서.compare(String(left), String(right));
}

/**
 * 여러 정렬 키를 차례로 적용한다.
 *
 * 앞선 키가 같을 때만 다음 키를 본다. 그래서 Shift+클릭으로 쌓은 차순위 정렬이
 * 헤더의 `①②③` 순번 그대로 동작한다.
 *
 * @param {object[]} rows
 * @param {Sort[]} sorts
 * @returns {object[]} 새 배열. 입력을 건드리지 않는다
 */
export function sortRows(rows, sorts = []) {
  if (sorts.length === 0) return [...rows];
  // 정렬 키가 전부 같은 행끼리는 원래 순서를 지킨다.
  // 원본 순서가 곧 엑셀의 행 순서여서, 흔들리면 사람이 표를 못 믿는다
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const sort of sorts) {
        const leftValue = left.row[sort.key];
        const rightValue = right.row[sort.key];

        // 빈칸은 언제나 뒤로 보낸다. **방향을 뒤집기 전에** 나눈다 —
        // 뒤집는 쪽에 빈칸 처리를 맡기면 내림차순에서 빈칸이 맨 위를 덮는다
        const leftBlank = isBlank(leftValue);
        const rightBlank = isBlank(rightValue);
        if (leftBlank || rightBlank) {
          if (leftBlank && rightBlank) continue;
          return leftBlank ? 1 : -1;
        }

        const order = 뜻순서[sort.key]
          ? 뜻차례(sort.key, leftValue) - 뜻차례(sort.key, rightValue)
          : compareValues(leftValue, rightValue);
        if (order !== 0) return sort.dir === 'desc' ? -order : order;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

/**
 * 헤더를 눌렀을 때 정렬 목록이 어떻게 바뀌는지.
 *
 * 한 번 누르면 오름차순 → 다시 누르면 내림차순 → 또 누르면 해제.
 *
 * **그냥 누르면 쌓인다.** 먼저 누른 열이 1순위, 그다음이 2순위다. 쌓는 데 Shift를
 * 요구하면 그런 조작이 있다는 것을 아무도 모르고, 그러면 다중 정렬은 없는 기능이다.
 * Shift는 반대로 "이 열만 보고 싶다"에 쓴다.
 *
 * @param {Sort[]} sorts 지금 정렬 목록
 * @param {string} key 누른 열
 * @param {boolean} only Shift를 누른 채였는지 — 이 열만 남긴다
 * @returns {Sort[]}
 */
export function toggleSort(sorts, key, only = false) {
  if (only) {
    const current = sorts.find((sort) => sort.key === key);
    if (!current) return [{ key, dir: 'asc' }];
    return current.dir === 'asc' ? [{ key, dir: 'desc' }] : [];
  }

  const at = sorts.findIndex((sort) => sort.key === key);
  // 처음 누른 열이 1순위, 그다음이 2순위다. 새 열은 늘 맨 뒤에 붙는다
  if (at === -1) return [...sorts, { key, dir: 'asc' }];

  if (sorts[at].dir === 'asc') {
    // **자리를 지킨 채 방향만 뒤집는다.** 뒤로 밀어내면 방향 하나를 바꿨을 뿐인데
    // 정렬 순위가 통째로 달라져서, 표가 왜 저렇게 섞였는지 설명할 수 없게 된다
    const next = [...sorts];
    next[at] = { key, dir: 'desc' };
    return next;
  }
  return sorts.filter((sort) => sort.key !== key);
}

/**
 * 필터 · 검색 · 정렬을 한 번에 적용한다.
 *
 * @param {object[]} rows
 * @param {{filters?: Filter[], search?: string, sorts?: Sort[], searchKeys?: string[]}} query
 * @returns {object[]}
 */
export function applyQuery(rows, { filters = [], search = '', sorts = [], searchKeys } = {}) {
  const tokens = searchTokens(search);

  const kept = rows.filter((row) => {
    for (const filter of filters) {
      if (!matchesFilter(row, filter)) return false;
    }
    if (tokens.length === 0) return true;
    const haystack = searchHaystack(row, searchKeys);
    return tokens.every((token) => haystack.includes(token));
  });

  return sortRows(kept, sorts);
}

/**
 * 어떤 열의 값마다 지금 몇 건이 남는지 센다.
 *
 * **그 열에 걸린 필터는 빼고** 센다. 빼지 않으면 이미 선택한 값만 건수가 남고
 * 나머지가 전부 0으로 보여서, 조건을 넓히려는 사람이 갈 곳을 잃는다.
 *
 * @param {object[]} rows
 * @param {Filter[]} filters
 * @param {string} key
 * @param {{search?: string, searchKeys?: string[]}} [context]
 * @returns {Map<unknown, number>}
 */
export function facetCounts(rows, filters, key, options = {}) {
  return new Map([...facetBuckets(rows, filters, key, options)]
    .map(([value, bucket]) => [value, bucket.count]));
}

/**
 * 값마다 **건수와 그 줄이 품은 화면 글자**를 함께 센다.
 *
 * 값 목록은 한 줄에 화면 글자가 여럿 묶일 수 있어(`none`에 「기록 없음」과
 * 「1단계 불합격」), 그 줄이 무엇을 품었는지를 이름에 적는다. 그 말을 건수와
 * **다른 행 집합**에서 모으면, 필터를 거는 순간 「포함」이라는 단정이 틀린다 —
 * 2건이 전부 1단계 탈락인데 「일부만 그렇다」고 적는 식이다 (§5).
 *
 * @param {object[]} rows
 * @param {Filter[]} filters
 * @param {string} key
 * @param {{search?: string, searchKeys?: string[]}} [context]
 * @returns {Map<unknown, {count: number, texts: string[]}>}
 */
export function facetBuckets(rows, filters, key, { search = '', searchKeys } = {}) {
  /*
   * 이 열의 **값 선택만** 뺀다. 같은 열의 열 이름 줄 검색(`contains`)은 남겨 둬야
   * 옆에 적는 건수가 눌렀을 때 남는 행 수와 맞는다 — 「3건」이라 적힌 것을 눌렀더니
   * 표가 비는 일이 여기서 났다. 값 선택을 거는 쪽도 같은 열의 검색은 지우지 않는다.
   */
  const others = filters.filter((filter) => filter.key !== key || filter.op === 'contains');
  const tokens = searchTokens(search);
  /** @type {Map<string, {value: unknown, count: number, texts: Set<string>}>} */
  const counts = new Map();

  for (const row of rows) {
    let passes = true;
    for (const filter of others) {
      if (!matchesFilter(row, filter)) { passes = false; break; }
    }
    if (!passes) continue;
    if (tokens.length > 0) {
      const haystack = searchHaystack(row, searchKeys);
      if (!tokens.every((token) => haystack.includes(token))) continue;
    }
    /*
     * **화면 글자로 묶는다.** 숫자 `10`과 글자 `'10'`은 화면에서 한 줄이고,
     * 거르는 쪽도 둘을 함께 통과시킨다(아래 `in` 비교). 값 그대로 세면 똑같이
     * 적힌 두 줄이 생기고, 어느 줄을 눌러도 적힌 건수보다 많은 행이 남는다.
     */
    const value = isBlank(row[key]) ? null : row[key];
    const bucket = value === null ? '' : valueLabel(key, value);
    const seen = counts.get(bucket);
    // 글자는 **서로 다른 것만** 모은다. 대개 한 바구니의 글자는 다 같아서, 행마다 쌓으면 자리만 먹는다
    const texts = seen?.texts ?? new Set();
    texts.add(화면글자(row, key, value));
    counts.set(bucket, { value: seen?.value ?? value, count: (seen?.count ?? 0) + 1, texts });
  }
  // 바구니는 묶는 데만 쓴다. 바깥은 대표값으로 받는다
  return new Map([...counts.values()]
    .map((entry) => [entry.value, { count: entry.count, texts: [...entry.texts] }]));
}

/**
 * 지금 걸린 필터를 사람이 읽을 문장으로 바꾼다. 상단 칩에 쓴다.
 * @param {Filter} filter
 * @param {string} label 열 이름
 */
export function describeFilter(filter, label) {
  if (filter.op === 'contains') return `${label}: "${String(filter.text ?? '').trim()}" 포함`;
  if (filter.op === 'blank') return `${label}: 빈칸만`;
  if (filter.op === 'filled') return `${label}: 값 있는 것만`;
  if (filter.op === 'range') {
    const min = filter.min ?? null;
    const max = filter.max ?? null;
    if (min !== null && max !== null) return `${label} ${min} ~ ${max}`;
    if (min !== null) return `${label} ${min} 이상`;
    if (max !== null) return `${label} ${max} 이하`;
    return `${label}: 전체`;
  }
  const values = filter.values ?? [];
  if (values.length === 0) return `${label}: 전체`;
  const shown = values.slice(0, 3).map((value) => valueLabel(filter.key, value)).join(', ');
  return values.length > 3 ? `${label}: ${shown} 외 ${values.length - 3}` : `${label}: ${shown}`;
}
