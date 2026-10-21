import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDatabase, saveDataset, loadDataset, clearAll,
  listFiles, findFile, removeFile, saveProfile, loadProfiles, STORE
} from '../src/store/db.js';

let counter = 0;

/** 테스트마다 새 보관소를 쓴다. 서로 영향을 주면 실패 원인을 찾기 어렵다 */
async function freshDatabase() {
  counter += 1;
  return openDatabase(`test-${counter}-${Date.now()}`);
}

function dataset(overrides = {}) {
  return {
    students: [
      { sid: '2025-AAAA-1111', cohortYear: 2025, keyHashes: ['h1'], gpa: { 전교과: 1.82 } },
      { sid: '2025-BBBB-2222', cohortYear: 2025, keyHashes: ['h2'], gpa: { 전교과: 2.41 } }
    ],
    applications: [
      { sid: '2025-AAAA-1111', cohortYear: 2025, univ: '서울대학교', final: '합격', fileHash: 'file-a' },
      { sid: '2025-AAAA-1111', cohortYear: 2025, univ: '연세대학교', final: '불합격', fileHash: 'file-a' },
      { sid: '2025-BBBB-2222', cohortYear: 2025, univ: '고려대학교', final: '합격', fileHash: 'file-a' }
    ],
    suneung: [
      { sid: '2025-AAAA-1111', area: '국어', grade: 2 },
      { sid: '2025-BBBB-2222', area: '국어', grade: 3 }
    ],
    files: [{ hash: 'file-a', name: '2026학년도.xlsx', cohortYear: 2025, rows: 3 }],
    ...overrides
  };
}

describe('보관과 불러오기', () => {
  let db;
  beforeEach(async () => { db = await freshDatabase(); });

  it('넣은 것을 그대로 되돌려준다', async () => {
    await saveDataset(db, dataset());
    const loaded = await loadDataset(db);
    expect(loaded.students).toHaveLength(2);
    expect(loaded.applications).toHaveLength(3);
    expect(loaded.suneung).toHaveLength(2);
    expect(loaded.files).toHaveLength(1);
  });

  it('빈 보관소를 읽어도 터지지 않는다', async () => {
    const loaded = await loadDataset(db);
    expect(loaded).toEqual({ students: [], applications: [], suneung: [], files: [] });
  });

  it('숫자 타입을 그대로 지킨다', async () => {
    await saveDataset(db, dataset());
    const loaded = await loadDataset(db);
    expect(loaded.students[0].gpa.전교과).toBe(1.82);
    expect(loaded.students[0].cohortYear).toBe(2025);
  });

  it('중첩된 값도 지킨다', async () => {
    const data = dataset();
    data.applications[0].extra = { 비고: '수시1' };
    await saveDataset(db, data);
    const loaded = await loadDataset(db);
    expect(loaded.applications.find((row) => row.univ === '서울대학교').extra)
      .toEqual({ 비고: '수시1' });
  });
});

describe('이어서 올리기', () => {
  let db;
  beforeEach(async () => { db = await freshDatabase(); });

  it('학생을 sid로 합친다', async () => {
    await saveDataset(db, dataset());
    await saveDataset(db, {
      students: [{ sid: '2025-AAAA-1111', cohortYear: 2025, keyHashes: ['h3'], gpa: { 국영수: 1.9 } }],
      applications: [{ sid: '2025-AAAA-1111', cohortYear: 2025, univ: '성균관대학교', fileHash: 'file-b' }],
      suneung: [],
      files: [{ hash: 'file-b', name: '추가.xlsx' }]
    });
    const loaded = await loadDataset(db);
    expect(loaded.students).toHaveLength(2);
    const merged = loaded.students.find((student) => student.sid === '2025-AAAA-1111');
    expect(merged.keyHashes.sort()).toEqual(['h1', 'h3']);
  });

  /*
   * 빠진 항목은 먼저 넣은 값을 지키고, 둘 다 있는 항목은 **방금 올린 값이 이긴다.**
   * 거꾸로 두었더니 등급을 바로잡아 같은 파일을 다시 올려도 옛 값이 화면에 남았다.
   */
  it('나중 파일의 내신을 더하고, 같은 항목은 새 값으로 바꾼다', async () => {
    await saveDataset(db, dataset());
    await saveDataset(db, {
      students: [{ sid: '2025-AAAA-1111', cohortYear: 2025, keyHashes: [], gpa: { 전교과: 3.3, 국영수: 1.9 } }],
      applications: [], suneung: [], files: []
    });
    const merged = (await loadDataset(db)).students
      .find((student) => student.sid === '2025-AAAA-1111');
    expect(merged.gpa.전교과).toBe(3.3);
    expect(merged.gpa.국영수).toBe(1.9);
  });

  it('지원 기록은 덮지 않고 덧붙인다', async () => {
    // 한 학생이 여러 해에 걸쳐 여러 파일에서 온다
    await saveDataset(db, dataset());
    await saveDataset(db, {
      students: [], suneung: [], files: [],
      applications: [{ sid: '2025-AAAA-1111', cohortYear: 2025, univ: '성균관대학교', fileHash: 'file-b' }]
    });
    expect((await loadDataset(db)).applications).toHaveLength(4);
  });

  it('같은 학생의 같은 영역 수능은 한 번만 남는다', async () => {
    await saveDataset(db, dataset());
    await saveDataset(db, {
      students: [], applications: [], files: [],
      suneung: [{ sid: '2025-AAAA-1111', area: '국어', grade: 2 }]
    });
    expect((await loadDataset(db)).suneung).toHaveLength(2);
  });
});

describe('파일 목록과 중복 감지', () => {
  let db;
  beforeEach(async () => { db = await freshDatabase(); });

  it('올린 파일을 목록에 남긴다', async () => {
    await saveDataset(db, dataset());
    const files = await listFiles(db);
    expect(files[0].name).toBe('2026학년도.xlsx');
  });

  it('같은 파일을 이미 올렸는지 내용 해시로 알아본다', async () => {
    await saveDataset(db, dataset());
    expect(await findFile(db, 'file-a')).toBeDefined();
    expect(await findFile(db, 'file-z')).toBeUndefined();
  });
});

describe('파일 단위로 되돌리기', () => {
  let db;
  beforeEach(async () => { db = await freshDatabase(); });

  async function addSecondFile() {
    await saveDataset(db, {
      students: [{ sid: '2024-CCCC-3333', cohortYear: 2024, keyHashes: ['h9'], gpa: {} }],
      applications: [{ sid: '2024-CCCC-3333', cohortYear: 2024, univ: '한양대학교', fileHash: 'file-b' }],
      suneung: [], files: [{ hash: 'file-b', name: '2025학년도.xlsx' }]
    });
  }

  it('그 파일이 넣은 지원 기록만 지운다', async () => {
    await saveDataset(db, dataset());
    await addSecondFile();

    const removed = await removeFile(db, 'file-a');
    expect(removed.applications).toBe(3);

    const loaded = await loadDataset(db);
    expect(loaded.applications).toHaveLength(1);
    expect(loaded.applications[0].univ).toBe('한양대학교');
  });

  it('기록이 하나도 남지 않은 학생을 함께 지운다', async () => {
    // 아무 기록도 없는 익명 ID가 목록에 남아 있으면 혼란만 준다
    await saveDataset(db, dataset());
    const removed = await removeFile(db, 'file-a');
    expect(removed.students).toBe(2);
    expect((await loadDataset(db)).students).toHaveLength(0);
  });

  it('다른 파일에도 기록이 있는 학생은 남긴다', async () => {
    await saveDataset(db, dataset());
    await saveDataset(db, {
      students: [], suneung: [], files: [{ hash: 'file-b', name: '추가.xlsx' }],
      applications: [{ sid: '2025-AAAA-1111', cohortYear: 2025, univ: '성균관대학교', fileHash: 'file-b' }]
    });

    await removeFile(db, 'file-a');
    const loaded = await loadDataset(db);
    expect(loaded.students.map((student) => student.sid)).toEqual(['2025-AAAA-1111']);
    expect(loaded.applications).toHaveLength(1);
  });

  it('지운 학생의 수능도 함께 지운다', async () => {
    await saveDataset(db, dataset());
    await removeFile(db, 'file-a');
    expect((await loadDataset(db)).suneung).toHaveLength(0);
  });

  it('파일 목록에서도 뺀다', async () => {
    await saveDataset(db, dataset());
    await removeFile(db, 'file-a');
    expect(await listFiles(db)).toHaveLength(0);
  });

  it('없는 파일을 지워도 터지지 않는다', async () => {
    await saveDataset(db, dataset());
    const removed = await removeFile(db, 'file-없음');
    expect(removed.applications).toBe(0);
    expect((await loadDataset(db)).applications).toHaveLength(3);
  });
});

describe('전체 지우기', () => {
  let db;
  beforeEach(async () => { db = await freshDatabase(); });

  it('모든 자료를 비운다', async () => {
    await saveDataset(db, dataset());
    await saveProfile(db, { id: 'p-2025', program: 'p', year: 2025 });
    await clearAll(db);

    const loaded = await loadDataset(db);
    expect(loaded.students).toEqual([]);
    expect(loaded.applications).toEqual([]);
    expect(loaded.suneung).toEqual([]);
    expect(loaded.files).toEqual([]);
    expect(await loadProfiles(db)).toEqual([]);
  });

  it('지운 뒤에도 계속 쓸 수 있다', async () => {
    await saveDataset(db, dataset());
    await clearAll(db);
    await saveDataset(db, dataset());
    expect((await loadDataset(db)).students).toHaveLength(2);
  });

  it('빈 보관소를 지워도 터지지 않는다', async () => {
    await expect(clearAll(db)).resolves.toBeUndefined();
  });
});

describe('열 매핑 프로파일', () => {
  let db;
  beforeEach(async () => { db = await freshDatabase(); });

  it('사용자가 만든 프로파일을 보관한다', async () => {
    await saveProfile(db, { id: 'kcue-2026', program: 'kcue', year: 2026 });
    expect((await loadProfiles(db))[0].id).toBe('kcue-2026');
  });

  it('같은 id면 새 것으로 바꾼다', async () => {
    await saveProfile(db, { id: 'kcue-2026', year: 2026, columns: { univ: 1 } });
    await saveProfile(db, { id: 'kcue-2026', year: 2026, columns: { univ: 9 } });
    const profiles = await loadProfiles(db);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].columns.univ).toBe(9);
  });
});

describe('보관소 구조', () => {
  it('필요한 저장소를 모두 만든다', async () => {
    const db = await freshDatabase();
    for (const name of Object.values(STORE)) {
      expect(db.objectStoreNames.contains(name), name).toBe(true);
    }
  });

  it('다시 열어도 자료가 남아 있다', async () => {
    counter += 1;
    const name = `persist-${counter}-${Date.now()}`;
    const first = await openDatabase(name);
    await saveDataset(first, dataset());
    first.close();

    const second = await openDatabase(name);
    expect((await loadDataset(second)).students).toHaveLength(2);
  });
});
