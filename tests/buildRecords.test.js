import { describe, it, expect } from 'vitest';
import { coerce, readRow, buildDataset } from '../src/ingest/buildRecords.js';
import { buildHeaderLabels, fillMergedRow } from '../src/ingest/headerBlock.js';
import { kcueGrid } from './helpers/workbook.js';

/** 센진학 계열을 닮은 최소 시트: 헤더 1행, 학생 2명 */
function simpleSheet(cohortYear = 2025) {
  return {
    grid: [
      ['학번', '이름', '대학', '모집단위', '전과목', '1단계', '최종', '비고'],
      ['30101', '김가온', '서울대학교', '컴퓨터공학부', 1.82, '합', '합', '수시1'],
      ['30101', '김가온', '연세대학교', '인공지능학과', 1.82, '합', '불', '수시2'],
      ['30102', '박서린', '성균관대학교', '경영학과', 2.41, '합', '합', '수시1']
    ],
    headerRows: 1,
    columns: {
      'identity.hakbun': 0, 'identity.name': 1,
      univ: 2, dept: 3, 'gpa.전과목': 4, stage1: 5, final: 6
    },
    cohortYear
  };
}

describe('셀 값 정리', () => {
  it('숫자 필드를 숫자로 바꾼다', () => {
    expect(coerce('gpa.전교과', '1.82')).toBe(1.82);
    expect(coerce('quota', '1,200')).toBe(1200);
  });

  it('숫자 필드의 자리채움 표기를 빈 값으로 본다', () => {
    for (const mark of ['-', '없음', '해당없음', 'N/A']) {
      expect(coerce('gpa.전교과', mark)).toBeNull();
    }
  });

  it('글자 필드에서는 자리채움 표기를 지우지 않는다', () => {
    // 불합격사유 같은 곳에서는 뜻이 있을 수 있다
    expect(coerce('failReason', '-')).toBe('-');
  });

  it('빈 값을 null로 통일한다', () => {
    expect(coerce('univ', null)).toBeNull();
    expect(coerce('univ', '   ')).toBeNull();
  });

  it('숫자가 아닌 값을 숫자 필드에 넣지 않는다', () => {
    expect(coerce('gpa.전교과', '미적용')).toBeNull();
  });

  it('학번은 숫자로 바꾸지 않는다', () => {
    // 앞자리 0이 사라지면 다른 학생이 된다
    expect(coerce('identity.hakbun', '00042')).toBe('00042');
  });

  it('0을 빈 값으로 오해하지 않는다', () => {
    expect(coerce('quota', 0)).toBe(0);
  });
});

describe('헤더 블록 전개', () => {
  it('병합셀을 오른쪽으로 흘려 채운다', () => {
    expect(fillMergedRow(['국어', null, null, null], 4)).toEqual(['국어', '국어', '국어', '국어']);
  });

  it('두 줄 헤더를 한 이름표로 합친다', () => {
    const labels = buildHeaderLabels(kcueGrid(), 2);
    expect(labels[11].label).toBe('한국사·등급');
    expect(labels[12].label).toBe('국어·과목');
    expect(labels[13].label).toBe('국어·표점');
  });

  it('아래 칸이 비면 위 이름만 쓴다', () => {
    const labels = buildHeaderLabels([['대학명', '학과'], [null, null]], 2);
    expect(labels[0].label).toBe('대학명');
  });

  it('한 줄 헤더는 그대로 둔다', () => {
    expect(buildHeaderLabels([['대학', '학과']], 1).map((item) => item.label)).toEqual(['대학', '학과']);
  });
});

describe('행 읽기', () => {
  it('논리 필드별로 나누어 담는다', () => {
    const row = ['30101', '김가온', '서울대학교', 1.82, '2', '언어와매체'];
    const parsed = readRow(row, {
      'identity.hakbun': 0, 'identity.name': 1, univ: 2,
      'gpa.전과목': 3, 'suneung.국어.grade': 4, 'suneung.국어.subject': 5
    });
    expect(parsed.identity).toEqual({ hakbun: '30101', name: '김가온' });
    expect(parsed.scalars.univ).toBe('서울대학교');
    expect(parsed.gpa).toEqual({ 전과목: 1.82 });
    expect(parsed.suneung).toEqual({ 국어: { grade: 2, subject: '언어와매체' } });
  });

  it('반영비가 붙은 내신 조합도 나누어 담는다', () => {
    const parsed = readRow([6.36, 6.34], { 'gpa.전교과': 0, 'gpa.전교과(2/4/4)': 1 });
    expect(parsed.gpa).toEqual({ 전교과: 6.36, '전교과(2/4/4)': 6.34 });
  });

  it('빈 칸은 담지 않는다', () => {
    const parsed = readRow(['서울대학교', null], { univ: 0, dept: 1 });
    expect(parsed.scalars).toEqual({ univ: '서울대학교' });
  });
});

describe('자료 묶음 만들기', () => {
  it('지원 건마다 한 행을 만든다', async () => {
    const result = await buildDataset([simpleSheet()]);
    expect(result.applications).toHaveLength(3);
    expect(result.applications[0].univ).toBe('서울대학교');
  });

  it('학생은 중복 없이 한 번만 담는다', async () => {
    // 내신·수능이 지원 건수만큼 되풀이되어 들어 있다
    const result = await buildDataset([simpleSheet()]);
    expect(result.students).toHaveLength(2);
    expect(result.students.map((student) => student.gpa.전과목).sort()).toEqual([1.82, 2.41]);
  });

  it('같은 학생의 지원 건이 한 ID로 묶인다', async () => {
    const result = await buildDataset([simpleSheet()]);
    const byUniv = new Map(result.applications.map((row) => [row.univ, row.sid]));
    expect(byUniv.get('서울대학교')).toBe(byUniv.get('연세대학교'));
    expect(byUniv.get('서울대학교')).not.toBe(byUniv.get('성균관대학교'));
  });

  it('이름과 학번을 결과 어디에도 남기지 않는다', async () => {
    const result = await buildDataset([simpleSheet()]);
    const dumped = JSON.stringify(result);
    expect(dumped).not.toContain('김가온');
    expect(dumped).not.toContain('박서린');
    expect(dumped).not.toContain('30101');
  });

  it('프로파일이 집어 가지 않은 열을 원본 이름으로 보존한다', async () => {
    const result = await buildDataset([simpleSheet()]);
    expect(result.applications[0].extra).toEqual({ 비고: '수시1' });
  });

  it('지원 기록이 아닌 행을 건너뛴다', async () => {
    const sheet = simpleSheet();
    sheet.grid.push([null, null, null, null, null, null, null, null]);
    sheet.grid.push(['', '합계', null, null, null, null, null, null]);
    const result = await buildDataset([sheet]);
    expect(result.applications).toHaveLength(3);
  });

  it('고3 년도를 모든 기록에 붙인다', async () => {
    const result = await buildDataset([simpleSheet(2023)]);
    expect(result.students.every((student) => student.cohortYear === 2023)).toBe(true);
    expect(result.applications.every((row) => row.cohortYear === 2023)).toBe(true);
    expect(result.students[0].sid).toMatch(/^2023-/);
  });

  it('고3 년도가 없으면 넣지 않고 알린다', async () => {
    const sheet = simpleSheet(null);
    const result = await buildDataset([sheet]);
    expect(result.applications).toHaveLength(0);
    expect(result.warnings.find((item) => item.type === 'missing-year').count).toBe(3);
  });

  it('여러 시트를 하나로 합친다', async () => {
    const result = await buildDataset([simpleSheet(2023), simpleSheet(2024)]);
    expect(result.students).toHaveLength(4);
    expect(result.applications).toHaveLength(6);
  });

  it('해가 다르면 같은 학번이라도 다른 학생이다', async () => {
    const result = await buildDataset([simpleSheet(2023), simpleSheet(2024)]);
    const years = new Set(result.students.map((student) => student.cohortYear));
    expect(years).toEqual(new Set([2023, 2024]));
  });
});

describe('수능 자료', () => {
  const suneungSheet = {
    grid: [
      ['학번', '이름', '대학', '국어과목', '국어등급', '수학등급'],
      ['30101', '김가온', '서울대학교', '언어와매체', 2, 1],
      ['30101', '김가온', '연세대학교', '언어와매체', 2, 1]
    ],
    headerRows: 1,
    columns: {
      'identity.hakbun': 0, 'identity.name': 1, univ: 2,
      'suneung.국어.subject': 3, 'suneung.국어.grade': 4, 'suneung.수학.grade': 5
    },
    cohortYear: 2025
  };

  it('영역마다 한 줄로 눕힌다', async () => {
    const result = await buildDataset([suneungSheet]);
    expect(result.suneung.map((row) => row.area).sort()).toEqual(['국어', '수학']);
  });

  it('지원 건수만큼 되풀이하지 않는다', async () => {
    // 두 번 지원했다고 수능을 두 번 본 것이 아니다
    const result = await buildDataset([suneungSheet]);
    expect(result.suneung).toHaveLength(2);
  });

  it('영역별 항목을 함께 담는다', async () => {
    const result = await buildDataset([suneungSheet]);
    const korean = result.suneung.find((row) => row.area === '국어');
    expect(korean.subject).toBe('언어와매체');
    expect(korean.grade).toBe(2);
  });
});

describe('행마다 연도가 다른 파일', () => {
  const stacked = {
    grid: [
      ['학년도', '학번', '이름', '대학'],
      [2024, '30101', '김가온', '서울대학교'],
      [2025, '30101', '박서린', '연세대학교'],
      [2026, '30102', '이도윤', '고려대학교']
    ],
    headerRows: 1,
    columns: { sourceYear: 0, 'identity.hakbun': 1, 'identity.name': 2, univ: 3 },
    cohortYear: null,
    yearBasis: 'admission'
  };

  it('행마다 연도를 읽어 고3 년도로 바꾼다', async () => {
    const result = await buildDataset([stacked]);
    expect(result.applications.map((row) => row.cohortYear)).toEqual([2023, 2024, 2025]);
  });

  it('기준을 모르면 행 연도를 쓰지 않는다', async () => {
    const result = await buildDataset([{ ...stacked, yearBasis: undefined }]);
    expect(result.applications).toHaveLength(0);
    expect(result.warnings.find((item) => item.type === 'missing-year')).toBeDefined();
  });
});

describe('이어서 올리기', () => {
  it('기존 학생의 ID를 지킨다', async () => {
    const first = await buildDataset([simpleSheet(2025)]);
    const second = await buildDataset([simpleSheet(2025)], { existing: first.students });
    expect(second.students.map((student) => student.sid).sort())
      .toEqual(first.students.map((student) => student.sid).sort());
  });

  it('새 연도를 더해도 기존 학생이 남는다', async () => {
    const first = await buildDataset([simpleSheet(2024)]);
    const second = await buildDataset([simpleSheet(2025)], { existing: first.students });
    expect(second.students).toHaveLength(4);
    for (const sid of first.students.map((student) => student.sid)) {
      expect(second.students.some((student) => student.sid === sid)).toBe(true);
    }
  });
});
