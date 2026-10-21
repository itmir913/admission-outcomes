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

/** 숫자로만 적힌 칸. 앞자리 0이 붙은 것은 코드로 보고 제외한다 */
const NUMERIC_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** @param {string} key */
function typeOf(key) {
  if (SCALAR_TYPE.has(key)) return SCALAR_TYPE.get(key);
  const parts = key.split('.');
  if (parts[0] === 'gpa') return 'number';
  if (parts[0] === 'suneung') return PART_TYPE[parts[2]] ?? 'text';
  return 'text';
}

/**
 * 셀 값을 필드 타입에 맞게 정리한다.
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
 * 한 행을 논리 필드별로 나누어 읽는다.
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

const IDENTITY_TOKENS = fields.identityLabels.tokens.map((token) => token.toLowerCase());

/**
 * 해석하지 못한 열이 사람을 특정하는 열인지 본다.
 *
 * 프로파일이 집어 가지 않은 열은 원본 이름 그대로 `extra`에 보존하는데(§4),
 * 그 통로로 이름·학번·수험번호·생년월일이 보관소에 그대로 들어갈 수 있다.
 * **개인정보가 새는 유일한 경로였다.** 여기서 막는다.
 *
 * @param {string} label
 */
export function isIdentityLabel(label) {
  const normalized = String(label ?? '').replace(/[\s()[\]·_-]/g, '').toLowerCase();
  return IDENTITY_TOKENS.some((token) => normalized.includes(token));
}

/**
 * 프로파일이 집어 가지 않은 열을 원본 헤더 이름 그대로 담는다 (§4 미지 열 보존).
 * 버리지 않아야 나중에 사전에 추가해 정식 필드로 올릴 수 있다.
 *
 * 다만 사람을 특정하는 열은 보존하지 않는다. 보존보다 개인정보가 우선이다.
 */
function readExtra(row, columns, labels) {
  const used = new Set(Object.values(columns));
  const extra = {};
  const dropped = [];
  /*
   * **머리글보다 넓은 행까지 훑는다.** 머리글 칸만 지워진 파일이 실재하는데,
   * 머리글 너비까지만 보면 그 열이 통째로 사라지고 「해석하지 못한 열」에도 잡히지
   * 않아 사람이 알 길이 없었다(§4·§5).
   */
  const width = Math.max(labels.length, row?.length ?? 0);
  for (let index = 0; index < width; index += 1) {
    if (used.has(index)) continue;
    const label = labels[index]?.label ?? '';
    const value = row?.[index];
    if (value === null || value === undefined || String(value).trim() === '') continue;
    /*
     * **이름표가 없는 열은 보관하지 않는다.**
     *
     * 신원 열 차단은 이름표를 보고 판정한다(`이름`·`학번`…). 이름표가 없으면 그 판정
     * 자체를 할 수 없는데, 머리글 칸이 비었고 그 아래에 학생 이름이 든 파일은 흔하다.
     * 번호를 붙여 보관하면 그 이름이 보관소와 화면에 그대로 남는다 — §1이 막는 그 길이
     * 이름 없는 열로 다시 열린다. 보존(§4)과 개인정보(§1)가 부딪히면 §1이 이긴다.
     *
     * 대신 **소리 없이 버리지는 않는다.** 몇 번째 열을 버렸는지 사람에게 알린다 (§5).
     */
    if (label === '') { dropped.push(`${index + 1}번째 열(머리글 없음)`); continue; }
    if (isIdentityLabel(label)) { dropped.push(label); continue; }
    const text = String(value).trim();
    // 빈칸 표시는 빈칸으로 둔다. `-`를 글자로 담아 두면 그 열은 영영 숫자 열이 못 된다
    if (BLANK_MARKS.has(text)) continue;
    /*
     * 숫자로만 적힌 칸은 숫자로 담는다. 글자로 담아 두면 해석하지 못한 등급 열에
     * 범위 필터도 정렬도 걸리지 않는다 — 화면에는 숫자가 보이는데 숫자로 다룰 수가 없다.
     *
     * **앞자리 0은 숫자로 보지 않는다.** `007` 같은 칸은 코드지 수가 아니고,
     * 숫자로 바꾸면 0이 지워져 다른 값이 된다.
     */
    extra[label] = NUMERIC_TEXT.test(text) ? Number(text) : text;
  }
  return { extra, dropped };
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
 * @property {{fileHash?: string, sourceFile?: string, sourceSheet?: string}} [source] 어느 파일·시트에서 왔는지
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
  /** 해석하지 못했는데 사람을 특정하는 열. 보존하지 않고 버린 것을 알린다 */
  const droppedIdentityLabels = new Set();
  /** @type {{parsed: object, cohortYear: number, extra: object, source: object}[]} */
  const rows = [];

  for (const sheet of sheets) {
    const labels = buildHeaderLabels(sheet.grid, sheet.headerRows);
    const yearColumn = sheet.columns.sourceYear;
    let skipped = 0;

    for (const row of bodyRows(sheet.grid, sheet.headerRows)) {
      const parsed = readRow(row, sheet.columns);
      if (!looksLikeApplication(parsed)) continue;

      // 파일 연도가 정해져 있으면 그것이 이긴다. 사람이 확정한 값을 자료가 덮으면 안 된다.
      // 연도 열은 파일 연도가 비어 있을 때 — 여러 해가 섞인 누적 파일일 때 — 쓴다
      let cohortYear = sheet.cohortYear;
      if ((cohortYear === null || cohortYear === undefined) && yearColumn !== undefined && sheet.yearBasis) {
        cohortYear = toCohortYear(coerce('sourceYear', row?.[yearColumn]), sheet.yearBasis);
      }
      if (cohortYear === null || cohortYear === undefined) { skipped += 1; continue; }

      const { extra, dropped } = readExtra(row, sheet.columns, labels);
      for (const label of dropped) droppedIdentityLabels.add(label);
      rows.push({ parsed, cohortYear, extra, source: sheet.source ?? null });
    }

    if (skipped > 0) {
      warnings.push({
        type: 'missing-year',
        count: skipped,
        message: `고3 년도를 정하지 못해 ${skipped}건을 넣지 못했습니다. 파일의 연도를 확인해 주세요.`
      });
    }
  }

  if (droppedIdentityLabels.size > 0) {
    // 머리글이 없어 신원 여부를 판정할 수 없는 열과, 이름으로 신원 열이라 본 것을 나누어 적는다
    const 이름없음 = [...droppedIdentityLabels].filter((label) => label.endsWith('(머리글 없음)'));
    const 신원 = [...droppedIdentityLabels].filter((label) => !label.endsWith('(머리글 없음)'));
    if (신원.length > 0) {
      warnings.push({
        type: 'identity-column-dropped',
        labels: 신원,
        message: `개인정보로 보이는 열(${신원.join(', ')})은 보관하지 않고 버렸습니다.`
      });
    }
    if (이름없음.length > 0) {
      warnings.push({
        type: 'unnamed-column-dropped',
        labels: 이름없음,
        message: `머리글이 없는 열(${이름없음.join(', ')})은 보관하지 않았습니다. 그 열에 무엇이 들었는지 알 수 없어 개인정보일 수 있습니다 — 머리글을 적어 다시 올리면 함께 읽습니다.`
      });
    }
  }

  const { sids, students: identified, merges, warnings: idWarnings } = await assignStudentIds(
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

    /*
     * 되풀이되는 값은 **나중에 읽은 것이 이긴다.**
     *
     * 같은 학생의 모든 행에 같은 값이 실려 있으므로 대개 무엇을 남기든 같다. 다른
     * 경우는 낡은 파일과 고친 파일을 **한 번에** 올렸을 때인데, 그때 먼저 본 값을
     * 지키면 낡은 값이 남는다 — 따로 올리면 고친 값이 이기는데(보관소의 `새값우선`)
     * 같이 올리면 거꾸로다. 두 자리가 다르게 굴면 사람은 어느 쪽도 믿을 수 없다.
     */
    if (student) {
      for (const [label, value] of Object.entries(row.parsed.gpa)) {
        if (value !== null && value !== undefined) student.gpa[label] = value;
      }
    }
    if (!suneungBySid.has(sid)) suneungBySid.set(sid, new Map());
    const areas = suneungBySid.get(sid);
    for (const [area, parts] of Object.entries(row.parsed.suneung)) {
      // 덮지 않고 합친다. 파일마다 담고 있는 항목이 다르다 —
      // 어떤 양식은 등급만, 어떤 양식은 표점·백분위까지 준다
      const merged = areas.get(area) ?? { sid, area };
      for (const [key, value] of Object.entries(parts)) {
        // 빠진 항목은 먼저 읽은 값을 지키고, 둘 다 있으면 나중 것이 이긴다
        if (value !== null && value !== undefined) merged[key] = value;
      }
      areas.set(area, merged);
    }

    applications.push({
      sid,
      cohortYear: row.cohortYear,
      ...row.parsed.scalars,
      ...(Object.keys(row.extra).length ? { extra: row.extra } : {}),
      // 파일 단위로 되돌릴 수 있어야 하므로 출처를 평평하게 남긴다
      ...(row.source ?? {})
    });
  });

  const suneung = [];
  for (const areas of suneungBySid.values()) suneung.push(...areas.values());

  return {
    students: [...studentBySid.values()].sort((left, right) => left.sid.localeCompare(right.sid)),
    applications,
    suneung,
    // 보관소가 옛 ID로 쌓아 둔 기록을 옮기도록 함께 넘긴다
    merges,
    warnings
  };
}
