/**
 * 화면 상태 기억하기 (§7).
 *
 * 정렬·필터·열 너비를 저장해 새로고침해도 그대로 있게 한다. 상담 중에 실수로
 * 새로고침했다고 조건을 처음부터 다시 잡게 만들 수는 없다.
 *
 * **개인정보는 여기 오지 않는다.** 저장되는 것은 열 이름과 익명화가 끝난 값뿐이다.
 */

const KEY = 'admission-outcomes:view';

/** @typedef {{columns: string[], widths: Record<string, number>, pinned: number, sorts: object[], filters: object[], filtersOpen: boolean|null, summary: boolean, grouping: string, summaryGpa: string|null, summaryTable: {columns: string[], widths: Record<string, number>, pinned: number, sorts: object[]}}} ViewState */

/**
 * 처음 상태.
 *
 * 고정 열이 셋인 것은 기본 열 순서가 `익명 ID · 고3 년도 · 대학명`이기 때문이다.
 * 가로로 밀었을 때 이 셋이 화면 밖으로 나가면 나머지 값이 누구 것인지 알 수 없다(§7).
 *
 * @returns {ViewState}
 */
export function emptyView() {
  // `filtersOpen`이 null이면 화면 폭이 정한다. 사람이 한 번 전환하면 그 선택이 남는다
  // `summary`는 대학×전형 요약표를 보는 중인지, `grouping`은 그 표의 묶음 기준이다
  return { columns: [], widths: {}, pinned: 3, sorts: [], filters: [], filtersOpen: null, summary: false, grouping: 'univAdm',
    // 요약표 합격자 내신의 기준 열. null이면 대표 내신 열(전교과)을 쓴다
    summaryGpa: null,
    // 요약표도 목록표와 같은 표라 열·너비·고정·정렬을 따로 가진다. 대학·전형 두 칸을 고정해 시작한다
    summaryTable: { columns: [], widths: {}, pinned: 2, sorts: [] } };
}

/**
 * 저장해 둔 상태를 읽는다.
 *
 * 저장된 모양이 지금과 다를 수 있다 — 도구가 바뀌었거나 사람이 손댔거나.
 * 그럴 때 화면이 깨지느니 기본값으로 시작하는 편이 낫다.
 *
 * @returns {ViewState}
 */
export function loadView() {
  const base = emptyView();
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return base;
    return {
      columns: Array.isArray(saved.columns) ? saved.columns.filter((key) => typeof key === 'string') : base.columns,
      widths: saved.widths && typeof saved.widths === 'object' ? saved.widths : base.widths,
      pinned: Number.isInteger(saved.pinned) ? saved.pinned : base.pinned,
      sorts: Array.isArray(saved.sorts) ? saved.sorts.filter((sort) => sort?.key) : base.sorts,
      filters: Array.isArray(saved.filters) ? saved.filters.filter((filter) => filter?.key && filter?.op) : base.filters,
      filtersOpen: typeof saved.filtersOpen === 'boolean' ? saved.filtersOpen : base.filtersOpen,
      summary: saved.summary === true,
      grouping: typeof saved.grouping === 'string' ? saved.grouping : base.grouping,
      summaryGpa: typeof saved.summaryGpa === 'string' ? saved.summaryGpa : base.summaryGpa,
      summaryTable: readSummaryTable(saved.summaryTable, base.summaryTable)
    };
  } catch {
    return base;
  }
}

/** 저장된 요약표 상태를 믿을 수 있는 것만 읽는다 */
function readSummaryTable(saved, base) {
  if (!saved || typeof saved !== 'object') return base;
  return {
    columns: Array.isArray(saved.columns) ? saved.columns.filter((key) => typeof key === 'string') : base.columns,
    widths: saved.widths && typeof saved.widths === 'object' ? saved.widths : base.widths,
    pinned: Number.isInteger(saved.pinned) ? saved.pinned : base.pinned,
    sorts: Array.isArray(saved.sorts) ? saved.sorts.filter((sort) => sort?.key) : base.sorts
  };
}

/** @param {ViewState} view */
export function saveView(view) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({
      columns: view.columns,
      widths: view.widths,
      pinned: view.pinned,
      sorts: view.sorts,
      filters: view.filters,
      filtersOpen: view.filtersOpen,
      summary: view.summary,
      grouping: view.grouping,
      summaryGpa: view.summaryGpa,
      summaryTable: view.summaryTable
    }));
  } catch {
    // 저장 자리가 없거나 시크릿 모드다. 화면은 그대로 돌아가야 하므로 삼킨다
  }
}

export function forgetView() {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch { /* 위와 같다 */ }
}

/**
 * 저장된 상태에서 지금 자료에 없는 열을 걷어낸다.
 *
 * 자료를 지우고 다른 파일을 불러오면 열 구성이 통째로 달라진다.
 * 남아 있는 옛 열을 그대로 쓰면 표가 빈칸만 잔뜩 보여 준다.
 *
 * @param {ViewState} view
 * @param {object[]} registry
 * @returns {ViewState}
 */
export function pruneView(view, registry) {
  const known = new Set(registry.map((field) => field.key));
  return {
    ...view,
    columns: view.columns.filter((key) => known.has(key)),
    sorts: view.sorts.filter((sort) => known.has(sort.key)),
    filters: view.filters.filter((filter) => known.has(filter.key))
  };
}
