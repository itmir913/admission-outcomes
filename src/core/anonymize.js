/**
 * 익명화와 학생 병합 (§2).
 *
 * 이름과 학번은 **키 해시를 만드는 순간에만** 쓰이고 그 자리에서 버려진다.
 * 이 파일 밖으로 원문이 나가지 않는다.
 *
 ## 주키
 *
 * **`고3 년도 + 학번`**, 학번이 없으면 **`고3 년도 + 반 + 번호`**가 사람을 구별한다.
 * 학번이 다르면 이름이 같아도 다른 사람이다.
 *
 * 이름은 주키에 넣지 않는다. 넣으면 같은 학번인데 표기가 조금 다른 것만으로
 * 한 학생이 둘로 나뉜다 — 파일마다 `홍길동`, `홍 길동`, 오타가 섞인다.
 *
 * 다만 파일마다 있는 식별 열이 다르다. 어떤 파일엔 학번이 있고 어떤 파일엔 반·번호만 있다.
 * 그래서 만들 수 있는 키를 모두 만들어 두고 하나라도 겹치면 같은 사람으로 본다.
 * **이름 키는 주키를 만들 수 없을 때를 위한 보조 수단**이고, 그때만 동명이인이 문제가 된다.
 *
 * ## 왜 모든 키에 고3 년도가 들어가는가
 *
 * 학번은 대개 `학년-반-번호` 꼴이라 **해마다 재사용된다.** `30101`은 매년 존재한다.
 * 연도를 빼면 동명이인이 겹치는 순간 2024년 학생과 2025년 학생이 한 사람이 된다.
 * 누적 연수가 길어질수록 반드시 만나는 충돌이다.
 */

import { sha256Text, toHex } from './hash.js';
import { encodeBase32, group } from './base32.js';

/**
 * 키 종류와 강도. 숫자가 클수록 사람을 더 좁게 특정한다.
 *
 * **주키는 `고3 년도 + 학번`이고, 학번이 없으면 `고3 년도 + 반 + 번호`다.**
 * 이름은 주키에 들어가지 않는다 — 같은 학번인데 이름 표기가 다르면
 * 한 학생이 둘로 나뉘기 때문이다. 파일마다 `홍길동`, `홍 길동`, 오타가 섞인다.
 *
 * 학년은 키에 넣지 않는다. 진학결과는 모두 고3 자료라 값이 늘 같아서
 * 사람을 구별하는 데 쓸모가 없고, 학년 열이 없는 파일과 매칭만 막는다.
 *
 * 이름은 **주키를 만들 수 없을 때만** 쓴다. 그때만 동명이인이 문제가 된다.
 */
export const KEY_KIND = {
  hakbun: { tag: 'h', strength: 4, usesName: false },
  classNumber: { tag: 'cn', strength: 3, usesName: false },
  numberName: { tag: 'nn', strength: 2, usesName: true },
  name: { tag: 'nm', strength: 1, usesName: true }
};

/** 익명 ID의 글자 수. 40비트라 한 해 수백 명 규모에서 충돌은 사실상 없다. */
export const ANON_ID_CHARS = 8;

const UNIT = '';

/**
 * 식별용 값을 정리한다.
 * 이름의 사이 공백까지 없애는 이유: `홍 길동`과 `홍길동`은 같은 사람인데
 * 파일마다 다르게 적혀 있으면 둘로 나뉜다.
 */
/**
 * 자리를 채우려고 넣는 표기. 식별 값으로 쓰면 **서로 다른 학생이 한 사람이 된다.**
 *
 * 읽는 쪽(`buildRecords`의 `coerce`)과 여기가 같은 목록을 봐야 한다. 베껴 두면
 * 한쪽만 늘어나는 날 다시 어긋나므로, 목록도 판정도 이 파일에서만 정한다.
 */
const BLANK_MARKS = new Set(['-', '--', '.', '없음', '해당없음', '미해당', 'N/A', 'NA']);

/** 대시류. 엑셀에는 전각 하이픈(－)과 줄표(—)가 섞여 들어온다 */
const DASHES = /^[-‐‑‒–—―ー－]+$/;

/**
 * 식별 값으로 쓸 수 없는 빈칸 표기인지.
 *
 * **정규화한 뒤에 본다.** 날글자로 맞춰 보면 전각 `Ｎ／Ａ`도, 사이가 벌어진 `없 음`도
 * 그대로 통과해 키 재료가 된다 — 그러면 학번 칸이 그 표기인 학생들이 한 익명 ID로
 * 묶이고, 행 수는 맞으므로 화면에는 아무 표시도 나지 않는다 (§3·§5).
 *
 * @param {string} normalized NFKC로 고르고 공백을 없앤 글자
 * @param {{zeroIsBlank?: boolean, nameField?: boolean}} [options]
 *   `zeroIsBlank` 주키가 아니면 0은 멀쩡한 값이다 (충원 0명, 내신 0)
 *   `nameField` 이름 열이면 더 좁게 본다
 */
export function isBlankMark(normalized, { zeroIsBlank = true, nameField = false } = {}) {
  if (normalized === '') return true;
  if (DASHES.test(normalized)) return true;
  /*
   * **이름에는 좁은 잣대를 쓴다.**
   *
   * `NA`는 학번 칸에서는 「없음」이지만 **이름으로는 실재한다** — 「나」씨를 로마자로
   * 적으면 `Na`다. 넓은 목록을 이름에 그대로 들이대면 그 학생의 행이 키를 얻지
   * 못해 한 건도 저장되지 않고, 경고는 몇 행인지만 말한다 (§5의 데이터 누락).
   */
  if (['없음', '해당없음', '미해당', '.'].includes(normalized)) return true;
  // 빗금이 들어 이름일 수 없다. 전각 `Ｎ／Ａ`는 정규화가 여기로 데려온다
  if (normalized.toUpperCase() === 'N/A') return true;
  /*
   * 맨글자 `NA`는 **이름과 자료 칸에서는 값이다** — 「나」씨의 로마자 표기이고,
   * 지역 코드로도 쓰인다. 학번·반·번호 칸에서만 「없음」으로 본다.
   */
  if (!nameField && (BLANK_MARKS.has(normalized) || BLANK_MARKS.has(normalized.toUpperCase()))) return true;
  /*
   * **학번·반·번호에 0은 있을 수 없다.** 빈 숫자 칸을 0으로 내보내는 양식이 있고,
   * 그 0이 가장 강한 주키로 받아들여지면 그 해의 그 행들이 전부 한 학생이 된다.
   *
   * 다른 칸에서는 0이 멀쩡한 값이다 — 충원 0명, 내신 0.
   */
  return zeroIsBlank && /^0+$/.test(normalized);
}

/** 식별 값의 표기 차이를 없앤다. NFKC로 전각 숫자(３０１０１)와 반각을 같게 만든다 */
export function normalizeIdentityText(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/\s+/g, '').trim();
}

function normalizePart(value, options = {}) {
  const text = normalizeIdentityText(value);
  if (isBlankMark(text, options)) return '';
  // 엑셀은 같은 반·번호·학번을 파일마다 문자열('01')로도 숫자(1)로도 담는다.
  // 앞의 0을 떼어 표기 차이를 흡수하지 않으면 한 학생이 둘로 나뉜다
  return /^\d+$/.test(text) ? String(Number(text)) : text;
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
  const name = normalizePart(identity.name, { nameField: true });
  const hakbun = normalizePart(identity.hakbun);
  const classNo = normalizePart(identity.classNo);
  const number = normalizePart(identity.number);
  const year = String(cohortYear ?? '').trim();

  if (!year) return [];

  const keys = [];
  const push = (kind, ...parts) => {
    const { tag, strength } = KEY_KIND[kind];
    keys.push({ kind, strength, text: [year, tag, ...parts].join(UNIT) });
  };

  // 주키 — 이름을 넣지 않는다
  if (hakbun) push('hakbun', hakbun);
  if (classNo && number) push('classNumber', classNo, number);

  // **주키를 만들 수 있으면 이름 키를 만들지 않는다.**
  // 만들면 학번으로 식별된 사람과 반·번호로 식별된 사람이 이름만 같아도 한 사람으로 합쳐진다.
  // 두 사람인지 한 사람인지는 자료만 봐서는 알 수 없으므로, 합치지 않는 쪽을 택한다.
  if (keys.length > 0) return keys.sort((left, right) => right.strength - left.strength);

  // 여기부터는 주키가 없는 행이다. 이름에 기대는 수밖에 없다
  if (name && number) push('numberName', number, name);
  if (name) push('name', name);

  return keys.sort((left, right) => right.strength - left.strength);
}

/**
 * 키 해시에 섞는 **고정 소금.**
 *
 * 소금 없이 해시하면 입력이 `고3 년도 + 학번` 한 줄이라 경우의 수가 수만 개뿐이다.
 * 널리 쓰이는 무지개표(흔한 문자열의 SHA-256 표)에 그대로 걸리고, 소금이 있으면
 * 적어도 이 도구 전용 표를 따로 만들어야 한다.
 *
 * **이것이 비밀은 아니다.** 코드가 공개돼 있으니 소금 값도 공개다 — 마음먹은 사람이
 * 이 소금으로 표를 새로 만드는 데 드는 시간은 여전히 짧다. 그 대신 익명 ID가
 * 기기와 학교를 가리지 않고 같아서, 같은 자료를 각자 올린 교사가 같은 ID로 같은
 * 학생을 가리킬 수 있다. 되돌릴 수 없게 만드는 장치가 아니라는 점은
 * docs/decisions.md 에 수치와 함께 적어 두었다.
 */
let saltCache = null;
async function keySalt() {
  if (saltCache === null) saltCache = toHex(await sha256Text('luminousky.com'));
  return saltCache;
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

  // ── 1. 키를 만든다 ────────────────────────────────────────────────────────
  //
  // 주키(학번 또는 반·번호)가 있는 행은 이름 키를 만들지 않는다(identityKeys 참조).
  // 그래서 이름으로 이어지는 것은 **주키가 하나도 없는 행끼리**뿐이다.
  // 그런 행은 같은 이름이면 같은 사람으로 볼 수밖에 없다 — 더 볼 것이 없다.
  const keysByEntry = entries.map((entry) => identityKeys(entry.cohortYear, entry.identity));
  const allowedByEntry = keysByEntry;

  const nameOnlyRows = keysByEntry
    .filter((keys) => keys.length > 0 && keys.every((key) => KEY_KIND[key.kind].usesName)).length;
  if (nameOnlyRows > 0) {
    warnings.push({
      type: 'name-only-identity',
      count: nameOnlyRows,
      message: `학번도 반·번호도 없어 이름만으로 식별한 행이 ${nameOnlyRows}건 있습니다. 동명이인이면 한 사람으로 묶입니다.`
    });
  }

  /** @type {Map<string, string>} 키 원문 → 해시. 원문은 이 함수를 벗어나지 않는다 */
  const hashByText = new Map();
  for (const keys of allowedByEntry) {
    for (const key of keys) if (!hashByText.has(key.text)) hashByText.set(key.text, null);
  }
  const salt = await keySalt();
  await Promise.all([...hashByText.keys()].map(async (text) => {
    hashByText.set(text, toHex(await sha256Text(salt + UNIT + text)));
  }));

  /*
   * ── 오염된 해시를 먼저 구별한다 ──────────────────────────────────────────
   *
   * **자료가 아니라고 말하는 키는 아무도 잇지 못한다.**
   *
   * 이름이 같은데 번호가 다른 행들, 반·번호가 겹치는데 학번이 다른 행들 — 그때
   * 둘을 잇는 약한 키(이름·반번호)는 **누구를 가리키는지 알 수 없는 키**다. 그 키로
   * 이으면 서로 다른 학생이 한 ID 아래 섞이고(§3), 묶는 동안 하나씩 떼어내는 식으로
   * 막으면 **행 순서가 답을 정한다** — 이름만 있는 행이 7번에게 붙을지 8번에게 붙을지를
   * 자료가 아니라 차례가 정한다.
   *
   * 그래서 묶기 전에 한 번 훑어 그런 키를 표시해 둔다. 오염된 키는 잇는 데 쓰지 않고
   * 보관하지도 않는다. 다만 **익명 ID를 뽑는 재료로는 그대로 쓴다** — 빼면 그 키밖에
   * 없는 행이 묶음을 못 만들어 통째로 저장되지 않는다 (§5의 데이터 누락).
   */
  /** @type {Map<string, Map<string, Set<string>>>} 해시 → (더 강한 종류 → 그 행들이 가진 해시들) */
  const 더강한것 = new Map();
  for (const keys of allowedByEntry) {
    for (const key of keys) {
      const hash = hashByText.get(key.text);
      if (!더강한것.has(hash)) 더강한것.set(hash, new Map());
      const 쌓인것 = 더강한것.get(hash);
      for (const other of keys) {
        if (other.strength <= key.strength) continue;
        if (!쌓인것.has(other.kind)) 쌓인것.set(other.kind, new Set());
        쌓인것.get(other.kind).add(hashByText.get(other.text));
      }
    }
  }
  /** @type {Set<string>} 서로 다른 학생을 가리키는 것이 드러난 해시 */
  const 오염된해시 = new Set();
  for (const [hash, 쌓인것] of 더강한것) {
    for (const 값들 of 쌓인것.values()) {
      if (값들.size > 1) { 오염된해시.add(hash); break; }
    }
  }

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
    // 오염된 해시로는 아무도 잇지 못한다. 자리표에 올리지 않는다
    if (!오염된해시.has(hash)) clusterByHash.set(hash, root);
  };

  // 이미 저장된 학생을 먼저 심는다. 그 ID가 이어져야 한다
  /** @type {Set<string>} 저장돼 있던 학생의 키 해시. 이름 유일성을 검사할 수 없는 대상이다 */
  const storedHashes = new Set();
  for (const student of existing) {
    const index = newCluster(student.cohortYear);
    for (const hash of student.keyHashes ?? []) {
      absorb(index, hash, 0, student.cohortYear, student.sid);
      storedHashes.add(hash);
    }
  }
  let unverifiedNameLinks = 0;

  /** @type {(number|null)[]} */
  const clusterOfEntry = [];

  let 잇지않은행 = 0;

  allowedByEntry.forEach((keys, index) => {
    if (keys.length === 0) { clusterOfEntry[index] = null; return; }
    const hashes = keys.map((key) => ({ hash: hashByText.get(key.text), strength: key.strength }));
    if (hashes.some((item) => 오염된해시.has(item.hash))) 잇지않은행 += 1;
    // 오염된 해시는 자리표에 없으므로 아무 묶음도 가리키지 못한다
    const matched = [...new Set(hashes.map((item) => clusterByHash.get(item.hash)).filter((value) => value !== undefined))];

    let target;
    if (matched.length === 0) {
      target = newCluster(entries[index].cohortYear);
    } else {
      // 한 행이 여러 묶음을 가리킨다면 그 식별자들이 한 사람의 것이라는 증거다.
      // 예: 반·번호만 있던 묶음과 학번만 있던 묶음을, 둘 다 실린 행이 이어 준다.
      // 합치지 않으면 같은 학생이 익명 ID를 둘 갖게 되고 스스로 낫지 않는다
      target = matched[0];
      for (const other of matched.slice(1)) sets.union(target, other);
    }
    // 주키가 없는 행이 이미 저장돼 있던 학생에 이름으로 붙는 경우, 그 이름이 예전 자료에서도
    // 유일했는지 확인할 방법이 없다. 붙이되 몇 건인지 알린다
    const onlyName = keys.every((key) => KEY_KIND[key.kind].usesName);
    if (onlyName && hashes.some((item) => storedHashes.has(item.hash))) unverifiedNameLinks += 1;

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
    if (!roots.has(root)) roots.set(root, { cohortYear: null, hashes: new Set(), best: null, sids: new Set() });
    const merged = roots.get(root);
    for (const hash of cluster.hashes) merged.hashes.add(hash);
    if (merged.cohortYear === null) merged.cohortYear = cluster.cohortYear;
    if (cluster.best && (!merged.best || cluster.best.strength > merged.best.strength)) merged.best = cluster.best;
    // 보관돼 있던 ID를 **모두** 모은다. 둘 이상이면 한 학생이 두 ID로 나뉘어 있던 것이다
    if (cluster.sid) merged.sids.add(cluster.sid);
  });

  const sidByRoot = new Map();
  const students = [];
  /**
   * 한 학생이 두 ID로 나뉘어 보관돼 있다가 이번에 이어진 자리.
   * @type {{from: string, into: string}[]}
   */
  const merges = [];
  for (const [root, merged] of roots.entries()) {
    if (merged.hashes.size === 0) continue;
    // 이미 있던 학생은 원래 ID를 지킨다. 담임이 본 ID가 바뀌면 안 된다
    const strongest = merged.best?.hash ?? [...merged.hashes].sort()[0];
    const bytes = Uint8Array.from(
      strongest.slice(0, 16).match(/.{2}/g).map((pair) => Number.parseInt(pair, 16))
    );
    /*
     * 보관된 ID가 둘 이상이면 **하나만 남는다.** 둘 다 지킬 수는 없다 — 한 사람이니까.
     *
     * 남길 것을 사전순으로 정한다. 먼저 만난 쪽을 선택하면 파일을 올린 차례에 따라
     * 살아남는 ID가 달라져, 같은 자료를 다시 넣은 사람과 다른 ID를 보게 된다.
     * 사라지는 ID는 `merges`로 알려, 보관소가 그 ID로 쌓아 둔 기록을 옮기게 한다.
     */
    const stored = [...merged.sids].sort();
    const sid = stored[0] ?? `${merged.cohortYear}-${group(encodeBase32(bytes, ANON_ID_CHARS), 4)}`;
    for (const other of stored.slice(1)) merges.push({ from: other, into: sid });
    sidByRoot.set(root, sid);
    /*
     * 오염된 해시는 **보관하지 않는다.** 보관하면 다음 업로드에서 그 해시로 두
     * 학생이 다시 이어진다 — 보관된 학생은 종류를 알 수 없어 검토를 못 하기 때문이다.
     */
    const 보관할것 = [...merged.hashes].filter((hash) => !오염된해시.has(hash)).sort();
    students.push({ sid, cohortYear: merged.cohortYear, keyHashes: 보관할것 });
  }

  if (잇지않은행 > 0) {
    warnings.push({
      type: 'identity-conflict',
      count: 잇지않은행,
      message: `식별자가 서로 어긋나 잇지 않은 행이 ${잇지않은행}건 있습니다. 학번이 다른데 반·번호가 겹치거나, 이름이 같은데 번호가 다른 경우입니다 — 다른 학생으로 두었고, 그 이름이나 반·번호로는 더 잇지 않습니다.`
    });
  }

  if (merges.length > 0) {
    warnings.push({
      type: 'students-merged',
      count: merges.length,
      message: `따로 있던 익명 ID ${merges.length}개가 같은 학생으로 이어졌습니다. 지난 기록도 함께 옮겼습니다.`
    });
  }

  if (unverifiedNameLinks > 0) {
    warnings.push({
      type: 'unverified-name-link',
      count: unverifiedNameLinks,
      message: `학번·반·번호 없이 이름만으로 기존 학생에 이어 붙인 행이 ${unverifiedNameLinks}건 있습니다. 동명이인이면 이력이 섞일 수 있습니다.`
    });
  }

  const unidentified = clusterOfEntry.filter((value) => value === null).length;
  if (unidentified > 0) {
    warnings.push({
      type: 'no-identity',
      count: unidentified,
      message: `학번·반·번호·이름을 모두 읽지 못한 행이 ${unidentified}건 있습니다. 학생에 묶이지 않습니다.`
    });
  }

  return {
    sids: clusterOfEntry.map((root) => (root === null ? null : sidByRoot.get(sets.find(root)) ?? null)),
    students: students.sort((left, right) => left.sid.localeCompare(right.sid)),
    merges,
    warnings
  };
}
