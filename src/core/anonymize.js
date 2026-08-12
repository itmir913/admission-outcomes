/**
 * 익명화와 학생 병합 (§2).
 *
 * 이름과 학번은 **키 해시를 만드는 순간에만** 쓰이고 그 자리에서 버려진다.
 * 이 파일 밖으로 원문이 나가지 않는다.
 *
 * ## 왜 키가 하나가 아닌가
 *
 * 같은 학생이 여러 파일에 흩어져 있는데, **파일마다 있는 식별 열이 다르다.**
 * 어떤 파일엔 학번이 있고, 어떤 파일엔 반·번호만 있다. 키를 하나만 쓰면 같은 사람이
 * 둘로 갈라진다. 그래서 만들 수 있는 키를 모두 만들어 두고, 하나라도 겹치면 같은 사람으로 본다.
 *
 * ## 왜 모든 키에 고3 년도가 들어가는가
 *
 * 학번은 대개 `학년-반-번호` 꼴이라 **해마다 재사용된다.** `30101`은 매년 존재한다.
 * 연도를 빼면 동명이인이 겹치는 순간 2024년 학생과 2025년 학생이 한 사람이 된다.
 * 누적 연수가 길어질수록 반드시 만나는 충돌이다.
 */

import { sha256Text, toHex } from './hash.js';
import { encodeBase32, group } from './base32.js';

/** 키 종류와 강도. 숫자가 클수록 사람을 더 좁게 특정한다. */
export const KEY_KIND = {
  hakbun: { tag: 'h', strength: 4 },
  classNumber: { tag: 'cn', strength: 3 },
  number: { tag: 'n', strength: 2 },
  name: { tag: 'nm', strength: 1 }
};

/** 익명 ID의 글자 수. 40비트라 한 해 수백 명 규모에서 충돌은 사실상 없다. */
export const ANON_ID_CHARS = 8;

const UNIT = '';

/**
 * 식별용 값을 다듬는다.
 * 이름의 사이 공백까지 없애는 이유: `홍 길동`과 `홍길동`은 같은 사람인데
 * 파일마다 다르게 적혀 있으면 둘로 갈라진다.
 */
function normalizePart(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFC').replace(/\s+/g, '').trim();
}

/**
 * 한 행의 식별 정보에서 만들 수 있는 키를 모두 만든다.
 *
 * 키 종류를 접두사로 붙여, 학번 `7`과 번호 `7`이 우연히 같은 키가 되는 일을 막는다.
 *
 * @param {number} cohortYear 고3 년도
 * @param {{name?: string, hakbun?: string, classNo?: string, number?: string}} identity
 * @returns {{kind: string, strength: number, text: string}[]} 강한 것부터
 */
export function identityKeys(cohortYear, identity = {}) {
  const name = normalizePart(identity.name);
  const hakbun = normalizePart(identity.hakbun);
  const classNo = normalizePart(identity.classNo);
  const number = normalizePart(identity.number);
  const year = String(cohortYear ?? '').trim();

  // 이름이 없으면 어떤 키도 사람을 특정하지 못한다.
  // 학번만으로 잇는 것은 위험하다 — 전학·재입력으로 학번이 겹치는 일이 있다.
  if (!year || !name) return [];

  const keys = [];
  const push = (kind, ...parts) => {
    const { tag, strength } = KEY_KIND[kind];
    keys.push({ kind, strength, text: [year, tag, ...parts].join(UNIT) });
  };

  if (hakbun) push('hakbun', hakbun, name);
  if (classNo && number) push('classNumber', classNo, number, name);
  if (number) push('number', number, name);
  push('name', name);

  return keys.sort((left, right) => right.strength - left.strength);
}

/** 같은 자리를 가리키는 원소끼리 묶는 자료구조 */
class DisjointSet {
  #parent = [];

  make() {
    this.#parent.push(this.#parent.length);
    return this.#parent.length - 1;
  }

  find(index) {
    while (this.#parent[index] !== index) {
      this.#parent[index] = this.#parent[this.#parent[index]];
      index = this.#parent[index];
    }
    return index;
  }

  union(left, right) {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.#parent[b] = a;
  }
}

/**
 * @typedef {object} StudentAssignment
 * @property {(string|null)[]} sids 입력 순서대로의 익명 ID. 식별 불가면 null
 * @property {{sid: string, cohortYear: number, keyHashes: string[]}[]} students
 * @property {{type: string, message: string, cohortYear?: number, count?: number}[]} warnings
 */

/**
 * 행마다 익명 ID를 매기고, 같은 학생끼리 묶는다.
 *
 * @param {{cohortYear: number, identity: object}[]} entries 원본 행 순서 그대로
 * @param {{existing?: {sid: string, cohortYear: number, keyHashes: string[]}[]}} [options]
 *        이미 저장돼 있는 학생들. 이어서 올릴 때 같은 사람이 같은 ID를 받도록 한다
 * @returns {Promise<StudentAssignment>}
 */
export async function assignStudentIds(entries, { existing = [] } = {}) {
  const warnings = [];

  // ── 1. 같은 고3 년도 안에서 이름이 유일한지 센다 ────────────────────────────
  //
  // 이름 단독 키는 동명이인을 한 사람으로 합쳐 버린다. 지원 이력이 뒤섞이면
  // 상담 자료가 조용히 거짓말을 하므로, **유일할 때만** 잇는 데 쓴다.
  // **종류별로 센다.** 같은 학생이라도 파일마다 있는 열이 달라
  // 어떤 행은 학번으로, 어떤 행은 반·번호로 나타난다. 종류를 뭉뚱그려 세면
  // 그 학생 한 명이 여러 사람으로 보인다.
  //
  // 진짜 동명이인은 **같은 종류의 키가 서로 다른 값을 가질 때** 드러난다.
  // 학번이 30101과 30215로 갈리면 두 사람이다.
  /** @type {Map<string, Map<string, Set<string>>>} 연도␟이름 → 종류 → 값들 */
  const strongKeysByName = new Map();
  const keysByEntry = entries.map((entry) => identityKeys(entry.cohortYear, entry.identity));

  for (const keys of keysByEntry) {
    if (keys.length === 0) continue;
    const nameKey = keys[keys.length - 1].text;
    if (!strongKeysByName.has(nameKey)) strongKeysByName.set(nameKey, new Map());
    const byKind = strongKeysByName.get(nameKey);
    for (const key of keys) {
      if (key.kind === 'name') continue;
      if (!byKind.has(key.kind)) byKind.set(key.kind, new Set());
      byKind.get(key.kind).add(key.text);
    }
  }

  const ambiguousNames = new Set();
  for (const [nameKey, byKind] of strongKeysByName.entries()) {
    for (const values of byKind.values()) {
      if (values.size > 1) { ambiguousNames.add(nameKey); break; }
    }
  }
  if (ambiguousNames.size > 0) {
    const byYear = new Map();
    for (const nameKey of ambiguousNames) {
      const year = Number(nameKey.split(UNIT)[0]);
      byYear.set(year, (byYear.get(year) ?? 0) + 1);
    }
    for (const [cohortYear, count] of byYear.entries()) {
      warnings.push({
        type: 'ambiguous-name',
        cohortYear,
        count,
        message: `${cohortYear}년 고3에 이름이 같은 학생이 ${count}건 있습니다. 이름만으로는 잇지 않고 따로 두었습니다.`
      });
    }
  }

  // ── 2. 쓸 키만 남기고 해시로 바꾼다 ────────────────────────────────────────
  const allowedByEntry = keysByEntry.map((keys) => {
    if (keys.length === 0) return [];
    const nameKey = keys[keys.length - 1];
    if (keys.length === 1) return keys; // 이름밖에 없는 행은 이름 키라도 써야 한다
    return ambiguousNames.has(nameKey.text) ? keys.filter((key) => key.kind !== 'name') : keys;
  });

  /** @type {Map<string, string>} 키 원문 → 해시. 원문은 이 함수를 벗어나지 않는다 */
  const hashByText = new Map();
  for (const keys of allowedByEntry) {
    for (const key of keys) if (!hashByText.has(key.text)) hashByText.set(key.text, null);
  }
  await Promise.all([...hashByText.keys()].map(async (text) => {
    hashByText.set(text, toHex(await sha256Text(text)));
  }));

  // ── 3. 겹치는 해시를 가진 행끼리 묶는다 ────────────────────────────────────
  const sets = new DisjointSet();
  /** @type {Map<string, number>} 해시 → 묶음 번호 */
  const clusterByHash = new Map();
  /** @type {{cohortYear: number|null, hashes: Set<string>, best: {strength: number, hash: string}|null, sid: string|null}[]} */
  const clusters = [];

  const newCluster = (cohortYear) => {
    const index = sets.make();
    clusters[index] = { cohortYear, hashes: new Set(), best: null, sid: null };
    return index;
  };

  const absorb = (index, hash, strength, cohortYear, sid = null) => {
    const root = sets.find(index);
    const cluster = clusters[root];
    cluster.hashes.add(hash);
    if (cluster.cohortYear === null) cluster.cohortYear = cohortYear;
    if (!cluster.best || strength > cluster.best.strength) cluster.best = { strength, hash };
    if (sid && !cluster.sid) cluster.sid = sid;
    clusterByHash.set(hash, root);
  };

  // 이미 저장된 학생을 먼저 심는다. 그 ID가 이어져야 한다
  for (const student of existing) {
    const index = newCluster(student.cohortYear);
    for (const hash of student.keyHashes ?? []) absorb(index, hash, 0, student.cohortYear, student.sid);
  }

  /** @type {(number|null)[]} */
  const clusterOfEntry = [];

  allowedByEntry.forEach((keys, index) => {
    if (keys.length === 0) { clusterOfEntry[index] = null; return; }
    const hashes = keys.map((key) => ({ hash: hashByText.get(key.text), strength: key.strength }));
    const matched = [...new Set(hashes.map((item) => clusterByHash.get(item.hash)).filter((value) => value !== undefined))];

    let target;
    if (matched.length === 0) {
      target = newCluster(entries[index].cohortYear);
    } else {
      target = matched[0];
      // 한 행이 서로 다른 학생 둘을 가리키면 원본 자료가 어긋난 것이다.
      // 임의로 합치지 않고 첫 묶음에 붙인 뒤 알린다
      if (matched.length > 1) {
        warnings.push({
          type: 'conflicting-keys',
          cohortYear: entries[index].cohortYear,
          message: `${entries[index].cohortYear}년 자료에 서로 다른 학생을 동시에 가리키는 행이 있습니다. 원본을 확인해 주세요.`
        });
      }
    }
    for (const item of hashes) absorb(target, item.hash, item.strength, entries[index].cohortYear);
    clusterOfEntry[index] = sets.find(target);
  });

  // ── 4. 묶음마다 익명 ID를 발급한다 ────────────────────────────────────────
  //
  // 가장 강한 키의 해시에서 뽑으므로, 파일을 올린 순서와 무관하게 같은 ID가 나온다.
  const roots = new Map();
  clusters.forEach((cluster, index) => {
    if (!cluster) return;
    const root = sets.find(index);
    if (!roots.has(root)) roots.set(root, { cohortYear: null, hashes: new Set(), best: null, sid: null });
    const merged = roots.get(root);
    for (const hash of cluster.hashes) merged.hashes.add(hash);
    if (merged.cohortYear === null) merged.cohortYear = cluster.cohortYear;
    if (cluster.best && (!merged.best || cluster.best.strength > merged.best.strength)) merged.best = cluster.best;
    if (cluster.sid && !merged.sid) merged.sid = cluster.sid;
  });

  const sidByRoot = new Map();
  const students = [];
  for (const [root, merged] of roots.entries()) {
    if (merged.hashes.size === 0) continue;
    // 이미 있던 학생은 원래 ID를 지킨다. 담임이 본 ID가 바뀌면 안 된다
    const strongest = merged.best?.hash ?? [...merged.hashes].sort()[0];
    const bytes = Uint8Array.from(
      strongest.slice(0, 16).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16))
    );
    const sid = merged.sid ?? `${merged.cohortYear}-${group(encodeBase32(bytes, ANON_ID_CHARS), 4)}`;
    sidByRoot.set(root, sid);
    students.push({ sid, cohortYear: merged.cohortYear, keyHashes: [...merged.hashes].sort() });
  }

  const unidentified = clusterOfEntry.filter((value) => value === null).length;
  if (unidentified > 0) {
    warnings.push({
      type: 'no-identity',
      count: unidentified,
      message: `이름을 읽지 못한 행이 ${unidentified}건 있습니다. 학생에 묶이지 않습니다.`
    });
  }

  return {
    sids: clusterOfEntry.map((root) => (root === null ? null : sidByRoot.get(sets.find(root)) ?? null)),
    students: students.sort((left, right) => left.sid.localeCompare(right.sid)),
    warnings
  };
}
