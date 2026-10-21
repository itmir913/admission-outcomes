/**
 * 브라우저 보관소 (§2, §5).
 *
 * 한 번 올려 두면 다음에 열 때 그대로 떠 있어야 한다. 상담할 때마다 엑셀을
 * 다시 올리는 수고를 없애는 것이 이 계층의 목적이다.
 *
 * **여기 들어오는 것은 익명화가 끝난 자료뿐이다.** 이름과 학번 원문은 이미 버려졌고
 * 남아 있는 것은 키 해시다.
 *
 * **다만 그 해시는 「되돌릴 수 없는」 것이 아니다.** 입력이 `고3 년도 + 학번` 한 줄이라
 * 경우의 수가 수만 개뿐이고, 고정 소금은 코드에 적혀 있어 비밀이 아니다. 마음먹은
 * 사람은 보관소나 익명 ID 목록만으로 학번을 되돌릴 수 있다 — 익명 ID는 **가명이지
 * 익명이 아니다.** 그래서 보관소도 ID 목록도 학교 밖으로 나가면 안 된다.
 * 자세한 수치와 그 판단은 docs/decisions.md 에 적어 두었다.
 *
 * 그래도 보관소는 **캐시이지 원본이 아니다.** 시크릿 모드·캐시 삭제·PC 교체로 사라진다.
 * 원본 엑셀 관리 책임은 학교에 있다.
 */

export const DB_NAME = 'admission-outcomes';
export const DB_VERSION = 1;

export const STORE = {
  students: 'students',
  applications: 'applications',
  suneung: 'suneung',
  files: 'files',
  profiles: 'profiles'
};

/** @param {IDBRequest} request */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** @param {IDBTransaction} transaction */
function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('저장이 중단되었습니다.'));
  });
}

function indexedDbFactory() {
  const factory = globalThis.indexedDB;
  if (!factory) {
    // 어느 쪽인지 여기서 구별할 수 없으므로 해당하는 곳을 모두 알린다.
    // "안 됩니다"만 남기면 사용자가 무엇을 바꿔 볼지 알 수 없다
    throw new Error(
      '이 브라우저에서는 데이터를 보관할 수 없습니다.\n'
      + '· 시크릿 모드라면 일반 창에서 열어 주세요.\n'
      + '· 파일을 직접 연 것(file://)이라면 브라우저가 보관을 막습니다. 웹 주소로 열어 주세요.'
    );
  }
  return factory;
}

/**
 * 보관소를 연다. 없으면 만든다.
 * @param {string} [name]
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase(name = DB_NAME) {
  const request = indexedDbFactory().open(name, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;

    if (!db.objectStoreNames.contains(STORE.students)) {
      const students = db.createObjectStore(STORE.students, { keyPath: 'sid' });
      students.createIndex('cohortYear', 'cohortYear');
    }
    if (!db.objectStoreNames.contains(STORE.applications)) {
      const applications = db.createObjectStore(STORE.applications, { keyPath: 'id', autoIncrement: true });
      applications.createIndex('sid', 'sid');
      applications.createIndex('cohortYear', 'cohortYear');
      // 파일 단위로 되돌리려면 어느 파일에서 왔는지 알아야 한다
      applications.createIndex('fileHash', 'fileHash');
    }
    if (!db.objectStoreNames.contains(STORE.suneung)) {
      const suneung = db.createObjectStore(STORE.suneung, { keyPath: ['sid', 'area'] });
      suneung.createIndex('sid', 'sid');
    }
    if (!db.objectStoreNames.contains(STORE.files)) {
      db.createObjectStore(STORE.files, { keyPath: 'hash' });
    }
    if (!db.objectStoreNames.contains(STORE.profiles)) {
      db.createObjectStore(STORE.profiles, { keyPath: 'id' });
    }
  };
  return promisify(request);
}

/**
 * @param {IDBDatabase} db
 * @param {string} name
 */
export function getAll(db, name) {
  return promisify(db.transaction(name, 'readonly').objectStore(name).getAll());
}

/**
 * 같은 파일을 이미 올렸는지 본다. 내용 해시로 판별하므로 이름을 바꿔도 알아챈다.
 * @param {IDBDatabase} db
 * @param {string} hash
 */
export function findFile(db, hash) {
  return promisify(db.transaction(STORE.files, 'readonly').objectStore(STORE.files).get(hash));
}

/** @param {IDBDatabase} db */
export function listFiles(db) {
  return getAll(db, STORE.files);
}

/**
 * 값이 있는 쪽만 덮는다.
 *
 * **방금 올린 값이 이긴다.** 양식마다 담는 항목이 달라(어떤 것은 등급만, 어떤 것은
 * 표점·백분위까지) 빠진 항목은 먼저 넣은 값을 그대로 둬야 하지만, 같은 항목이
 * 둘 다 있으면 새것이 맞다 — 값을 고쳐 다시 올린 사람은 고친 값을 보려고 올린 것이다.
 * 거꾸로 두었더니 등급을 바로잡아 다시 올려도 옛 등급이 화면에 남았다.
 */
function 새값우선(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * 학생 하나를 합친다. 같은 사람이 여러 파일에 나뉘어 있으므로 키와 내신을 모은다.
 */
function mergeStudent(existing, incoming) {
  if (!existing) return { ...incoming, gpa: { ...incoming.gpa } };
  return {
    ...existing,
    ...incoming,
    keyHashes: [...new Set([...(existing.keyHashes ?? []), ...(incoming.keyHashes ?? [])])].sort(),
    // 키 종류도 **합친다.** 들어온 쪽으로 덮으면, 파일마다 다른 식별 열을 쓰는 학생의
    // 종류 기록이 업로드마다 지워져 모순을 알아보는 장치가 조용히 꺼진다
    keyKinds: { ...(existing.keyKinds ?? {}), ...(incoming.keyKinds ?? {}) },
    gpa: 새값우선(existing.gpa, incoming.gpa)
  };
}

/**
 * 불러온 자료를 보관소에 넣는다.
 *
 * 학생은 sid로 합치고, 지원 기록은 덧붙인다.
 * 지원 기록을 덮어쓰지 않는 이유: 한 학생이 여러 해에 걸쳐, 여러 파일에서 온다.
 *
 * @param {IDBDatabase} db
 * @param {{students: object[], applications: object[], suneung: object[], files?: object[]}} dataset
 */
export async function saveDataset(db, dataset) {
  const names = [STORE.students, STORE.applications, STORE.suneung, STORE.files];
  const transaction = db.transaction(names, 'readwrite');
  // 주의: 이 트랜잭션 안에서 await하는 것은 전부 IDB 요청의 onsuccess에서 풀리는 약속이라야 한다.
  // sha256이나 fetch 같은 다른 await를 끼워 넣으면 트랜잭션이 먼저 닫혀
  // 실제 브라우저에서 TransactionInactiveError가 난다 (테스트 대역은 이를 잡아내지 못한다)
  const students = transaction.objectStore(STORE.students);
  const applications = transaction.objectStore(STORE.applications);
  const suneung = transaction.objectStore(STORE.suneung);
  const files = transaction.objectStore(STORE.files);

  /*
   * **따로 있던 두 ID가 한 학생으로 이어졌으면, 옛 ID로 쌓아 둔 기록을 먼저 옮긴다.**
   *
   * 옮기지 않으면 지원 이력이 두 ID로 나뉜 채 남아 학생 수가 한 명 더 세어지고,
   * 그 뒤 업로드가 두 ID에 번갈아 붙어 스스로 낫지 않는다.
   */
  for (const { from, into } of dataset.merges ?? []) {
    if (!from || !into || from === into) continue;
    for (const row of await promisify(applications.index('sid').getAll(from))) {
      applications.put({ ...row, sid: into });
    }
    for (const row of await promisify(suneung.index('sid').getAll(from))) {
      const target = await promisify(suneung.get([into, row.area]));
      /*
       * 두 쪽 다 예전에 보관된 값이라 **어느 쪽이 새것인지 알 수 없다.** 그래서
       * 살아남는 ID(`into`)의 값을 지킨다 — ID를 고르는 규칙과 같은 규칙을 따른다.
       * 시간 순서가 아니다. `into`는 사전순으로 앞선 sid이지 먼저 보관된 sid가 아니다.
       */
      suneung.put({ ...새값우선(row, target ?? {}), sid: into, area: row.area });
      suneung.delete([from, row.area]);
    }
    /*
     * **내신을 함께 옮긴다.**
     *
     * 내신은 학생 레코드의 `gpa`에만 산다. 이번 업로드의 학생 목록에는 이어 주는
     * 파일에서 읽은 값만 들어 있으므로, 사라지는 ID에 쌓여 있던 내신은 여기서
     * 옮기지 않으면 어디로도 가지 않는다 — 화면은 그 학생의 내신을 빈칸으로
     * 보여 주고, 경고는 「지난 기록도 함께 옮겼습니다」라고 적는다 (§5).
     */
    const 사라질학생 = await promisify(students.get(from));
    if (사라질학생) {
      const 남을학생 = await promisify(students.get(into));
      students.put(mergeStudent(사라질학생, 남을학생 ?? { sid: into }));
    }
    students.delete(from);
  }

  for (const student of dataset.students ?? []) {
    const existing = await promisify(students.get(student.sid));
    students.put(mergeStudent(existing, student));
  }
  // 같은 파일을 다시 올리면 그 파일이 넣었던 기록을 먼저 걷어낸다.
  // 걷어내지 않으면 재업로드마다 지원 건이 두 배로 쌓인다
  /*
   * **시트 단위로 걷어낸다.**
   *
   * 파일 하나를 통째로 지우면, 시트 두 장짜리 파일에서 한 장만 빼고 다시 올렸을 때
   * 뺀 시트가 넣었던 기록까지 사라진다. 화면은 「그 파일이 넣었던 기록을 교체합니다」
   * 라고만 알리므로 사람은 한 장이 사라진 것을 모른다. 이번에 다시 넣는 시트만 걷는다.
   */
  const 시트키 = (fileHash, sheetName) => `${fileHash}\u001f${sheetName ?? ''}`;
  /*
   * 읽은 시트 목록을 쓴다. 지원 기록에서 거꾸로 뽑으면 **행이 0건이 된 시트가 빠져**,
   * 그 시트의 옛 기록이 지워지지 않고 남는다. 목록이 없는 옛 호출은 기록에서 뽑는다.
   */
  const incomingSheets = new Set([
    ...(dataset.readSheets ?? []).map((sheet) => 시트키(sheet.fileHash, sheet.sheetName)),
    ...(dataset.applications ?? [])
      .filter((row) => row.fileHash)
      .map((row) => 시트키(row.fileHash, row.sourceSheet))
  ]);
  const incomingFiles = new Set([
    ...(dataset.readSheets ?? []).map((sheet) => sheet.fileHash),
    ...(dataset.applications ?? []).map((row) => row.fileHash)
  ].filter(Boolean));
  for (const fileHash of incomingFiles) {
    for (const old of await promisify(applications.index('fileHash').getAll(fileHash))) {
      /*
       * **시트 이름이 없는 옛 기록은 파일 단위로 본다.**
       *
       * 시트 단위로 걷어내기 전에 들어간 기록에는 `sourceSheet`가 없다. 새 키로는
       * 맞지 않아 지워지지 않고, 같은 파일을 다시 올리는 순간 그 위에 또 쌓여
       * **지원 건수가 한 번 두 배가 된다.** 그 기록이 어느 시트 것인지 알 수 없으니
       * 파일이 같으면 걷는 것이 맞다 — 어차피 그 파일을 통째로 다시 넣는 중이다.
       */
      if (old.sourceSheet === undefined || old.sourceSheet === null) {
        applications.delete(old.id);
        continue;
      }
      if (!incomingSheets.has(시트키(old.fileHash, old.sourceSheet))) continue;
      applications.delete(old.id);
    }
  }
  for (const application of dataset.applications ?? []) {
    applications.add(application);
  }
  for (const row of dataset.suneung ?? []) {
    // 빠진 항목은 먼저 넣은 값을 지키고, 둘 다 있는 항목은 방금 올린 값이 이긴다
    const existing = await promisify(suneung.get([row.sid, row.area]));
    suneung.put(existing ? 새값우선(existing, row) : row);
  }
  for (const file of dataset.files ?? []) {
    /*
     * **파일 기록은 합친다.**
     *
     * 지원 기록은 시트 단위로 남는데 파일 기록은 이번에 넣은 시트만으로 만들어진다.
     * 통째로 덮으면 고르지 않은 시트의 이름과 확정해 둔 연도가 사라져, 다음에 그
     * 파일을 올릴 때 연도 칸이 다시 빈칸이 되고(§2) 「현재 엑셀 파일」 목록은
     * 보관된 다른 시트를 숨긴다.
     */
    const 옛기록 = await promisify(files.get(file.hash));
    if (!옛기록) {
      files.put(file);
      continue;
    }
    const yearBySheet = { ...(옛기록.yearBySheet ?? {}), ...(file.yearBySheet ?? {}) };
    /*
     * 연도 목록은 **시트별로 확정한 값에서 뽑는다.** 합집합으로 쌓으면, 연도를
     * 잘못 넣은 것을 알아채고 고쳐 다시 올려도 틀린 해가 기록에 영원히 남아
     * 「현재 엑셀 파일」 패널이 있지도 않은 해를 말한다 (§2·§5).
     */
    const 적어둔연도 = [...new Set(Object.values(yearBySheet).filter((year) => year !== null && year !== undefined))];
    const sheets = [...new Set([...(옛기록.sheets ?? []), ...(file.sheets ?? [])])];
    /*
     * 시트별 기록이 **모든 시트를 덮을 때만** 그것으로 갈아 치운다. 한 시트만 적혀
     * 있는데 갈아 치우면, 시트별 기록이 없던 옛 레코드에서 다른 시트의 해가 사라져
     * 패널이 보관된 자료를 숨긴다.
     */
    // 시트 이름이 `constructor`면 상속된 속성이 잡혀 참이 된다
    const 모두적혀있다 = sheets.every((name) => Object.prototype.hasOwnProperty.call(yearBySheet, name));
    files.put({
      ...옛기록,
      ...file,
      sheets,
      cohortYears: 모두적혀있다 && 적어둔연도.length > 0
        ? 적어둔연도
        : [...new Set([...(옛기록.cohortYears ?? []), ...적어둔연도])],
      yearBySheet
    });
  }

  /*
   * **지원 기록이 하나도 남지 않은 학생은 지운다.**
   *
   * 같은 파일을 고쳐(학생 한 명을 빼고) 다시 올리면 그 사람의 지원 건은 걷히는데
   * 학생·수능 레코드는 남아, 아무 기록도 없는 익명 ID가 학생 수와 수능 집계에만
   * 계속 들어갔다. 파일 하나를 통째로 뺄 때(removeFile)와 같은 정리를 여기서도 한다.
   */
  const 살아있는 = new Set((await promisify(applications.getAll())).map((row) => row.sid));
  for (const sid of await promisify(students.getAllKeys())) {
    if (살아있는.has(sid)) continue;
    students.delete(sid);
    for (const row of await promisify(suneung.index('sid').getAll(sid))) {
      suneung.delete([row.sid, row.area]);
    }
  }

  await done(transaction);
}

/**
 * 보관된 자료를 모두 읽는다.
 * @param {IDBDatabase} db
 */
export async function loadDataset(db) {
  const [students, applications, suneung, files] = await Promise.all([
    getAll(db, STORE.students),
    getAll(db, STORE.applications),
    getAll(db, STORE.suneung),
    getAll(db, STORE.files)
  ]);
  return { students, applications, suneung, files };
}

/**
 * 파일 하나가 넣은 것을 되돌린다. 같은 파일을 고쳐 다시 올릴 때 쓴다.
 *
 * 지원 기록을 지우고 나면 남은 기록이 없는 학생이 생긴다. 그 학생도 함께 지운다 —
 * 아무 기록도 없는 익명 ID가 목록에 남아 있으면 혼란만 준다.
 *
 * @param {IDBDatabase} db
 * @param {string} fileHash
 * @returns {Promise<{applications: number, students: number}>}
 */
export async function removeFile(db, fileHash) {
  if (!fileHash) return { applications: 0, students: 0 };
  const names = [STORE.students, STORE.applications, STORE.suneung, STORE.files];
  const transaction = db.transaction(names, 'readwrite');
  const applications = transaction.objectStore(STORE.applications);
  const students = transaction.objectStore(STORE.students);
  const suneung = transaction.objectStore(STORE.suneung);

  const doomed = await promisify(applications.index('fileHash').getAll(fileHash));
  for (const application of doomed) applications.delete(application.id);
  transaction.objectStore(STORE.files).delete(fileHash);

  // 위의 delete가 같은 트랜잭션에 이미 반영되어 있으므로 남은 것이 곧 살아남은 기록이다
  const alive = new Set((await promisify(applications.getAll())).map((row) => row.sid));

  let removedStudents = 0;
  for (const sid of new Set(doomed.map((row) => row.sid))) {
    if (alive.has(sid)) continue;
    students.delete(sid);
    removedStudents += 1;
    for (const row of await promisify(suneung.index('sid').getAll(sid))) {
      suneung.delete([row.sid, row.area]);
    }
  }

  await done(transaction);
  return { applications: doomed.length, students: removedStudents };
}

/**
 * 전체 지우기.
 *
 * 화면 상단에 늘 보이는 버튼이 부르는 함수다(§2). 설정 화면 깊숙이 숨겨 두면
 * 아무도 지우지 않는다. 사용자가 마음먹었을 때 한 번에 사라져야 한다.
 *
 * @param {IDBDatabase} db
 */
export async function clearAll(db) {
  const names = Object.values(STORE);
  const transaction = db.transaction(names, 'readwrite');
  for (const name of names) transaction.objectStore(name).clear();
  await done(transaction);
}

/**
 * 사용자가 수동 매핑으로 만든 헤더 프로파일을 보관한다(§4).
 * @param {IDBDatabase} db
 * @param {object} profile
 */
export async function saveProfile(db, profile) {
  const transaction = db.transaction(STORE.profiles, 'readwrite');
  transaction.objectStore(STORE.profiles).put(profile);
  await done(transaction);
}

/** @param {IDBDatabase} db */
export function loadProfiles(db) {
  return getAll(db, STORE.profiles);
}

/**
 * 브라우저에 자료를 함부로 비우지 말라고 요청한다.
 *
 * 요청일 뿐 보장이 아니다. 학교 공용 PC는 재부팅 때 초기화되기도 한다.
 * 그래서 이 보관소를 원본으로 여기지 않는다.
 *
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  if (!globalThis.navigator?.storage?.persist) return false;
  try {
    return await globalThis.navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * 남은 자리를 살펴본다. 화면에 "얼마나 쓰고 있는지"를 보여줄 때 쓴다.
 * @returns {Promise<{usage: number, quota: number}|null>}
 */
export async function storageEstimate() {
  if (!globalThis.navigator?.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await globalThis.navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
