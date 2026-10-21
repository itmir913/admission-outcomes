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
import { facetCounts, applyQuery } from '../src/analysis/query.js';
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
    // 소수 셋째 자리가 다른 두 값은 표에도 목록에도 같은 10.00으로 적힌다
    const rows = [{ 'gpa.환산': 10.001 }, { 'gpa.환산': 10.002 }, { 'gpa.환산': 11.5 }];
    const counts = facetCounts(rows, [], 'gpa.환산');
    const [대표, 건수] = [...counts.entries()].find(([value]) => Math.floor(Number(value)) === 10);
    expect(건수).toBe(2);
    const kept = applyQuery(rows, { filters: [{ key: 'gpa.환산', op: 'in', values: [대표] }] });
    expect(kept).toHaveLength(건수);
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
