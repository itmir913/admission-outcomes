import { describe, it, expect } from 'vitest';
import { extractYears, findYearColumn, inferYear, EARLIEST_YEAR } from '../src/ingest/year.js';
import { senjinhakGrid, kcueGrid } from './helpers/workbook.js';

const NOW = 2026;

describe('문자열에서 학년도 뽑기', () => {
  it('학년도 표지가 붙은 값을 찾는다', () => {
    expect(extractYears('2024학년도 진학결과', { currentYear: NOW }).marked).toEqual([2024]);
  });

  it('표지와 숫자 사이 공백을 허용한다', () => {
    expect(extractYears('2024 학년도', { currentYear: NOW }).marked).toEqual([2024]);
  });

  it('년도·년 표기도 인정한다', () => {
    expect(extractYears('2023년도 결과', { currentYear: NOW }).marked).toEqual([2023]);
    expect(extractYears('2023년 결과', { currentYear: NOW }).marked).toEqual([2023]);
  });

  it('두 자리 표기를 2000년대로 편다', () => {
    expect(extractYears('24학년도 수시', { currentYear: NOW }).marked).toEqual([2024]);
  });

  it('두 자리는 표지가 붙었을 때만 인정한다', () => {
    // "24"만 있는 문자열을 2024로 읽으면 반 번호·인원수를 학년도로 오해한다
    const found = extractYears('3학년 24명', { currentYear: NOW });
    expect(found.marked).toEqual([]);
    expect(found.bare).toEqual([]);
  });

  it('표지 없는 네 자리는 따로 담는다', () => {
    const found = extractYears('대교협_2022_최종.xlsx', { currentYear: NOW });
    expect(found.marked).toEqual([]);
    expect(found.bare).toEqual([2022]);
  });

  it('학년도와 작성일이 섞여 있으면 학년도 쪽만 표지로 잡는다', () => {
    // 실제로 흔한 파일명이다
    const found = extractYears('2024학년도_대교협_20250131.xlsx', { currentYear: NOW });
    expect(found.marked).toEqual([2024]);
    expect(found.bare).not.toContain(2024);
  });

  it('미래로 너무 먼 값을 거른다', () => {
    expect(extractYears('2099학년도', { currentYear: NOW }).marked).toEqual([]);
  });

  it('다음 학년도는 정상으로 본다', () => {
    // 2027학년도 입시는 2026년에 치른다
    expect(extractYears('2027학년도', { currentYear: NOW }).marked).toEqual([2027]);
  });

  it('너무 오래된 값을 거른다', () => {
    expect(extractYears(`${EARLIEST_YEAR - 1}학년도`, { currentYear: NOW }).marked).toEqual([]);
  });

  it('여러 학년도가 있으면 모두 담는다', () => {
    expect(extractYears('2022~2024학년도', { currentYear: NOW }).bare).toContain(2022);
  });

  it('빈 값과 잘못된 입력을 견딘다', () => {
    expect(extractYears('', { currentYear: NOW })).toEqual({ marked: [], bare: [] });
    expect(extractYears(null, { currentYear: NOW })).toEqual({ marked: [], bare: [] });
  });
});

describe('격자에서 학년도 열 찾기', () => {
  it('값이 학년도인 열을 찾아낸다', () => {
    const found = findYearColumn(senjinhakGrid(2026), { currentYear: NOW });
    expect(found.column).toBe(0);
    expect(found.uniform).toBe(true);
    expect(found.values).toEqual([2026]);
  });

  it('학년(3)이 든 열을 학년도로 오해하지 않는다', () => {
    // 대교협 파일의 `학년` 열에는 3이 들어 있다. 이름이 같아도 값이 다르다
    expect(findYearColumn(kcueGrid(), { currentYear: NOW, headerRows: 2 })).toBeNull();
  });

  it('여러 학년도가 섞여 있으면 uniform이 아니다', () => {
    const grid = [
      ['학년도', '대학'],
      [2024, '가'], [2025, '나'], [2026, '다'], [2024, '라']
    ];
    const found = findYearColumn(grid, { currentYear: NOW });
    expect(found.uniform).toBe(false);
    expect(found.values).toEqual([2024, 2025, 2026]);
  });

  it('표본이 너무 적으면 판단하지 않는다', () => {
    expect(findYearColumn([['학년도'], [2024]], { currentYear: NOW })).toBeNull();
  });

  it('학년도 아닌 값이 많이 섞이면 그 열을 쓰지 않는다', () => {
    const grid = [
      ['값'],
      [2024], [2025], ['미정'], ['해당없음'], ['-'], [3]
    ];
    expect(findYearColumn(grid, { currentYear: NOW })).toBeNull();
  });

  it('문자열로 저장된 학년도도 읽는다', () => {
    // 엑셀에서 텍스트 서식으로 저장되면 "2024"로 들어온다
    const grid = [['학년도'], ['2024'], ['2024'], ['2024']];
    expect(findYearColumn(grid, { currentYear: NOW }).values).toEqual([2024]);
  });

  it('빈 격자를 견딘다', () => {
    expect(findYearColumn([], { currentYear: NOW })).toBeNull();
    expect(findYearColumn([['a']], { currentYear: NOW })).toBeNull();
  });
});

describe('학년도 추론', () => {
  it('셀 값을 파일명보다 신뢰한다', () => {
    // 파일명은 사람이 붙이는 것이라 "최종_수정본_2025" 같은 게 흔하다
    const guess = inferYear({
      fileName: '2099_잘못된이름.xlsx',
      grid: senjinhakGrid(2026),
      currentYear: NOW
    });
    expect(guess.year).toBe(2026);
    expect(guess.source).toBe('cell');
    expect(guess.confidence).toBe('high');
  });

  it('셀에 없으면 파일명에서 찾는다', () => {
    const guess = inferYear({
      fileName: '2024학년도_대교협_수시결과.xlsx',
      grid: kcueGrid(),
      headerRows: 2,
      currentYear: NOW
    });
    expect(guess.year).toBe(2024);
    expect(guess.source).toBe('filename');
    expect(guess.confidence).toBe('high');
  });

  it('파일명에 없으면 시트명에서 찾는다', () => {
    const guess = inferYear({
      fileName: '진학결과.xlsx',
      sheetName: '2023학년도',
      grid: kcueGrid(),
      headerRows: 2,
      currentYear: NOW
    });
    expect(guess.year).toBe(2023);
    expect(guess.source).toBe('sheet');
  });

  it('표지 없는 네 자리만 있으면 확신을 낮춘다', () => {
    // 사용자에게 확인받아야 한다
    const guess = inferYear({ fileName: '대교협_2022.xlsx', currentYear: NOW });
    expect(guess.year).toBe(2022);
    expect(guess.confidence).toBe('low');
  });

  it('후보가 여럿이면 확신을 낮추고 전부 남긴다', () => {
    const guess = inferYear({ fileName: '2022학년도_2023학년도_통합.xlsx', currentYear: NOW });
    expect(guess.confidence).toBe('low');
    expect(guess.candidates).toEqual([2022, 2023]);
  });

  it('한 파일에 여러 학년도가 섞이면 행마다 읽도록 알린다', () => {
    const grid = [
      ['학년도', '대학'],
      [2024, '가'], [2025, '나'], [2026, '다']
    ];
    const guess = inferYear({ fileName: '누적.xlsx', grid, currentYear: NOW });
    expect(guess.year).toBeNull();
    expect(guess.yearColumn).toBe(0);
    expect(guess.candidates).toEqual([2024, 2025, 2026]);
  });

  it('아무 데서도 못 찾으면 없다고 답한다', () => {
    const guess = inferYear({ fileName: '진학결과.xlsx', sheetName: 'Sheet1', currentYear: NOW });
    expect(guess.year).toBeNull();
    expect(guess.confidence).toBe('none');
  });

  it('인자 없이 불러도 터지지 않는다', () => {
    expect(inferYear().confidence).toBe('none');
  });
});
