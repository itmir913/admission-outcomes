import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { prepareUploads, commitSheets } from '../src/ingest/pipeline.js';
import { ProfileSet, buildProfile } from '../src/ingest/profile.js';
import { openDatabase, saveDataset, loadDataset, clearAll } from '../src/store/db.js';
import { makeWorkbook, makeZip, senjinhakGrid } from './helpers/workbook.js';

const NOW = 2026;

/** 표본 격자에 맞는 프로파일 하나짜리 묶음 */
async function profilesFor(grid, { year = 2025, yearBasis = 'admission', omitYearColumn = false } = {}) {
  const yearColumn = omitYearColumn ? {} : { sourceYear: 0 };
  const profile = await buildProfile({
    program: 'demo',
    programLabel: '표본 프로그램',
    year,
    headerRows: 1,
    grid,
    yearBasis: omitYearColumn ? undefined : yearBasis,
    columns: {
      ...yearColumn, 'identity.hakbun': 1, 'identity.name': 2,
      region: 3, univ: 4, dept: 5, admName: 6, track: 7, period: 8,
      'gpa.전교과': 9, stage1: 10, final: 11
    }
  });
  return new ProfileSet([profile]);
}

const upload = (name, bytes) => ({ name, bytes });

describe('프로파일로 해석한 시트도 미해결을 알린다', () => {
  /*
   * 프로파일을 등록하면 조용해지던 자리다. 열은 그대로 `extra`로 가는데 안내만
   * 사라져서, 사람은 그 열이 해석된 줄 안다 (§5 조용히 틀리는 값).
   */
  async function 한열빼먹은프로파일(grid) {
    const profile = await buildProfile({
      program: 'demo', programLabel: '표본 프로그램', year: 2025, headerRows: 1, grid,
      yearBasis: 'admission',
      columns: {
        sourceYear: 0, 'identity.hakbun': 1, 'identity.name': 2,
        region: 3, univ: 4, dept: 5, admName: 6, track: 7, period: 8,
        'gpa.전교과': 9, stage1: 10   // 11번(최종)을 일부러 빼 둔다
      }
    });
    return new ProfileSet([profile]);
  }

  it('프로파일이 가리키지 않는 열을 미해결로 보고한다', async () => {
    const grid = senjinhakGrid(2026);
    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await 한열빼먹은프로파일(grid), currentYear: NOW }
    );

    expect(sheets[0].reading.source).toBe('profile');
    expect(sheets[0].reading.unresolved.map((item) => item.label)).toEqual(['최종']);
  });

  it('그 사실을 경고로 띄운다 — 이름 경로와 똑같이', async () => {
    const grid = senjinhakGrid(2026);
    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await 한열빼먹은프로파일(grid), currentYear: NOW }
    );
    const { warnings } = await commitSheets(sheets);

    const 미해결 = warnings.filter((warning) => warning.type === 'columns-unresolved');
    expect(미해결).toHaveLength(1);
    expect(미해결[0].message).toContain('최종');
  });

  it('사람이 확인해 둔 열은 묻지 않는다 — extraColumns', async () => {
    /*
     * 프로파일은 사람이 확인해 둔 답이고, `extraColumns`는 그중 「담을 논리 필드가
     * 없더라」는 답이다. 그것까지 매번 알리면 올릴 때마다 같은 열이 줄줄이 뜨고,
     * 사람은 그 안내를 읽지 않게 된다 — 그러면 진짜 새 열이 왔을 때도 지나친다.
     */
    const grid = senjinhakGrid(2026);
    const profile = await buildProfile({
      program: 'demo', programLabel: '표본 프로그램', year: 2025, headerRows: 1, grid,
      yearBasis: 'admission',
      columns: {
        sourceYear: 0, 'identity.hakbun': 1, 'identity.name': 2,
        region: 3, univ: 4, dept: 5, admName: 6, track: 7, period: 8,
        'gpa.전교과': 9, stage1: 10
      }
    });
    profile.extraColumns = [11];   // 11번(최종)은 담을 자리가 없다고 사람이 확정했다

    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles: new ProfileSet([profile]), currentYear: NOW }
    );
    const { warnings } = await commitSheets(sheets);

    expect(sheets[0].reading.unresolved).toEqual([]);
    expect(warnings.filter((warning) => warning.type === 'columns-unresolved')).toEqual([]);
  });

  it('확정해 두지 않은 열은 여전히 보고한다 — 양식이 열을 새로 얻은 경우', async () => {
    const grid = senjinhakGrid(2026).map((row) => [...row]);
    grid[0].push('새로생긴열');
    for (let index = 1; index < grid.length; index += 1) grid[index].push('값');

    const profile = await buildProfile({
      program: 'demo', programLabel: '표본 프로그램', year: 2025, headerRows: 1, grid,
      yearBasis: 'admission',
      columns: {
        sourceYear: 0, 'identity.hakbun': 1, 'identity.name': 2,
        region: 3, univ: 4, dept: 5, admName: 6, track: 7, period: 8,
        'gpa.전교과': 9, stage1: 10, final: 11
      }
    });
    profile.extraColumns = [];

    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles: new ProfileSet([profile]), currentYear: NOW }
    );
    expect(sheets[0].reading.unresolved.map((item) => item.label)).toEqual(['새로생긴열']);
  });

  it('프로파일이 열을 다 집어 가면 아무 말도 하지 않는다', async () => {
    const grid = senjinhakGrid(2026);
    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await profilesFor(grid), currentYear: NOW }
    );
    const { warnings } = await commitSheets(sheets);

    expect(sheets[0].reading.unresolved).toEqual([]);
    expect(warnings.filter((warning) => warning.type === 'columns-unresolved')).toEqual([]);
  });
});

describe('불러오기 준비', () => {
  it('시트마다 무엇을 알아냈는지 보고한다', async () => {
    const grid = senjinhakGrid(2026);
    const profiles = await profilesFor(grid);
    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles, currentYear: NOW }
    );

    expect(sheets).toHaveLength(1);
    expect(sheets[0].profile.program).toBe('demo');
    expect(sheets[0].sheetName).toBe('result');
    expect(sheets[0].rowCount).toBe(4);
  });

  it('아무것도 저장하지 않는다', async () => {
    // 사람이 확인하기 전에는 손대지 않는다
    const grid = senjinhakGrid(2026);
    const db = await openDatabase(`prepare-${Date.now()}`);
    await prepareUploads(
      [upload('a.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await profilesFor(grid), currentYear: NOW }
    );
    expect((await loadDataset(db)).applications).toEqual([]);
  });

  it('프로파일이 알려 준 기준으로 고3 년도를 제안한다', async () => {
    // 연도 열의 2026은 학년도다 → 고3 년도 2025
    const grid = senjinhakGrid(2026);
    const { sheets } = await prepareUploads(
      [upload('a.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await profilesFor(grid), currentYear: NOW }
    );
    expect(sheets[0].yearGuess.cohortYear).toBe(2025);
    expect(sheets[0].ready).toBe(true);
  });

  it('맞는 프로파일이 없으면 손댈 곳으로 표시한다', async () => {
    const { sheets } = await prepareUploads(
      [upload('a.xlsx', makeWorkbook({ result: senjinhakGrid(2026) }))],
      { profiles: new ProfileSet([]), currentYear: NOW }
    );
    expect(sheets[0].profile).toBeNull();
    expect(sheets[0].match.needsFallback).toBe(true);
    expect(sheets[0].ready).toBe(false);
  });

  it('이미 올린 파일이면 알려 준다', async () => {
    const grid = senjinhakGrid(2026);
    const bytes = makeWorkbook({ result: grid });
    const profiles = await profilesFor(grid);

    const first = await prepareUploads([upload('a.xlsx', bytes)], { profiles, currentYear: NOW });
    const known = [{ hash: first.sheets[0].fileHash, name: 'a.xlsx' }];

    const second = await prepareUploads([upload('이름만다름.xlsx', bytes)], {
      profiles, existingFiles: known, currentYear: NOW
    });
    expect(second.sheets[0].duplicate).toBeDefined();
    expect(second.sheets[0].duplicate.name).toBe('a.xlsx');
  });

  it('zip으로 올려도 같은 결과를 낸다', async () => {
    const grid = senjinhakGrid(2026);
    const bytes = makeWorkbook({ result: grid });
    const profiles = await profilesFor(grid);

    const direct = await prepareUploads([upload('a.xlsx', bytes)], { profiles, currentYear: NOW });
    const zipped = await prepareUploads([upload('묶음.zip', makeZip({ 'a.xlsx': bytes }))], {
      profiles, currentYear: NOW
    });
    expect(zipped.sheets[0].fileHash).toBe(direct.sheets[0].fileHash);
    expect(zipped.sheets[0].container).toBe('묶음.zip');
  });

  it('읽지 못한 파일을 이유와 함께 돌려준다', async () => {
    const { sheets, skipped } = await prepareUploads(
      [upload('안내문.pdf', new TextEncoder().encode('%PDF'))],
      { profiles: new ProfileSet([]), currentYear: NOW }
    );
    expect(sheets).toEqual([]);
    expect(skipped[0].reason).toMatch(/엑셀/);
  });
});

describe('확정하고 넣기', () => {
  async function prepared() {
    const grid = senjinhakGrid(2026);
    return prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await profilesFor(grid), currentYear: NOW }
    );
  }

  it('제안한 연도로 자료를 만든다', async () => {
    const { sheets } = await prepared();
    const dataset = await commitSheets(sheets);
    expect(dataset.applications).toHaveLength(4);
    expect(dataset.applications.every((row) => row.cohortYear === 2025)).toBe(true);
  });

  it('사람이 정한 연도가 제안을 이긴다', async () => {
    const { sheets } = await prepared();
    const dataset = await commitSheets(sheets, {
      decisions: { [sheets[0].id]: { cohortYear: 2019 } }
    });
    expect(dataset.applications.every((row) => row.cohortYear === 2019)).toBe(true);
    expect(dataset.students[0].sid).toMatch(/^2019-/);
  });

  it('빼기로 한 시트는 넣지 않는다', async () => {
    const { sheets } = await prepared();
    const dataset = await commitSheets(sheets, {
      decisions: { [sheets[0].id]: { include: false } }
    });
    expect(dataset.applications).toHaveLength(0);
  });

  it('출처를 남겨 파일 단위로 되돌릴 수 있게 한다', async () => {
    const { sheets } = await prepared();
    const dataset = await commitSheets(sheets);
    expect(dataset.applications[0].fileHash).toBe(sheets[0].fileHash);
    expect(dataset.applications[0].sourceFile).toBe('진학결과.xlsx');
  });

  it('파일 기록을 함께 만든다', async () => {
    const { sheets } = await prepared();
    const dataset = await commitSheets(sheets);
    expect(dataset.files).toHaveLength(1);
    expect(dataset.files[0].cohortYears).toEqual([2025]);
    expect(dataset.files[0].sheets).toEqual(['result']);
  });

  it('이름과 학번을 남기지 않는다', async () => {
    const { sheets } = await prepared();
    const dataset = await commitSheets(sheets);
    const dumped = JSON.stringify(dataset);
    expect(dumped).not.toContain('김가온');
    expect(dumped).not.toContain('30101');
  });

  it('프로파일이 없어도 이름으로 해석해 넣는다', async () => {
    // 지문이 어긋났다는 것은 "읽을 수 없다"가 아니라 "다시 해석해야 한다"는 뜻이다 (§4)
    const { sheets } = await prepareUploads(
      [upload('a.xlsx', makeWorkbook({ result: senjinhakGrid(2026) }))],
      { profiles: new ProfileSet([]), currentYear: NOW }
    );
    expect(sheets[0].reading.source).toBe('names');
    expect(sheets[0].reading.readable).toBe(true);
    // 이름으로 해석한 것은 맞아 보여도 한 번은 눈으로 보게 한다
    expect(sheets[0].ready).toBe(false);

    const dataset = await commitSheets(sheets, { decisions: { [sheets[0].id]: { cohortYear: 2025, include: true } } });
    expect(dataset.applications.length).toBeGreaterThan(0);
    expect(dataset.applications[0].univ).toBe('서울대학교');
  });

  it('대학명 열을 못 찾으면 넣지 않고 알린다', async () => {
    const grid = [['쪽지', '메모'], ['가', '나']];
    const { sheets } = await prepareUploads(
      [upload('a.xlsx', makeWorkbook({ result: grid }))],
      { profiles: new ProfileSet([]), currentYear: NOW }
    );
    expect(sheets[0].reading.readable).toBe(false);
    const dataset = await commitSheets(sheets);
    expect(dataset.applications).toHaveLength(0);
    expect(dataset.warnings.find((item) => item.type === 'not-readable')).toBeDefined();
  });

  it('연도가 정해지지 않으면 넣지 않고 알린다', async () => {
    const grid = senjinhakGrid(2026);
    // 연도 열을 집어 가지 않는 프로파일이라, 값이 학년도인지 고3 년도인지 알 수 없다
    const profiles = await profilesFor(grid, { omitYearColumn: true });
    const { sheets } = await prepareUploads(
      [upload('연도없음.xlsx', makeWorkbook({ result: grid }))],
      { profiles, currentYear: NOW }
    );
    const dataset = await commitSheets(sheets);
    expect(dataset.applications).toHaveLength(0);
    expect(dataset.warnings.find((item) => item.type === 'year-not-set')).toBeDefined();
  });
});

describe('보관소까지 이어지는 왕복', () => {
  it('올리고 저장하고 다시 읽으면 그대로다', async () => {
    const grid = senjinhakGrid(2026);
    const profiles = await profilesFor(grid);
    const db = await openDatabase(`roundtrip-${Date.now()}`);
    await clearAll(db);

    const { sheets } = await prepareUploads(
      [upload('진학결과.xlsx', makeWorkbook({ result: grid }))],
      { profiles, currentYear: NOW }
    );
    const dataset = await commitSheets(sheets);
    await saveDataset(db, dataset);

    const loaded = await loadDataset(db);
    expect(loaded.students).toHaveLength(3);
    expect(loaded.applications).toHaveLength(4);
    expect(loaded.files).toHaveLength(1);
  });

  it('이듬해 자료를 더해도 기존 학생의 익명 ID가 그대로다', async () => {
    const profiles2025 = await profilesFor(senjinhakGrid(2026));
    const db = await openDatabase(`carry-${Date.now()}`);
    await clearAll(db);

    const first = await prepareUploads(
      [upload('2026학년도.xlsx', makeWorkbook({ result: senjinhakGrid(2026) }))],
      { profiles: profiles2025, currentYear: NOW }
    );
    const firstData = await commitSheets(first.sheets);
    await saveDataset(db, firstData);

    const before = (await loadDataset(db)).students.map((student) => student.sid).sort();

    const second = await prepareUploads(
      [upload('2027학년도.xlsx', makeWorkbook({ result: senjinhakGrid(2027) }))],
      { profiles: profiles2025, currentYear: NOW }
    );
    const secondData = await commitSheets(second.sheets, {
      existingStudents: (await loadDataset(db)).students
    });
    await saveDataset(db, secondData);

    const after = (await loadDataset(db)).students.map((student) => student.sid);
    for (const sid of before) expect(after).toContain(sid);
    expect(after).toHaveLength(6);
  });
});

describe('행마다 연도가 적힌 누적 파일', () => {
  /*
   * 사람이 고3 년도 칸을 비우면 행별 연도로 읽어야 한다. 예전에는 `??`로 파일 이름의
   * 추정 연도가 메워져 모든 행이 한 해로 덮였다 — 한 해 밀린 값이 조용히 저장된다 (§2).
   */
  it('고3 년도 칸을 비우면 파일 이름 연도로 덮지 않고 행별로 읽는다', async () => {
    const grid = senjinhakGrid(2026);
    grid[3][0] = 2025;
    grid[4][0] = 2025;
    const { sheets } = await prepareUploads(
      [upload('2026학년도 누적.xlsx', makeWorkbook({ result: grid }))],
      { profiles: await profilesFor(grid), currentYear: NOW }
    );
    expect(sheets[0].reading.perRowYear).toBe(true);

    const dataset = await commitSheets(sheets, { decisions: { [sheets[0].id]: { cohortYear: null } } });
    expect(dataset.applications.map((row) => row.cohortYear).sort()).toEqual([2024, 2024, 2025, 2025]);
    // 파일 연도가 없으니 파일 기록에도 null을 적지 않는다
    expect(dataset.files[0].cohortYears).not.toContain(null);
    expect(dataset.files[0].yearBySheet ?? {}).not.toHaveProperty(sheets[0].sheetName);
  });
});


describe('이름은 같고 내용이 다른 파일을 다시 올릴 때', () => {
  /*
   * 셀 하나만 고쳐도 해시가 달라 교체로 인식되지 않았다. 지원 건수가 두 배가 되고
   * 합격률의 분모와 분자가 함께 부푼다 (§5).
   */
  async function 두번올리기(replace) {
    const grid = senjinhakGrid(2026);
    const profiles = await profilesFor(grid);
    const db = await openDatabase(`same-name-${replace}-${Date.now()}`);
    await clearAll(db);

    const first = await prepareUploads([upload('결과.xlsx', makeWorkbook({ result: grid }))], { profiles, currentYear: NOW });
    await saveDataset(db, await commitSheets(first.sheets));

    const fixed = senjinhakGrid(2026);
    fixed[4][11] = '합';
    const stored = await loadDataset(db);
    const second = await prepareUploads([upload('결과.xlsx', makeWorkbook({ result: fixed }))], {
      profiles, existingFiles: stored.files, currentYear: NOW
    });
    expect(second.sheets[0].duplicate).toBeNull();
    expect(second.sheets[0].sameName.map((file) => file.hash)).toEqual([first.sheets[0].fileHash]);

    await saveDataset(db, await commitSheets(second.sheets, {
      decisions: { [second.sheets[0].id]: { replace } },
      existingStudents: stored.students
    }));
    return loadDataset(db);
  }

  it('바꾸기로 고르면 옛 파일 기록을 걷어내고 새 것만 남긴다', async () => {
    const loaded = await 두번올리기(true);
    expect(loaded.applications).toHaveLength(4);
    expect(loaded.files).toHaveLength(1);
    expect(loaded.applications.filter((row) => row.univ?.includes('아주'))).toHaveLength(1);
  });

  it('따로 더하기로 고르면 둘 다 남긴다', async () => {
    const loaded = await 두번올리기(false);
    expect(loaded.applications).toHaveLength(8);
    expect(loaded.files).toHaveLength(2);
  });
});

describe('zip 안 폴더가 다른 같은 이름 파일', () => {
  /*
   * 2025학년도/결과.xlsx와 2026학년도/결과.xlsx가 확인 창에 똑같이 「결과.xlsx」로 보이면
   * 어느 쪽이 어느 해인지 구별할 수 없다. 폴더를 적어 두고, 고3 년도 제안에도 쓴다.
   */
  it('폴더를 시트에 남기고, 폴더 이름의 학년도로 고3 년도를 제안한다', async () => {
    const grid = senjinhakGrid(2026).map((row) => row.slice(1));
    const zip = makeZip({
      '2025학년도/결과.xlsx': makeWorkbook({ result: grid }),
      '2026학년도/결과.xlsx': makeWorkbook({ result: grid.concat([grid[1]]) })
    });
    const { sheets } = await prepareUploads([upload('전체.zip', zip)], { profiles: new ProfileSet([]), currentYear: NOW });
    expect(sheets.map((sheet) => sheet.folder).sort()).toEqual(['2025학년도', '2026학년도']);
    const byFolder = Object.fromEntries(sheets.map((sheet) => [sheet.folder, sheet.yearGuess.cohortYear]));
    expect(byFolder['2025학년도']).toBe(2024);
    expect(byFolder['2026학년도']).toBe(2025);
  });
});

describe('다른 폴더의 같은 이름 파일은 교체 대상이 아니다', () => {
  it('2025학년도/결과.xlsx를 고쳐 올려도 2026학년도/결과.xlsx는 묻지도 지우지도 않는다', async () => {
    const grid = senjinhakGrid(2026).map((row) => row.slice(1));
    const profiles = new ProfileSet([]);
    const db = await openDatabase(`folder-${Date.now()}`);
    await clearAll(db);
    const zip = makeZip({
      '2025학년도/결과.xlsx': makeWorkbook({ result: grid }),
      '2026학년도/결과.xlsx': makeWorkbook({ result: grid.concat([grid[1]]) })
    });
    const first = await prepareUploads([upload('전체.zip', zip)], { profiles, currentYear: NOW });
    await saveDataset(db, await commitSheets(first.sheets));

    const fixed = grid.map((row) => [...row]);
    fixed[4][10] = '합';
    const again = makeZip({ '2025학년도/결과.xlsx': makeWorkbook({ result: fixed }) });
    const stored = await loadDataset(db);
    const second = await prepareUploads([upload('고침.zip', again)], { profiles, existingFiles: stored.files, currentYear: NOW });
    expect(second.sheets[0].sameName).toHaveLength(1);
    expect(second.sheets[0].sameName[0].folder).toBe('2025학년도');
    await saveDataset(db, await commitSheets(second.sheets, {
      decisions: { [second.sheets[0].id]: { replace: true } },
      existingStudents: stored.students
    }));
    const loaded = await loadDataset(db);
    expect(loaded.files.map((file) => file.folder).sort()).toEqual(['2025학년도', '2026학년도']);
    expect(loaded.applications).toHaveLength(4 + 5);
  });
});

describe('기준을 모르는 누적 파일 — 사람이 연도 열의 기준을 정한다', () => {
  async function 누적() {
    const grid = senjinhakGrid(2026);
    grid[2][0] = 2025;
    grid[4][0] = 2024;
    return prepareUploads([upload('누적.xlsx', makeWorkbook({ result: grid }))], { profiles: new ProfileSet([]), currentYear: NOW });
  }

  it('값이 올해를 넘지 않으면 기준을 묻는다', async () => {
    const { sheets } = await 누적();
    const { needsBasisChoice } = await import('../src/ui/upload.js');
    expect(needsBasisChoice(sheets[0])).toBe(true);
  });

  it('학년도로 정하면 행마다 한 해 당겨 읽는다', async () => {
    const { sheets } = await 누적();
    const dataset = await commitSheets(sheets, { decisions: { [sheets[0].id]: { yearBasis: 'admission', cohortYear: 2030 } } });
    // 넣어 둔 파일 연도(2030)는 쓰지 않는다
    expect(dataset.applications.map((row) => row.cohortYear).sort()).toEqual([2023, 2024, 2025, 2025]);
  });

  it('고3 년도로 정하면 그대로 읽는다', async () => {
    const { sheets } = await 누적();
    const dataset = await commitSheets(sheets, { decisions: { [sheets[0].id]: { yearBasis: 'senior' } } });
    expect(dataset.applications.map((row) => row.cohortYear).sort()).toEqual([2024, 2025, 2026, 2026]);
  });

  it('파일 전체를 한 해로 정하면 넣은 연도 하나로 저장한다', async () => {
    const { sheets } = await 누적();
    const dataset = await commitSheets(sheets, { decisions: { [sheets[0].id]: { yearBasis: 'file', cohortYear: 2025 } } });
    expect(new Set(dataset.applications.map((row) => row.cohortYear))).toEqual(new Set([2025]));
  });
});

describe('이름으로 해석한 시트의 열 배정을 보여 준다', () => {
  it('어느 열이 어느 칸으로 갔는지 돌려주고, 수능 표지 없는 과목 열을 알린다', async () => {
    const grid = [
      ['학번', '이름', '대학명', '모집단위', '최종', '전교과', '국어', '수학', '영어'],
      ['30101', '가', '가대학', '국문', '합', 2.1, 3, 2, 1]
    ];
    const { sheets } = await prepareUploads([upload('자체.xlsx', makeWorkbook({ result: grid }))], { profiles: new ProfileSet([]), currentYear: NOW });
    const reading = sheets[0].reading;
    expect(reading.mapping.find((item) => item.label === '국어')?.key).toBe('gpa.국어');
    expect(reading.notes.some((note) => note.includes('수능 구역 표지'))).toBe(true);
  });
});
