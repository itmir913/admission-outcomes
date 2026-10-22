/**
 * 열 해석의 주 경로 — 이름으로 해석한다 (§4).
 *
 * 엑셀에서 믿을 수 있는 것은 **열 이름**이지 열 번호가 아니다. 번호는 양식이
 * 조금만 달라져도 통째로 밀린다 — 실제로 대교협 양식에 5등급제 열 하나가
 * 끼어들면서 뒤따르는 논리 필드 53개가 한 칸씩 밀렸다. 이름은 하나도 바뀌지 않았는데도.
 *
 * 그래서 순서를 이렇게 둔다.
 *
 *   헤더 블록 탐지 → 병합셀 채움 · 여러 줄 라벨 합성 → **구역 판정**
 *     → 이름 매칭 → 값으로 교차검증 → 확정된 열 번호
 *
 * 열 번호는 **이 과정의 결과물**이다. 번호를 먼저 믿고 읽는 일은 없다.
 * 한 번 해석한 답은 지문과 함께 프로파일로 저장되어, 같은 양식이 다시 오면 그대로 쓰인다.
 *
 * 구역 판정이 이름 매칭보다 먼저인 이유는 §4에 적힌 그대로다. 대교협 양식에는
 * `국어`·`영어`·`수학`이 내신 구역과 수능 구역에 각각 한 번씩 나오고,
 * 이름만 보면 어느 쪽인지 알 수 없다.
 */

import synonyms from '../dict/field-synonyms.json' with { type: 'json' };
import anchors from '../dict/section-anchors.json' with { type: 'json' };
import { buildHeaderLabels, bodyRows } from './headerBlock.js';
import { isKnownFieldKey } from './profile.js';

const SCORES = synonyms.scores;

/**
 * 표기 → 고유키 조회표. 내신 조합·과목과 수능 영역은 **열거한 사전으로만** 모인다.
 * 규칙으로 이름을 해석하지 않는다 (§4·§5).
 */
function 표기표(entries) {
  const table = new Map();
  for (const entry of entries) {
    for (const word of entry.exact) table.set(normalizeLabel(word).tight, entry.key);
  }
  return table;
}
const GPA_COMBO_KEYS = 표기표(synonyms.gpaCombos);
const GPA_SUBJECT_KEYS = 표기표(synonyms.gpaSubjects);
const SUNEUNG_AREA_KEYS = 표기표(synonyms.suneungAreas);

/** 헤더 블록이 차지할 수 있는 줄 수. 셋을 넘는 양식은 아직 본 적이 없다. */
export const MAX_HEADER_ROWS = 3;

/** 머리글이 맨 위에 없을 수도 있다. 제목 줄·안내 줄이 앞에 붙는 양식이 있다. */
export const MAX_HEADER_START = 5;

/**
 * 라벨을 견주기 좋게 정리한다.
 *
 * 두 가지를 돌려주는 이유가 있다. `전형명(대)`는 괄호를 통째로 걷어내야 `전형명`과
 * 만나는데, `전교과(2/4/4)`는 괄호 안이 **뜻을 나르는 값**이라 걷어내면 네 열이 한 열이 된다.
 *
 * @param {string} text
 * @returns {{tight: string, base: string}} tight은 괄호 글자만 지운 것, base는 괄호 묶음을 걷어낸 것
 */
export function normalizeLabel(text) {
  const flat = String(text ?? '')
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toLowerCase();
  const tight = flat.replace(/[()[\]{}]/g, '');
  const stripped = flat.replace(/[([{][^)\]}]*[)\]}]/g, '');
  return { tight, base: stripped === '' ? tight : stripped };
}

/**
 * 라벨 하나와 논리 필드 하나가 얼마나 맞는지.
 *
 * @param {{tight: string, base: string}} label
 * @param {{exact?: string[], affix?: string[], partial?: string[]}} rule
 * @returns {number} 0이면 안 맞는 것
 */
export function scoreLabel(label, rule) {
  const forms = [label.base, label.tight];
  const norm = (text) => normalizeLabel(text).tight;

  for (const word of rule.exact ?? []) {
    if (forms.includes(norm(word))) return SCORES.exact;
  }
  for (const word of rule.affix ?? []) {
    const target = norm(word);
    if (!target) continue;
    if (forms.some((form) => form !== target && (form.startsWith(target) || form.endsWith(target)))) {
      return SCORES.affix;
    }
  }
  let best = 0;
  for (const word of rule.partial ?? []) {
    const target = norm(word);
    if (!target) continue;
    for (const form of forms) {
      if (!form.includes(target)) continue;
      // 긴 라벨이 짧은 말을 품고 있는 것은 약한 근거다 — `최종발표일`이 `최종`을 품는다
      best = Math.max(best, Math.round(SCORES.partialMax * (target.length / form.length)));
    }
  }
  return best;
}

// ── 구역 판정 ────────────────────────────────────────────────────────────────

const GPA_ANCHORS = anchors.gpa.anchors.map((word) => normalizeLabel(word).tight);
const GPA_SUBJECTS = anchors.gpa.subjects.map((word) => normalizeLabel(word).tight);
const SUNEUNG_ANCHORS = anchors.suneung.anchors.map((word) => normalizeLabel(word).tight);
const PART_BY_LABEL = new Map(
  Object.entries(anchors.suneung.parts).map(([word, part]) => [normalizeLabel(word).tight, part])
);

/**
 * 이 열 이름이 사전에 있는 논리 필드를 가리키는지.
 * 내신 구역의 오른쪽 끝을 정하는 데 쓴다.
 *
 * @param {import('./headerBlock.js').HeaderLabel} label
 */
export function namesAScalar(label) {
  const normalized = normalizeLabel(label.label);
  if (normalized.tight === '') return false;
  return synonyms.scalars.some((rule) => scoreLabel(normalized, rule) >= SCORES.threshold);
}

/**
 * 열들을 세 구역으로 구분한다.
 *
 * 수능 구역을 먼저 찾고, 그다음 내신 구역을 찾는다. 수능이 뒤쪽에 있어서
 * 내신 구역의 오른쪽 끝을 수능의 시작이 정해 주기 때문이다.
 *
 * @param {import('./headerBlock.js').HeaderLabel[]} labels
 * @returns {{gpa: {start: number, end: number}|null, suneung: {start: number, end: number}|null}}
 */
export function findSections(labels) {
  const tops = labels.map((label) => normalizeLabel(label.top));
  const subs = labels.map((label) => normalizeLabel(label.sub));

  // 수능: 한국사가 표지다. 없으면 항목 이름(과목·표점·백분위)이 처음 나오는 자리를 쓴다
  let suneungStart = tops.findIndex((top) => SUNEUNG_ANCHORS.includes(top.tight));
  if (suneungStart === -1) {
    suneungStart = subs.findIndex((sub) => {
      const part = PART_BY_LABEL.get(sub.tight);
      return part === 'subject' || part === 'stdScore' || part === 'percentile';
    });
  }

  // 내신: 조합 표지(전교과·전과목)에서 시작해, 왼쪽으로 과목 이름이 이어지는 만큼 넓힌다
  const anchorAt = tops.findIndex((top, index) =>
    GPA_ANCHORS.includes(top.base) && (suneungStart === -1 || index < suneungStart));

  let gpa = null;
  if (anchorAt !== -1) {
    let start = anchorAt;
    while (start > 0 && GPA_SUBJECTS.includes(tops[start - 1].base)) start -= 1;

    /*
     * 오른쪽 끝은 수능 구역이 정해 준다. **다만 수능 구역이 없는 양식이 있다** —
     * 등급만 싣고 한국사를 안 싣는 양식이 그렇다. 그때 내신 구역을 줄 끝까지 두면
     * `1단계`·`최종`까지 내신으로 삼키고, 값 검증이 뒤늦게 취소해 주는 대신
     * 그 열들이 통째로 미해결로 남는다.
     *
     * 그래서 사전에 이름이 있는 열을 만나면 거기서 끊는다. 내신 조합 이름은
     * 자유 문자열이지만, 사전에 있는 이름과 겹치는 일은 없다.
     */
    let end = suneungStart === -1 ? labels.length : suneungStart;
    for (let index = anchorAt + 1; index < end; index += 1) {
      if (namesAScalar(labels[index])) { end = index; break; }
    }
    gpa = { start, end };
  }

  /*
   * 수능 구역의 오른쪽 끝도 **사전에 있는 이름을 만나면 끊는다.**
   *
   * 줄 끝까지 두었더니 수능 블록 뒤에 오는 `최종`·`등록여부`·`예비순위`가 통째로
   * 수능 구역에 삼켜졌다. 예비순위는 값이 1~9라 교차검증도 못 잡아
   * `suneung.예비순위.grade`라는 가짜 영역이 조용히 생기고, 최종·등록은 미해결로
   * 떨어져 **합격 결과가 집계에서 사라진다.** 내신 구역에 둔 보호를 여기에도 둔다.
   */
  let suneungEnd = labels.length;
  if (suneungStart !== -1) {
    for (let index = suneungStart + 1; index < labels.length; index += 1) {
      if (namesAScalar(labels[index])) { suneungEnd = index; break; }
    }
  }

  return {
    gpa,
    suneung: suneungStart === -1 ? null : { start: suneungStart, end: suneungEnd }
  };
}

/**
 * 머리글 두 칸을 한 이름으로 읽는다 — `sub`가 있으면 `top(sub)`, 없으면 `top`.
 *
 * **정규화가 아니다.** 글자를 바꾸지 않고 두 줄짜리 머리글을 한 이름으로 읽을 뿐이고,
 * 사전이 그 이름을 그대로 받는다. 그래서 두 머리글 모양이 같은 키를 낸다.
 *
 *   두 줄: top=전교과         sub=2/4/4  →  전교과(2/4/4)
 *   한 줄: top=전교과(2/4/4)  sub=''     →  전교과(2/4/4)
 */
function headerName(label) {
  const top = String(label.top ?? '').trim();
  if (top === '') return '';
  const sub = String(label.sub ?? '').trim();
  return sub === '' ? top : `${top}(${sub})`;
}

/** 표기 하나를 사전에서 찾는다. 사전을 거치지 않는 길은 두지 않는다 */
function lookup(table, name) {
  return table.get(normalizeLabel(name).tight) ?? null;
}

/**
 * 내신 구역의 열 하나에서 논리 키를 만든다.
 *
 * **반영비를 읽는 규칙을 두지 않는다. 사전이 열거한다.**
 * 우리는 이 양식들의 열이 무엇인지 알고 있으므로 해석할 이유가 없고, 규칙을 두면
 * 그 규칙의 예외를 찾는 일이 시작된다 — 숫자를 뽑다 `(5등급)`에서 없는 반영비를
 * 지어내고, 전체 반영을 가리다 빈칸 열을 떨어뜨리는 식이다. 사전에 없는 이름은
 * 키가 되지 않고 미해결로 남아 사람에게 묻는다(§5).
 *
 * **조합 맞추기에 `base`(괄호를 걷어낸 것)를 쓰지 않는다.** `전교과(2/4/4)`의 `base`는
 * `전교과`라서, 걷어내면 네 열이 한 열이 되고 가중평균 열이 전과목 평균으로 이름
 * 붙는다. 괄호 안은 뜻을 나르는 값이다. 다만 **구역 판정의 앵커 비교는 `base`를
 * 계속 쓴다** — 그쪽에서는 `전교과(2/4/4)`가 내신 구역을 열어 주어야 한다.
 */
export function gpaKeyOf(label) {
  const name = headerName(label);
  if (name === '') return null;
  const key = lookup(GPA_SUBJECT_KEYS, name) ?? lookup(GPA_COMBO_KEYS, name);
  return key === null ? null : `gpa.${key}`;
}

/** 수능 구역의 열 하나에서 논리 키를 만든다. 영역 이름도 사전을 거친다 */
export function suneungKeyOf(label) {
  const area = lookup(SUNEUNG_AREA_KEYS, String(label.top ?? '').trim());
  if (area === null) return null;
  // 항목 이름이 없으면 등급만 있는 양식이다 (센진학)
  const part = PART_BY_LABEL.get(normalizeLabel(label.sub).tight) ?? 'grade';
  return `suneung.${area}.${part}`;
}

// ── 값으로 교차검증 ──────────────────────────────────────────────────────────

/**
 * 논리 필드마다 값이 어느 범위에 있어야 하는지.
 *
 * 이름이 맞아 보여도 값이 전혀 다른 범위면 잘못 배정한 것이다.
 * **배정을 지우고 비워 둔다** — 조용히 틀린 값이 이 시스템에서 가장 위험하다(§5).
 */
const VALUE_RANGE = {
  gpa: { min: 1, max: 9, label: '내신 1.00~9.00' },
  'suneung.percentile': { min: 0, max: 100, label: '백분위 0~100' },
  'suneung.stdScore': { min: 0, max: 200, label: '표준점수 0~200' },
  'suneung.grade': { min: 1, max: 9, label: '수능 등급 1~9' },
  quota: { min: 0, max: 100000, label: '모집인원' },
  sourceYear: { min: 1990, max: 2100, label: '연도 네 자리' }
};

/** @param {string} key */
function rangeFor(key) {
  if (key.startsWith('gpa.')) return VALUE_RANGE.gpa;
  if (key.startsWith('suneung.')) {
    const part = key.split('.')[2];
    return VALUE_RANGE[`suneung.${part}`] ?? null;
  }
  return VALUE_RANGE[key] ?? null;
}

/** 값이 범위에 드는 비율. 값이 아예 없으면 null — 검증할 거리가 없다는 뜻이다. */
export function fitRatio(values, range) {
  let seen = 0;
  let inside = 0;
  for (const raw of values) {
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    seen += 1;
    const value = Number(String(raw).replace(/,/g, ''));
    if (Number.isFinite(value) && value >= range.min && value <= range.max) inside += 1;
  }
  return seen === 0 ? null : inside / seen;
}

/** 이보다 적게 맞으면 잘못 배정한 것으로 본다. */
const FIT_FLOOR = 0.6;

// ── 해석 ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Resolution
 * @property {number} headerStart 헤더가 시작하는 행
 * @property {number} headerRows 헤더 줄 수
 * @property {Record<string, number>} columns 논리 키 → 열 번호
 * @property {{index: number, label: string, reason: string}[]} unresolved 해석하지 못한 열
 * @property {string[]} notes 사람이 읽을 설명
 * @property {import('./headerBlock.js').HeaderLabel[]} labels
 */

/**
 * 헤더 블록이 정해졌다는 전제에서 열을 해석한다.
 *
 * @param {unknown[][]} grid 헤더가 첫 줄에 오도록 이미 잘라 둔 격자
 * @param {number} headerRows
 * @param {number} [sampleRows] 값 검증에 쓸 행 수
 * @returns {Resolution}
 */
export function resolveColumns(grid, headerRows = 1, sampleRows = 200) {
  const labels = buildHeaderLabels(grid, headerRows);
  const body = bodyRows(grid, headerRows).slice(0, sampleRows);
  const sections = findSections(labels);
  const notes = [];

  /** @type {Map<number, string>} 열 번호 → 논리 키 */
  const taken = new Map();
  /** @type {Map<string, number>} 논리 키 → 열 번호 */
  const columns = new Map();
  /** @type {Map<number, string>} 해석하지 못한 이유 */
  const why = new Map();

  const claim = (index, key) => {
    if (taken.has(index) || columns.has(key)) return false;
    taken.set(index, key);
    columns.set(key, index);
    return true;
  };

  const inSection = (index, section) => section !== null && index >= section.start && index < section.end;

  // 1. 구역이 정해진 열부터 집는다. 이름 매칭이 `국어`를 가로채기 전에 끝내야 한다
  for (let index = 0; index < labels.length; index += 1) {
    const key = inSection(index, sections.gpa) ? gpaKeyOf(labels[index])
      : inSection(index, sections.suneung) ? suneungKeyOf(labels[index])
        : null;
    if (key === null) continue;
    if (!isKnownFieldKey(key)) { why.set(index, `만들 수 없는 필드 이름입니다: ${key}`); continue; }
    if (!claim(index, key)) why.set(index, `${key}는 앞선 열이 이미 차지했습니다`);
  }

  // 2. 나머지는 이름으로 경쟁한다. 점수가 높은 짝부터 확정하고, 한 열에 한 필드만 준다
  const bids = [];
  for (let index = 0; index < labels.length; index += 1) {
    if (taken.has(index)) continue;
    if (inSection(index, sections.gpa) || inSection(index, sections.suneung)) continue;
    const label = normalizeLabel(labels[index].label);
    if (label.tight === '') continue;
    for (const rule of synonyms.scalars) {
      const score = scoreLabel(label, rule);
      if (score >= SCORES.threshold) bids.push({ index, key: rule.key, score });
    }
  }
  // 점수 내림차순, 같으면 왼쪽 열이 이긴다 — 병합셀 때문에 같은 이름이 연달아 나온다
  bids.sort((left, right) => right.score - left.score || left.index - right.index);
  for (const bid of bids) claim(bid.index, bid.key);

  // 3. 값으로 교차검증한다. 이름이 맞아 보여도 값이 딴 세상이면 지운다
  for (const [key, index] of [...columns]) {
    const range = rangeFor(key);
    if (!range) continue;
    const ratio = fitRatio(body.map((row) => row?.[index]), range);
    if (ratio === null || ratio >= FIT_FLOOR) continue;
    columns.delete(key);
    taken.delete(index);
    /*
     * 사람이 읽는 문장에 내부 키(`suneung.국어.grade`)를 적지 않는다. 읽는 쪽에는
     * 뜻도 통하지 않고, 「비고를 수능 등급으로 보려 했다」처럼 엉뚱하게 들린다.
     */
    why.set(index, `${labels[index].label}의 값이 ${range.label} 범위에 맞지 않아 그 자리로 보지 않았습니다`);
    /*
     * **보관 여부는 여기서 말하지 않는다.**
     *
     * 「원본 그대로 두었습니다」는 식별 열에도 똑같이 붙어, 같은 카드에서
     * 「학부모 연락처는 보관하지 않습니다」와 나란히 떴다. 전화번호가 보관됐다는
     * 뜻으로 읽을 글이다 — §1이 걸린 자리라 값이 틀린 것보다 나쁘다. 보관 여부는
     * 미해결 안내 한 곳에서만 말한다.
     */
    notes.push(`${labels[index].label} 열은 값이 ${range.label} 범위 밖이라 그 자리로 보지 않았습니다.`);
  }

  // 4. `학년` 열에 학년(3)이 아니라 연도(2026)가 들어 있는 양식이 있다 (§3의 함정).
  //    이름으로는 구분되지 않으므로 값으로 판별해 승격시킨다
  const schoolYearAt = columns.get('schoolYear');
  if (schoolYearAt !== undefined && !columns.has('sourceYear')) {
    const asYear = fitRatio(body.map((row) => row?.[schoolYearAt]), VALUE_RANGE.sourceYear);
    if (asYear !== null && asYear >= 0.9) {
      columns.delete('schoolYear');
      columns.set('sourceYear', schoolYearAt);
      taken.set(schoolYearAt, 'sourceYear');
      notes.push(`'${labels[schoolYearAt].label}' 열에 학년이 아니라 연도가 들어 있어 연도 열로 보았습니다. 고3 실제 연도인지 학년도인지 확인해 주세요.`);
    }
  }

  const unresolved = [];
  for (let index = 0; index < labels.length; index += 1) {
    if (taken.has(index)) continue;
    const label = labels[index].label;
    if (!label) continue;
    unresolved.push({ index, label, reason: why.get(index) ?? '사전에 없는 이름입니다' });
  }

  return {
    headerStart: 0,
    headerRows,
    columns: Object.fromEntries(columns),
    unresolved,
    notes,
    labels
  };
}

/**
 * 헤더가 몇 번째 줄에서 몇 줄인지까지 알아내 해석한다.
 *
 * 줄 수를 눈으로 정하는 규칙을 쌓는 대신 **해 보고 가장 잘 풀린 것을 남긴다.**
 * 규칙은 양식 하나를 볼 때마다 늘어나지만, 결과를 견주는 것은 양식이 몇이든 같다.
 *
 * @param {unknown[][]} grid
 * @param {{sampleRows?: number}} [options]
 * @returns {Resolution}
 */
export function resolveSheet(grid, { sampleRows = 200 } = {}) {
  const rows = grid ?? [];
  const isEmptyRow = (row) => !(row ?? []).some((cell) => String(cell ?? '').trim() !== '');

  let best = null;
  for (let start = 0; start <= Math.min(MAX_HEADER_START, Math.max(0, rows.length - 1)); start += 1) {
    if (isEmptyRow(rows[start])) continue;
    for (let headerRows = 1; headerRows <= MAX_HEADER_ROWS; headerRows += 1) {
      if (start + headerRows >= rows.length) break;
      const attempt = resolveColumns(rows.slice(start), headerRows, sampleRows);
      attempt.headerStart = start;
      // 많이 해석한 쪽이 이기고, 같으면 머리줄이 짧은 쪽·위쪽에서 시작한 쪽이 이긴다
      const size = Object.keys(attempt.columns).length;
      const bestSize = best ? Object.keys(best.columns).length : -1;
      if (size > bestSize
        || (size === bestSize && best && (headerRows < best.headerRows || start < best.headerStart))) {
        best = attempt;
      }
    }
  }

  return best ?? resolveColumns(rows, 1, sampleRows);
}
