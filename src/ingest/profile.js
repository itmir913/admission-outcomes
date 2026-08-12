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
 *   "year": 2025, "headerRows": 2, "fingerprint": "b7f3…",
 *   "columns": { "univ": 4, "gpa.전교과": 10, "suneung.국어.grade": 15 } }
 * ```
 *
 * `columns`는 **논리 키 → 열 인덱스**의 평평한 맵이다.
 * 되풀이되는 묶음(내신 반영조합, 수능 영역)은 점으로 이어 붙인 키로 표현한다.
 * 구조를 하나로 유지해야 새 양식이 들어와도 스키마가 흔들리지 않는다.
 */

import fields from '../dict/fields.json' with { type: 'json' };
import { headerFingerprint } from './fingerprint.js';

const SCALAR_KEYS = new Set(fields.scalars.map((field) => field.key));
const SUNEUNG_PARTS = new Set(fields.repeating.suneung.parts);

/** @param {string} key */
export function isKnownFieldKey(key) {
  if (SCALAR_KEYS.has(key)) return true;
  const parts = String(key).split('.');
  if (parts[0] === 'gpa') return parts.length === 2 && parts[1].length > 0;
  if (parts[0] === 'suneung') return parts.length === 3 && parts[1].length > 0 && SUNEUNG_PARTS.has(parts[2]);
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

  return { valid: problems.length === 0, problems };
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
   * 이 시트에 쓸 프로파일을 고른다 (§4 해석 순서 2~3).
   *
   * 지문이 맞는 것만 후보다. 같은 학년도를 먼저 보고, 없으면 **가장 최신 학년도부터**
   * 거슬러 올라간다. 양식이 바뀌지 않은 해는 여기서 걸린다.
   *
   * @param {{fingerprint: string, year?: number|null}} input
   * @returns {{ profile: object, match: 'year'|'carried' } | null}
   */
  select({ fingerprint, year = null }) {
    const matching = this.profiles.filter((profile) => profile.fingerprint === fingerprint);
    if (matching.length === 0) return null;

    if (year !== null) {
      const sameYear = matching.find((profile) => profile.year === year);
      if (sameYear) return { profile: sameYear, match: 'year' };
    }
    const newest = [...matching].sort((left, right) => right.year - left.year)[0];
    return { profile: newest, match: 'carried' };
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
 * @property {'year'|'carried'|'none'} match year=그 학년도 것, carried=다른 해에서 물려씀
 * @property {number|null} carriedFrom 물려썼다면 어느 해 것인지 (화면에 알린다)
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
 * @param {{grid: unknown[][], year?: number|null}} sheet
 * @returns {Promise<ProfileMatch>}
 */
export async function matchProfile(profileSet, { grid, year = null }) {
  const rowCounts = [...new Set(profileSet.profiles.map((profile) => profile.headerRows))].sort();
  const attempts = rowCounts.length ? rowCounts : [1];

  for (const headerRows of attempts) {
    const fingerprint = await headerFingerprint(grid, headerRows);
    const found = profileSet.select({ fingerprint, year });
    if (found) {
      return {
        profile: found.profile,
        match: found.match,
        carriedFrom: found.match === 'carried' ? found.profile.year : null,
        fingerprint,
        needsFallback: false
      };
    }
  }

  return {
    profile: null,
    match: 'none',
    carriedFrom: null,
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
export async function buildProfile({ program, programLabel, year, headerRows, grid, columns }) {
  return {
    id: `${program}-${year}`,
    program,
    programLabel: programLabel ?? program,
    year,
    headerRows,
    fingerprint: await headerFingerprint(grid, headerRows),
    columns,
    createdAt: new Date().toISOString()
  };
}
