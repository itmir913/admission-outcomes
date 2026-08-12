/**
 * 브라우저 보관소 (§2, §5).
 *
 * 한 번 올려 두면 다음에 열 때 그대로 떠 있어야 한다. 상담할 때마다 엑셀을
 * 다시 올리는 수고를 없애는 것이 이 계층의 목적이다.
 *
 * **여기 들어오는 것은 익명화가 끝난 자료뿐이다.** 이름과 학번은 이미 버려졌고,
 * 남아 있는 것은 되돌릴 수 없는 키 해시다. 공용 PC의 브라우저 프로필에
 * 개인정보가 남지 않는다.
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
    throw new Error('이 브라우저에서는 자료를 보관할 수 없습니다. 시크릿 모드라면 일반 창에서 열어 주세요.');
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
 * 학생 하나를 합친다. 같은 사람이 여러 파일에 나뉘어 있으므로
 * 키와 내신을 모으고, 이미 있는 값은 덮어쓰지 않는다.
 */
function mergeStudent(existing, incoming) {
  if (!existing) return { ...incoming, gpa: { ...incoming.gpa } };
  return {
    ...existing,
    keyHashes: [...new Set([...(existing.keyHashes ?? []), ...(incoming.keyHashes ?? [])])].sort(),
    gpa: { ...incoming.gpa, ...existing.gpa }
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
  const students = transaction.objectStore(STORE.students);
  const applications = transaction.objectStore(STORE.applications);
  const suneung = transaction.objectStore(STORE.suneung);
  const files = transaction.objectStore(STORE.files);

  for (const student of dataset.students ?? []) {
    const existing = await promisify(students.get(student.sid));
    students.put(mergeStudent(existing, student));
  }
  for (const application of dataset.applications ?? []) {
    applications.add(application);
  }
  for (const row of dataset.suneung ?? []) {
    suneung.put(row);
  }
  for (const file of dataset.files ?? []) {
    files.put(file);
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
  const names = [STORE.students, STORE.applications, STORE.suneung, STORE.files];
  const transaction = db.transaction(names, 'readwrite');
  const applications = transaction.objectStore(STORE.applications);
  const students = transaction.objectStore(STORE.students);
  const suneung = transaction.objectStore(STORE.suneung);

  const doomed = await promisify(applications.index('fileHash').getAll(fileHash));
  for (const application of doomed) applications.delete(application.id);
  transaction.objectStore(STORE.files).delete(fileHash);

  const survivors = await promisify(applications.getAll());
  const alive = new Set(survivors
    .filter((row) => row.fileHash !== fileHash)
    .map((row) => row.sid));

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
