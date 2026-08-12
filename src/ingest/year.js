/**
 * 학년도 인식 (§3).
 *
 * 파일마다 어느 해의 입시 결과인지 알아내야 한다. 실패하면 사용자에게 묻되,
 * 성공해도 "이 파일을 2024학년도로 읽었습니다"를 보여주고 고칠 수 있게 한다.
 *
 * 함정이 하나 있다. **대교협 파일의 `학년` 열에는 학년도가 아니라 학년(3)이 들어 있다.**
 * 센진학 파일의 `학년` 열에는 학년도(2026)가 들어 있다. 헤더 이름이 같으므로
 * 이름으로 판단하면 3을 학년도로 읽는다. 그래서 값의 범위로 판별한다.
 */

/** 학년도로 인정할 범위의 아래쪽 끝. 이보다 오래된 자료는 다루지 않는다. */
export const EARLIEST_YEAR = 1990;

/**
 * 학년도로 인정할 범위의 위쪽 여유.
 * 2027학년도 입시는 2026년에 치르므로 올해보다 앞선 값이 정상적으로 나온다.
 */
export const FUTURE_ALLOWANCE = 2;

/**
 * @param {number} value
 * @param {number} currentYear
 */
function isPlausibleYear(value, currentYear) {
  return Number.isInteger(value) && value >= EARLIEST_YEAR && value <= currentYear + FUTURE_ALLOWANCE;
}

/**
 * 문자열에서 학년도로 보이는 값을 뽑는다.
 *
 * `학년도`·`년도`가 붙은 값을 더 신뢰한다. `2024학년도_대교협_20250131.xlsx`처럼
 * 학년도와 작성일이 함께 든 파일명이 흔하기 때문이다.
 *
 * @param {string} text
 * @param {{currentYear?: number}} [options]
 * @returns {{ marked: number[], bare: number[] }} marked = 학년도 표지가 붙은 값
 */
export function extractYears(text, { currentYear = new Date().getFullYear() } = {}) {
  const source = String(text ?? '');
  const marked = [];
  const bare = [];

  // 2024학년도 / 2024 학년도 / 2024년도 / 2024년
  for (const match of source.matchAll(/(\d{4})\s*(?:학년도|년도|년)/g)) {
    const value = Number(match[1]);
    if (isPlausibleYear(value, currentYear)) marked.push(value);
  }
  // 24학년도 → 2024. 두 자리는 표지가 붙었을 때만 인정한다
  for (const match of source.matchAll(/(?<!\d)(\d{2})\s*(?:학년도|년도)/g)) {
    const value = 2000 + Number(match[1]);
    if (isPlausibleYear(value, currentYear)) marked.push(value);
  }
  for (const match of source.matchAll(/(?<!\d)(19|20)(\d{2})(?!\d)/g)) {
    const value = Number(`${match[1]}${match[2]}`);
    if (isPlausibleYear(value, currentYear) && !marked.includes(value)) bare.push(value);
  }

  return { marked: [...new Set(marked)], bare: [...new Set(bare)] };
}

/**
 * 격자(행렬)에서 학년도가 담긴 열을 찾는다.
 *
 * 헤더 이름을 보지 않고 **값의 생김새만** 본다. 헤더가 바뀌어도 견디고,
 * `학년` 열에 3이 든 파일을 학년도로 오해하지 않는다.
 *
 * @param {unknown[][]} grid 헤더를 포함한 전체 행렬
 * @param {{currentYear?: number, headerRows?: number, minRows?: number, ratio?: number}} [options]
 * @returns {{ column: number, values: number[], uniform: boolean } | null}
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
      if (isPlausibleYear(value, currentYear)) years.push(value);
    }
    if (filled < minRows) continue;
    if (years.length / filled < ratio) continue;
    const distinct = [...new Set(years)].sort();
    return { column, values: distinct, uniform: distinct.length === 1 };
  }
  return null;
}

/**
 * @typedef {object} YearGuess
 * @property {number|null} year 파일 전체에 적용할 학년도
 * @property {number|null} yearColumn 행마다 학년도가 다를 때 그 열 번호
 * @property {'cell'|'filename'|'sheet'|null} source 어디서 알아냈는지 (사용자에게 보여준다)
 * @property {'high'|'low'|'none'} confidence low면 사용자 확인을 받는다
 * @property {number[]} candidates 후보가 여럿일 때 전부
 */

/**
 * 학년도를 추론한다. 셀 값 → 파일명 → 시트명 순으로 믿는다.
 *
 * 셀을 가장 신뢰하는 이유: 파일명은 사람이 손으로 붙이는 것이라
 * `2024학년도_최종_수정본_2025.xlsx` 같은 것이 흔하다.
 *
 * @param {{fileName?: string, sheetName?: string, grid?: unknown[][], headerRows?: number, currentYear?: number}} input
 * @returns {YearGuess}
 */
export function inferYear({
  fileName = '', sheetName = '', grid = [], headerRows = 1,
  currentYear = new Date().getFullYear()
} = {}) {
  const found = findYearColumn(grid, { currentYear, headerRows });
  if (found) {
    // 한 파일에 여러 학년도가 섞인 누적 파일이면 행마다 읽어야 한다
    if (!found.uniform) {
      return {
        year: null, yearColumn: found.column, source: 'cell',
        confidence: 'high', candidates: found.values
      };
    }
    return {
      year: found.values[0], yearColumn: found.column, source: 'cell',
      confidence: 'high', candidates: found.values
    };
  }

  for (const [source, text] of [['filename', fileName], ['sheet', sheetName]]) {
    const { marked, bare } = extractYears(text, { currentYear });
    if (marked.length === 1) {
      return { year: marked[0], yearColumn: null, source, confidence: 'high', candidates: marked };
    }
    if (marked.length > 1) {
      return { year: marked[0], yearColumn: null, source, confidence: 'low', candidates: marked };
    }
    if (bare.length === 1) {
      return { year: bare[0], yearColumn: null, source, confidence: 'low', candidates: bare };
    }
    if (bare.length > 1) {
      return { year: bare[0], yearColumn: null, source, confidence: 'low', candidates: bare };
    }
  }

  return { year: null, yearColumn: null, source: null, confidence: 'none', candidates: [] };
}
