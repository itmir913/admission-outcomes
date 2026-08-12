/**
 * 연도 인식 (§3).
 *
 * ## 용어 — 이 파일에서 가장 중요한 것
 *
 * 한국 대입에는 1년 차이 나는 두 연도가 있고, 둘 다 흔히 "연도"라고 불린다.
 *
 *   고3 년도   그 학생이 고등학교 3학년이었던 **달력 연도**.   2025
 *   학년도     그 학생이 치른 대입의 학년도. 학번과 같다.       2026   ( = 고3 년도 + 1 )
 *
 * **이 시스템은 언제나 고3 년도(`cohortYear`)만 쓴다.** 화면에도, 축에도, 익명 ID에도.
 * 두 값을 섞으면 자료가 통째로 한 해씩 밀리고, 밀렸다는 사실조차 눈에 띄지 않는다.
 *
 * 그래서 값을 읽을 때마다 **그 값이 어느 쪽 기준인지(basis)** 를 반드시 함께 판정한다.
 * 판정하지 못하면 추측하지 않고 사용자에게 묻는다.
 */

/** 연도로 인정할 범위의 아래쪽 끝. 이보다 오래된 자료는 다루지 않는다. */
export const EARLIEST_YEAR = 1990;

/** 학년도는 달력 연도보다 앞설 수 있다. 2026학년도 입시는 2025년에 치른다. */
export const FUTURE_ALLOWANCE = 2;

/** 읽어 들인 값이 어느 기준인지 */
export const BASIS = {
  /** 고3 년도. 우리가 쓰는 기준 */
  senior: 'senior',
  /** 학년도(= 고3 년도 + 1). 원본 자료에 흔한 기준 */
  admission: 'admission',
  /** 어느 쪽인지 알 수 없음. 사용자에게 물어야 한다 */
  unknown: 'unknown'
};

/**
 * 어느 기준의 값을 고3 년도로 바꾼다.
 * @param {number} value
 * @param {'senior'|'admission'|'unknown'} basis
 * @returns {number|null} basis를 모르면 null — 추측해서 넘기지 않는다
 */
export function toCohortYear(value, basis) {
  if (!Number.isInteger(value)) return null;
  if (basis === BASIS.senior) return value;
  if (basis === BASIS.admission) return value - 1;
  return null;
}

function isPlausibleRawYear(value, currentYear) {
  return Number.isInteger(value) && value >= EARLIEST_YEAR && value <= currentYear + FUTURE_ALLOWANCE;
}

/**
 * 문자열에서 연도로 보이는 값을 뽑되, **기준까지 함께 판정한다.**
 *
 * `2024학년도`는 학년도라고 스스로 밝히고 있다. 반면 `2024년`이나 그냥 `2024`는
 * 고3 년도일 수도, 학년도를 줄여 쓴 것일 수도 있다. 이 둘을 같이 취급하면
 * 파일명 하나 때문에 한 해치 자료가 통째로 밀린다.
 *
 * @param {string} text
 * @param {{currentYear?: number}} [options]
 * @returns {{ admission: number[], unknown: number[] }}
 */
export function extractYears(text, { currentYear = new Date().getFullYear() } = {}) {
  const source = String(text ?? '');
  const admission = [];
  const unknown = [];

  // "학년도"라고 적혀 있으면 학년도다. 표기가 곧 근거다
  for (const match of source.matchAll(/(\d{4})\s*학년도/g)) {
    const value = Number(match[1]);
    if (isPlausibleRawYear(value, currentYear)) admission.push(value);
  }
  for (const match of source.matchAll(/(?<!\d)(\d{2})\s*학년도/g)) {
    const value = 2000 + Number(match[1]);
    if (isPlausibleRawYear(value, currentYear)) admission.push(value);
  }

  // "2024년", "2024년도", 맨 숫자는 어느 쪽인지 알 수 없다
  for (const match of source.matchAll(/(?<!\d)(19|20)(\d{2})(?!\d)/g)) {
    const value = Number(`${match[1]}${match[2]}`);
    if (isPlausibleRawYear(value, currentYear) && !admission.includes(value)) unknown.push(value);
  }

  return { admission: [...new Set(admission)], unknown: [...new Set(unknown)] };
}

/**
 * 격자에서 연도가 담긴 열을 찾는다.
 *
 * 헤더 이름을 보지 않고 **값의 생김새만** 본다. 헤더가 바뀌어도 견디고,
 * `학년` 열에 3이 든 파일을 연도로 오해하지 않는다.
 *
 * @param {unknown[][]} grid 헤더를 포함한 전체 행렬
 * @param {{currentYear?: number, headerRows?: number, minRows?: number, ratio?: number}} [options]
 * @returns {{ column: number, values: number[], uniform: boolean, basis: string } | null}
 */
export function findYearColumn(grid, {
  currentYear = new Date().getFullYear(),
  headerRows = 1,
  minRows = 3,
  ratio = 0.8
} = {}) {
  if (!Array.isArray(grid) || grid.length <= headerRows) return null;
  const body = grid.slice(headerRows);
  const width = body.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);

  for (let column = 0; column < width; column += 1) {
    /** @type {number[]} */
    const years = [];
    let filled = 0;
    for (const row of body) {
      const raw = row?.[column];
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      filled += 1;
      const value = Number(String(raw).trim());
      if (isPlausibleRawYear(value, currentYear)) years.push(value);
    }
    if (filled < minRows) continue;
    if (years.length / filled < ratio) continue;

    const distinct = [...new Set(years)].sort();
    // 달력 연도를 넘어서는 값은 고3 년도일 수 없다. 학년도라는 확증이 된다.
    // 반대로 넘지 않는다고 해서 고3 년도라는 뜻은 아니므로, 그때는 모른다고 답한다.
    const basis = distinct[distinct.length - 1] > currentYear ? BASIS.admission : BASIS.unknown;
    return { column, values: distinct, uniform: distinct.length === 1, basis };
  }
  return null;
}

/**
 * @typedef {object} CohortYearGuess
 * @property {number|null} cohortYear 파일 전체에 적용할 고3 년도
 * @property {number|null} yearColumn 행마다 연도가 다를 때 그 열 번호
 * @property {string} basis 읽어 들인 값의 기준
 * @property {'cell'|'filename'|'sheet'|null} source 어디서 알아냈는지 (화면에 보여준다)
 * @property {'high'|'low'|'none'} confidence low 이하면 사용자 확인을 받는다
 * @property {number[]} rawCandidates 변환 전 후보값 (사용자에게 보여줄 때 쓴다)
 * @property {boolean} needsInput 사용자에게 직접 입력받아야 하는지
 */

/**
 * 고3 년도를 추론한다. 셀 값 → 파일명 → 시트명 순으로 믿는다.
 *
 * 셀을 가장 신뢰하는 이유: 파일명은 사람이 손으로 붙이는 것이라
 * `2024학년도_최종_수정본_2025.xlsx` 같은 것이 흔하다.
 *
 * **기준을 모르면 연도를 확정하지 않는다.** 1년 밀린 자료는 겉보기에 멀쩡해서
 * 잘못을 알아챌 방법이 없기 때문이다. 이때는 `needsInput`을 세워 사용자에게 넘긴다.
 *
 * @param {{fileName?: string, sheetName?: string, grid?: unknown[][], headerRows?: number, columnBasis?: string, currentYear?: number}} input
 * @param {string} [input.columnBasis] 프로파일이 알려 주는 연도 열의 기준
 * @returns {CohortYearGuess}
 */
export function inferCohortYear({
  fileName = '', sheetName = '', grid = [], headerRows = 1,
  columnBasis = null, currentYear = new Date().getFullYear()
} = {}) {
  const none = {
    cohortYear: null, yearColumn: null, basis: BASIS.unknown,
    source: null, confidence: 'none', rawCandidates: [], needsInput: true
  };

  const found = findYearColumn(grid, { currentYear, headerRows });
  if (found) {
    // 프로파일이 기준을 알려 줬으면 그것을 따른다. 값으로 얻은 확증이 있으면 그것도 쓴다
    const basis = columnBasis ?? found.basis;
    const known = basis === BASIS.senior || basis === BASIS.admission;
    return {
      cohortYear: found.uniform && known ? toCohortYear(found.values[0], basis) : null,
      yearColumn: found.column,
      basis,
      source: 'cell',
      confidence: known ? 'high' : 'low',
      rawCandidates: found.values,
      needsInput: !known
    };
  }

  for (const [source, text] of [['filename', fileName], ['sheet', sheetName]]) {
    const { admission, unknown } = extractYears(text, { currentYear });
    if (admission.length === 1) {
      return {
        cohortYear: toCohortYear(admission[0], BASIS.admission),
        yearColumn: null, basis: BASIS.admission, source,
        confidence: 'high', rawCandidates: admission, needsInput: false
      };
    }
    if (admission.length > 1) {
      return {
        cohortYear: null, yearColumn: null, basis: BASIS.admission, source,
        confidence: 'low', rawCandidates: admission, needsInput: true
      };
    }
    if (unknown.length > 0) {
      // 숫자는 찾았지만 고3 년도인지 학년도인지 알 수 없다. 후보만 들고 사용자에게 간다
      return {
        cohortYear: null, yearColumn: null, basis: BASIS.unknown, source,
        confidence: 'low', rawCandidates: unknown, needsInput: true
      };
    }
  }

  return none;
}
