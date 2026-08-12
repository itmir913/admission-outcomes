/**
 * 불러오기 전체 흐름 (§1).
 *
 * 두 걸음으로 나뉜다. 사이에 **사람이 끼어든다.**
 *
 *   1. prepare  파일을 읽고 시트마다 무엇을 알아냈는지 보고한다
 *                → 화면이 고3 년도를 묻고, 겹치는 파일을 어떻게 할지 묻는다
 *   2. commit   사람이 정한 것을 받아 자료로 만든다
 *
 * 나누는 이유는 §3에 있다. 고3 년도는 추론이 아니라 사람이 확정한다.
 * 한 해 밀린 자료는 겉보기에 멀쩡해서 나중에 알아챌 방법이 없다.
 */

import { loadUploads } from './files.js';
import { matchProfile } from './profile.js';
import { inferCohortYear } from './year.js';
import { buildDataset } from './buildRecords.js';

/**
 * @typedef {object} PreparedSheet
 * @property {string} id 화면에서 이 시트를 가리킬 이름
 * @property {string} fileName
 * @property {string} sheetName
 * @property {string} fileHash
 * @property {string} [container] zip으로 올렸다면 그 zip 이름
 * @property {unknown[][]} grid
 * @property {object|null} profile 맞은 헤더 프로파일
 * @property {object} match 어떻게 맞았는지 (물려썼다면 어느 해 것인지)
 * @property {object} yearGuess 고3 년도 제안과 그 근거
 * @property {object|null} duplicate 이미 올린 적 있는 파일이면 그 기록
 * @property {number} rowCount 헤더를 뺀 행 수
 * @property {boolean} ready 사람이 더 정할 것 없이 바로 넣을 수 있는지
 */

/**
 * 올린 파일들을 읽고, 시트마다 무엇을 알아냈는지 보고한다.
 *
 * 이 단계에서는 아무것도 저장하지 않는다. 사람이 확인할 거리를 모아 올 뿐이다.
 *
 * @param {{name: string, bytes: Uint8Array}[]} uploads
 * @param {{profiles: object, existingFiles?: object[], currentYear?: number}} context
 * @returns {Promise<{sheets: PreparedSheet[], skipped: {name: string, reason: string}[]}>}
 */
export async function prepareUploads(uploads, { profiles, existingFiles = [], currentYear } = {}) {
  const { sheets, skipped } = await loadUploads(uploads);
  const knownFiles = new Map(existingFiles.map((file) => [file.hash, file]));

  const prepared = [];
  for (const sheet of sheets) {
    const match = await matchProfile(profiles, { grid: sheet.grid });
    const headerRows = match.profile?.headerRows ?? 1;

    const yearGuess = inferCohortYear({
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      grid: sheet.grid,
      headerRows,
      // 프로파일이 밝힌 연도 열과 그 기준을 짝으로 넘긴다.
      // 짝을 깨면 엉뚱한 열에 기준이 적용된다
      yearColumn: match.profile?.columns?.sourceYear ?? null,
      columnBasis: match.profile?.yearBasis ?? null,
      currentYear
    });

    prepared.push({
      id: `${sheet.fileHash}#${sheet.sheetName}`,
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      fileHash: sheet.fileHash,
      container: sheet.container,
      grid: sheet.grid,
      profile: match.profile,
      match,
      yearGuess,
      duplicate: knownFiles.get(sheet.fileHash) ?? null,
      rowCount: Math.max(0, sheet.grid.length - headerRows),
      // 프로파일이 맞고 연도까지 확실할 때만 손댈 것이 없다
      ready: Boolean(match.profile) && !yearGuess.needsInput && yearGuess.cohortYear !== null
    });
  }

  return { sheets: prepared, skipped };
}

/**
 * 사람이 정한 것을 받아 자료로 만든다.
 *
 * @param {PreparedSheet[]} prepared
 * @param {object} options
 * @param {Record<string, {cohortYear?: number|null, include?: boolean}>} [options.decisions]
 *        시트 id별 결정. `cohortYear`를 주면 제안을 덮고, `include: false`면 건너뛴다
 * @param {object[]} [options.existingStudents] 이미 보관된 학생 (익명 ID 이어 붙이기)
 * @returns {Promise<{students: object[], applications: object[], suneung: object[], files: object[], warnings: object[]}>}
 */
export async function commitSheets(prepared, { decisions = {}, existingStudents = [] } = {}) {
  const warnings = [];
  const inputs = [];
  /** @type {Map<string, object>} */
  const files = new Map();

  for (const sheet of prepared) {
    const decision = decisions[sheet.id] ?? {};
    if (decision.include === false) continue;

    if (!sheet.profile) {
      // 프로파일이 없으면 어느 열이 무엇인지 모른다. 수동 매핑을 거쳐야 한다(§4)
      warnings.push({
        type: 'no-profile',
        sheet: sheet.id,
        message: `${sheet.fileName}의 열 구성을 알아보지 못했습니다. 열을 직접 지정해 주세요.`
      });
      continue;
    }

    const cohortYear = decision.cohortYear ?? sheet.yearGuess.cohortYear;
    // 여러 해가 섞인 누적 파일이면 파일 연도 없이 행마다 읽는다
    const perRowYear = sheet.profile.columns.sourceYear !== undefined
      && Boolean(sheet.profile.yearBasis);
    if ((cohortYear === null || cohortYear === undefined) && !perRowYear) {
      warnings.push({
        type: 'year-not-set',
        sheet: sheet.id,
        message: `${sheet.fileName}의 고3 년도가 정해지지 않아 넣지 않았습니다.`
      });
      continue;
    }

    inputs.push({
      grid: sheet.grid,
      headerRows: sheet.profile.headerRows,
      columns: sheet.profile.columns,
      yearBasis: sheet.profile.yearBasis,
      cohortYear,
      source: {
        fileHash: sheet.fileHash,
        sourceFile: sheet.fileName,
        sourceSheet: sheet.sheetName
      }
    });

    // 한 파일에 시트가 여럿이면 파일 기록은 하나만 남긴다
    const file = files.get(sheet.fileHash) ?? {
      hash: sheet.fileHash,
      name: sheet.fileName,
      container: sheet.container ?? null,
      sheets: [],
      cohortYears: [],
      profileId: sheet.profile.id,
      loadedAt: new Date().toISOString()
    };
    file.sheets.push(sheet.sheetName);
    if (!file.cohortYears.includes(cohortYear)) file.cohortYears.push(cohortYear);
    files.set(sheet.fileHash, file);
  }

  const dataset = await buildDataset(inputs, { existing: existingStudents });
  return {
    ...dataset,
    files: [...files.values()],
    warnings: [...warnings, ...dataset.warnings]
  };
}
