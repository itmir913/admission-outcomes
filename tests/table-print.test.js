// @vitest-environment jsdom
/**
 * **인쇄하면 빈 쪽만 나왔다** (2026-10-22, 사용자).
 *
 * 표는 보이는 구간만 그리고, 위아래 나머지는 높이만 가진 빈 행으로 메운다. 화면에서는
 * 스크롤 막대 길이를 맞추는 장치지만 종이에는 그 높이가 그대로 빈 자리로 찍힌다.
 * A4 50쪽을 넘기면서 자료는 한 화면 분량뿐이었다.
 *
 * 그래서 인쇄하는 동안에는 모든 행을 그리고 빈 행을 두지 않는다.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createTable } from '../src/ui/table.js';

const registry = [
  { key: 'cohortYear', label: '고3 년도', type: 'year' },
  { key: 'univ', label: '대학' }
];

/** 한 화면에 들어갈 수 없을 만큼 많은 행 */
const rows = Array.from({ length: 300 }, (_, index) => ({
  sid: `2025-TEST-${index}`,
  cohortYear: 2025,
  univ: `대학${index}`
}));

/** 자료가 든 행과 자리만 메우는 빈 행을 나눠 센다 */
function 행수(body) {
  const all = [...body.querySelectorAll('tr')];
  return {
    자료: all.filter((tr) => tr.children.length > 0).length,
    빈: all.filter((tr) => tr.children.length === 0).length
  };
}

describe('인쇄', () => {
  let body;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="scroll"><table>
        <colgroup id="cols"></colgroup>
        <thead><tr id="head"></tr></thead>
        <tbody id="body"></tbody>
      </table></div>
      <p id="empty"></p>`;

    body = document.querySelector('#body');

    const table = createTable({
      scroller: document.querySelector('#scroll'),
      colgroup: document.querySelector('#cols'),
      headRow: document.querySelector('#head'),
      body,
      empty: document.querySelector('#empty')
    });
    table.render({
      rows,
      registry,
      state: { columns: registry.map((field) => field.key), widths: {}, pinned: 0, sorts: [] }
    });
  });

  it('화면에서는 일부만 그리고 나머지는 빈 행으로 메운다', () => {
    const 센것 = 행수(body);
    expect(센것.자료).toBeLessThan(rows.length);
    expect(센것.빈).toBeGreaterThan(0);
  });

  it('인쇄할 때는 모든 행을 그리고 빈 행을 남기지 않는다', () => {
    globalThis.dispatchEvent(new globalThis.Event('beforeprint'));

    const 센것 = 행수(body);
    expect(센것.자료).toBe(rows.length);
    expect(센것.빈).toBe(0);
  });

  it('인쇄가 끝나면 화면은 다시 보이는 구간만 그린다', () => {
    globalThis.dispatchEvent(new globalThis.Event('beforeprint'));
    globalThis.dispatchEvent(new globalThis.Event('afterprint'));

    expect(행수(body).자료).toBeLessThan(rows.length);
  });
});
