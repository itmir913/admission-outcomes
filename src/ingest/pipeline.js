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
import { buildHeaderLabels } from './headerBlock.js';
import { inferCohortYear } from './year.js';
import { buildDataset, isIdentityLabel } from './buildRecords.js';
import fields from '../dict/fields.json' with { type: 'json' };

const GPA_SUBJECT_KEYS = fields.repeating.gpa.subjects.map((entry) => `gpa.${entry.key}`);

/**
 * 학생을 알아낼 열이 있는지.
 *
 * 없으면 모든 행이 학생에 묶이지 못해 **한 건도 저장되지 않는다.** 불러오기 전에
 * 알려야 한다 — 읽은 행 수만 보고 들어온 줄 알면 빈 보관소를 보고도 모른다 (§5).
 *
 * **`identityKeys`와 같은 규칙으로 본다.** 주키(학번, 또는 반+번호)만 인정하면,
 * 이름 키로 멀쩡히 식별되는 파일이 「저장할 수 없습니다」로 막힌다 — 실제로는
 * 저장되는데 그렇게 적는 셈이고, 사람은 그 파일을 영영 들여올 수 없다 (§3의 보조 수단).
 */
function hasPrimaryIdentity(columns = {}) {
  const has = (key) => columns[key] !== undefined;
  if (has('identity.hakbun')) return true;
  return has('identity.class') && has('identity.number');
}

function hasIdentity(columns = {}) {
  const has = (key) => columns[key] !== undefined;
  // 주키
  if (has('identity.hakbun')) return true;
  if (has('identity.class') && has('identity.number')) return true;
  // 주키를 만들 수 없을 때의 보조 수단. 이름만 있는 파일도 들여올 수 있어야 한다
  return has('identity.name');
}

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
 * @property {boolean} identifiable 학생을 알아낼 열이 있는지 (없으면 한 건도 저장되지 않는다)
 * @property {boolean} nameOnlyIdentity 주키 없이 이름만으로 식별하는 시트인지
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
/**
 * 프로파일이 집어 가지 않은 열을 미해결로 모은다.
 *
 * **프로파일로 읽은 시트도 미해결을 알려야 한다.** 예전에는 이 자리가 빈 배열이었다.
 * 그래서 프로파일을 등록하는 순간 「열 n개를 해석하지 못했습니다」가 사라졌는데,
 * 그 열들은 그대로 `extra`로 가고 있었다 — 열을 더 이해해서가 아니라 보고하지
 * 않아서 조용해진 것이다. 실제 자료는 프로파일 경로로 해석되므로 이쪽이 본선이다(§5).
 *
 * @param {unknown[][]} grid
 * @param {{columns: Record<string, number>, headerRows: number}} profile
 * @returns {{index: number, label: string, reason: string}[]}
 */
function unresolvedUnderProfile(grid, profile) {
  const labels = buildHeaderLabels(grid, profile.headerRows);
  const taken = new Set(Object.values(profile.columns));
  /*
   * **사람이 이미 확인한 열은 묻지 않는다.** 프로파일은 사람이 확인해 둔 답이고,
   * `extraColumns`는 그중 「담을 논리 필드가 없더라」는 답이다. 그것까지 매번 알리면
   * 올릴 때마다 같은 열 열다섯 개가 뜨고, 사람은 그 안내를 읽지 않게 된다 —
   * **그러면 양식이 열을 새로 얻었을 때도 지나친다.** 알림이 뜻을 가지려면 드물어야 한다.
   */
  const 확정 = new Set(profile.extraColumns ?? []);
  const unresolved = [];
  for (let index = 0; index < labels.length; index += 1) {
    if (taken.has(index) || 확정.has(index)) continue;
    const label = labels[index].label;
    if (!label) continue;
    unresolved.push({ index, label, reason: '프로파일이 가리키지 않는 열입니다' });
  }
  return unresolved;
}

export function readSheetColumns(grid, match) {
  if (match.profile) {
    const columns = match.profile.columns;
    return {
      source: 'profile',
      columns,
      headerRows: match.profile.headerRows,
      headerStart: 0,
      yearBasis: match.profile.yearBasis ?? null,
      unresolved: unresolvedUnderProfile(grid, match.profile),
      notes: [],
      profileId: match.profile.id,
      label: match.profile.programLabel ?? match.profile.id,
      readable: columns.univ !== undefined,
      identifiable: hasIdentity(columns),
      nameOnlyIdentity: hasIdentity(columns) && !hasPrimaryIdentity(columns),
      columnCount: Object.keys(columns).length
    };
  }

  const resolved = resolveSheet(grid);
  const notes = [...resolved.notes];
  /*
   * **수능 구역 표지 없이 과목 이름이 내신으로 간 경우를 알린다.** 학교 자체 양식에
   * 「전교과, 국어, 수학, 영어」가 있고 뒤 셋이 수능 등급이면, 표지(한국사 등)가 없어
   * 내신 과목으로 해석된다. 값 범위(1~9)도 같아 교차검증으로는 걸러지지 않는다 (§4).
   */
  const 과목키 = new Set(GPA_SUBJECT_KEYS);
  const 내신과목 = Object.keys(resolved.columns).filter((key) => 과목키.has(key));
  const 수능있음 = Object.keys(resolved.columns).some((key) => key.startsWith('suneung.'));
  if (내신과목.length > 0 && !수능있음) {
    notes.push(`수능 구역 표지(한국사 등)가 없어 ${내신과목.map((key) => key.slice(4)).join('·')} 열을 내신 과목으로 읽었습니다. `
      + '수능 등급이라면 아래 열 배정을 확인하고, 맞지 않으면 이 시트를 꺼 주세요.');
  }
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
    identifiable: hasIdentity(resolved.columns),
    nameOnlyIdentity: hasIdentity(resolved.columns) && !hasPrimaryIdentity(resolved.columns),
    columnCount: resolved.labels.length,
    // 이름으로 해석한 시트는 사람이 한 번 본다(§4). 무엇을 볼지가 있어야 한다
    mapping: Object.entries(resolved.columns)
      .map(([key, index]) => ({ key, index, label: resolved.labels[index]?.label ?? `${index + 1}번째 열` }))
      .sort((left, right) => left.index - right.index)
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
      // 폴더 이름(`2025학년도/`)도 파일 이름과 같은 단서다. zip 이름은 넣지 않는다 — 여러 해를 묶은 이름이 흔하다
      fileName: sheet.folder ? `${sheet.folder}/${sheet.fileName}` : sheet.fileName,
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
      folder: sheet.folder,
      hidden: Boolean(sheet.hidden),
      grid: sheet.grid,
      reading,
      profile: match.profile,
      match,
      yearGuess,
      duplicate: knownFiles.get(sheet.fileHash) ?? null,
      /*
       * **이름은 같은데 내용이 다른 보관된 파일.** 셀 하나만 고쳐도 해시가 달라져 교체로
       * 인식되지 않고 옛 기록 위에 쌓인다 — 합격률의 분모와 분자가 함께 부푼다 (§5).
       * 이름만 보고 바꾸면 다른 해의 같은 이름 파일을 지울 수 있으니 사람에게 묻는다.
       */
      // zip의 다른 폴더(다른 해)에 든 같은 이름 파일까지 교체 대상에 넣으면 그 해 자료가 함께 지워진다
      // 폴더를 적기 전 판이 남긴 zip 기록에는 `folder` 자체가 없다. 그때는 이름만 보고 묻는다 —
      // 빼 버리면 고친 zip을 다시 올려도 교체를 묻지 않고 옛 기록 위에 쌓인다
      sameName: existingFiles.filter((file) => file.name === sheet.fileName
        && ((file.folder ?? null) === (sheet.folder ?? null) || (file.container && !('folder' in file)))
        && file.hash !== sheet.fileHash),
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
 * @param {Record<string, {cohortYear?: number|null, include?: boolean, replace?: boolean, yearBasis?: 'admission'|'senior'|'file'}>} [options.decisions]
 *        시트 id별 결정. `cohortYear`를 주면 제안을 덮고, `include: false`면 건너뛴다.
 *        `replace: true`면 이름이 같은 옛 파일(`sameName`)을 걷어내고 넣는다
 * @param {object[]} [options.existingStudents] 이미 보관된 학생 (익명 ID 이어 붙이기)
 * @returns {Promise<{students: object[], applications: object[], suneung: object[], files: object[], warnings: object[]}>}
 */
export async function commitSheets(prepared, { decisions = {}, existingStudents = [] } = {}) {
  const replacedFiles = new Set();
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

    /*
     * **사람이 비운 칸(null)은 추정값으로 메우지 않는다.**
     *
     * `??`로 메우면 행마다 연도가 적힌 누적 파일에서도 파일 이름 연도가 모든 행을 덮어,
     * 한 해 밀린 값이 조용히 저장된다 (§2). 결정에 연도가 아예 없을 때만 추정을 쓴다.
     */
    /*
     * **사람이 연도 열의 기준을 정했으면 행마다 읽는다.** 이때 파일 연도는 쓰지 않는다 —
     * 파일 연도가 있으면 행의 연도를 덮어, 정한 기준이 아무 일도 하지 않는다.
     */
    const 사람기준 = reading.columns.sourceYear !== undefined && ['admission', 'senior'].includes(decision.yearBasis)
      ? decision.yearBasis
      : null;
    const cohortYear = 사람기준
      ? null
      : decision.cohortYear !== undefined ? decision.cohortYear : sheet.yearGuess.cohortYear;
    /*
     * 여러 해가 섞인 누적 파일이면 파일 연도 없이 행마다 읽는다.
     *
     * 어떤 기준으로 읽을지는 prepare 단계에서 이미 정해 두었다 (§2).
     */
    const basis = 사람기준 ?? reading.effectiveBasis ?? null;
    const perRowYear = Boolean(사람기준) || Boolean(reading.perRowYear);
    if ((cohortYear === null || cohortYear === undefined) && !perRowYear) {
      warnings.push({
        type: 'year-not-set',
        sheet: sheet.id,
        message: `${sheet.fileName}의 고3 년도가 정해지지 않아 넣지 않았습니다.`
      });
      continue;
    }

    if (decision.replace === true) {
      for (const old of sheet.sameName ?? []) replacedFiles.add(old.hash);
    }

    inputs.push({
      // 머리글 앞에 제목 줄이 붙은 양식이 있다. 잘라 내고 넘긴다
      grid: sheet.grid.slice(reading.headerStart),
      headerRows: reading.headerRows,
      columns: reading.columns,
      yearBasis: basis,
      cohortYear,
      sheetId: sheet.id,
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
      folder: sheet.folder ?? null,
      sheets: [],
      cohortYears: [],
      profileId: reading.profileId,
      resolvedBy: reading.source,
      loadedAt: new Date().toISOString()
    };
    if (reading.unresolved.length > 0) {
      /*
       * 해석하지 못한 열이라고 다 보존하는 것은 아니다. 식별 열로 보이는 이름은
       * 보관소에 넣지 않으므로(§1), 한 숫자로 묶어 「보존했다」고 알리면 사실과 다르다.
       */
      const 보존 = reading.unresolved.filter((item) => !isIdentityLabel(item.label));
      const 제외 = reading.unresolved.filter((item) => isIdentityLabel(item.label));
      const 목록 = (items) => `${items.slice(0, 5).map((item) => item.label).join(', ')}${items.length > 5 ? ' …' : ''}`;
      warnings.push({
        type: 'columns-unresolved',
        sheet: sheet.id,
        message: [
          보존.length > 0
            ? `${sheet.fileName}에서 열 ${보존.length}개를 해석하지 못해 원본 이름 그대로 보존했습니다: ${목록(보존)}`
            : `${sheet.fileName}에서 해석하지 못한 열이 있습니다.`,
          제외.length > 0 ? `개인정보로 보이는 열 ${제외.length}개(${목록(제외)})는 보관하지 않았습니다.` : null
        ].filter(Boolean).join(' ')
      });
    }
    for (const note of reading.notes) {
      warnings.push({ type: 'reading-note', sheet: sheet.id, message: `${sheet.fileName}: ${note}` });
    }

    file.sheets.push(sheet.sheetName);
    // 행별 연도 시트는 파일 연도가 없다. null을 적어 두면 합칠 때 「정해진 연도」로 해석된다
    if (cohortYear !== null && cohortYear !== undefined) {
      if (!file.cohortYears.includes(cohortYear)) file.cohortYears.push(cohortYear);
      /*
       * **시트마다 확정한 연도를 따로 적어 둔다.**
       *
       * 파일 단위 목록(`cohortYears`)만 두면 시트가 둘이고 해가 다른 파일에서 「연도가
       * 섞였다」로 보여, 다시 올릴 때 두 시트 다 빈칸이 된다. 또박또박 적어 둔 값을
       * 두고 사람에게 다시 치게 하는 셈이다 (§2).
       */
      file.yearBySheet = { ...(file.yearBySheet ?? {}), [sheet.sheetName]: cohortYear };
    }
    files.set(sheet.fileHash, file);
  }

  const dataset = await buildDataset(inputs, { existing: existingStudents });

  /*
   * **한 건도 만들지 못한 시트를 알린다.**
   *
   * 보관소는 다시 넣는 시트의 옛 기록을 걷어내므로, 0건이 된 시트는 예전에 쌓아
   * 둔 기록을 **지우기만 한다.** 비워 바로잡으려는 사람에게는 그게 맞지만, 머리글
   * 행 수가 한 줄 밀리거나 프로파일이 빈 열을 가리켜 0건이 되는 길도 같은 문이다.
   * 어느 쪽인지는 사람만 알 수 있으니 숫자를 보여 준다 (§5).
   */
  const 시트별건수 = new Map();
  for (const row of dataset.applications ?? []) {
    const key = `${row.fileHash}#${row.sourceSheet}`;
    시트별건수.set(key, (시트별건수.get(key) ?? 0) + 1);
  }
  for (const input of inputs) {
    const key = `${input.source?.fileHash}#${input.source?.sourceSheet}`;
    if (시트별건수.get(key)) continue;
    const sheet = prepared.find((item) => item.id === input.sheetId) ?? {
      fileName: input.source?.sourceFile ?? '파일', sheetName: input.source?.sourceSheet, id: null
    };
    warnings.push({
      type: 'sheet-empty',
      sheet: sheet.id,
      // 사람이 이 글을 읽는 시점에는 이미 지워져 있다. 미래형으로 적으면 막을 수 있다고 믿는다
      message: `${sheet.fileName}의 ${sheet.sheetName} 시트에서 지원 기록을 한 건도 만들지 못했습니다. 이 시트가 예전에 넣어 둔 기록은 지웠습니다 — 머리글 줄 수나 양식이 달라졌는지 확인해 주세요.`
    });
  }

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
    replacedFiles: [...replacedFiles],
    readSheets: inputs.map((input) => ({
      fileHash: input.source?.fileHash,
      sheetName: input.source?.sourceSheet
    })).filter((item) => item.fileHash),
    warnings: [...warnings, ...dataset.warnings]
  };
}
