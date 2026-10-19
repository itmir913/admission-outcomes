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
 * 필터 하나가 행 하나를 통과시키는지.
 * @param {object} row
 * @param {Filter} filter
 */
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

  // `in`. 선택한 것이 없으면 아무것도 거르지 않는다 —
  // 빈 목록을 "전부 제외"로 읽으면 체크를 다 풀었을 때 화면이 갑자기 빈다
  const chosen = filter.values ?? [];
  if (chosen.length === 0) return true;
  // 빈칸을 고를 수 있어야 한다. `null`과 `''`을 한 가지로 본다
  if (isBlank(value)) return chosen.some((candidate) => isBlank(candidate));
  return chosen.some((candidate) => candidate === value || String(candidate) === String(value));
}

/**
 * 검색어를 낱말로 가른다. 여러 낱말은 모두 포함(AND)이다.
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
    if (isBlank(value)) continue;
    parts.push(String(value).toLowerCase());
    const label = valueLabel(key, value);
    if (label !== String(value)) parts.push(label.toLowerCase());
  }
  return parts.join(' ');
}

/**
 * 값이 있는 것끼리 견준다. 빈칸 처리는 방향을 뒤집기 전에 따로 한다.
 */
function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return Number(right === true) - Number(left === true);
  }
  return String(left).localeCompare(String(right), 'ko', { numeric: true });
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
  // 정렬 키가 전부 같은 행끼리는 원래 차례를 지킨다.
  // 원본 차례가 곧 엑셀의 행 차례여서, 흔들리면 사람이 표를 못 믿는다
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const sort of sorts) {
        const leftValue = left.row[sort.key];
        const rightValue = right.row[sort.key];

        // 빈칸은 언제나 뒤로 보낸다. **방향을 뒤집기 전에** 가른다 —
        // 뒤집는 쪽에 빈칸 처리를 맡기면 내림차순에서 빈칸이 맨 위를 덮는다
        const leftBlank = isBlank(leftValue);
        const rightBlank = isBlank(rightValue);
        if (leftBlank || rightBlank) {
          if (leftBlank && rightBlank) continue;
          return leftBlank ? 1 : -1;
        }

        const order = compareValues(leftValue, rightValue);
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
export function facetCounts(rows, filters, key, { search = '', searchKeys } = {}) {
  const others = filters.filter((filter) => filter.key !== key);
  const tokens = searchTokens(search);
  /** @type {Map<unknown, number>} */
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
    const value = isBlank(row[key]) ? null : row[key];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * 지금 걸린 필터를 사람이 읽을 문장으로 바꾼다. 상단 칩에 쓴다.
 * @param {Filter} filter
 * @param {string} label 열 이름
 */
export function describeFilter(filter, label) {
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
