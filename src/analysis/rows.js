/**
 * 보관된 세 갈래(students · applications · suneung)를 화면이 쓰는 평평한 행으로 합친다.
 *
 * 보관은 정규화해서 하고(§5) 화면은 평평한 것을 원한다. 그 사이를 여기서 잇는다.
 * 한 행 = 지원 한 건이고, 그 학생의 내신·수능이 함께 실린다.
 *
 * 열 이름은 점으로 이은 논리 키 그대로다 (`gpa.전교과`, `suneung.국어.grade`,
 * `extra.학교유형`). 이렇게 두면 §4에서 해석하지 못해 `extra`로 보존한 열도
 * 코드를 고치지 않고 그대로 정렬·필터·축으로 쓸 수 있다.
 */

import { classifyOutcome, registerState, stage1Passed } from '../core/outcome.js';

/** 화면 행에서 아무 뜻도 없는 보관용 열. 표에 내보내지 않는다. */
const INTERNAL = new Set(['id', 'keyHashes', 'extra', 'fileHash', 'sourceSheet', 'sourceYear']);

/**
 * @param {{students?: object[], applications?: object[], suneung?: object[]}} dataset
 * @returns {object[]}
 */
export function buildRows(dataset) {
  const students = new Map((dataset.students ?? []).map((student) => [student.sid, student]));

  /** @type {Map<string, Record<string, unknown>>} */
  const suneungBySid = new Map();
  for (const row of dataset.suneung ?? []) {
    const flat = suneungBySid.get(row.sid) ?? {};
    for (const [part, value] of Object.entries(row)) {
      if (part === 'sid' || part === 'area') continue;
      flat[`suneung.${row.area}.${part}`] = value;
    }
    suneungBySid.set(row.sid, flat);
  }

  return (dataset.applications ?? []).map((application) => {
    const student = students.get(application.sid);
    /** @type {Record<string, unknown>} */
    const row = {};

    for (const [key, value] of Object.entries(application)) {
      if (INTERNAL.has(key)) continue;
      row[key] = value;
    }
    for (const [label, value] of Object.entries(application.extra ?? {})) {
      row[`extra.${label}`] = value;
    }
    for (const [label, value] of Object.entries(student?.gpa ?? {})) {
      row[`gpa.${label}`] = value;
    }
    Object.assign(row, suneungBySid.get(application.sid) ?? {});

    // 파생 열. 원본에 없지만 상담에서 가장 자주 보는 값이다
    const outcome = classifyOutcome(application);
    row.outcome = outcome.code;
    row['#outcome'] = outcome;
    row.registered = registerState(application);
    row.stage1Passed = stage1Passed(application);
    // 되돌리기·출처 표시에 쓰지만 열로는 감춘다
    row['#fileHash'] = application.fileHash ?? null;

    return row;
  });
}
