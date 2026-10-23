// @vitest-environment jsdom
/**
 * **값 목록 안에서 찾을 때 검색칸이 포커스를 잃지 않는다.**
 *
 * 한 글자 칠 때마다 블록을 통째로 다시 그렸더니, 치던 검색칸이 새 요소로 갈려
 * 다음 글자가 어디에도 들어가지 않았다. 검색칸은 그대로 두고 목록만 바뀌어야 한다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createFilters } from '../src/ui/filters.js';

// 검색칸이 나오는 기준(12가지)을 넘기려고 값을 스무 가지 둔다
const 이름들 = Array.from({ length: 20 }, (_, index) => `학과${String(index).padStart(2, '0')}`);
const rows = 이름들.map((major) => ({ major }));
const registry = [{
  key: 'major', label: '모집단위', group: 'application', type: 'text',
  numeric: false, filled: rows.length, cardinality: 이름들.length
}];

/** 머리줄 깔대기가 여는 팝오버와 같은 길(`blockFor`)로 세운다 */
function 패널세우기() {
  document.body.innerHTML = '<div id="mount"></div>';
  const panel = createFilters({
    mount: document.createElement('div'),
    read: () => ({ rows, registry, filters: [], search: '' }),
    onChange: () => {}
  });
  document.querySelector('#mount').append(panel.blockFor('major'));
  return panel;
}

const 검색칸 = () => document.querySelector('#mount input[type="search"]');
const 보이는값 = () => [...document.querySelectorAll('#mount input[type="checkbox"]')];

function 입력(node, text) {
  node.value = text;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  vi.runAllTimers();
}

describe('값 목록 안에서 찾기', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

  it('글자를 쳐도 같은 검색칸에 포커스가 남는다', () => {
    패널세우기();
    const 처음 = 검색칸();
    처음.focus();

    입력(처음, '학과1');

    expect(검색칸()).toBe(처음);
    expect(document.activeElement).toBe(처음);
    expect(보이는값()).toHaveLength(10);
  });

  it('찾은 값이 기준보다 적어져도 검색칸은 사라지지 않는다', () => {
    패널세우기();
    const 처음 = 검색칸();
    입력(처음, '학과05');
    expect(보이는값()).toHaveLength(1);

    입력(처음, '');
    expect(검색칸()).toBe(처음);
    expect(보이는값()).toHaveLength(20);
  });

  it('찾은 값이 없으면 그렇다고 적는다', () => {
    패널세우기();
    입력(검색칸(), '없는말');
    expect(보이는값()).toHaveLength(0);
    expect(document.querySelector('#mount').textContent).toContain('해당하는 값이 없습니다.');
  });
});
