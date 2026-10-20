/**
 * 코드 감사에서 드러난 결함들의 회귀 테스트.
 *
 * 전부 **조용히 틀리던** 것들이다 — 에러도 안 나고 테스트도 통과하면서
 * 자료만 어긋났다. 다시 들어오지 못하게 여기 못박는다.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { buildDataset, isIdentityLabel } from '../src/ingest/buildRecords.js';
import { assignStudentIds } from '../src/core/anonymize.js';
import { inferCohortYear, BASIS } from '../src/ingest/year.js';
import { openDatabase, saveDataset, loadDataset } from '../src/store/db.js';
import { expandUploads } from '../src/ingest/files.js';
import { makeWorkbook, makeZip, senjinhakGrid } from './helpers/workbook.js';

let counter = 0;
const freshDatabase = () => openDatabase(`audit-${(counter += 1)}-${Date.now()}`);

describe('개인정보가 extra로 새던 통로', () => {
  const leakySheet = {
    grid: [
      ['반', '번호', '이름', '수험번호', '생년월일', '연락처', '대학', '학과'],
      ['1', '1', '김가온', '20250012345', '2007-03-11', '010-0000-0000', '서울대학교', '컴퓨터공학부'],
      ['1', '2', '박서린', '20250012346', '2007-05-02', '010-0000-0001', '연세대학교', '경영학과']
    ],
    headerRows: 1,
    // 프로파일이 수험번호·생년월일·연락처를 집어 가지 않는다 — 흔한 상황이다
    columns: { 'identity.class': 0, 'identity.number': 1, 'identity.name': 2, univ: 6, dept: 7 },
    cohortYear: 2025
  };

  it('해석하지 못한 식별 열을 extra에 담지 않는다', async () => {
    const result = await buildDataset([leakySheet]);
    const dumped = JSON.stringify(result);
    for (const leak of ['20250012345', '2007-03-11', '010-0000-0000', '김가온']) {
      expect(dumped, leak).not.toContain(leak);
    }
  });

  it('버렸다는 사실을 알린다', async () => {
    // 조용히 버리면 왜 그 열이 안 보이는지 알 수 없다
    const result = await buildDataset([leakySheet]);
    const warning = result.warnings.find((item) => item.type === 'identity-column-dropped');
    expect(warning.labels).toEqual(expect.arrayContaining(['수험번호', '생년월일', '연락처']));
  });

  it('식별 열이 아닌 것은 그대로 보존한다', async () => {
    const sheet = {
      ...leakySheet,
      grid: [
        ['반', '번호', '이름', '비고', '대학', '학과'],
        ['1', '1', '김가온', '수시1', '서울대학교', '컴퓨터공학부']
      ],
      columns: { 'identity.class': 0, 'identity.number': 1, 'identity.name': 2, univ: 4, dept: 5 }
    };
    const result = await buildDataset([sheet]);
    expect(result.applications[0].extra).toEqual({ 비고: '수시1' });
  });

  it('보관소까지 가도 새지 않는다', async () => {
    const db = await freshDatabase();
    await saveDataset(db, await buildDataset([leakySheet]));
    expect(JSON.stringify(await loadDataset(db))).not.toContain('20250012345');
  });

  it('식별 낱말 판별이 과하지도 모자라지도 않다', () => {
    for (const label of ['수험번호', '생년월일', '학번', '이름', '성명', '연락처', '보호자']) {
      expect(isIdentityLabel(label), label).toBe(true);
    }
    for (const label of ['비고', '최초후보순위', '모집단위', '모집인원', '국어·표점', '학교유형']) {
      expect(isIdentityLabel(label), label).toBe(false);
    }
  });
});

describe('연도처럼 생긴 엉뚱한 열', () => {
  const grid = [
    ['출생년도', '학년도', '학번', '대학'],
    [2007, 2026, '30101', '서울대학교'],
    [2007, 2026, '30102', '연세대학교'],
    [2006, 2026, '30103', '고려대학교']
  ];

  it('프로파일이 밝히지 않은 열에 프로파일 기준을 적용하지 않는다', () => {
    // 붙이면 생년 2007을 학년도로 읽어 고3 년도가 2006이 된다 — 19년 밀린다
    const guess = inferCohortYear({ grid, columnBasis: BASIS.admission, currentYear: 2026 });
    expect(guess.cohortYear).not.toBe(2006);
    expect(guess.needsInput).toBe(true);
  });

  it('밝혀진 열을 읽으면 제대로 나온다', () => {
    const guess = inferCohortYear({
      grid, yearColumn: 1, columnBasis: BASIS.admission, currentYear: 2026
    });
    expect(guess.cohortYear).toBe(2025);
  });
});

describe('한 학생이 익명 ID를 둘 갖던 문제', () => {
  const rows = [
    { cohortYear: 2025, identity: { classNo: '1', number: '5' } },
    { cohortYear: 2025, identity: { hakbun: '30105' } },
    { cohortYear: 2025, identity: { classNo: '1', number: '5', hakbun: '30105' } }
  ];

  it('두 식별자를 함께 실은 행이 두 묶음을 잇는다', async () => {
    const result = await assignStudentIds(rows);
    expect(new Set(result.sids).size).toBe(1);
    expect(result.students).toHaveLength(1);
  });

  it('이은 뒤 어느 식별자로 와도 같은 ID가 나온다', async () => {
    const linked = await assignStudentIds(rows);
    const later = await assignStudentIds(
      [{ cohortYear: 2025, identity: { classNo: '1', number: '5' } }],
      { existing: linked.students }
    );
    expect(later.sids[0]).toBe(linked.sids[0]);
  });
});

describe('이름이 같다고 합쳐 버리던 문제', () => {
  it('식별 열이 다른 동명이인을 합치지 않는다', async () => {
    // 두 확인된 엑셀 양식이 서로 다른 열로 학생을 식별하므로 흔한 경우다
    const result = await assignStudentIds([
      { cohortYear: 2025, identity: { hakbun: '30101', name: '김민준' } },
      { cohortYear: 2025, identity: { classNo: '7', number: '12', name: '김민준' } }
    ]);
    expect(result.sids[0]).not.toBe(result.sids[1]);
  });

  it('문자열과 숫자로 적힌 같은 학생을 나누지 않는다', async () => {
    const result = await assignStudentIds([
      { cohortYear: 2025, identity: { classNo: '01', number: '07' } },
      { cohortYear: 2025, identity: { classNo: 1, number: 7 } }
    ]);
    expect(result.sids[0]).toBe(result.sids[1]);
    expect(result.students).toHaveLength(1);
  });
});

describe('수능 자세한 값이 사라지던 문제', () => {
  const base = {
    headerRows: 1,
    columns: { 'identity.hakbun': 0, univ: 1 },
    cohortYear: 2025
  };

  it('한 파일 안에서 뒤 행의 항목을 잃지 않는다', async () => {
    const sheet = {
      ...base,
      grid: [
        ['학번', '대학', '국어등급', '국어백분위'],
        ['30101', '서울대학교', 2, null],
        ['30101', '연세대학교', 2, 93]
      ],
      columns: { ...base.columns, 'suneung.국어.grade': 2, 'suneung.국어.percentile': 3 }
    };
    const result = await buildDataset([sheet]);
    expect(result.suneung[0]).toMatchObject({ area: '국어', grade: 2, percentile: 93 });
  });

  it('나중 파일이 등급만 담고 있어도 앞선 표점·백분위를 덮지 않는다', async () => {
    const db = await freshDatabase();
    await saveDataset(db, {
      students: [], applications: [], files: [],
      suneung: [{ sid: '2025-A', area: '국어', grade: 2, percentile: 93, stdScore: 130 }]
    });
    await saveDataset(db, {
      students: [], applications: [], files: [],
      suneung: [{ sid: '2025-A', area: '국어', grade: 2 }]
    });
    const stored = (await loadDataset(db)).suneung[0];
    expect(stored.percentile).toBe(93);
    expect(stored.stdScore).toBe(130);
  });
});

describe('재업로드가 지원 기록을 두 배로 쌓던 문제', () => {
  const dataset = () => ({
    students: [{ sid: '2025-A', cohortYear: 2025, keyHashes: ['h1'], gpa: {} }],
    applications: [
      { sid: '2025-A', cohortYear: 2025, univ: '서울대학교', fileHash: 'f1' },
      { sid: '2025-A', cohortYear: 2025, univ: '연세대학교', fileHash: 'f1' }
    ],
    suneung: [],
    files: [{ hash: 'f1', name: '진학결과.xlsx' }]
  });

  it('같은 파일을 다시 올려도 건수가 늘지 않는다', async () => {
    const db = await freshDatabase();
    await saveDataset(db, dataset());
    await saveDataset(db, dataset());
    expect((await loadDataset(db)).applications).toHaveLength(2);
  });

  it('다른 파일의 기록은 건드리지 않는다', async () => {
    const db = await freshDatabase();
    await saveDataset(db, dataset());
    await saveDataset(db, {
      students: [], suneung: [], files: [{ hash: 'f2', name: '다른파일.xlsx' }],
      applications: [{ sid: '2025-A', cohortYear: 2025, univ: '고려대학교', fileHash: 'f2' }]
    });
    await saveDataset(db, dataset());
    expect((await loadDataset(db)).applications).toHaveLength(3);
  });
});

describe('압축을 다 해제한 뒤에야 크기를 재던 문제', () => {
  it('해제하기 전에 선언된 크기로 걸러낸다', () => {
    const archive = makeZip({
      'a.xlsx': makeWorkbook({ s: senjinhakGrid(2026) }),
      'b.xlsx': makeWorkbook({ s: senjinhakGrid(2026) })
    });
    const result = expandUploads([{ name: '폭탄.zip', bytes: archive }], {
      limits: { maxEntries: 10, maxTotalBytes: 100 }
    });
    expect(result.files).toHaveLength(0);
    expect(result.skipped.some((item) => item.reason.includes('용량'))).toBe(true);
  });

  it('항목 수 상한도 해제하기 전에 본다', () => {
    const entries = {};
    for (let index = 0; index < 6; index += 1) {
      entries[`f${index}.xlsx`] = makeWorkbook({ s: [['대학'], ['서울대학교']] });
    }
    const result = expandUploads([{ name: '많음.zip', bytes: makeZip(entries) }], {
      limits: { maxEntries: 3, maxTotalBytes: 10 * 1024 * 1024 }
    });
    expect(result.files).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/너무 많습니다/);
  });

  it('정상 범위의 압축은 그대로 통과시킨다', () => {
    const archive = makeZip({ 'a.xlsx': makeWorkbook({ s: senjinhakGrid(2026) }) });
    const result = expandUploads([{ name: '정상.zip', bytes: archive }]);
    expect(result.files).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });
});
