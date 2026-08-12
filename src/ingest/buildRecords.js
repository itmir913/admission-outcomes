/**
 * 프로파일로 읽은 행을 자료 모델로 옮긴다 (§5).
 *
 * 들어오는 것은 시트 하나의 격자와 열 매핑, 사용자가 확정한 고3 년도다.
 * 나가는 것은 `students` · `applications` · `suneung` 세 갈래다.
 *
 * 학생의 내신·수능은 지원 건수만큼 되풀이되어 들어 있다. 그대로 두면 여러 해를
 * 쌓았을 때 그만큼 부풀어 오르므로, 학생 단위로 한 번만 남긴다.
 */

import fields from '../dict/fields.json' with { type: 'json' };
import { buildHeaderLabels, bodyRows } from './headerBlock.js';
import { assignStudentIds } from '../core/anonymize.js';
import { toCohortYear } from './year.js';

const SCALAR_TYPE = new Map(fields.scalars.map((field) => [field.key, field.type]));
const PART_TYPE = fields.partTypes;

/** 값이 비었다는 뜻으로 쓰이는 표기들. 엑셀에서 자리를 채우려고 넣는다. */
const BLANK_MARKS = new Set(['-', '--', '.', '없음', '해당없음', '미해당', 'N/A', 'n/a']);

/** @param {string} key */
function typeOf(key) {
  if (SCALAR_TYPE.has(key)) return SCALAR_TYPE.get(key);
  const parts = key.split('.');
  if (parts[0] === 'gpa') return 'number';
  if (parts[0] === 'suneung') return PART_TYPE[parts[2]] ?? 'text';
  return 'text';
}

/**
 * 셀 값을 필드 타입에 맞게 다듬는다.
 * @param {string} key
 * @param {unknown} raw
 */
export function coerce(key, raw) {
  if (raw === null || raw === undefined) return null;
  const type = typeOf(key);
  const text = String(raw).trim();
  if (text === '') return null;

  if (type === 'number' || type === 'year') {
    if (BLANK_MARKS.has(text)) return null;
    const value = Number(text.replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }
  // 글자 필드에서는 `-`를 지우지 않는다. 불합격사유 같은 곳에 뜻이 있을 수 있다
  return text;
}

/**
 * 한 행을 논리 필드별로 갈라 읽는다.
 * @param {unknown[]} row
 * @param {Record<string, number>} columns
 */
export function readRow(row, columns) {
  const identity = {};
  const scalars = {};
  /** @type {Record<string, number|null>} */
  const gpa = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const suneung = {};

  for (const [key, index] of Object.entries(columns)) {
    const value = coerce(key, row?.[index]);
    if (value === null) continue;
    const parts = key.split('.');

    if (parts[0] === 'identity') {
      const slot = { name: 'name', hakbun: 'hakbun', class: 'classNo', number: 'number' }[parts[1]];
      if (slot) identity[slot] = value;
      continue;
    }
    if (parts[0] === 'gpa') { gpa[parts.slice(1).join('.')] = value; continue; }
    if (parts[0] === 'suneung') {
      const [, area, part] = parts;
      if (!suneung[area]) suneung[area] = {};
      suneung[area][part] = value;
      continue;
    }
    scalars[key] = value;
  }

  return { identity, scalars, gpa, suneung };
}

/**
 * 프로파일이 집어 가지 않은 열을 원본 헤더 이름 그대로 담는다 (§4 미지 열 보존).
 * 버리지 않아야 나중에 사전에 추가해 정식 필드로 올릴 수 있다.
 */
function readExtra(row, columns, labels) {
  const used = new Set(Object.values(columns));
  const extra = {};
  for (let index = 0; index < labels.length; index += 1) {
    if (used.has(index)) continue;
    const label = labels[index].label;
    if (!label) continue;
    const value = row?.[index];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    extra[label] = String(value).trim();
  }
  return extra;
}

/** 지원 기록으로 볼 만한 행인지 본다. 양식에는 빈 행과 합계 행이 섞여 있다. */
function looksLikeApplication(parsed) {
  return Boolean(parsed.scalars.univ || parsed.scalars.dept || parsed.scalars.final);
}

/**
 * @typedef {object} SheetInput
 * @property {unknown[][]} grid
 * @property {number} headerRows
 * @property {Record<string, number>} columns 프로파일의 열 매핑
 * @property {number|null} cohortYear 사용자가 확정한 고3 년도
 * @property {string} [yearBasis] 연도 열이 있을 때 그 값의 기준
 * @property {object} [source] 어느 파일·시트에서 왔는지
 */

/**
 * 시트 여러 장을 하나의 자료 묶음으로 만든다.
 *
 * @param {SheetInput[]} sheets
 * @param {{existing?: object[]}} [options] 이미 저장된 학생들 (ID 이어 붙이기)
 * @returns {Promise<{students: object[], applications: object[], suneung: object[], warnings: object[]}>}
 */
export async function buildDataset(sheets, { existing = [] } = {}) {
  const warnings = [];
  /** @type {{parsed: object, cohortYear: number, extra: object, source: object}[]} */
  const rows = [];

  for (const sheet of sheets) {
    const labels = buildHeaderLabels(sheet.grid, sheet.headerRows);
    const yearColumn = sheet.columns.sourceYear;
    let skipped = 0;

    for (const row of bodyRows(sheet.grid, sheet.headerRows)) {
      const parsed = readRow(row, sheet.columns);
      if (!looksLikeApplication(parsed)) continue;

      // 행마다 연도가 다른 누적 파일이면 그 열을 쓴다. 기준을 모르면 파일 연도로 돌아간다
      let cohortYear = sheet.cohortYear;
      if (yearColumn !== undefined && sheet.yearBasis) {
        const perRow = toCohortYear(coerce('sourceYear', row?.[yearColumn]), sheet.yearBasis);
        if (perRow !== null) cohortYear = perRow;
      }
      if (cohortYear === null || cohortYear === undefined) { skipped += 1; continue; }

      rows.push({
        parsed,
        cohortYear,
        extra: readExtra(row, sheet.columns, labels),
        source: sheet.source ?? null
      });
    }

    if (skipped > 0) {
      warnings.push({
        type: 'missing-year',
        count: skipped,
        message: `고3 년도를 정하지 못해 ${skipped}건을 넣지 못했습니다. 파일의 연도를 확인해 주세요.`
      });
    }
  }

  const { sids, students: identified, warnings: idWarnings } = await assignStudentIds(
    rows.map((row) => ({ cohortYear: row.cohortYear, identity: row.parsed.identity })),
    { existing }
  );
  warnings.push(...idWarnings);

  // ── 학생 단위 값 모으기 ───────────────────────────────────────────────────
  /** @type {Map<string, object>} */
  const studentBySid = new Map();
  for (const student of identified) {
    studentBySid.set(student.sid, {
      sid: student.sid,
      cohortYear: student.cohortYear,
      keyHashes: student.keyHashes,
      gpa: {}
    });
  }

  const applications = [];
  /** @type {Map<string, Map<string, object>>} */
  const suneungBySid = new Map();

  rows.forEach((row, index) => {
    const sid = sids[index];
    if (sid === null) return;
    const student = studentBySid.get(sid);

    // 되풀이되는 값은 처음 본 것만 남긴다. 같은 학생의 모든 행에 같은 값이 실려 있다
    if (student) {
      for (const [label, value] of Object.entries(row.parsed.gpa)) {
        if (student.gpa[label] === undefined) student.gpa[label] = value;
      }
    }
    if (!suneungBySid.has(sid)) suneungBySid.set(sid, new Map());
    const areas = suneungBySid.get(sid);
    for (const [area, parts] of Object.entries(row.parsed.suneung)) {
      if (!areas.has(area)) areas.set(area, { sid, area, ...parts });
    }

    applications.push({
      sid,
      cohortYear: row.cohortYear,
      ...row.parsed.scalars,
      ...(Object.keys(row.extra).length ? { extra: row.extra } : {}),
      ...(row.source ? { source: row.source } : {})
    });
  });

  const suneung = [];
  for (const areas of suneungBySid.values()) suneung.push(...areas.values());

  return {
    students: [...studentBySid.values()].sort((left, right) => left.sid.localeCompare(right.sid)),
    applications,
    suneung,
    warnings
  };
}
