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

import { classifyOutcome, outcomeMark, registerState, stage1Passed, STAGE1_FAIL_LABEL } from '../core/outcome.js';

/** 화면 행에서 아무 뜻도 없는 보관용 열. 표에 내보내지 않는다. */
const INTERNAL = new Set(['id', 'keyHashes', 'extra', 'fileHash', 'sourceSheet', 'sourceYear']);

/** 최종 열이 비어 있고 1단계에서 탈락한 건. `classifyOutcome`이 판정 미상 자리에 둔다 */
function isStage1Fail(row) {
  const outcome = row['#outcome'];
  return outcome?.code === 'none' && outcome.label === STAGE1_FAIL_LABEL;
}

/** 1단계는 통과했는데 최종 열이 비어 있는 건. 그 해 발표가 아직 안 끝났다는 뜻이다 */
function isAwaitingFinal(row) {
  const outcome = row['#outcome'];
  return row.stage1Passed === true && outcome?.code === 'none' && outcome.raw === null;
}

/**
 * 1단계 불합격을 불합격으로 바꾼다 — **발표가 끝난 해에만.**
 *
 * 1단계에서 탈락하면 최종 열을 비워 두는 양식이 많다. 그 건을 판정 미상 자리에
 * 두면 실제로 떨어진 지원이 합격률의 분모에서 빠져 **합격률이 과대평가된다.**
 * 과년도 자료에서는 이쪽이 훨씬 위험하다 — 상담에서 합격선처럼 보이기 때문이다.
 *
 * 그렇다고 늘 불합격으로 셀 수는 없다. 발표 직후 파일은 1단계 합격자의 최종 열도
 * 비어 있어 분자가 0이고, 1단계 탈락만 분모에 들어가 **합격률 0.0%** 가 찍힌다.
 *
 * 그래서 그 해가 진행 중인지를 **자료에 있는 사실로** 판단한다 (§5 — 추측하지 않는다):
 * 같은 고3 년도에 「1단계는 통과했는데 최종 열이 빈」 건이 하나라도 있으면 아직
 * 발표가 끝나지 않은 해이므로 지금처럼 분모에서 뺀다. 하나도 없으면 그 해는
 * 끝난 자료이고, 1단계 불합격은 그 학생의 최종 결과가 맞다.
 *
 * 이름표는 「1단계 불합격」 그대로 둔다. 불합격 안에서 몇 건이 1단계 탈락이었는지
 * 표와 값 목록이 계속 구분해 보여 줘야 하고, 합격·충원·불합격의 합이 분모와
 * 맞아떨어져 보는 사람이 숫자를 되검산할 수 있다.
 */
function 끝난해의1단계불합격을불합격으로(rows) {
  /** @type {Map<string, object[]>} */
  const 해별 = new Map();
  for (const row of rows) {
    const key = String(row.cohortYear ?? '');
    const group = 해별.get(key) ?? [];
    group.push(row);
    해별.set(key, group);
  }

  for (const group of 해별.values()) {
    if (group.some(isAwaitingFinal)) continue;
    for (const row of group) {
      if (!isStage1Fail(row)) continue;
      row.outcome = 'fail';
      row['#outcome'] = {
        ...row['#outcome'],
        code: 'fail',
        mark: outcomeMark('fail'),
        // 최종 열에서 읽은 값은 아니지만, 그 학생의 최종 결과로는 확정됐다
        final: true
      };
    }
  }
  return rows;
}

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

  const rows = (dataset.applications ?? []).map((application) => {
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

  return 끝난해의1단계불합격을불합격으로(rows);
}
