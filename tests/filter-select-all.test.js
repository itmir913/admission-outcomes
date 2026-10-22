// @vitest-environment jsdom
/**
 * **값 목록에 「전체 선택」을 둔다** (2026-10-22, 사용자).
 *
 * 수십 가지 가운데 하나만 빼고 보려면, 없을 때는 나머지를 전부 손으로 눌러야 한다.
 *
 * 조용히 틀릴 수 있는 자리는 **무엇을 「전체」로 보느냐**다. 안에서 찾기로 목록을
 * 줄여 둔 채 누르면, 보이지 않는 값까지 선택하는 쪽은 눌러 놓고 무엇을 선택했는지
 * 화면에서 셀 수 없다 (§5). 보이는 것만 선택하고, 그것을 검사로 못 박는다.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createFilters } from '../src/ui/filters.js';

const registry = [
  {
    key: 'univ', label: '대학명', group: 'application', type: 'text',
    numeric: false, filled: 4, cardinality: 3
  }
];
const rows = [
  { univ: '가온대학교' },
  { univ: '가온대학교' },
  { univ: '나린대학교' },
  { univ: '다솜한국대' }
];

/** 패널을 세우고, 마지막으로 올라온 필터 목록을 들고 있는다 */
function 패널세우기(filters = []) {
  document.body.innerHTML = '<div id="mount"></div>';
  const 상태 = { filters };
  const panel = createFilters({
    mount: document.querySelector('#mount'),
    read: () => ({ rows, registry, filters: 상태.filters, search: '' }),
    onChange: (next) => { 상태.filters = next; panel.render(); }
  });
  panel.render();
  return 상태;
}

/** 이름이 붙은 단추 하나. 값 목록 위의 것만 본다 */
const 단추 = (text) => [...document.querySelectorAll('#mount button')]
  .find((node) => node.textContent === text);

const 선택된값 = (상태) => 상태.filters.find((filter) => filter.key === 'univ' && filter.op === 'in')?.values;

describe('값 목록의 전체 선택·해제', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('전체 선택은 목록의 값을 모두 선택한다', () => {
    const 상태 = 패널세우기();
    단추('전체 선택').click();
    expect(new Set(선택된값(상태))).toEqual(new Set(['가온대학교', '나린대학교', '다솜한국대']));
  });

  it('이미 선택한 값은 두 번 들어가지 않는다', () => {
    const 상태 = 패널세우기([{ key: 'univ', op: 'in', values: ['나린대학교'] }]);
    단추('전체 선택').click();
    expect(선택된값(상태)).toHaveLength(3);
  });

  it('전체 해제는 그 열의 값 선택을 비운다', () => {
    const 상태 = 패널세우기([{ key: 'univ', op: 'in', values: ['가온대학교', '나린대학교'] }]);
    단추('전체 해제').click();
    expect(선택된값(상태)).toBeUndefined();
  });

  /*
   * **쓸 수 없는 단추도 자리를 지킨다**(D15). 전부 선택한 화면에서 「전체 선택」이
   * 사라지면 그 줄의 높이가 바뀌고, 방금 누른 체크박스가 손가락 밑에서 밀려난다.
   */
  it('더 선택할 것이 없으면 쓸 수 없게 두되 자리는 지킨다', () => {
    패널세우기([{ key: 'univ', op: 'in', values: ['가온대학교', '나린대학교', '다솜한국대'] }]);
    expect(단추('전체 선택').disabled).toBe(true);
    expect(단추('전체 해제').disabled).toBe(false);
  });

  it('선택한 것이 없으면 전체 해제를 쓸 수 없다', () => {
    패널세우기();
    expect(단추('전체 해제').disabled).toBe(true);
    expect(단추('전체 선택').disabled).toBe(false);
  });

  /** 머리줄 검색은 다른 자리의 다른 조작이다. 값 선택이 그것을 지우면 안 된다 */
  it('같은 열의 머리줄 검색을 지우지 않는다', () => {
    const 상태 = 패널세우기([{ key: 'univ', op: 'contains', text: '대학교' }]);
    단추('전체 선택').click();
    expect(상태.filters).toContainEqual({ key: 'univ', op: 'contains', text: '대학교' });
  });
});
