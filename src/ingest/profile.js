/**
 * 헤더 프로파일 (§4).
 *
 * 프로그램마다·학년도마다 열 구성이 다르므로, **어떤 프로그램이든 JSON 하나로 등록**되게 한다.
 * 코드에는 대교협도 센진학도 나오지 않는다. 새 프로그램 지원 = 프로파일 파일 추가.
 *
 * 프로파일 한 장의 생김새:
 *
 * ```json
 * { "id": "kcue-2025", "program": "kcue", "programLabel": "대교협 수시진학관리",
 *   "year": 2025, "headerRows": 2, "fingerprint": "b7f3…", "yearBasis": "admission",
 *   "columns": { "univ": 4, "gpa.전교과": 10, "suneung.국어.grade": 15 } }
 *
 * `yearBasis`는 연도 열(`sourceYear`)의 값이 **고3 년도인지 학년도인지**를 밝힌다.
 * 이걸 빠뜨리면 자료 전체가 한 해씩 밀린 채로 멀쩡해 보인다.
 * ```
 *
 * **`year`는 이름표일 뿐 매칭 키가 아니다.** 고르는 기준은 지문 하나다.
 * 머리글 줄 수(`headerRows`)도 연도가 아니라 **지문에 딸린 속성**이다 —
 * 같은 프로그램이라도 내보내기 양식이 바뀌면 줄 수가 달라지고, 그것은 해와 무관하다.
 * 실제로 같은 프로그램의 두 양식이 1줄과 2줄로 나뉘었다(decisions.md D23).
 *
 * `columns`는 **논리 키 → 열 인덱스**의 평평한 맵이다.
 * 되풀이되는 묶음(내신 반영조합, 수능 영역)은 점으로 이어 붙인 키로 표현한다.
 * 구조를 하나로 유지해야 새 양식이 들어와도 스키마가 흔들리지 않는다.
 */

import fields from '../dict/fields.json' with { type: 'json' };
import { headerFingerprint } from './headerHash.js';

const SCALAR_KEYS = new Set(fields.scalars.map((field) => field.key));
const SUNEUNG_PARTS = new Set(fields.repeating.suneung.parts);
const GPA_KEYS = new Set(
  [...fields.repeating.gpa.combos, ...fields.repeating.gpa.subjects].map((entry) => entry.key)
);
const SUNEUNG_AREAS = new Set(fields.repeating.suneung.areas.map((entry) => entry.key));

/**
 * 쓸 수 있는 논리 키인가.
 *
 * **내신 조합과 수능 영역은 사전에 열거한 것만 받는다.** 글자 모양을 정규식으로 보지
 * 않는다 — 예전에는 `gpa.` 뒤에 아무 이름이나 통과했다.
 *
 * **프로파일 경로는 사전을 거치지 않으므로 이 함수가 그 경로의 유일한 문지기다.**
 * 프로파일에 날것 머리글이 키로 적혀 있으면 사전을 통째로 우회해 같은 조합이 다시
 * 두 열로 나뉜다. 그래서 여기서 사전과 **정확히 같은 집합**을 본다.
 *
 * `split('.')`을 쓰지 않는다. 반영비에 소수점이 들어가면 쪼개기가 어긋난다.
 *
 * @param {string} key
 */
export function isKnownFieldKey(key) {
  const text = String(key);
  if (SCALAR_KEYS.has(text)) return true;
  if (text.startsWith('gpa.')) return GPA_KEYS.has(text.slice(4));
  if (text.startsWith('suneung.')) {
    const rest = text.slice(8);
    const cut = rest.lastIndexOf('.');
    if (cut <= 0) return false;
    return SUNEUNG_AREAS.has(rest.slice(0, cut)) && SUNEUNG_PARTS.has(rest.slice(cut + 1));
  }
  return false;
}

/**
 * 프로파일이 쓸 만한 모양인지 본다.
 * 잘못된 프로파일은 조용히 무시되는 대신 이유와 함께 걸러져야 한다.
 *
 * @param {object} profile
 * @returns {{ valid: boolean, problems: string[] }}
 */
export function validateProfile(profile) {
  const problems = [];
  if (!profile || typeof profile !== 'object') return { valid: false, problems: ['프로파일이 객체가 아닙니다.'] };
  if (!profile.id) problems.push('id가 없습니다.');
  if (!profile.program) problems.push('program이 없습니다.');
  if (!Number.isInteger(profile.year)) problems.push('year가 정수가 아닙니다.');
  if (!Number.isInteger(profile.headerRows) || profile.headerRows < 1) problems.push('headerRows가 1 이상 정수가 아닙니다.');
  if (typeof profile.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(profile.fingerprint)) {
    problems.push('fingerprint가 64자리 16진 문자열이 아닙니다.');
  }

  const columns = profile.columns;
  if (!columns || typeof columns !== 'object') {
    problems.push('columns가 없습니다.');
    return { valid: problems.length === 0, problems };
  }

  const usedIndexes = new Map();
  for (const [key, index] of Object.entries(columns)) {
    if (!isKnownFieldKey(key)) problems.push(`알 수 없는 필드 키: ${key}`);
    if (!Number.isInteger(index) || index < 0) {
      problems.push(`${key}의 열 번호가 0 이상 정수가 아닙니다.`);
      continue;
    }
    // 한 열을 두 필드가 가리키면 둘 중 하나는 틀린 것이다
    if (usedIndexes.has(index)) problems.push(`${usedIndexes.get(index)}와 ${key}가 같은 열(${index})을 가리킵니다.`);
    else usedIndexes.set(index, key);
  }
  if (!('univ' in columns)) problems.push('대학명(univ) 열이 없으면 분석할 수 없습니다.');

  // 연도 열이 있으면 그 값이 고3 년도인지 학년도인지 반드시 밝혀야 한다.
  // 밝히지 않으면 자료 전체가 한 해씩 밀리고, 밀렸다는 사실이 눈에 띄지 않는다.
  if ('sourceYear' in columns && !['senior', 'admission'].includes(profile.yearBasis)) {
    problems.push('연도 열이 있으면 yearBasis가 senior 또는 admission이어야 합니다.');
  }

  return { valid: problems.length === 0, problems };
}

/**
 * 두 프로파일이 같은 답을 내는가.
 *
 * 지문이 같으면 머리글이 글자 하나까지 같다는 뜻이고, 그러면 매핑도 같아야 한다.
 * 다르다면 둘 중 하나가 틀린 것이다.
 *
 * @param {object} left
 * @param {object} right
 */
export function sameMapping(left, right) {
  if (left.headerRows !== right.headerRows) return false;
  if ((left.yearBasis ?? null) !== (right.yearBasis ?? null)) return false;
  const keys = Object.keys(left.columns ?? {});
  if (keys.length !== Object.keys(right.columns ?? {}).length) return false;
  return keys.every((key) => left.columns[key] === right.columns[key]);
}

/**
 * 프로파일 묶음. 저장소에 동봉된 것과 사용자가 만든 것을 함께 담는다.
 */
export class ProfileSet {
  /** @param {object[]} profiles */
  constructor(profiles = []) {
    /** @type {object[]} */
    this.profiles = [];
    /** @type {{profile: object, problems: string[]}[]} */
    this.rejected = [];
    for (const profile of profiles) this.add(profile);
  }

  /** @param {object} profile */
  add(profile) {
    const { valid, problems } = validateProfile(profile);
    if (!valid) {
      this.rejected.push({ profile, problems });
      return false;
    }
    // 같은 id를 다시 넣으면 새 것이 이긴다. 사용자가 고친 프로파일이 기본값을 덮는다
    const existing = this.profiles.findIndex((item) => item.id === profile.id);
    if (existing >= 0) this.profiles[existing] = profile;
    else this.profiles.push(profile);
    return true;
  }

  /**
   * 이 시트에 쓸 프로파일을 정한다 (§4 해석 순서).
   *
   * **지문이 맞는 것만 후보다.** 지문이 같다는 것은 헤더가 글자 하나까지 같다는 뜻이므로,
   * 어느 해에 만든 프로파일이든 그대로 쓸 수 있다. 양식이 바뀌지 않은 해는 여기서 걸린다.
   *
   * **지문이 같은데 매핑이 다르면 어느 쪽도 쓰지 않는다.** 둘 중 하나는 틀렸는데
   * 어느 쪽인지 알 방법이 없다. 나중에 만든 쪽을 조용히 고르면, 틀린 프로파일로 읽은
   * 상담 자료가 멀쩡한 얼굴로 나온다 — 이 시스템에서 가장 위험한 것이다(§5).
   * 그때는 `conflict`를 돌려주고, 부르는 쪽이 이름 매칭으로 내려간다.
   *
   * @param {{fingerprint: string}} input
   * @returns {{ profile: object, conflict?: undefined } | { profile: null, conflict: string[] } | null}
   */
  select({ fingerprint }) {
    const matching = this.profiles.filter((profile) => profile.fingerprint === fingerprint);
    if (matching.length === 0) return null;

    const [first, ...rest] = matching;
    const disagreeing = rest.filter((profile) => !sameMapping(first, profile));
    if (disagreeing.length > 0) {
      return { profile: null, conflict: [first.id, ...disagreeing.map((profile) => profile.id)] };
    }
    // 여기 왔다면 매핑이 모두 같다. 어느 것을 선택해도 결과가 같다
    return { profile: first };
  }

  /** 지문과 무관하게 이름만으로 찾는다. 수동 매핑 화면에서 참고용으로 쓴다. */
  byProgram(program) {
    return this.profiles
      .filter((profile) => profile.program === program)
      .sort((left, right) => right.year - left.year);
  }
}

/**
 * @typedef {object} ProfileMatch
 * @property {object|null} profile 쓸 프로파일
 * @property {'fingerprint'|'none'} match 지문이 맞았는지
 * @property {number|null} profileYear 어느 해에 만든 프로파일인지 (화면에 알린다)
 * @property {string} fingerprint
 * @property {boolean} needsFallback 이름 매칭으로 내려가야 하는지
 */

/**
 * 시트 하나에 맞는 프로파일을 찾는다.
 *
 * `headerRows`를 모르는 채로 지문을 낼 수 없으므로, 등록된 프로파일들이 쓰는
 * 헤더 행 수를 모두 시도한다. 대부분 1~2줄이라 비용이 크지 않다.
 *
 * @param {ProfileSet} profileSet
 * @param {{grid: unknown[][]}} sheet
 * @returns {Promise<ProfileMatch>}
 */
export async function matchProfile(profileSet, { grid }) {
  const rowCounts = [...new Set(profileSet.profiles.map((profile) => profile.headerRows))].sort();
  const attempts = rowCounts.length ? rowCounts : [1];

  for (const headerRows of attempts) {
    const fingerprint = await headerFingerprint(grid, headerRows);
    const found = profileSet.select({ fingerprint });
    if (found?.conflict) {
      // 지문이 같은데 매핑이 다르다. 어느 쪽도 쓰지 않고 이름 매칭으로 내려간다
      return {
        profile: null, match: 'conflict', conflict: found.conflict,
        profileYear: null, fingerprint, needsFallback: true
      };
    }
    if (found) {
      return {
        profile: found.profile,
        match: 'fingerprint',
        profileYear: found.profile.year,
        fingerprint,
        needsFallback: false
      };
    }
  }

  return {
    profile: null,
    match: 'none',
    profileYear: null,
    fingerprint: await headerFingerprint(grid, 1),
    needsFallback: true
  };
}

/**
 * 확정된 매핑으로 새 프로파일을 만든다.
 * 사용자가 수동 매핑을 마치면 이것을 저장해 두었다가 이듬해 먼저 조회한다(§4 6단계).
 *
 * @param {{program: string, programLabel?: string, year: number, headerRows: number, grid: unknown[][], columns: Record<string, number>}} input
 * @returns {Promise<object>}
 */
export async function buildProfile({ program, programLabel, year, headerRows, grid, columns, yearBasis }) {
  const profile = {
    id: `${program}-${year}`,
    program,
    programLabel: programLabel ?? program,
    year,
    headerRows,
    fingerprint: await headerFingerprint(grid, headerRows),
    columns,
    createdAt: new Date().toISOString()
  };
  if (yearBasis) profile.yearBasis = yearBasis;
  return profile;
}
