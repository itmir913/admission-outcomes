// @vitest-environment jsdom
/**
 * **도구줄의 고정 수는 늘 사실이다** (2026-10-22, 사용자).
 *
 * 고정할 수 있는 열 수는 화면 너비와 열 너비가 정한다. 그래서 사람이 정한 수보다
 * 적게 고정되는 일이 생기는데, 그때 도구줄이 정한 수를 그대로 적으면 **5라 적힌
 * 화면에 4개가 고정돼 있다.** 눈으로는 멀쩡해서 틀린 줄 모른다 (§5).
 *
 * 그래서 도구줄은 사람이 정한 수가 아니라 **실제로 그려진 수**를 적고, 더 들어갈
 * 자리가 없으면 「+」를 막는다. 이 검사가 보는 것은 표가 그 두 가지에 답하는 자리다
 * — `drawnPinned()`와 `canPinMore()`. 그 답을 받아 화면에 적는 곳은 `main.js`라
 * 여기서 닿지 않는다. 그쪽은 예시 양식으로 브라우저에서 확인했다.
 *
 * jsdom은 폭을 재지 않으므로(`clientWidth`가 늘 0) 스크롤러의 폭을 직접 심는다.
 * 폭을 못 재는 경우도 같은 방법으로 만든다 — 그때는 **막지 않는 것**이 맞다.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createTable } from '../src/ui/table.js';

const registry = [
  { key: 'sid', label: '익명 ID', group: 'student', type: 'text', numeric: false, filled: 1, cardinality: 1 },
  { key: 'cohortYear', label: '고3 년도', group: 'student', type: 'year', numeric: true, filled: 1, cardinality: 1 },
  { key: 'univ', label: '대학명', group: 'application', type: 'text', numeric: false, filled: 1, cardinality: 1 },
  { key: 'dept', label: '모집단위', group: 'application', type: 'text', numeric: false, filled: 1, cardinality: 1 }
];
const rows = [{ sid: '2025-A3F2-7K9M', cohortYear: 2025, univ: '가온대학교', dept: '국제통상학과' }];
const columns = registry.map((field) => field.key);
/** 열 하나가 200px. 60% 규칙이 자르는 자리를 눈으로 셀 수 있게 똑같이 둔다 */
const widths = Object.fromEntries(columns.map((key) => [key, 200]));

/**
 * @param {number} 폭 스크롤러의 `clientWidth`. 0이면 「아직 못 쟀다」
 * @param {number} pinned 사람이 정한 고정 수
 */
function 표세우기(폭, pinned) {
  document.body.innerHTML = `
    <div id="scroll"><table>
      <colgroup id="cols"></colgroup>
      <thead><tr id="head"></tr></thead>
      <tbody id="body"></tbody>
    </table></div>
    <p id="empty"></p>`;

  const scroller = document.querySelector('#scroll');
  Object.defineProperty(scroller, 'clientWidth', { value: 폭, configurable: true });

  const 알림 = [];
  const table = createTable({
    scroller,
    colgroup: document.querySelector('#cols'),
    headRow: document.querySelector('#head'),
    body: document.querySelector('#body'),
    empty: document.querySelector('#empty'),
    onPinnedChange: (drawn) => 알림.push(drawn)
  });
  table.render({ rows, registry, state: { columns, widths, pinned, sorts: [] } });
  return { table, 알림, head: document.querySelector('#head') };
}

describe('고정 열 수는 화면이 정한다', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  /** 1000px의 60%는 600px. 200px짜리 열 셋까지 들어간다 */
  it('들어갈 자리가 있으면 더 고정할 수 있다고 답한다', () => {
    const { table } = 표세우기(1000, 2);
    expect(table.canPinMore()).toBe(true);
  });

  it('자리가 없으면 더 고정할 수 없다고 답한다', () => {
    const { table } = 표세우기(1000, 3);
    expect(table.canPinMore()).toBe(false);
  });

  /** 열을 다 고정한 뒤에는 더 넣을 열이 없다 */
  it('남은 열이 없어도 더 고정할 수 없다고 답한다', () => {
    const { table } = 표세우기(100000, columns.length);
    expect(table.canPinMore()).toBe(false);
  });

  it('그린 수가 정한 수보다 적으면 그 수를 알린다', () => {
    const { table, 알림, head } = 표세우기(1000, 4);
    expect(table.drawnPinned()).toBe(3);
    expect(알림.at(-1)).toBe(3);
    expect(head.querySelectorAll('.pinned')).toHaveLength(3);
  });

  it('다 들어가면 정한 수 그대로 알린다', () => {
    const { table, 알림 } = 표세우기(1000, 2);
    expect(table.drawnPinned()).toBe(2);
    expect(알림.at(-1)).toBe(2);
  });

  /*
   * **상한을 숫자로 박아 두지 않는다** (2026-10-22, 사용자).
   *
   * 한때 여섯 개로 막아 두었다. 몇 개가 들어가는지는 화면 너비와 열 너비가 정하고
   * 그것은 사람마다 매 순간 다르다 — 숫자로 박으면 넓은 화면에서 필요 없이 막는다.
   * 숫자가 다시 들어와도 좁은 화면에서는 티가 안 나므로 넓은 화면으로 검사한다.
   */
  it('넓은 화면에서는 일곱째 열도 고정할 수 있다', () => {
    const 많은열 = Array.from({ length: 9 }, (_, index) => ({
      key: `c${index}`, label: `열 ${index}`, group: 'application',
      type: 'text', numeric: false, filled: 1, cardinality: 1
    }));
    document.body.innerHTML = `
      <div id="scroll"><table>
        <colgroup id="cols"></colgroup>
        <thead><tr id="head"></tr></thead>
        <tbody id="body"></tbody>
      </table></div>
      <p id="empty"></p>`;
    const scroller = document.querySelector('#scroll');
    Object.defineProperty(scroller, 'clientWidth', { value: 4000, configurable: true });

    const table = createTable({
      scroller,
      colgroup: document.querySelector('#cols'),
      headRow: document.querySelector('#head'),
      body: document.querySelector('#body'),
      empty: document.querySelector('#empty')
    });
    const keys = 많은열.map((field) => field.key);
    table.render({
      rows: [Object.fromEntries(keys.map((key) => [key, '값']))],
      registry: 많은열,
      state: {
        columns: keys,
        widths: Object.fromEntries(keys.map((key) => [key, 200])),
        pinned: 7,
        sorts: []
      }
    });

    expect(table.drawnPinned()).toBe(7);
    expect(table.canPinMore()).toBe(true);
  });

  /*
   * **폭을 못 재는 동안에는 「못 늘린다」고 답하지 않는다.** 시작 화면이 떠 있어
   * 표가 아직 자리를 못 받은 순간의 1은 「안 들어간다」가 아니라 「아직 모른다」다.
   * 여기서 막으면 자료를 불러오기도 전에 단추가 꺼진 채 남는다.
   */
  it('폭을 못 재면 막지 않는다', () => {
    const { table } = 표세우기(0, 4);
    expect(table.canPinMore()).toBe(true);
    expect(table.drawnPinned()).toBe(1);
  });
});
