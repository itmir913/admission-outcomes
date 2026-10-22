/**
 * **값 목록은 사전순이다** (2026-10-22, 사용자).
 *
 * 건수순으로 두었더니 대학이 수십 가지인 목록에서 찾는 이름이 어디쯤에 있는지
 * 확인할 수가 없었다. 건수는 사람이 외우고 있는 것이 아니다.
 *
 * 다만 **순서가 있는 값은 값순이어야 한다.** 연도를 사전순으로 늘어놓으면
 * 2023·2024·2025가 아니라 글자 순서로 서고, 등급도 마찬가지다. 그러면 어느 해가
 * 빠졌는지 눈으로 셀 수 없다 — 빠진 줄은 아무 표시도 내지 않는다 (§5).
 */

import { describe, it, expect } from 'vitest';

import { entryOrder } from '../src/ui/filters.js';

/** 목록 한 줄. `entryOrder`가 보는 것만 담는다 */
const 줄 = (value, label, count) => ({ value, label: label ?? String(value), count });

const 늘어놓기 = (field, entries) => [...entries].sort(entryOrder(field)).map((entry) => entry.label);

describe('값 목록의 순서', () => {
  const 글자열 = { key: 'univ', label: '대학명', type: 'text', numeric: false };

  it('글자 값은 사전순이다 — 건수가 많아도 앞으로 오지 않는다', () => {
    expect(늘어놓기(글자열, [
      줄('하늘대학교', '하늘대학교', 99),
      줄('가온대학교', '가온대학교', 1),
      줄('나린대학교', '나린대학교', 50)
    ])).toEqual(['가온대학교', '나린대학교', '하늘대학교']);
  });

  /** 괄호로 시작해 사전순으로는 맨 앞에 선다. 이름이 아니라 이름이 없다는 표시다 */
  it('「(빈칸)」은 맨 뒤다', () => {
    expect(늘어놓기(글자열, [
      줄(null, '(빈칸)', 7),
      줄('가온대학교', '가온대학교', 1)
    ])).toEqual(['가온대학교', '(빈칸)']);
  });

  it('연도는 최근 해가 위다', () => {
    const 연도열 = { key: 'cohortYear', label: '고3 년도', type: 'year', numeric: true };
    expect(늘어놓기(연도열, [줄(2023), 줄(2025), 줄(2024)])).toEqual(['2025', '2024', '2023']);
  });

  /*
   * **결과는 사람이 읽는 차례가 따로 있다.** 사전순으로 세우면 불합격이 맨 위에 선다.
   * 그 차례는 표가 쓰는 것(`query.js`의 뜻 순서)을 그대로 가져온다 — 두 군데 적어
   * 두면 표와 목록이 서로 다른 차례로 서는 날이 온다.
   */
  it('결과는 합격 → 충원합격 → 불합격 → 판정 미상 순이다', () => {
    const 결과열 = { key: 'outcome', label: '결과', type: 'enum', numeric: false };
    expect(늘어놓기(결과열, [
      줄('fail', '불합격', 106),
      줄('unknown', '판정 미상', 3),
      줄('pass', '합격', 33),
      줄('waitPass', '충원합격', 22)
    ])).toEqual(['합격', '충원합격', '불합격', '판정 미상']);
  });

  it('등록 여부도 뜻 순서다', () => {
    const 등록열 = { key: 'registered', label: '등록', type: 'enum', numeric: false };
    expect(늘어놓기(등록열, [
      줄('declined', '미등록', 4),
      줄('registered', '등록', 9)
    ])).toEqual(['등록', '미등록']);
  });

  it('숫자는 작은 값이 앞선다', () => {
    const 숫자열 = { key: 'waitRank', label: '예비순위', type: 'number', numeric: true };
    expect(늘어놓기(숫자열, [줄(10), 줄(2), 줄(7)])).toEqual(['2', '7', '10']);
  });
});
