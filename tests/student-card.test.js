// @vitest-environment jsdom
/**
 * **학생 상세의 대학명을 눌러 그 대학을 필터에 더한다** (2026-10-22, 사용자).
 *
 * 이 자리는 조용히 틀릴 길이 둘이다.
 *
 * - **학과명까지 누를 수 있게 되는 것.** 학과 이름 표기는 학교마다 달라서
 *   (국제통상학과·글로벌통상학부) 학과로 거른 표는 「이 학과 현황」처럼 보이지만
 *   실제로는 표기가 같은 학교만 모인 것이다. 뒤집히기 쉬운 결정이라 검사로 못 박는다.
 * - **필터를 제자리에서 고치는 것.** `query.js`의 라벨 캐시가 `values` 배열 객체를
 *   키로 삼는다. 제자리에서 더하면 칩에는 적혀 있는데 표에서는 걸리지 않고,
 *   예외도 다른 테스트 실패도 없다. 그래서 `applyQuery`까지 끌고 와 검사한다.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { addValueFilter } from '../src/ui/filters.js';
import { openStudent } from '../src/ui/student.js';
import { applyQuery } from '../src/analysis/query.js';

/** 지원 한 건. 카드가 읽는 자리만 채운다 */
function 지원(univ, dept, extra = {}) {
  return {
    sid: '2025-TEST-0001',
    cohortYear: 2025,
    univ,
    dept,
    admType: '학생부위주(교과)',
    outcome: 'pass',
    '#outcome': { code: 'pass', label: '합격', mark: '●', passed: true },
    ...extra
  };
}

describe('addValueFilter', () => {
  it('없던 값을 더한다', () => {
    const next = addValueFilter([], 'univ', '가온대학교');
    expect(next).toEqual([{ key: 'univ', op: 'in', values: ['가온대학교'] }]);
  });

  it('이미 선택한 값이면 바뀔 것이 없다고 알린다', () => {
    const before = [{ key: 'univ', op: 'in', values: ['가온대학교'] }];
    expect(addValueFilter(before, 'univ', '가온대학교')).toBeNull();
  });

  it('선택한 값에 덧붙인다 — 앞서 선택한 것을 지우지 않는다', () => {
    const before = [{ key: 'univ', op: 'in', values: ['가온대학교'] }];
    const next = addValueFilter(before, 'univ', '나린대학교');
    expect(next).toEqual([{ key: 'univ', op: 'in', values: ['가온대학교', '나린대학교'] }]);
  });

  it('원본과 그 안의 배열을 건드리지 않는다', () => {
    const values = ['가온대학교'];
    const before = [{ key: 'univ', op: 'in', values }];
    const next = addValueFilter(before, 'univ', '나린대학교');
    expect(values).toEqual(['가온대학교']);
    expect(next[0].values).not.toBe(values);
    expect(next).not.toBe(before);
  });

  it('같은 열의 머리줄 검색과 다른 열의 필터는 그대로 둔다', () => {
    const before = [
      { key: 'univ', op: 'contains', text: '대학' },
      { key: 'cohortYear', op: 'in', values: [2025] }
    ];
    const next = addValueFilter(before, 'univ', '가온대학교');
    expect(next).toContainEqual({ key: 'univ', op: 'contains', text: '대학' });
    expect(next).toContainEqual({ key: 'cohortYear', op: 'in', values: [2025] });
    expect(next).toContainEqual({ key: 'univ', op: 'in', values: ['가온대학교'] });
  });

  /*
   * 보관된 화면 상태는 모양만 검사해 들어오므로(`prefs.js`) 같은 열의 `in`이 둘일 수
   * 있다. 둘이 남으면 교집합이 되어 표가 비는데, 칩줄만 보고는 까닭을 알 수 없다.
   */
  it('같은 열의 in 필터가 둘이면 하나로 합친다', () => {
    const before = [
      { key: 'univ', op: 'in', values: ['가온대학교'] },
      { key: 'univ', op: 'in', values: ['나린대학교'] }
    ];
    const next = addValueFilter(before, 'univ', '다솜대학교');
    expect(next).toEqual([
      { key: 'univ', op: 'in', values: ['가온대학교', '나린대학교', '다솜대학교'] }
    ]);
  });

  it('이미 있는 값이어도 in 필터가 둘이면 합쳐서 돌려준다', () => {
    const before = [
      { key: 'univ', op: 'in', values: ['가온대학교'] },
      { key: 'univ', op: 'in', values: ['나린대학교'] }
    ];
    expect(addValueFilter(before, 'univ', '가온대학교')).toEqual([
      { key: 'univ', op: 'in', values: ['가온대학교', '나린대학교'] }
    ]);
  });

  /*
   * 겹친 값을 그대로 쌓으면 거르는 결과는 맞는데 칩이 「가온대학교, 가온대학교」로
   * 적히고, 값이 많을 때 「… 외 N」의 N까지 틀린다.
   */
  it('합칠 때 겹치는 값은 하나로 줄인다', () => {
    const before = [
      { key: 'univ', op: 'in', values: ['가온대학교', '나린대학교'] },
      { key: 'univ', op: 'in', values: ['가온대학교'] }
    ];
    expect(addValueFilter(before, 'univ', '가온대학교')).toEqual([
      { key: 'univ', op: 'in', values: ['가온대학교', '나린대학교'] }
    ]);
  });

  /*
   * **같은 값인지는 라벨로 본다.** 세는 쪽도 거르는 쪽도 라벨로 견주므로, 여기만
   * 원값으로 보면 목록에서 한 줄인 것이 필터에는 둘로 들어간다. `outcome`은
   * 저장값(`pass`)과 화면 글자(`합격`)가 다른 열이라 이 차이가 드러난다.
   */
  it('라벨이 같으면 이미 선택한 값으로 본다', () => {
    const before = [{ key: 'outcome', op: 'in', values: ['pass'] }];
    expect(addValueFilter(before, 'outcome', 'pass')).toBeNull();
  });

  /**
   * 칩에는 적혀 있는데 표에서는 안 걸리는 일이 없어야 한다.
   *
   * **거르기를 두 번 실행하는 순서가 이 검사의 핵심이다.** 제자리에서 고치는
   * 구현이라면 첫 호출이 채운 라벨 캐시(`query.js`가 `values` 배열을 키로 쓴다)에
   * 둘째 호출이 그대로 적중해, 두 대학을 걸었는데 한 대학만 걸린다.
   */
  it('더한 값으로 실제로 걸러진다', () => {
    const rows = [지원('가온대학교', '국제통상학과'), 지원('나린대학교', '행정학과')];
    const one = addValueFilter([], 'univ', '가온대학교');
    expect(applyQuery(rows, { filters: one, search: '', sorts: [] })).toHaveLength(1);

    const two = addValueFilter(one, 'univ', '나린대학교');
    expect(applyQuery(rows, { filters: two, search: '', sorts: [] })).toHaveLength(2);
  });
});

describe('지원 카드의 대학명', () => {
  /** @type {HTMLDialogElement} */
  let dialog;

  beforeEach(() => {
    document.body.replaceChildren();
    dialog = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
    // jsdom 에 showModal 이 없는 판이 있다. 이 검사가 보려는 것은 상자 안의 내용이다
    if (typeof dialog.showModal !== 'function') dialog.showModal = function () { this.open = true; };
    document.body.append(dialog);
  });

  const 열기 = (rows, onUnivFilter) => openStudent(dialog, { sid: '2025-TEST-0001', rows, onUnivFilter });

  it('대학명이 단추이고, 누르면 그 대학으로 불린다', () => {
    const 불린값 = [];
    열기([지원('가온대학교', '국제통상학과')], (univ) => 불린값.push(univ));

    const button = dialog.querySelector('h4 button');
    expect(button).not.toBeNull();
    expect(button.textContent).toBe('가온대학교');
    expect(button.getAttribute('type')).toBe('button');
    button.click();
    expect(불린값).toEqual(['가온대학교']);
  });

  /*
   * **머리글의 이름은 대학명 그대로여야 한다.**
   *
   * 단추에 `aria-label`로 하는 일을 적으면 그 글이 단추의 이름을 대체하고,
   * 머리글의 이름은 자손에서 계산되므로 `h4`까지 「대학 … 필터에 추가」가 된다.
   * 머리글로 훑는 사람이 카드 제목을 잃는데, 화면을 눈으로 보면 멀쩡하다 (§5).
   */
  it('머리글의 이름이 대학명이다 — 단추가 가로채지 않는다', () => {
    열기([지원('가온대학교', '국제통상학과')], () => {});
    const heading = dialog.querySelector('h4');
    expect(heading).not.toBeNull();
    expect(heading.textContent).toBe('가온대학교');
    expect(heading.querySelector('button').hasAttribute('aria-label')).toBe(false);
  });

  it('하는 일은 설명 자리에 적는다', () => {
    열기([지원('가온대학교', '국제통상학과')], () => {});
    expect(dialog.querySelector('h4 button').getAttribute('title')).toBe('이 대학을 필터에 추가');
  });

  it('학과명은 누를 수 없다', () => {
    열기([지원('가온대학교', '국제통상학과')], () => {});
    const 단추글자 = [...dialog.querySelectorAll('button')].map((node) => node.textContent);
    expect(단추글자).not.toContain('국제통상학과');
  });

  it('누를 길이 없으면 단추를 두지 않는다', () => {
    열기([지원('가온대학교', '국제통상학과')], undefined);
    expect(dialog.querySelector('h4 button')).toBeNull();
  });

  it('대학을 모르는 건은 누를 수 없다', () => {
    열기([지원(null, '국제통상학과')], () => {});
    expect(dialog.querySelector('h4 button')).toBeNull();
    expect(dialog.querySelector('h4').textContent).toBe('(대학 미상)');
  });
});
