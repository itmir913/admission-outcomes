/**
 * 표의 창 계산 테스트.
 *
 * 여러 해를 쌓으면 1만 행 내외가 된다(§6). 다 그리면 필터를 건드릴 때마다 화면이 멈추므로
 * 보이는 만큼만 그리는데, 그 구간 계산이 틀리면 **표의 일부가 통째로 사라진다.**
 * 스크롤해 보기 전에는 아무도 모른다.
 */

import { describe, it, expect } from 'vitest';
import { visibleWindow, cellText, suggestWidth } from '../src/ui/table.js';

const ROW = 44;
const OVERSCAN = 8;

describe('그릴 행 구간', () => {
  it('맨 위에서는 0부터 한 화면 남짓', () => {
    const { start, end } = visibleWindow(0, 440, 1000);
    expect(start).toBe(0);
    expect(end).toBe(10 + OVERSCAN);
  });

  it('스크롤한 만큼 구간이 따라 내려간다', () => {
    const { start, end } = visibleWindow(ROW * 100, 440, 1000);
    expect(start).toBe(100 - OVERSCAN);
    expect(end).toBe(100 + 10 + OVERSCAN);
  });

  it('행 수를 넘어가지 않는다', () => {
    const { start, end } = visibleWindow(ROW * 990, 440, 1000);
    expect(end).toBe(1000);
    expect(start).toBeLessThan(end);
  });

  it('구간이 화면보다 넉넉하다', () => {
    // 스크롤할 때 빈칸이 스쳐 지나가면 표를 믿을 수 없게 된다
    const { start, end } = visibleWindow(ROW * 50, 880, 1000);
    expect(end - start).toBeGreaterThan(880 / ROW);
  });

  it('자리를 잡기 전(높이 0)에도 한 화면은 그린다', () => {
    // 아무것도 안 그리면 스크롤할 것이 없고, 스크롤 이벤트도 영영 오지 않는다
    const { start, end } = visibleWindow(0, 0, 1000);
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(0);
  });

  it('행이 없거나 스크롤이 음수여도 무너지지 않는다', () => {
    expect(visibleWindow(0, 500, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleWindow(-40, 500, 10).start).toBe(0);
  });

  it('행이 화면보다 적으면 전부 그린다', () => {
    expect(visibleWindow(0, 800, 5)).toEqual({ start: 0, end: 5 });
  });
});

describe('셀 글자', () => {
  it('빈칸은 빈 글자다', () => {
    expect(cellText('univ', null)).toBe('');
    expect(cellText('univ', '')).toBe('');
  });

  it('소수는 자리를 맞춰 자른다', () => {
    expect(cellText('gpa.전교과', 2.1)).toBe('2.10');
    expect(cellText('cohortYear', 2025)).toBe('2025');
  });

  it('파생 열은 화면 말로 바꾼다', () => {
    expect(cellText('outcome', 'waitPass')).toBe('충원합격');
  });
});

describe('열 기본 너비', () => {
  it('대학명은 넓게, 등급은 좁게 잡는다', () => {
    expect(suggestWidth({ key: 'univ' })).toBeGreaterThan(suggestWidth({ key: 'gpa.전교과', group: 'gpa' }));
  });
});
