/**
 * 결과 해석 테스트.
 *
 * 여기가 틀리면 합격률이 통째로 틀린다. 그런데 화면은 멀쩡해 보인다.
 * 실제 두 양식에서 나온 표기를 그대로 넣어 본다.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyOutcome, stage1Passed, registerState, unknownOutcomeTerms, OUTCOME
} from '../src/core/outcome.js';

describe('최종 결과 읽기', () => {
  it('양식마다 다른 표기를 같은 뜻으로 읽는다', () => {
    // 대교협은 `합격`/`불합격`, 센진학은 `합`/`불`로 적는다
    expect(classifyOutcome({ final: '합격' }).code).toBe(OUTCOME.pass);
    expect(classifyOutcome({ final: '합' }).code).toBe(OUTCOME.pass);
    expect(classifyOutcome({ final: '불합격' }).code).toBe(OUTCOME.fail);
    expect(classifyOutcome({ final: '불' }).code).toBe(OUTCOME.fail);
  });

  it('충원합격을 따로 세면서도 합격으로 친다', () => {
    const outcome = classifyOutcome({ final: '충원합격' });
    expect(outcome.code).toBe(OUTCOME.waitPass);
    expect(outcome.passed).toBe(true);
    // 최초합격과 구분해 볼 수 있어야 하므로 code는 남는다
    expect(outcome.code).not.toBe(OUTCOME.pass);
  });

  it('부분 일치로 불합격을 합격으로 뒤집지 않는다', () => {
    // `1단계 불합격`은 `합격`을 품고 있다. 여기서 한 번 틀리면 알아챌 방법이 없다
    expect(classifyOutcome({ final: '1단계 불합격' }).code).toBe(OUTCOME.unknown);
    expect(classifyOutcome({ final: '불합격' }).passed).toBe(false);
  });

  it('모르는 표기를 어느 쪽으로도 밀어 넣지 않는다', () => {
    const outcome = classifyOutcome({ final: '보류' });
    expect(outcome.code).toBe(OUTCOME.unknown);
    expect(outcome.passed).toBe(false);
    // 무엇을 못 읽었는지 사람이 볼 수 있어야 사전에 한 줄을 더한다
    expect(outcome.raw).toBe('보류');
    expect(outcome.label).toBe('보류');
  });

  it('빈칸은 불합격이 아니라 기록 없음이다', () => {
    expect(classifyOutcome({}).code).toBe(OUTCOME.none);
    expect(classifyOutcome({ final: null }).code).toBe(OUTCOME.none);
    expect(classifyOutcome({ final: '  ' }).code).toBe(OUTCOME.none);
  });

  it('최종이 비어도 1단계에서 탈락했으면 불합격이다', () => {
    const outcome = classifyOutcome({ final: null, stage1: '불합격' });
    expect(outcome.code).toBe(OUTCOME.fail);
    expect(outcome.label).toBe('1단계 불합격');
  });

  it('1단계 합격을 최종 합격으로 세지 않는다', () => {
    // 2단계가 남아 있다. 여기서 합격으로 세면 합격자가 부풀어 오른다
    const outcome = classifyOutcome({ final: null, stage1: '합격' });
    expect(outcome.passed).toBe(false);
    expect(outcome.code).toBe(OUTCOME.none);
  });

  it('색 말고 모양으로도 구분된다', () => {
    const marks = ['합격', '충원합격', '불합격'].map((final) => classifyOutcome({ final }).mark);
    expect(new Set(marks).size).toBe(3);
  });
});

describe('1단계 통과 여부', () => {
  it('통과·탈락·해당 없음 셋을 섞지 않는다', () => {
    expect(stage1Passed({ stage1: '합' })).toBe(true);
    expect(stage1Passed({ stage1: '불합격' })).toBe(false);
    // 일괄합산 전형은 1단계 열이 아예 비어 있다. 탈락이 아니다
    expect(stage1Passed({ stage1: null })).toBe(null);
    expect(stage1Passed({ stage1: '???' })).toBe(null);
  });
});

describe('등록 여부', () => {
  it('양식마다 다른 표기를 읽는다', () => {
    expect(registerState({ register: '등록' })).toBe('registered');
    expect(registerState({ register: 'Y' })).toBe('registered');
    expect(registerState({ register: '등록포기' })).toBe('declined');
  });

  it('빈칸을 포기로 세지 않는다', () => {
    // 등록 열을 채우지 않고 넘어간 파일이 실제로 있다.
    // 빈칸을 포기로 읽으면 진학자 수가 통째로 무너진다
    expect(registerState({})).toBe('none');
    expect(registerState({ register: null })).toBe('none');
  });
});

describe('못 읽은 표기 모으기', () => {
  it('열별로 무엇을 몇 건 못 읽었는지 알린다', () => {
    const found = unknownOutcomeTerms([
      { final: '합격' },
      { final: '보류' },
      { final: '보류' },
      { final: '합격', stage1: '대기' },
      { final: '합격', register: '???' }
    ]);
    expect(found).toEqual([
      { field: '최종', value: '보류', count: 2 },
      { field: '1단계', value: '대기', count: 1 },
      { field: '등록', value: '???', count: 1 }
    ]);
  });

  it('전부 해석되면 아무것도 알리지 않는다', () => {
    expect(unknownOutcomeTerms([{ final: '합', stage1: '합', register: '등록' }])).toEqual([]);
  });
});
