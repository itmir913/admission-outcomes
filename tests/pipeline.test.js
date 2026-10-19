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
      'gpa.전과목': 9, stage1: 10, final: 11
    }
  });
  return new ProfileSet([profile]);
}

const upload = (name, bytes) => ({ name, bytes });

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

  it('프로파일이 없어도 이름으로 풀어 넣는다', async () => {
    // 지문이 어긋났다는 것은 "읽을 수 없다"가 아니라 "다시 풀어야 한다"는 뜻이다 (§4)
    const { sheets } = await prepareUploads(
      [upload('a.xlsx', makeWorkbook({ result: senjinhakGrid(2026) }))],
      { profiles: new ProfileSet([]), currentYear: NOW }
    );
    expect(sheets[0].reading.source).toBe('names');
    expect(sheets[0].reading.readable).toBe(true);
    // 이름으로 푼 것은 맞아 보여도 한 번은 눈으로 보게 한다
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
