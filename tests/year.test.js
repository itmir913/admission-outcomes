import { describe, it, expect } from 'vitest';
import {
  extractYears, findYearColumn, inferCohortYear, toCohortYear, BASIS, EARLIEST_YEAR
} from '../src/ingest/year.js';
import { senjinhakGrid, kcueGrid } from './helpers/workbook.js';

const NOW = 2026;

describe('기준 변환', () => {
  it('학년도를 고3 년도로 되돌린다', () => {
    // 2025년에 고3이었던 학생의 대입이 2026학년도다
    expect(toCohortYear(2026, BASIS.admission)).toBe(2025);
  });

  it('고3 년도는 그대로 둔다', () => {
    expect(toCohortYear(2025, BASIS.senior)).toBe(2025);
  });

  it('기준을 모르면 값을 만들지 않는다', () => {
    // 한 해 밀린 자료는 겉보기에 멀쩡해서 잘못을 알아챌 수 없다. 추측하지 않는다
    expect(toCohortYear(2025, BASIS.unknown)).toBeNull();
  });

  it('정수가 아니면 null이다', () => {
    expect(toCohortYear('2025', BASIS.senior)).toBeNull();
    expect(toCohortYear(null, BASIS.senior)).toBeNull();
  });
});

describe('문자열에서 연도 뽑기', () => {
  it('학년도 표기는 학년도로 분류한다', () => {
    const found = extractYears('2024학년도 진학결과', { currentYear: NOW });
    expect(found.admission).toEqual([2024]);
    expect(found.unknown).toEqual([]);
  });

  it('표기와 숫자 사이 공백을 허용한다', () => {
    expect(extractYears('2024 학년도', { currentYear: NOW }).admission).toEqual([2024]);
  });

  it('두 자리 학년도 표기를 2000년대로 편다', () => {
    expect(extractYears('24학년도 수시', { currentYear: NOW }).admission).toEqual([2024]);
  });

  it('"년"과 "년도"는 학년도로 단정하지 않는다', () => {
    // 2024년 진학결과가 2024학년도인지 2024년 고3인지 알 수 없다
    const found = extractYears('2024년 진학결과', { currentYear: NOW });
    expect(found.admission).toEqual([]);
    expect(found.unknown).toEqual([2024]);
  });

  it('맨 네 자리는 기준을 알 수 없다', () => {
    const found = extractYears('대교협_2022_최종.xlsx', { currentYear: NOW });
    expect(found.admission).toEqual([]);
    expect(found.unknown).toEqual([2022]);
  });

  it('두 자리는 학년도 표기가 붙었을 때만 인정한다', () => {
    const found = extractYears('3학년 24명', { currentYear: NOW });
    expect(found.admission).toEqual([]);
    expect(found.unknown).toEqual([]);
  });

  it('학년도와 작성일이 섞여 있으면 학년도만 확정한다', () => {
    const found = extractYears('2024학년도_대교협_20250131.xlsx', { currentYear: NOW });
    expect(found.admission).toEqual([2024]);
    expect(found.unknown).not.toContain(2024);
  });

  it('미래로 너무 먼 값을 거른다', () => {
    expect(extractYears('2099학년도', { currentYear: NOW }).admission).toEqual([]);
  });

  it('다음 학년도는 정상으로 본다', () => {
    // 2027학년도 입시는 2026년에 치른다
    expect(extractYears('2027학년도', { currentYear: NOW }).admission).toEqual([2027]);
  });

  it('너무 오래된 값을 거른다', () => {
    expect(extractYears(`${EARLIEST_YEAR - 1}학년도`, { currentYear: NOW }).admission).toEqual([]);
  });

  it('빈 값과 잘못된 입력을 견딘다', () => {
    expect(extractYears('', { currentYear: NOW })).toEqual({ admission: [], unknown: [] });
    expect(extractYears(null, { currentYear: NOW })).toEqual({ admission: [], unknown: [] });
  });
});

describe('격자에서 연도 열 찾기', () => {
  it('값이 연도인 열을 찾아낸다', () => {
    const found = findYearColumn(senjinhakGrid(2026), { currentYear: NOW });
    expect(found.column).toBe(0);
    expect(found.uniform).toBe(true);
    expect(found.values).toEqual([2026]);
  });

  it('학년(3)이 든 열을 연도로 오해하지 않는다', () => {
    // 대교협 파일의 `학년` 열에는 3이 들어 있다. 이름이 같아도 값이 다르다
    expect(findYearColumn(kcueGrid(), { currentYear: NOW, headerRows: 2 })).toBeNull();
  });

  it('달력 연도를 넘는 값이 있으면 학년도로 확정한다', () => {
    // 고3 년도는 올해를 넘을 수 없다. 넘었다면 학년도다
    const grid = [['연도'], [2027], [2027], [2027]];
    expect(findYearColumn(grid, { currentYear: NOW }).basis).toBe(BASIS.admission);
  });

  it('달력 연도를 넘지 않으면 기준을 단정하지 않는다', () => {
    // 2025는 고3 년도일 수도 학년도일 수도 있다
    const grid = [['연도'], [2025], [2025], [2025]];
    expect(findYearColumn(grid, { currentYear: NOW }).basis).toBe(BASIS.unknown);
  });

  it('여러 연도가 섞여 있으면 uniform이 아니다', () => {
    const grid = [['연도'], [2024], [2025], [2026], [2024]];
    const found = findYearColumn(grid, { currentYear: NOW });
    expect(found.uniform).toBe(false);
    expect(found.values).toEqual([2024, 2025, 2026]);
  });

  it('표본이 너무 적으면 판단하지 않는다', () => {
    expect(findYearColumn([['연도'], [2024]], { currentYear: NOW })).toBeNull();
  });

  it('연도 아닌 값이 많이 섞이면 그 열을 쓰지 않는다', () => {
    const grid = [['값'], [2024], [2025], ['미정'], ['해당없음'], ['-'], [3]];
    expect(findYearColumn(grid, { currentYear: NOW })).toBeNull();
  });

  it('문자열로 저장된 연도도 읽는다', () => {
    const grid = [['연도'], ['2024'], ['2024'], ['2024']];
    expect(findYearColumn(grid, { currentYear: NOW }).values).toEqual([2024]);
  });

  it('빈 격자를 견딘다', () => {
    expect(findYearColumn([], { currentYear: NOW })).toBeNull();
    expect(findYearColumn([['a']], { currentYear: NOW })).toBeNull();
  });
});

describe('고3 년도 추론', () => {
  it('프로파일이 알려 준 기준으로 변환한다', () => {
    // 센진학의 연도 열은 학년도 기준이다. 2026 → 고3 년도 2025
    const guess = inferCohortYear({
      fileName: '센진학.xlsx',
      grid: senjinhakGrid(2026),
      columnBasis: BASIS.admission,
      currentYear: NOW
    });
    expect(guess.cohortYear).toBe(2025);
    expect(guess.source).toBe('cell');
    expect(guess.confidence).toBe('high');
    expect(guess.needsInput).toBe(false);
  });

  it('기준을 모르면 연도를 확정하지 않고 사용자에게 넘긴다', () => {
    const guess = inferCohortYear({ grid: senjinhakGrid(2025), currentYear: NOW });
    expect(guess.cohortYear).toBeNull();
    expect(guess.needsInput).toBe(true);
    expect(guess.rawCandidates).toEqual([2025]);
  });

  it('값이 달력 연도를 넘으면 기준을 스스로 확정한다', () => {
    // 프로파일이 없어도 2027은 고3 년도일 수 없다
    const guess = inferCohortYear({ grid: senjinhakGrid(2027), currentYear: NOW });
    expect(guess.basis).toBe(BASIS.admission);
    expect(guess.cohortYear).toBe(2026);
    expect(guess.needsInput).toBe(false);
  });

  it('셀에 없으면 파일명의 학년도 표기를 쓴다', () => {
    const guess = inferCohortYear({
      fileName: '2024학년도_대교협_수시결과.xlsx',
      grid: kcueGrid(),
      headerRows: 2,
      currentYear: NOW
    });
    expect(guess.cohortYear).toBe(2023);
    expect(guess.source).toBe('filename');
    expect(guess.confidence).toBe('high');
  });

  it('파일명에 없으면 시트명에서 찾는다', () => {
    const guess = inferCohortYear({
      fileName: '진학결과.xlsx',
      sheetName: '2023학년도',
      grid: kcueGrid(),
      headerRows: 2,
      currentYear: NOW
    });
    expect(guess.cohortYear).toBe(2022);
    expect(guess.source).toBe('sheet');
  });

  it('기준을 알 수 없는 파일명이면 확정하지 않는다', () => {
    // "2022"가 고3 년도인지 학년도인지 알 수 없다. 한 해 밀릴 위험을 감수하지 않는다
    const guess = inferCohortYear({ fileName: '대교협_2022.xlsx', currentYear: NOW });
    expect(guess.cohortYear).toBeNull();
    expect(guess.confidence).toBe('low');
    expect(guess.needsInput).toBe(true);
    expect(guess.rawCandidates).toEqual([2022]);
  });

  it('학년도 후보가 여럿이면 확정하지 않고 전부 남긴다', () => {
    const guess = inferCohortYear({ fileName: '2022학년도_2023학년도_통합.xlsx', currentYear: NOW });
    expect(guess.cohortYear).toBeNull();
    expect(guess.needsInput).toBe(true);
    expect(guess.rawCandidates).toEqual([2022, 2023]);
  });

  it('한 파일에 여러 연도가 섞이면 행마다 읽도록 알린다', () => {
    const grid = [['연도', '대학'], [2024, '가'], [2025, '나'], [2027, '다']];
    const guess = inferCohortYear({ fileName: '누적.xlsx', grid, currentYear: NOW });
    expect(guess.cohortYear).toBeNull();
    expect(guess.yearColumn).toBe(0);
    expect(guess.basis).toBe(BASIS.admission);
    expect(guess.rawCandidates).toEqual([2024, 2025, 2027]);
  });

  it('아무 데서도 못 찾으면 입력을 요청한다', () => {
    const guess = inferCohortYear({ fileName: '진학결과.xlsx', sheetName: 'Sheet1', currentYear: NOW });
    expect(guess.cohortYear).toBeNull();
    expect(guess.confidence).toBe('none');
    expect(guess.needsInput).toBe(true);
  });

  it('인자 없이 불러도 터지지 않는다', () => {
    expect(inferCohortYear().needsInput).toBe(true);
  });
});
