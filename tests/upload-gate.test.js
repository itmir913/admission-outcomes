/**
 * **넣지 않기로 한 시트는 불러오기를 막지 않는다.**
 *
 * 여러 파일을 한꺼번에 올리면 그중 하나는 읽지 못하는 양식인 일이 드물지 않다.
 * 그때 사람은 그것만 체크를 끄고 나머지를 불러온다 — 그런데 꺼 놓은 시트의 문제가
 * 단추를 계속 잠그고 있으면, 자기가 선택한 멀쩡한 파일을 의심하게 된다.
 * 화면에는 "저 파일이 문제다"라고 쓰여 있고 그 파일은 이미 꺼져 있다.
 *
 * 막는 조건을 화면에서 떼어 내 여기서 고정한다. 화면 구조가 바뀌어도 규칙은 그대로여야 한다.
 */

import { describe, it, expect } from 'vitest';

import { uploadBlockers, chosenCount, needsFileYear, yearLooksSane, toSchoolYear } from '../src/ui/upload.js';

/** 읽을 수 있는 시트. 연도 열이 없어 파일 단위 고3 년도를 요구한다. */
function readable(id, name = `${id}.xlsx`) {
  return { id, fileName: name, profile: { id: 'demo-1', columns: { univ: 0 } } };
}

/** 행마다 연도가 실린 누적 시트. 파일 연도를 비워 둬도 된다. */
function perRowYear(id, name = `${id}.xlsx`) {
  return { id, fileName: name, profile: { id: 'demo-2', yearBasis: 'admission', columns: { univ: 0, sourceYear: 3 } } };
}

/** 열 구성을 알아보지 못한 시트. */
function unreadable(id, name = `${id}.xlsx`) {
  return { id, fileName: name, profile: null };
}

const 넣음 = (cohortYear = 2025) => ({ cohortYear, include: true });
const 뺌 = (cohortYear = null) => ({ cohortYear, include: false });

describe('불러오기를 막는 조건', () => {
  it('체크를 끈 시트는 읽지 못해도 막지 않는다', () => {
    const sheets = [readable('a'), unreadable('b')];
    const decisions = new Map([['a', 넣음(2025)], ['b', 뺌()]]);
    expect(uploadBlockers(sheets, decisions)).toEqual([]);
  });

  it('체크를 끈 시트는 고3 년도가 비어 있어도 막지 않는다', () => {
    const sheets = [readable('a'), readable('b')];
    const decisions = new Map([['a', 넣음(2025)], ['b', { cohortYear: null, include: false }]]);
    expect(uploadBlockers(sheets, decisions)).toEqual([]);
  });

  it('켜 둔 시트가 읽히지 않으면 막는다', () => {
    const sheets = [unreadable('a', '새양식.xlsx')];
    const decisions = new Map([['a', 넣음(2025)]]);
    expect(uploadBlockers(sheets, decisions)).toEqual(['새양식.xlsx: 열 구성을 알아보지 못했습니다']);
  });

  it('켜 둔 시트에 고3 년도가 없으면 막는다 — 한 해 밀린 자료는 알아챌 방법이 없다', () => {
    const sheets = [readable('a', '수시결과.xlsx')];
    const decisions = new Map([['a', { cohortYear: null, include: true }]]);
    expect(uploadBlockers(sheets, decisions)).toEqual(['수시결과.xlsx: 고3 년도를 넣어 주세요']);
  });

  it('행마다 연도가 실린 파일은 고3 년도를 비워 둬도 막지 않는다', () => {
    const sheets = [perRowYear('a')];
    const decisions = new Map([['a', { cohortYear: null, include: true }]]);
    expect(uploadBlockers(sheets, decisions)).toEqual([]);
  });

  it('막는 이유를 시트마다 하나씩 모은다 — 첫 하나만 고쳐도 또 막히는 이유를 알 수 있다', () => {
    const sheets = [unreadable('a', '가.xlsx'), readable('b', '나.xlsx')];
    const decisions = new Map([['a', 넣음(2025)], ['b', { cohortYear: null, include: true }]]);
    expect(uploadBlockers(sheets, decisions)).toEqual([
      '가.xlsx: 열 구성을 알아보지 못했습니다',
      '나.xlsx: 고3 년도를 넣어 주세요'
    ]);
  });

  it('평범한 객체로 넘겨도 같게 센다 — 결정은 Map으로도 기록으로도 돈다', () => {
    const sheets = [readable('a'), unreadable('b')];
    expect(uploadBlockers(sheets, { a: 넣음(2025), b: 뺌() })).toEqual([]);
  });
});

describe('선택한 시트 수', () => {
  it('켜 둔 것만 센다', () => {
    const sheets = [readable('a'), readable('b'), readable('c')];
    const decisions = new Map([['a', 넣음()], ['b', 뺌()], ['c', 넣음()]]);
    expect(chosenCount(sheets, decisions)).toBe(2);
  });

  it('전부 끄면 0이다 — 막을 이유는 없지만 불러올 것도 없다', () => {
    const sheets = [readable('a')];
    const decisions = new Map([['a', 뺌()]]);
    expect(uploadBlockers(sheets, decisions)).toEqual([]);
    expect(chosenCount(sheets, decisions)).toBe(0);
  });
});

describe('파일 단위 고3 년도가 필요한지', () => {
  it('연도 열이 있고 기준이 밝혀져 있으면 필요 없다', () => {
    expect(needsFileYear(perRowYear('a'))).toBe(false);
  });

  it('연도 열이 없으면 필요하다', () => {
    expect(needsFileYear(readable('a'))).toBe(true);
  });

  it('연도 열은 있는데 기준이 없으면 필요하다 — 기준을 모르면 값을 만들지 않는다', () => {
    const sheet = { id: 'a', fileName: 'a.xlsx', profile: { columns: { univ: 0, sourceYear: 3 } } };
    expect(needsFileYear(sheet)).toBe(true);
  });

  it('프로파일이 아예 없어도 던지지 않는다', () => {
    expect(needsFileYear({ id: 'a', profile: null })).toBe(true);
  });
});

describe('고3 년도의 상식적 범위', () => {
  it('올해보다 한 해까지는 받는다', () => {
    expect(yearLooksSane(2026, 2026)).toBe(true);
    expect(yearLooksSane(2027, 2026)).toBe(true);
    expect(yearLooksSane(2028, 2026)).toBe(false);
  });

  it('학년도는 고3 년도보다 한 해 뒤다', () => {
    expect(toSchoolYear(2025)).toBe(2026);
  });
});
