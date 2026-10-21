/**
 * 헤더 블록 다루기 (§4).
 *
 * 여러 줄짜리 헤더를 한 줄짜리 이름표로 전개한다. 병합셀 때문에 위쪽 헤더가
 * 첫 칸에만 들어 있으므로, 오른쪽으로 흘려 채운 뒤 아래 줄과 합친다.
 *
 *   국어 |      |      |      →  국어 | 국어 | 국어 | 국어
 *   과목 | 표점 | 백분위 | 등급     ↓
 *                             국어·과목 | 국어·표점 | 국어·백분위 | 국어·등급
 *
 * 여기서만 열 위치를 쓴다. 이름표를 만들고 나면 그 뒤로는 이름으로 다룬다.
 */

/** 라벨 두 층을 잇는 글자. 원본 헤더에 잘 쓰이지 않는 것을 골랐다. */
export const LABEL_JOIN = '·';

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * 위쪽 헤더를 오른쪽으로 흘려 채워 병합셀을 되살린다.
 * @param {unknown[]} row
 * @param {number} width
 * @returns {string[]}
 */
export function fillMergedRow(row, width) {
  const filled = [];
  let carried = '';
  for (let index = 0; index < width; index += 1) {
    const value = cellText(row?.[index]);
    if (value !== '') carried = value;
    filled.push(carried);
  }
  return filled;
}

/**
 * @typedef {{ top: string, sub: string, label: string }} HeaderLabel
 */

/**
 * 헤더 블록을 열마다 하나의 이름표로 전개한다.
 *
 * @param {unknown[][]} grid
 * @param {number} headerRows
 * @returns {HeaderLabel[]}
 */
export function buildHeaderLabels(grid, headerRows = 1) {
  const rows = (grid ?? []).slice(0, Math.max(1, headerRows));
  const width = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);
  /*
   * **머리글이 한 줄이면 왼쪽 이름을 끌어오지 않는다.**
   *
   * 두 줄짜리 머리글에서 윗줄의 빈칸은 병합셀이라 왼쪽 이름을 물려받는 것이 맞다.
   * 그런데 한 줄짜리에서는 빈칸이 그저 **이름 없는 열**이다. 끌어오면 바로 왼쪽 열과
   * 같은 이름을 갖게 되고, 두 열의 값이 `extra`의 한 자리를 다투다 한쪽이 소리 없이
   * 사라진다. 게다가 그 이름이 멀쩡히 해석된 열의 이름과 같아져, 화면은 그 열을
   * 해석하지 못한 것처럼 알린다.
   */
  if (headerRows <= 1) {
    const single = (rows[0] ?? []).slice(0, width).map((cell) => cellText(cell));
    while (single.length < width) single.push('');
    return single.map((value) => ({ top: value, sub: '', label: value }));
  }

  const top = fillMergedRow(rows[0], width);

  // 셋째 줄 이상은 아래 줄끼리 이어 붙인다
  const lower = [];
  for (let index = 0; index < width; index += 1) {
    const parts = [];
    for (let row = 1; row < rows.length; row += 1) {
      const value = cellText(rows[row]?.[index]);
      if (value !== '') parts.push(value);
    }
    lower.push(parts.join(LABEL_JOIN));
  }

  return top.map((value, index) => ({
    top: value,
    sub: lower[index],
    label: lower[index] ? `${value}${LABEL_JOIN}${lower[index]}` : value
  }));
}

/**
 * 헤더 아래의 자료 행만 돌려준다.
 * @param {unknown[][]} grid
 * @param {number} headerRows
 */
export function bodyRows(grid, headerRows = 1) {
  return (grid ?? []).slice(Math.max(1, headerRows));
}
