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
import { classifyOutcome } from '../src/core/outcome.js';
import { tallyOutcomes, passRate, rateNote } from '../src/ui/outcome.js';
import { sortRows, searchHaystack } from '../src/analysis/query.js';
import { visibleWindow } from '../src/ui/table.js';
import { facetCounts, facetBuckets, applyQuery } from '../src/analysis/query.js';
import { bucketLabel } from '../src/analysis/registry.js';
import { uploadBlockers, prefilledYear } from '../src/ui/upload.js';

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
    for (const label of ['수험번호', '생년월일', '학번', '이름', '성명', '연락처', '보호자',
      '학생', '수험생', '지원자', '지원자명', '수험생명', '지원자 성명', '핸드폰', 'HP', 'phone', 'E-mail', '학부모']) {
      expect(isIdentityLabel(label), label).toBe(true);
    }
    for (const label of ['비고', '최초후보순위', '모집단위', '모집인원', '국어·표점', '학교유형',
      '지원자수', '지원자 평균', '학생부종합', '학생부교과', '수험생활', '메일링']) {
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

describe('2차 감사 — 조용히 틀리던 자리들', () => {
  it('통계 칸을 더하면 화면의 합격률이 그대로 나온다', () => {
    const rows = [
      { '#outcome': classifyOutcome({ final: '합격' }) },
      { '#outcome': classifyOutcome({ final: '충원합격' }) },
      { '#outcome': classifyOutcome({ final: '불합격' }) },
      // 1단계에서만 탈락한 건. 분자도 분모도 아니다
      { '#outcome': classifyOutcome({ final: null, stage1: '불합격' }) }
    ];
    const tally = tallyOutcomes(rows);
    expect(tally.최종판정).toBe(tally.합격 + tally.충원합격 + tally.불합격);
    expect(passRate(tally)).toBeCloseTo(2 / 3, 6);
    // 분모가 몇 건인지와 무엇이 빠졌는지가 화면에 적혀야 한다
    expect(rateNote(tally)).toContain('3건');
    expect(rateNote(tally)).toContain('1건');
  });

  it('뜻이 있는 열은 저장값 글자순이 아니라 뜻 차례로 정렬한다', () => {
    const rows = [
      { outcome: 'fail', registered: 'none' },
      { outcome: 'pass', registered: 'registered' },
      { outcome: 'waitPass', registered: 'declined' }
    ];
    expect(sortRows(rows, [{ key: 'outcome', dir: 'asc' }]).map((row) => row.outcome))
      .toEqual(['pass', 'waitPass', 'fail']);
    expect(sortRows(rows, [{ key: 'registered', dir: 'asc' }]).map((row) => row.registered))
      .toEqual(['registered', 'declined', 'none']);
  });

  it('전체 검색도 화면에 적힌 글자로 찾는다', () => {
    // 「1단계 불합격」은 저장값에도 사전에도 없고 이름표에만 있다
    const row = { outcome: 'none', '#outcome': classifyOutcome({ final: null, stage1: '불합격' }) };
    expect(searchHaystack(row, ['outcome'])).toContain('1단계 불합격');
  });

  it('행 높이를 재서 넘겨 주면 그 높이로 창을 셈한다', () => {
    const 기본 = visibleWindow(0, 440, 1000);
    const 두배 = visibleWindow(0, 440, 1000, 72);
    expect(두배.end).toBeLessThan(기본.end);
  });
});

describe('3차 감사 — 자료가 사라지던 자리들', () => {
  it('이름이 같은 미해결 열을 서로 덮지 않는다', async () => {
    const sheet = {
      grid: [
        ['학번', '대학명', '최종', '비고', '비고'],
        ['20250012345', '가온대학교', '합격', '장학금', '기숙사'],
        // 한쪽만 채워진 행. 행마다 번호를 다시 정하면 5열 값이 4열 자리에 들어앉는다
        ['20250012346', '한결대학교', '합격', '', '통학']
      ],
      headerRows: 1,
      columns: { 'identity.hakbun': 0, univ: 1, final: 2 },
      cohortYear: 2025
    };
    const { applications } = await buildDataset([sheet]);
    expect(applications[0].extra).toEqual({ '비고(4)': '장학금', '비고(5)': '기숙사' });
    // 4열이 빈 행에서도 5열 값은 5열 자리에 들어간다
    expect(applications[1].extra).toEqual({ '비고(5)': '통학' });
  });

  it('학생을 알아낼 열이 없으면 저장하지 않았다고 알린다', async () => {
    const sheet = {
      grid: [['대학명', '모집단위', '최종'], ['가온대학교', '컴퓨터공학부', '합격']],
      headerRows: 1,
      columns: { univ: 0, dept: 1, final: 2 },
      cohortYear: 2025
    };
    const { applications, warnings } = await buildDataset([sheet]);
    expect(applications).toHaveLength(0);
    // 읽은 행 수만 보고 들어온 줄 알면, 빈 보관소를 보고도 모른다
    expect(warnings.some((warning) => warning.type === 'rows-not-saved')).toBe(true);
  });

  it('합칠 때 사라지는 ID의 내신을 함께 옮긴다', async () => {
    const db = await freshDatabase();
    await saveDataset(db, {
      students: [{ sid: 'B', cohortYear: 2025, keyHashes: ['h'], gpa: { total: 1.62 } }],
      applications: [{ sid: 'B', cohortYear: 2025, univ: '가온대학교', fileHash: 'F', sourceSheet: 'S' }],
      suneung: [], files: [], readSheets: [{ fileHash: 'F', sheetName: 'S' }]
    });
    await saveDataset(db, {
      students: [{ sid: 'A', cohortYear: 2025, keyHashes: ['cn', 'h'], gpa: {} }],
      applications: [{ sid: 'A', cohortYear: 2025, univ: '한결대학교', fileHash: 'G', sourceSheet: 'S' }],
      suneung: [], files: [],
      merges: [{ from: 'B', into: 'A' }],
      readSheets: [{ fileHash: 'G', sheetName: 'S' }]
    });
    const loaded = await loadDataset(db);
    const 남은 = loaded.students.find((student) => student.sid === 'A');
    expect(남은.gpa.total).toBe(1.62);
    expect(loaded.students).toHaveLength(1);
  });

  it('시트 하나만 다시 올려도 다른 시트의 연도 기록이 남는다', async () => {
    const db = await freshDatabase();
    const 기록 = (sheets, yearBySheet) => ({
      hash: 'F', name: '누적.xlsx', sheets, cohortYears: Object.values(yearBySheet), yearBySheet
    });
    await saveDataset(db, {
      students: [], applications: [], suneung: [],
      files: [기록(['A반', 'B반'], { 'A반': 2024, 'B반': 2025 })],
      readSheets: [{ fileHash: 'F', sheetName: 'A반' }, { fileHash: 'F', sheetName: 'B반' }]
    });
    await saveDataset(db, {
      students: [], applications: [], suneung: [],
      files: [기록(['A반'], { 'A반': 2024 })],
      readSheets: [{ fileHash: 'F', sheetName: 'A반' }]
    });
    const { files } = await loadDataset(db);
    expect(files[0].yearBySheet).toEqual({ 'A반': 2024, 'B반': 2025 });
    expect(files[0].sheets).toEqual(expect.arrayContaining(['A반', 'B반']));
  });

  it('용량을 넘은 압축은 통째로 거절한다', () => {
    const big = makeWorkbook({ result: senjinhakGrid(2025) });
    const zip = makeZip({ 'a.xlsx': big, 'b.xlsx': big, 'c.xlsx': big });
    const result = expandUploads([{ name: 'bundle.zip', bytes: zip }], { limits: { maxEntries: 50, maxTotalBytes: 1 } });
    expect(result.files).toHaveLength(0);
    expect(result.skipped[0].name).toBe('bundle.zip');
  });

  it('압축 안의 macOS 부산물은 항목 수에 세지 않는다', () => {
    const book = makeWorkbook({ result: senjinhakGrid(2025) });
    const entries = {};
    for (let index = 0; index < 3; index += 1) {
      entries[`${index}.xlsx`] = book;
      entries[`__MACOSX/._${index}.xlsx`] = new Uint8Array([1, 2, 3]);
    }
    const result = expandUploads([{ name: 'mac.zip', bytes: makeZip(entries) }], { limits: { maxEntries: 4, maxTotalBytes: 512 * 1024 * 1024 } });
    expect(result.files).toHaveLength(3);
  });
});

describe('4차 감사 — 고치면서 들여온 자리들', () => {
  it('이름으로 식별되는 시트를 막지 않는다', async () => {
    const sheet = {
      grid: [['이름', '번호', '대학명', '최종'], ['김가온', '1', '가온대학교', '합격']],
      headerRows: 1,
      columns: { 'identity.name': 0, 'identity.number': 1, univ: 2, final: 3 },
      cohortYear: 2025
    };
    const { applications, warnings } = await buildDataset([sheet]);
    // 저장되는 자료를 「저장할 수 없습니다」로 막던 자리다
    expect(applications).toHaveLength(1);
    expect(warnings.some((warning) => warning.type === 'rows-not-saved')).toBe(false);
    expect(uploadBlockers(
      [{ id: 's', fileName: 'f.xlsx', reading: { readable: true, identifiable: true }, }],
      { s: { include: true, cohortYear: 2025 } }
    )).toEqual([]);
  });

  it('값 목록에 묶인 건수만큼 행이 남는다', () => {
    /*
     * 소수 셋째 자리가 다른 두 값은 예전에 같은 「10.00」으로 적혀 한 줄로 묶였다.
     * 이제 셋째 자리부터는 있는 그대로 적으므로 두 줄이고, 어느 쪽이든 줄의 건수와
     * 거른 행 수가 같아야 한다.
     */
    const rows = [{ 'gpa.환산': 10.001 }, { 'gpa.환산': 10.002 }, { 'gpa.환산': 11.5 }];
    const counts = facetCounts(rows, [], 'gpa.환산');
    const 열 = [...counts.entries()].filter(([value]) => Math.floor(Number(value)) === 10);
    expect(열).toHaveLength(2);
    for (const [대표, 건수] of 열) {
      const kept = applyQuery(rows, { filters: [{ key: 'gpa.환산', op: 'in', values: [대표] }] });
      expect(kept).toHaveLength(건수);
    }
  });

  it('연도를 고쳐 다시 올리면 틀린 해가 남지 않는다', async () => {
    const db = await freshDatabase();
    const 기록 = (year) => ({
      hash: 'F', name: '한장.xlsx', sheets: ['시트1'], cohortYears: [year], yearBySheet: { '시트1': year }
    });
    for (const year of [2024, 2025]) {
      await saveDataset(db, {
        students: [], applications: [], suneung: [],
        files: [기록(year)], readSheets: [{ fileHash: 'F', sheetName: '시트1' }]
      });
    }
    const { files } = await loadDataset(db);
    expect(files[0].cohortYears).toEqual([2025]);
  });
});

describe('5차 감사 — 미리 채운 연도가 거짓말하던 자리', () => {
  it('식별 열이 빈칸 표시뿐이면 여러 학생을 한 사람으로 묶지 않는다', async () => {
    const sheet = {
      grid: [
        ['학번', '이름', '대학명', '최종'],
        ['-', '-', '가온대학교', '합격'],
        ['-', '-', '한결대학교', '불합격'],
        ['-', '-', '서림대학교', '합격']
      ],
      headerRows: 1,
      columns: { 'identity.hakbun': 0, 'identity.name': 1, univ: 2, final: 3 },
      cohortYear: 2025
    };
    const { students, applications, warnings } = await buildDataset([sheet]);
    // `-`를 키 재료로 쓰면 세 행이 한 익명 ID로 합쳐지고, 화면에는 아무 표시도 없었다
    expect(students).toHaveLength(0);
    expect(applications).toHaveLength(0);
    expect(warnings.some((warning) => warning.type === 'rows-not-saved')).toBe(true);
  });

  it('시트가 여럿인 파일에서는 파일 연도로 시트를 채우지 않는다', () => {
    // 「2025학년」 시트는 2025로 확정했고 「누적」 시트는 행마다 연도다
    const duplicate = {
      sheets: ['2025학년', '누적'],
      cohortYears: [2025],
      yearBySheet: { '2025학년': 2025, '누적': null }
    };
    const 카드 = (sheetName) => ({
      id: sheetName, fileName: '누적.xlsx', sheetName, duplicate,
      reading: { readable: true, identifiable: true }
    });
    // 누적 시트에 2025가 채워지면 2023년 지원 건이 2025년으로 보관된다
    expect(prefilledYear(카드('누적'))).toBeNull();
    expect(prefilledYear(카드('2025학년'))).toBe(2025);
  });

  it('시트별 기록이 없는 옛 레코드의 해를 버리지 않는다', async () => {
    const db = await freshDatabase();
    // yearBySheet가 들어오기 전 판으로 보관한 레코드
    await saveDataset(db, {
      students: [], applications: [], suneung: [],
      files: [{ hash: 'F', name: '누적.xlsx', sheets: ['가', '나'], cohortYears: [2024, 2025] }],
      readSheets: [{ fileHash: 'F', sheetName: '가' }, { fileHash: 'F', sheetName: '나' }]
    });
    await saveDataset(db, {
      students: [], applications: [], suneung: [],
      files: [{ hash: 'F', name: '누적.xlsx', sheets: ['가'], cohortYears: [2024], yearBySheet: { '가': 2024 } }],
      readSheets: [{ fileHash: 'F', sheetName: '가' }]
    });
    const { files } = await loadDataset(db);
    expect(files[0].cohortYears).toEqual(expect.arrayContaining([2024, 2025]));
  });
});

describe('7차 감사 — 조용히 묶이고 조용히 틀리던 자리', () => {
  it('전각·사이 공백·0 같은 빈칸 표기를 식별 값으로 쓰지 않는다', async () => {
    const 표기별 = async (mark) => {
      const sheet = {
        grid: [
          ['학번', '이름', '대학명', '최종'],
          [mark, '김가온', '가온대학교', '합격'],
          [mark, '박서린', '한결대학교', '불합격']
        ],
        headerRows: 1,
        columns: { 'identity.hakbun': 0, 'identity.name': 1, univ: 2, final: 3 },
        cohortYear: 2025
      };
      const { students } = await buildDataset([sheet]);
      return students.length;
    };
    // 학번 칸이 이 표기들이면 이름이 다른 두 학생이 한 익명 ID로 묶였다
    for (const mark of ['Ｎ／Ａ', '없 음', 'NA', '－', '0', '000']) {
      expect(await 표기별(mark), mark).toBe(2);
    }
    // 뜻이 있는 값은 그대로 쓴다
    expect(await 표기별('30101')).toBe(1);
  });

  it('로마자 이름 Na를 빈칸으로 보지 않는다', async () => {
    const sheet = {
      grid: [['이름', '대학명', '최종'], ['Na', '가온대학교', '합격'], ['Kim', '한결대학교', '합격']],
      headerRows: 1,
      columns: { 'identity.name': 0, univ: 1, final: 2 },
      cohortYear: 2025
    };
    const { applications, students } = await buildDataset([sheet]);
    // 「나」씨를 로마자로 적으면 Na다. 학번 칸의 NA와 같은 잣대를 들이대면 그 행이 사라진다
    expect(applications).toHaveLength(2);
    expect(students).toHaveLength(2);
  });

  it('값 목록의 이름은 건수와 같은 행에서 모은다', () => {
    const 건 = (code, label, year) => ({ outcome: code, cohortYear: year, '#outcome': { code, label } });
    const rows = [
      건('none', '기록 없음', 2024), 건('none', '기록 없음', 2024), 건('none', '기록 없음', 2024),
      건('none', '1단계 불합격', 2025), 건('none', '1단계 불합격', 2025)
    ];
    const 걸린필터 = [{ key: 'cohortYear', op: 'in', values: [2025] }];
    const bucket = facetBuckets(rows, 걸린필터, 'outcome').get('none');
    expect(bucket.count).toBe(2);
    // 남은 2건은 전부 1단계 탈락이다. 전체 자료에서 모으면 「포함」이라 적힌다
    expect(bucketLabel('outcome', 'none', bucket.texts).label).toBe('기록 없음(1단계 불합격)');
  });

  it('보존한 열에도 전각 빈칸 표기를 값으로 담지 않는다', async () => {
    const sheet = {
      grid: [
        ['학번', '대학명', '최종', '비고', '모집인원'],
        ['30101', '가온대학교', '합격', '－', 0]
      ],
      headerRows: 1,
      columns: { 'identity.hakbun': 0, univ: 1, final: 2 },
      cohortYear: 2025
    };
    const { applications } = await buildDataset([sheet]);
    // `－`를 글자로 담으면 값이 든 것처럼 보이고 필터 목록에 한 줄로 선다
    expect(applications[0].extra?.['비고']).toBeUndefined();
    // 0은 그 칸에서 멀쩡한 값이다
    expect(applications[0].extra?.['모집인원']).toBe(0);
  });

  it('값 목록 한 줄이 무엇을 품었는지 적고, 접힌 표기도 찾을 수 있다', () => {
    // 전부가 그 표기인 줄과 일부만 그런 줄을 다르게 적는다
    const 일부 = bucketLabel('outcome', 'none', ['기록 없음', '1단계 불합격', '기록 없음']);
    expect(일부.label).toBe('기록 없음(1단계 불합격 포함)');
    const 전부 = bucketLabel('outcome', 'unknown', ['보류', '추후발표', '재검토', '보류']);
    expect(전부.label).toBe('알 수 없음(보류·추후발표 외 1)');
    // 「외 1」로 접힌 표기도 목록 안 찾기가 본다
    expect(전부.terms).toContain('재검토');
  });

  it('값 목록을 고쳐 써도 거른 결과가 따라온다', () => {
    const rows = [{ x: 'A' }, { x: 'B' }];
    const filter = { key: 'x', op: 'in', values: ['A'] };
    expect(applyQuery(rows, { filters: [filter] })).toHaveLength(1);
    // 캐시가 옛 목록을 들고 있으면 여기서 1건이 남는다
    filter.values = ['B'];
    expect(applyQuery(rows, { filters: [filter] })[0].x).toBe('B');
  });
});

describe('9차 감사 — 식별자가 어긋나는데도 합쳐지던 자리', () => {
  const 시트 = (grid, columns) => ({ grid, headerRows: 1, columns, cohortYear: 2025 });

  it('이름이 같아도 번호가 다르면 합치지 않는다', async () => {
    const { students, warnings } = await buildDataset([시트(
      [['번호', '이름', '대학명', '최종'],
        ['7', '김가온', '가온대학교', '합격'],
        ['8', '김가온', '한결대학교', '합격']],
      { 'identity.number': 0, 'identity.name': 1, univ: 2, final: 3 }
    )]);
    // 같은 해 같은 반에서 7번과 8번은 같은 학생일 수 없다
    expect(students).toHaveLength(2);
    expect(warnings.some((warning) => warning.type === 'identity-conflict')).toBe(true);
  });

  it('반·번호가 겹쳐도 학번이 다르면 합치지 않는다', async () => {
    const { students, warnings } = await buildDataset([시트(
      [['학번', '반', '번호', '대학명', '최종'],
        ['30107', '3', '7', '가온대학교', '합격'],
        ['30207', '3', '7', '한결대학교', '합격']],
      { 'identity.hakbun': 0, 'identity.class': 1, 'identity.number': 2, univ: 3, final: 4 }
    )]);
    // 전입생에게 반·번호를 다시 매긴 파일에서 실제로 겹친다. 경고 하나 없이 섞이던 자리다
    expect(students).toHaveLength(2);
    expect(warnings.some((warning) => warning.type === 'identity-conflict')).toBe(true);
  });

  it('학번이 같으면 반·번호가 달라도 합친다', async () => {
    const { students } = await buildDataset([시트(
      [['학번', '반', '번호', '대학명', '최종'],
        ['30101', '3', '1', '가온대학교', '합격'],
        ['30101', '4', '2', '한결대학교', '합격']],
      { 'identity.hakbun': 0, 'identity.class': 1, 'identity.number': 2, univ: 3, final: 4 }
    )]);
    // 학기 중에 반이 바뀐 것이지 다른 사람이 아니다
    expect(students).toHaveLength(1);
  });

  it('이름이 N/A나 0인 행들을 한 학생으로 묶지 않는다', async () => {
    for (const mark of ['N/A', 'Ｎ／Ａ', 'n/a', '0', '000']) {
      const { students } = await buildDataset([시트(
        [['이름', '대학명', '최종'],
          [mark, '가온대학교', '합격'],
          [mark, '한결대학교', '합격'],
          [mark, '서림대학교', '합격']],
        { 'identity.name': 0, univ: 1, final: 2 }
      )]);
      expect(students, mark).toHaveLength(0);
    }
    // 맨글자 NA는 「나」씨의 로마자 표기다. 이름으로 쓴다
    const { students } = await buildDataset([시트(
      [['이름', '대학명', '최종'], ['NA', '가온대학교', '합격'], ['Kim', '한결대학교', '합격']],
      { 'identity.name': 0, univ: 1, final: 2 }
    )]);
    expect(students).toHaveLength(2);
  });
})

describe('10차 감사 — 다른 학생으로 둔 둘이 같은 키를 들고 있던 자리', () => {
  const 행 = (cohortYear, identity) => ({ cohortYear, identity });

  it('두 학생이 같은 키 해시를 들지 않는다', async () => {
    const { students } = await assignStudentIds([
      행(2025, { number: '7', name: '김가온' }),
      행(2025, { number: '8', name: '김가온' }),
      행(2025, { hakbun: '30107', classNo: '3', number: '7' }),
      행(2025, { hakbun: '30207', classNo: '3', number: '7' })
    ]);
    const 본것 = new Map();
    for (const student of students) {
      for (const hash of student.keyHashes) {
        // 같은 해시를 둘이 들고 있으면 다음 업로드에서 그 해시로 되붙는다
        expect(본것.get(hash) ?? student.sid).toBe(student.sid);
        본것.set(hash, student.sid);
      }
    }
    expect(students.length).toBeGreaterThan(1);
  });

  it('행 순서가 달라도 같은 묶음이 나온다 — 자료에 모순이 있어도', async () => {
    const 행들 = [
      행(2025, { name: '김가온' }),
      행(2025, { number: '7', name: '김가온' }),
      행(2025, { number: '8', name: '김가온' })
    ];
    const 지문 = async (순서) => {
      const { sids } = await assignStudentIds(순서.map((at) => 행들[at]));
      // 어느 행끼리 한 사람으로 묶였는지만 본다
      return 순서.map((at, index) => 순서.map((other, 자리) => sids[index] === sids[자리]).join('')).join('|');
    };
    const 차례 = [[0, 1, 2], [1, 0, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1], [0, 2, 1]];
    const 모양 = await Promise.all(차례.map(지문));
    expect(new Set(모양).size).toBe(1);
  });

  it('모순이 두 파일에 나뉘어 와도 다른 학생으로 둔다', async () => {
    const 시트 = (번호, 이름, 대학) => ({
      grid: [['번호', '이름', '대학명', '최종'], [번호, 이름, 대학, '합격']],
      headerRows: 1,
      columns: { 'identity.number': 0, 'identity.name': 1, univ: 2, final: 3 },
      cohortYear: 2025,
      source: { fileHash: `F${번호}`, sourceFile: `${번호}.xlsx`, sourceSheet: 'S' }
    });
    for (const 이름 of ['가', '김가온', '홍길동', '윤서아']) {
      const db = await freshDatabase();
      for (const [번호, 대학] of [['7', '가온대학교'], ['8', '한결대학교']]) {
        const dataset = await buildDataset([시트(번호, 이름, 대학)], {
          existing: (await loadDataset(db)).students
        });
        await saveDataset(db, {
          ...dataset, files: [], readSheets: [{ fileHash: `F${번호}`, sheetName: 'S' }]
        });
      }
      // 한 파일에 담으면 둘로 나뉘는데 나눠 올리면 하나가 되던 자리다
      const { students, applications } = await loadDataset(db);
      expect(students.length, 이름).toBe(2);
      expect(applications.length, 이름).toBe(2);
    }
  });

  it('판을 올리기 전에 합쳐져 버린 레코드를 알린다', async () => {
    // 종류를 적어 두지 않은 옛 레코드에 모순된 짝이 붙으면 합쳐지고, 다시 올려도 낫지 않는다
    const 옛레코드 = await assignStudentIds([행(2025, { number: '7', name: '김가온' })]);
    const 옛것 = 옛레코드.students.map(({ sid, cohortYear, keyHashes }) => ({ sid, cohortYear, keyHashes }));
    const 붙은뒤 = await assignStudentIds([행(2025, { number: '8', name: '김가온' })], { existing: 옛것 });
    expect(붙은뒤.students).toHaveLength(1);

    // 옛 레코드는 종류를 적어 두지 않았으므로, 그 종류가 채워진 다음 업로드에서 드러난다
    const 채워진뒤 = await assignStudentIds([행(2025, { number: '7', name: '김가온' })], {
      existing: 붙은뒤.students
    });
    const 다음번 = await assignStudentIds([행(2025, { number: '7', name: '김가온' })], {
      existing: 채워진뒤.students
    });
    expect(다음번.warnings.some((warning) => warning.type === 'stored-student-conflict')).toBe(true);

    // 멀쩡한 레코드(학번 하나가 반 둘을 묶는 경우)는 알리지 않는다
    const 멀쩡한것 = await assignStudentIds([
      행(2025, { hakbun: '30101', classNo: '3', number: '1' }),
      행(2025, { hakbun: '30101', classNo: '4', number: '2' })
    ]);
    const 이어서 = await assignStudentIds([행(2025, { hakbun: '30101' })], {
      existing: 멀쩡한것.students
    });
    expect(이어서.warnings.some((warning) => warning.type === 'stored-student-conflict')).toBe(false);
  });

  it('종류를 일부만 아는 레코드를 두고 합쳐졌다고 말하지 않는다', async () => {
    // 옛 판이 넣어 둔 학번 레코드(종류 기록 없음)에 반·번호만 있는 파일을 이어 붙이는 길
    const 옛것 = await assignStudentIds([
      행(2025, { hakbun: '30101', classNo: '1', number: '1' }),
      행(2025, { hakbun: '30101', classNo: '2', number: '2' })
    ]);
    const 종류없이 = 옛것.students.map(({ sid, cohortYear, keyHashes }) => ({ sid, cohortYear, keyHashes }));
    let 보관된것 = 종류없이;
    for (const [classNo, number] of [['1', '1'], ['2', '2'], ['1', '1']]) {
      const 이번 = await assignStudentIds([행(2025, { classNo, number })], { existing: 보관된것 });
      보관된것 = 이번.students;
      // 학번 하나가 반 둘을 묶고 있는 정상 학생이다. 지우라고 말하면 안 된다
      expect(이번.warnings.some((warning) => warning.type === 'stored-student-conflict')).toBe(false);
    }
    expect(보관된것).toHaveLength(1);
  });

  it('같은 파일을 네 번 올려도 학생 수가 늘지도 줄지도 않는다', async () => {
    for (const 이름 of ['가', '김가온', '최여울', '홍길동', '강민재', '윤서아']) {
      const db = await freshDatabase();
      const sheet = {
        grid: [['번호', '이름', '대학명', '최종'],
          ['7', 이름, '가온대학교', '합격'],
          ['8', 이름, '한결대학교', '합격']],
        headerRows: 1,
        columns: { 'identity.number': 0, 'identity.name': 1, univ: 2, final: 3 },
        cohortYear: 2025,
        source: { fileHash: 'F', sourceFile: '진학결과.xlsx', sourceSheet: 'S' }
      };
      for (let 차례 = 0; 차례 < 4; 차례 += 1) {
        const dataset = await buildDataset([sheet], { existing: (await loadDataset(db)).students });
        await saveDataset(db, { ...dataset, files: [], readSheets: [{ fileHash: 'F', sheetName: 'S' }] });
        const { students, applications } = await loadDataset(db);
        expect(students.length, `${이름} ${차례 + 1}회`).toBe(2);
        expect(applications.length, `${이름} ${차례 + 1}회`).toBe(2);
      }
    }
  });
});

describe('계산 감사에서 드러난 것', async () => {
  const { coerce } = await import('../src/ingest/buildRecords.js');
  const { formatNumber } = await import('../src/analysis/registry.js');
  const { matchesFilter } = await import('../src/analysis/query.js');

  it('소수점 쉼표를 열 배 값으로 읽지 않는다 — 내신 2,5가 25가 되면 안 된다', () => {
    expect(coerce('gpa.전교과', '2,5')).toBeNull();
    expect(coerce('gpa.전교과', '1,234')).toBeNull();
    expect(coerce('gpa.전교과', '2.5')).toBe(2.5);
  });

  it('성적이 아닌 숫자는 천 단위 쉼표만 지운다', () => {
    expect(coerce('quota', '1,234')).toBe(1234);
    expect(coerce('quota', '12,5')).toBeNull();
  });

  it('화면 글자와 범위 필터가 같은 값을 말한다 — 2.354를 2.35로 적지 않는다', () => {
    expect(formatNumber(2.354)).toBe('2.354');
    expect(formatNumber(2.4)).toBe('2.40');
    expect(formatNumber(2.35)).toBe('2.35');
    const row = { 'gpa.전교과': 2.354 };
    expect(matchesFilter(row, { key: 'gpa.전교과', op: 'range', min: null, max: 2.35 })).toBe(false);
  });
});
