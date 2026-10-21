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
import { resolveSheet } from './resolveColumns.js';
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
 * @property {Reading} reading 어느 열이 무엇인지, 그리고 그걸 어떻게 알아냈는지
 * @property {object|null} profile 지문이 맞은 헤더 프로파일 (없으면 이름으로 해석한 것)
 * @property {object} match 지문 대조 결과
 * @property {object} yearGuess 고3 년도 제안과 그 근거
 * @property {object|null} duplicate 이미 올린 적 있는 파일이면 그 기록
 * @property {number} rowCount 헤더를 뺀 행 수
 * @property {boolean} ready 사람이 더 정할 것 없이 바로 넣을 수 있는지
 */

/**
 * @typedef {object} Reading
 * @property {'profile'|'names'} source 지문이 맞은 프로파일로 읽었는지, 이름으로 해석했는지
 * @property {Record<string, number>} columns 논리 키 → 열 번호
 * @property {number} headerRows
 * @property {number} headerStart 헤더가 시작하는 행
 * @property {string|null} yearBasis 연도 열의 기준. 이름으로 해석했으면 모른다
 * @property {{index: number, label: string, reason: string}[]} unresolved 해석하지 못한 열
 * @property {string[]} notes 사람이 읽을 설명
 * @property {string|null} profileId
 * @property {string|null} label 화면에 보일 양식 이름
 * @property {boolean} readable 분석할 수 있는 상태인지 (대학명 열이 있어야 한다)
 * @property {number} columnCount 전체 열 수

/**
 * 시트 하나의 열을 읽어 낸다 (§4).
 *
 * **이름 매칭이 주 경로다.** 지문이 맞는 프로파일이 있으면 이미 사람이 확인해 둔
 * 답이므로 그것을 쓰고, 없으면 이름으로 해석한다. 지문이 어긋났다는 것은
 * "읽을 수 없다"가 아니라 "다시 해석해야 한다"는 뜻이다.
 *
 * @param {unknown[][]} grid
 * @param {object} match
 * @returns {Reading}
 */
export function readSheetColumns(grid, match) {
  if (match.profile) {
    const columns = match.profile.columns;
    return {
      source: 'profile',
      columns,
      headerRows: match.profile.headerRows,
      headerStart: 0,
      yearBasis: match.profile.yearBasis ?? null,
      unresolved: [],
      notes: [],
      profileId: match.profile.id,
      label: match.profile.programLabel ?? match.profile.id,
      readable: columns.univ !== undefined,
      columnCount: Object.keys(columns).length
    };
  }

  const resolved = resolveSheet(grid);
  const notes = [...resolved.notes];
  if (match.match === 'conflict') {
    notes.unshift(`지문이 같은 프로파일 ${match.conflict.join(' · ')}의 열 매핑이 서로 달라`
      + ' 어느 쪽도 쓰지 않았습니다. 이름으로 해석합니다 — 프로파일을 수정해 주세요.');
  }
  return {
    source: 'names',
    columns: resolved.columns,
    headerRows: resolved.headerRows,
    headerStart: resolved.headerStart,
    // 이름으로는 연도 열의 기준을 알 수 없다. 기준을 모르면 값을 만들지 않는다 (§2)
    yearBasis: null,
    unresolved: resolved.unresolved,
    notes,
    profileId: null,
    label: '이름으로 알아냄',
    readable: resolved.columns.univ !== undefined,
    columnCount: resolved.labels.length
  };
}

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
  /*
   * **같은 내용을 한 번에 두 번 올리는 일을 여기서 걸러 낸다.**
   *
   * 보관소의 중복 방지는 "그 파일이 넣었던 기록을 지우고 다시 넣는" 방식이라,
   * 한 번의 커밋 안에 같은 파일이 두 장 들어오면 막지 못한다 — 건수가 그대로
   * 두 배가 되고 화면 어디에도 표식이 없다. 「결과.xlsx」와 「결과 (1).xlsx」를
   * 함께 담은 zip은 아주 흔하다.
   */
  const seen = new Set();
  for (const sheet of sheets) {
    const id = `${sheet.fileHash}#${sheet.sheetName}`;
    if (seen.has(id)) {
      skipped.push({ name: sheet.fileName, reason: '같은 내용을 이 묶음에서 이미 읽었습니다' });
      continue;
    }
    seen.add(id);
    const match = await matchProfile(profiles, { grid: sheet.grid });
    const reading = readSheetColumns(sheet.grid, match);
    const body = sheet.grid.slice(reading.headerStart);

    const yearGuess = inferCohortYear({
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      grid: body,
      headerRows: reading.headerRows,
      // 연도 열과 그 기준을 짝으로 넘긴다. 짝을 깨면 엉뚱한 열에 기준이 적용된다.
      // 이름으로 해석한 시트는 기준이 null이라, 값이 올해를 넘지 않는 한 사람에게 묻는다
      yearColumn: reading.columns.sourceYear ?? null,
      columnBasis: reading.yearBasis,
      currentYear
    });

    /*
     * 행마다 연도를 읽어도 되는지를 **여기서 한 번만** 정한다.
     *
     * 기준은 프로파일이 밝힌 것을 먼저 쓰고, 없으면 연도 추론이 값에서 확정한 것만 쓴다 —
     * 값이 올해를 넘으면 고3 년도일 수 없으므로 학년도다. 둘 다 없으면 사람에게 묻는다.
     * 화면과 저장 쪽이 이 판단을 따로 하면 둘이 어긋나고, 어긋난 쪽이 조용히 이긴다.
     */
    /*
     * 추론이 정한 기준은 **그 기준을 읽어 낸 열이 곧 연도 열일 때만** 쓴다.
     * 다른 열에서 건너온 기준으로 연도 열을 행마다 변환하면 한 해가 통째로 밀린다.
     */
    const 같은열 = yearGuess.source === 'cell'
      && yearGuess.yearColumn !== null
      && yearGuess.yearColumn === reading.columns.sourceYear;
    reading.effectiveBasis = reading.yearBasis
      ?? (같은열 && ['senior', 'admission'].includes(yearGuess.basis) ? yearGuess.basis : null);
    reading.perRowYear = reading.columns.sourceYear !== undefined && Boolean(reading.effectiveBasis);

    prepared.push({
      id: `${sheet.fileHash}#${sheet.sheetName}`,
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      fileHash: sheet.fileHash,
      container: sheet.container,
      grid: sheet.grid,
      reading,
      profile: match.profile,
      match,
      yearGuess,
      duplicate: knownFiles.get(sheet.fileHash) ?? null,
      rowCount: Math.max(0, body.length - reading.headerRows),
      // 사람이 확인해 둔 프로파일로 읽었고 연도까지 확실할 때만 손댈 것이 없다.
      // 이름으로 해석한 것은 맞아 보여도 한 번은 눈으로 보게 한다
      ready: reading.source === 'profile' && reading.readable
        && !yearGuess.needsInput && yearGuess.cohortYear !== null
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

    const reading = sheet.reading;
    if (!reading?.readable) {
      // 대학명 열을 못 찾으면 분석할 거리가 없다. 여기서 멈추는 편이 낫다(§5)
      warnings.push({
        type: 'not-readable',
        sheet: sheet.id,
        message: `${sheet.fileName}에서 대학명 열을 찾지 못해 넣지 않았습니다.`
      });
      continue;
    }

    const cohortYear = decision.cohortYear ?? sheet.yearGuess.cohortYear;
    /*
     * 여러 해가 섞인 누적 파일이면 파일 연도 없이 행마다 읽는다.
     *
     * 어떤 기준으로 읽을지는 prepare 단계에서 이미 정해 두었다 (§2).
     */
    const basis = reading.effectiveBasis ?? null;
    const perRowYear = Boolean(reading.perRowYear);
    if ((cohortYear === null || cohortYear === undefined) && !perRowYear) {
      warnings.push({
        type: 'year-not-set',
        sheet: sheet.id,
        message: `${sheet.fileName}의 고3 년도가 정해지지 않아 넣지 않았습니다.`
      });
      continue;
    }

    inputs.push({
      // 머리글 앞에 제목 줄이 붙은 양식이 있다. 잘라 내고 넘긴다
      grid: sheet.grid.slice(reading.headerStart),
      headerRows: reading.headerRows,
      columns: reading.columns,
      yearBasis: basis,
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
      profileId: reading.profileId,
      resolvedBy: reading.source,
      loadedAt: new Date().toISOString()
    };
    if (reading.source === 'names' && reading.unresolved.length > 0) {
      warnings.push({
        type: 'columns-unresolved',
        sheet: sheet.id,
        message: `${sheet.fileName}에서 열 ${reading.unresolved.length}개를 해석하지 못해 원본 이름 그대로 보존했습니다: ${reading.unresolved.slice(0, 5).map((item) => item.label).join(', ')}${reading.unresolved.length > 5 ? ' …' : ''}`
      });
    }
    for (const note of reading.notes) {
      warnings.push({ type: 'reading-note', sheet: sheet.id, message: `${sheet.fileName}: ${note}` });
    }

    file.sheets.push(sheet.sheetName);
    if (!file.cohortYears.includes(cohortYear)) file.cohortYears.push(cohortYear);
    files.set(sheet.fileHash, file);
  }

  const dataset = await buildDataset(inputs, { existing: existingStudents });
  return {
    ...dataset,
    files: [...files.values()],
    /*
     * **이번에 읽은 시트 목록을 그대로 넘긴다.**
     *
     * 보관소는 다시 넣는 시트의 옛 기록만 걷어내는데, 그 목록을 지원 기록에서
     * 거꾸로 뽑으면 **행이 0건이 된 시트가 빠진다** — 잘못 들어간 시트를 비워
     * 바로잡으려는 사람의 수정이 반영되지 않는다. 읽은 사실은 여기서만 안다.
     */
    readSheets: inputs.map((input) => ({
      fileHash: input.source?.fileHash,
      sheetName: input.source?.sourceSheet
    })).filter((item) => item.fileHash),
    warnings: [...warnings, ...dataset.warnings]
  };
}
