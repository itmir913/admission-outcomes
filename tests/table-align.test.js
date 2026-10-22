// @vitest-environment jsdom
/**
 * **표의 머리 칸과 몸 칸은 같은 쪽으로 선다. 지금은 왼쪽뿐이다** (2026-10-19, 사용자).
 *
 * 이 결함은 조용하다. 머리와 칸이 **서로 다른 자리에서** 정렬을 정하면 — 머리는
 * 헤더를 그리는 곳에서, 칸은 셀을 그리는 곳에서 — 한쪽만 고쳐도 아무것도 울지 않는다.
 * 숫자 열 하나가 머리는 왼쪽, 값은 오른쪽으로 서 있어도 표는 멀쩡해 보인다.
 *
 * 그래서 검사가 둘이다.
 *
 * - **정적 훑기**는 스타일시트를 보고 *정렬을 정하는 자리가 하나뿐인지*를 잡는다.
 * - **마운트 검사**는 실제로 그린 표에서 열마다 머리와 칸을 견준다.
 *
 * 앞의 것은 넓고 얕으며 뒤의 것은 좁고 깊다. 하나로는 이 결함을 못 잡는다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postcss from 'postcss';
import { describe, it, expect, beforeEach } from 'vitest';

import { createTable } from '../src/ui/table.js';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');

/**
 * 정렬을 정하는 유틸리티 클래스. **여기 없는 것은 정렬을 안 건드린다.**
 * 지금 허용하는 것은 왼쪽뿐이라, 왼쪽을 뜻하는 클래스조차 셀에는 붙을 일이 없다.
 */
const ALIGN_CLASSES = Object.freeze({
  'text-left': 'left',
  'text-center': 'center',
  'text-right': 'right',
  'text-start': 'left',
  'text-end': 'right',
  'justify-center': 'center',
  'justify-end': 'right',
  'justify-start': 'left'
});

/** 한 요소(와 그 자손)가 들고 있는 정렬 클래스. */
function alignTokensIn(node) {
  const found = new Set();
  const walk = (element) => {
    for (const token of element.classList ?? []) {
      if (token in ALIGN_CLASSES) found.add(ALIGN_CLASSES[token]);
    }
    for (const child of element.children ?? []) walk(child);
  };
  walk(node);
  return [...found].sort();
}

/**
 * 규칙마다 **쉼표로 나눈 선택자 하나씩**과 그 규칙이 직접 적은 속성들.
 *
 * **주석은 CSS 파서가 구분한다.** 중괄호를 글자로 세면 주석 속 `}` 하나에 끊겨
 * 그 뒤의 규칙이 통째로 검사 밖으로 빠지는데, 빠졌다는 사실은 초록불에 안 적힌다.
 */
function rulesOf(css) {
  const found = [];
  postcss.parse(css).walkRules((rule) => {
    const declarations = (rule.nodes ?? [])
      .filter((node) => node.type === 'decl')
      .map((node) => ({ prop: node.prop.toLowerCase(), value: String(node.value).toLowerCase() }));
    for (const selector of rule.selectors) {
      found.push({ selector: selector.trim().replace(/\s+/g, ' '), declarations });
    }
  });
  return found;
}

/** `text-align`을 정하는 규칙들. */
export function alignRules(css) {
  return rulesOf(css)
    .map(({ selector, declarations }) => ({
      selector,
      value: declarations.find((one) => one.prop === 'text-align')?.value
    }))
    .filter((rule) => rule.value !== undefined);
}

describe('정렬을 정하는 자리는 하나다', () => {
  const inTable = alignRules(CSS).filter((rule) => rule.selector.includes('grid-table'));

  /**
   * 파서가 쉼표로 묶인 선택자를 하나씩 분리해 주므로, 한 규칙에 적은 `th, td`는
   * 여기서 둘로 보인다. 그래서 세는 것은 규칙 수가 아니라 **가리키는 자리**다.
   */
  it('표의 정렬은 머리 칸과 몸 칸 두 자리만 가리킨다', () => {
    // 셋이 되는 순간 "어느 쪽이 이기는가"가 특정도 싸움이 되고, 그 싸움은 조용히 진다
    expect(inTable.map((rule) => rule.selector).sort())
      .toEqual(['.grid-table td', '.grid-table th']);
  });

  it('머리 칸과 몸 칸이 같은 규칙에서 같은 값을 받는다', () => {
    expect(new Set(inTable.map((rule) => rule.value))).toEqual(new Set(['left']));
  });

  it('값이 왼쪽이다', () => {
    expect(inTable.every((rule) => rule.value === 'left')).toBe(true);
  });

  it('표 밖에서도 오른쪽·가운데로 미는 규칙을 두지 않는다', () => {
    const pushed = alignRules(CSS).filter((rule) => rule.value === 'right' || rule.value === 'center');
    expect(pushed.map((rule) => `${rule.selector} { text-align: ${rule.value} }`)).toEqual([]);
  });
});

describe('그려 놓은 표에서 머리와 칸이 같은 쪽을 본다', () => {
  /** 숫자 열과 글자 열을 섞는다. 어긋나는 것은 늘 숫자 열이었다 */
  const registry = [
    { key: 'sid', label: '익명 ID', group: 'student', type: 'text', numeric: false, filled: 2, cardinality: 2 },
    { key: 'cohortYear', label: '고3 년도', group: 'student', type: 'year', numeric: true, filled: 2, cardinality: 2 },
    { key: 'univ', label: '대학명', group: 'application', type: 'text', numeric: false, filled: 2, cardinality: 2 },
    { key: 'gpa.전교과', label: '전교과', group: 'gpa', type: 'number', numeric: true, filled: 2, cardinality: 2 }
  ];
  const rows = [
    { sid: '2025-A3F2-7K9M', cohortYear: 2025, univ: '서울대학교', 'gpa.전교과': 1.82 },
    { sid: '2025-B7QT-2M4X', cohortYear: 2024, univ: '연세대학교', 'gpa.전교과': 3.4 }
  ];

  let head;
  let body;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="scroll"><table>
        <colgroup id="cols"></colgroup>
        <thead><tr id="head"></tr></thead>
        <tbody id="body"></tbody>
      </table></div>
      <p id="empty"></p>`;

    head = document.querySelector('#head');
    body = document.querySelector('#body');

    const table = createTable({
      scroller: document.querySelector('#scroll'),
      colgroup: document.querySelector('#cols'),
      headRow: head,
      body,
      empty: document.querySelector('#empty')
    });
    table.render({
      rows,
      registry,
      state: { columns: registry.map((field) => field.key), widths: {}, pinned: 2, sorts: [] }
    });
  });

  it('열마다 머리와 칸이 같은 정렬을 쓴다', () => {
    const cells = [...body.querySelectorAll('tr')]
      .filter((tr) => tr.children.length > 0)[0].children;

    expect(head.children.length).toBe(registry.length);
    expect(cells.length).toBe(registry.length);

    const mismatched = [];
    for (let index = 0; index < registry.length; index += 1) {
      const headAlign = alignTokensIn(head.children[index]);
      const cellAlign = alignTokensIn(cells[index]);
      if (String(headAlign) !== String(cellAlign)) {
        mismatched.push(`${registry[index].key}: 머리 ${JSON.stringify(headAlign)} ≠ 칸 ${JSON.stringify(cellAlign)}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('숫자 열도 오른쪽으로 보내지 않는다 - 자릿수는 tabular-nums가 맞춘다', () => {
    const cells = [...body.querySelectorAll('tr')]
      .filter((tr) => tr.children.length > 0)[0].children;

    const pushed = [];
    for (let index = 0; index < registry.length; index += 1) {
      for (const node of [head.children[index], cells[index]]) {
        const align = alignTokensIn(node);
        if (align.some((side) => side !== 'left')) pushed.push(`${registry[index].key}: ${align}`);
      }
    }
    expect(pushed).toEqual([]);
  });

  it('숫자 열에는 자릿수를 맞추는 표시가 붙어 있다', () => {
    const cells = [...body.querySelectorAll('tr')]
      .filter((tr) => tr.children.length > 0)[0].children;
    expect(cells[1].classList.contains('figure')).toBe(true);
    expect(cells[3].classList.contains('figure')).toBe(true);
    expect(cells[0].classList.contains('figure')).toBe(false);
  });

  it('검사기가 어긋난 정렬을 실제로 잡는다', () => {
    // 이 검사가 0을 세고 통과하면 초록불이 "깨끗하다"가 아니라 "안 봤다"를 뜻한다
    const cells = [...body.querySelectorAll('tr')]
      .filter((tr) => tr.children.length > 0)[0].children;
    cells[3].classList.add('text-right');
    expect(alignTokensIn(cells[3])).toEqual(['right']);
    expect(alignTokensIn(head.children[3])).toEqual([]);
  });
});
