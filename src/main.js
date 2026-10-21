/**
 * 화면 전체를 엮는 곳.
 *
 * 흐름은 §1 그대로다.
 *
 *   엑셀 여러 개 또는 zip 하나 → 확인(고3 년도 확정) → IndexedDB → 표
 *
 * 상태를 한 곳에 모아 두고, 무엇이 바뀌든 `refresh()` 한 번으로 다시 그린다.
 * 자료가 1만 행 내외라 이 단순함이 성능 기준(재계산 100ms) 안에 들어온다(§6).
 */

import { prepareUploads, commitSheets } from './ingest/pipeline.js';
import { ProfileSet } from './ingest/profile.js';
import { bundledProfiles } from './dict/header-profiles/index.js';
import {
  openDatabase, loadDataset, saveDataset, clearAll, removeFile,
  loadProfiles, listFiles, requestPersistence, storageEstimate
} from './store/db.js';

import { buildRows } from './analysis/rows.js';
import { buildRegistry, defaultColumns, fieldLabel } from './analysis/registry.js';
import { applyQuery, describeFilter } from './analysis/query.js';
import { unknownOutcomeTerms } from './core/outcome.js';

import { pick, el, clear, debounce } from './ui/dom.js';
import { createTable } from './ui/table.js';
import { createFilters } from './ui/filters.js';
import { readFiles, confirmUploads, bindDropzone } from './ui/upload.js';
import { openStudent } from './ui/student.js';
import { openFiles, openColumns } from './ui/panels.js';
import { loadView, saveView, forgetView, pruneView, emptyView } from './ui/prefs.js';

const CURRENT_YEAR = new Date().getFullYear();

const dom = {
  요약: pick('#요약'),
  요약띠: pick('#요약띠'),
  시작화면: pick('#시작화면'),
  본화면: pick('#본화면'),
  필터판: pick('#필터판'),
  필터막: pick('#필터막'),
  검색: /** @type {HTMLInputElement} */ (pick('#검색')),
  칩줄: pick('#칩줄'),
  고정수: pick('#고정수'),
  열팝오버: pick('#열팝오버'),
  알림줄: pick('#알림줄'),
  표: pick('#표'),
  표없음: pick('#표없음'),
  진행: pick('#진행'),
  파일입력: /** @type {HTMLInputElement} */ (pick('#파일입력')),
  확인상자: /** @type {HTMLDialogElement} */ (pick('#확인상자')),
  파일상자: /** @type {HTMLDialogElement} */ (pick('#파일상자')),
  열상자: /** @type {HTMLDialogElement} */ (pick('#열상자')),
  학생상자: /** @type {HTMLDialogElement} */ (pick('#학생상자'))
};

/** @type {{db: IDBDatabase|null, dataset: object, rows: object[], registry: object[], view: object, search: string, warnings: object[]}} */
const state = {
  db: null,
  dataset: { students: [], applications: [], suneung: [], files: [] },
  rows: [],
  registry: [],
  view: emptyView(),
  search: '',
  warnings: []
};

function busy(on) {
  dom.진행.classList.toggle('hidden', !on);
  dom.진행.classList.toggle('grid', on);
}

// ── 표 ────────────────────────────────────────────────────────────────────────
const table = createTable({
  scroller: dom.표,
  colgroup: pick('#열너비'),
  headRow: pick('#헤더행'),
  searchRow: pick('#검색행'),
  body: pick('#본문행'),
  empty: dom.표없음,
  /** 머리줄 검색칸에 지금 무엇이 적혀 있는지. 다시 그려도 글자가 남아야 한다 */
  columnSearch: (key) => {
    const found = state.view.filters.find((filter) => filter.key === key && filter.op === 'contains');
    return found?.text ?? '';
  },
  onColumnFilter: (key, anchor) => 팝오버열기(key, anchor),
  onColumnSearch: (key, text) => {
    const rest = state.view.filters.filter(
      (filter) => !(filter.key === key && filter.op === 'contains'));
    const next = String(text ?? '').trim() === '' ? rest : [...rest, { key, op: 'contains', text }];
    state.view = { ...state.view, filters: next };
    saveView(state.view);
    refresh({ keepScroll: true });
  },
  onRowOpen: (row) => {
    // 지금 걸린 조건과 무관하게 그 학생의 **전체** 이력을 보여 준다.
    // 상담에서 알고 싶은 것은 "이 학생이 어디에 어떻게 지원했나" 전부다
    openStudent(dom.학생상자, {
      sid: row.sid,
      rows: state.rows.filter((item) => item.sid === row.sid)
    });
  },
  onStateChange: (next) => {
    state.view = { ...state.view, sorts: next.sorts, widths: next.widths, pinned: next.pinned, columns: next.columns };
    saveView(state.view);
    refresh({ keepScroll: true });
  }
});

// ── 필터 ──────────────────────────────────────────────────────────────────────
const filters = createFilters({
  mount: dom.필터판,
  read: () => ({
    rows: state.rows,
    registry: state.registry,
    filters: state.view.filters,
    search: state.search
  }),
  onChange: (next) => {
    state.view = { ...state.view, filters: next };
    saveView(state.view);
    refresh();
  },
  onClose: () => 필터판보이기(false)
});

// ── 다시 그리기 ───────────────────────────────────────────────────────────────

/**
 * 지금 보이는 지원 건을 판정별로 센다.
 *
 * 읽지 못한 표기(`unknown`)와 기록이 없는 건(`none`)을 합격에도 불합격에도 넣지 않는다.
 * 어느 한쪽에 밀어 넣으면 합격률이 조용히 틀리고, 틀린 티가 나지 않는다(§5).
 *
 * @param {object[]} rows
 */
export function tallyOutcomes(rows) {
  const tally = { 지원: rows.length, 합격: 0, 충원합격: 0, 불합격: 0, 미상: 0, 학생: 0 };
  const students = new Set();
  for (const row of rows) {
    if (row.sid) students.add(row.sid);
    const code = row['#outcome']?.code;
    if (code === 'pass') tally.합격 += 1;
    else if (code === 'waitPass') tally.충원합격 += 1;
    else if (code === 'fail') tally.불합격 += 1;
    else tally.미상 += 1;
  }
  tally.학생 = students.size;
  return tally;
}

/**
 * 합격률. 분모는 **판정을 읽어 낸 지원 건수**다.
 *
 * 전체 건수로 나누면 읽지 못한 표기가 많은 해일수록 합격률이 낮게 나오는데,
 * 그건 그 해 실적이 아니라 우리 사전의 구멍이다.
 *
 * @returns {number|null} 셀 수 있는 건이 하나도 없으면 null
 */
export function passRate(tally) {
  const judged = tally.합격 + tally.충원합격 + tally.불합격;
  return judged === 0 ? null : (tally.합격 + tally.충원합격) / judged;
}

/**
 * 요약 띠 (§7 · plan.md §6).
 *
 * **측정값의 정의를 늘 문장으로 함께 둔다.** 상담 중에 숫자의 근거를 설명하지
 * 못하면 그 숫자는 쓸 수 없다. "합격 12"가 건수인지 사람 수인지는 보는 사람마다 다르게 읽는다.
 */
/**
 * 판정 구성 막대.
 *
 * 숫자 일곱 개만으로는 서로의 비율이 눈에 들어오지 않는다. 띠 하나가 그걸 대신한다.
 *
 * **차트 라이브러리를 들이지 않는다.** 범주 넷짜리 띠 하나를 그리려고
 * 단일 HTML 배포에 수십 KB를 얹을 까닭이 없다 (§6). 분포를 칸마다 세어
 * 보여 줄 일이 생기면 그때 다시 판단한다.
 *
 * **색만으로 구분하지 않는다** (§9). 칸마다 모양을 함께 적고, 좁아서 글자가
 * 들어가지 않는 칸은 아래 범례가 받는다.
 */
function outcomeBar(tally) {
  if (tally.지원 === 0) return null;
  const parts = [
    { name: '합격', mark: '●', count: tally.합격, tone: 'bg-pass text-white' },
    { name: '충원합격', mark: '△', count: tally.충원합격, tone: 'bg-wait text-white' },
    { name: '불합격', mark: '✕', count: tally.불합격, tone: 'bg-fail text-white' },
    { name: '판정 미상', mark: '·', count: tally.미상, tone: 'bg-line text-ink' }
  ].filter((part) => part.count > 0);

  const 몫 = (count) => (count / tally.지원) * 100;

  /*
   * 칸 안에는 **비율만** 적는다. 이름까지 넣었더니 폭이 좁은 화면에서 글자가 잘렸다 —
   * 칸 너비는 비율이 정하는데 글자 길이는 이름이 정해서, 둘이 맞을 보장이 없다.
   * 이름은 아래 범례가 맡는다. 범례는 색·모양과 이름을 잇는 열쇠이기도 하다.
   */
  const 적을만한가 = (part) => 몫(part.count) >= 8;

  return el('div', { class: 'border-t border-line-soft px-4 py-3' }, [
    el('div', {
      class: 'flex h-6 w-full overflow-hidden rounded',
      attrs: { role: 'img', 'aria-label': parts.map((part) => `${part.name} ${part.count}건`).join(', ') }
    }, parts.map((part) => el('div', {
      class: `${part.tone} flex items-center justify-center overflow-hidden whitespace-nowrap text-base font-semibold`,
      // 칸 너비는 자료에서 나온다. 클래스로는 적을 수 없는 값이다 (§9의 예외)
      style: { width: `${몫(part.count).toFixed(2)}%` },
      attrs: { title: `${part.name} ${part.count}건 (${몫(part.count).toFixed(1)}%)` },
      text: 적을만한가(part) ? `${part.mark} ${몫(part.count).toFixed(1)}%` : ''
    }))),
    el('ul', {
      class: 'mt-2 flex flex-wrap gap-x-4 gap-y-1 text-base text-ink-soft'
    }, parts.map((part) => el('li', {
      text: `${part.mark} ${part.name} ${몫(part.count).toFixed(1)}%`
    })))
  ]);
}

function paintSummary(visible, total) {
  const tally = tallyOutcomes(visible);
  const rate = passRate(tally);
  const 걸러짐 = visible.length !== total;

  const cell = (name, value, tone = '') => el('div', { class: `stat ${tone}` }, [
    el('p', { class: 'stat-name', text: name }),
    el('p', { class: 'stat-value', text: value })
  ]);

  clear(dom.요약띠).append(el('div', { class: 'card overflow-hidden' }, [
    el('div', { class: 'flex flex-wrap divide-x divide-line' }, [
      cell(걸러짐 ? `지원 (전체 ${total})` : '지원', tally.지원),
      cell('학생', tally.학생),
      cell('합격', tally.합격, 'text-pass'),
      cell('충원합격', tally.충원합격, 'text-wait'),
      cell('불합격', tally.불합격, 'text-fail'),
      cell('합격률', rate === null ? '—' : `${(rate * 100).toFixed(1)}%`),
      tally.미상 > 0 ? cell('판정 미상', tally.미상, 'text-ink-soft') : null
    ].filter(Boolean)),
    outcomeBar(tally),
    el('p', {
      class: 'border-t border-line-soft bg-canvas px-4 py-1.5 text-base text-ink-soft',
      text: tally.미상 > 0
        ? '합격률 = (합격 + 충원합격) ÷ 판정을 읽어 낸 지원 건수. 판정 미상 건은 분모에서 빠집니다.'
        : '합격률 = (합격 + 충원합격) ÷ 지원 건수. 사람 수가 아니라 지원 건수 기준입니다.'
    })
  ]));
}

/**
 * 칩 줄 — 지금 걸려 있는 **정렬과 필터**를 한 줄에 늘어놓는다 (§7, 참고 UI).
 *
 * 정렬을 먼저 둔다. 표가 왜 이 차례로 보이는지를 먼저 파악해야 하고,
 * 그다음이 무엇을 걸러 냈는지다. 둘 다 칩 하나씩 눌러 뗄 수 있다.
 */
function paintChips() {
  clear(dom.칩줄);

  state.view.sorts.forEach((sort, rank) => {
    dom.칩줄.append(el('span', {
      class: 'chip border-pass/30 bg-pass-soft text-pass'
    }, [
      el('span', {
        class: 'rounded bg-pass px-1.5 text-base font-bold text-white',
        text: String(rank + 1)
      }),
      el('span', { text: `${fieldLabel(sort.key)} ${sort.dir === 'asc' ? '▲' : '▼'}` }),
      el('button', {
        class: 'text-pass/70',
        text: '✕',
        attrs: { type: 'button', 'aria-label': `${fieldLabel(sort.key)} 정렬 해제` },
        on: {
          click: () => updateView({
            sorts: state.view.sorts.filter((item) => item.key !== sort.key)
          })
        }
      })
    ]));
  });

  if (state.view.filters.length === 0) return;

  for (const filter of state.view.filters) {
    dom.칩줄.append(el('span', { class: 'chip' }, [
      el('span', { text: describeFilter(filter, fieldLabel(filter.key)) }),
      el('button', {
        class: 'text-brand/70 hover:text-brand',
        text: '✕',
        attrs: { type: 'button', 'aria-label': `${fieldLabel(filter.key)} 필터 해제` },
        on: {
          click: () => {
            state.view = { ...state.view, filters: state.view.filters.filter((item) => item !== filter) };
            saveView(state.view);
            refresh();
          }
        }
      })
    ]));
  }
}

/** 사람이 점검해야 할 것을 알린다. 조용히 넘어가면 틀린 자료가 그대로 상담에 쓰인다. */
function paintNotices() {
  clear(dom.알림줄);
  const notices = [];

  for (const warning of state.warnings) {
    notices.push({ tone: warning.type === 'identity-column-dropped' ? 'info' : 'warn', text: warning.message });
  }

  const unknown = unknownOutcomeTerms(state.dataset.applications ?? []);
  if (unknown.length > 0) {
    notices.push({
      tone: 'warn',
      text: `읽지 못한 결과 표기가 있습니다 — ${unknown.slice(0, 4).map((item) => `${item.field} '${item.value}' ${item.count}건`).join(', ')}. 합격으로도 불합격으로도 세지 않았습니다.`
    });
  }

  for (const notice of notices) {
    dom.알림줄.append(el('p', {
      class: `rounded-xl px-4 py-2 text-base ${notice.tone === 'warn' ? 'bg-wait-soft text-wait' : 'bg-canvas text-ink-soft'}`,
      text: notice.text
    }));
  }
}

// ── 열별 값 목록 (참고 UI) ───────────────────────────────────────────────────

/** 지금 값 목록이 떠 있는 열. 없으면 null. */
let 열린열 = null;

function 팝오버닫기() {
  if (열린열 === null) return;
  열린열 = null;
  dom.열팝오버.classList.add('hidden');
  clear(dom.열팝오버);
  table.markOpenFilter(null);
}

/** 내용만 다시 그린다. 자리는 그대로 둔다 — 값을 선택할 때마다 창이 뛰면 다음 값을 누를 수 없다. */
function 팝오버그리기() {
  if (열린열 === null) return;
  const field = state.registry.find((item) => item.key === 열린열);
  const body = filters.blockFor(열린열, 팝오버그리기);
  clear(dom.열팝오버).append(
    el('div', { class: 'flex items-center gap-2 border-b border-line px-3 py-2' }, [
      el('h3', {
        class: 'min-w-0 flex-1 truncate text-base font-semibold',
        text: field?.label ?? 열린열,
        attrs: { title: field?.label ?? 열린열 }
      }),
      el('button', {
        class: 'btn btn-sm px-2', text: '닫기',
        attrs: { type: 'button' }, on: { click: 팝오버닫기 }
      })
    ]),
    el('div', { class: 'max-h-80 overflow-y-auto px-3 py-2' }, [body].filter(Boolean))
  );
}

/**
 * 깔때기 단추가 가리키는 열의 값 목록을 연다.
 *
 * 자리는 자바스크립트가 잴 수밖에 없다 — 단추가 표와 함께 가로로 움직이므로
 * 클래스로는 적을 수 없는 값이다(§9의 예외와 같은 까닭).
 */
function 팝오버열기(key, anchor) {
  if (열린열 === key) { 팝오버닫기(); return; }
  // **자리를 먼저 잰다.** markOpenFilter 가 머리줄을 다시 그리면서 이 단추를 갈아 끼우는데,
  // 떨어져 나간 요소는 자리를 0으로 보고한다 — 그러면 창이 화면 왼쪽 위에 가서 붙는다
  const box = anchor.getBoundingClientRect();

  열린열 = key;
  dom.열팝오버.classList.remove('hidden');
  팝오버그리기();
  table.markOpenFilter(key);
  const 폭 = dom.열팝오버.offsetWidth;
  const 높이 = dom.열팝오버.offsetHeight;
  // 화면 밖으로 나가지 않게 가둔다. 오른쪽 끝 열에서 특히 자주 넘친다
  const left = Math.max(8, Math.min(box.left, globalThis.innerWidth - 폭 - 8));
  const 아래 = box.bottom + 4;
  const top = 아래 + 높이 > globalThis.innerHeight - 8 ? Math.max(8, box.top - 높이 - 4) : 아래;
  dom.열팝오버.style.left = `${left}px`;
  dom.열팝오버.style.top = `${top}px`;
}

// 바깥을 누르면 닫는다. 깔때기 단추 자신은 스스로 토글하므로 여기서 빼낸다
document.addEventListener('click', (event) => {
  if (열린열 === null) return;
  if (dom.열팝오버.contains(event.target)) return;
  팝오버닫기();
});

// 표를 움직이면 단추가 제자리를 떠난다. 따라다니게 만들기보다 닫는 편이 솔직하다
dom.표.addEventListener('scroll', 팝오버닫기, { passive: true });

/** 고정할 수 있는 열 수의 상한. 여섯을 넘기면 가로로 볼 것이 남지 않는다. */
const MAX_PINNED = 6;

/**
 * 툴바의 상태를 맞춘다 (#3).
 *
 * **쓸 수 없는 단추도 자리를 지킨다**(D15). 값에 따라 단추가 생겼다 사라지면
 * 그 줄의 높이가 바뀌고, 그때마다 표가 위아래로 들썩인다.
 */
function paintToolbar() {
  const pinned = Math.min(state.view.pinned, state.view.columns.length, MAX_PINNED);
  dom.고정수.textContent = String(pinned);

  const disable = (selector, off) => {
    const node = pick(selector);
    node.disabled = off;
    node.setAttribute('aria-disabled', String(off));
  };
  disable('#고정줄이기', pinned <= 0);
  disable('#고정늘리기', pinned >= Math.min(MAX_PINNED, state.view.columns.length));
  disable('#정렬초기화', state.view.sorts.length === 0);
  disable('#필터초기화', state.view.filters.length === 0);
  disable('#열초기화', false);
}

/** 보존할 것만 남기고 화면 상태를 바꾼다. */
function updateView(patch) {
  state.view = { ...state.view, ...patch };
  saveView(state.view);
  refresh({ keepScroll: true });
}

/**
 * 필터 패널의 표시를 전환한다 (#1).
 *
 * 기본값은 화면 폭이 정한다. 사람이 한 번이라도 전환하면 그 선택이 `body`의 클래스로
 * 올라와 기본값을 덮고, 그 뒤로는 화면 폭이 바뀌어도 사람의 선택이 이긴다.
 */
function 필터판보이기(on, { 기억 = true } = {}) {
  document.body.classList.toggle('filters-on', on);
  document.body.classList.toggle('filters-off', !on);
  // 막은 좁은 화면에서만 뜻이 있다. 넓은 화면에서는 패널이 표를 덮지 않는다
  dom.필터막.classList.toggle('hidden', !on);
  const 토글 = pick('#필터토글');
  토글.setAttribute('aria-expanded', String(on));
  토글.setAttribute('aria-label', on ? '필터 패널 숨기기' : '필터 패널 표시');
  // 접혀 있다는 것을 단추 자신이 보여 준다. 글자가 ☰ 하나뿐이라 색으로 구분한다
  토글.classList.toggle('btn-primary', !on);
  // 좁은 화면이라 닫아 둔 것은 사람의 선택이 아니다. 적어 두면 넓은 화면의 선택을 덮는다
  if (기억 && state.view.filtersOpen !== on) updateView({ filtersOpen: on });
}

/** 지금 패널이 떠 있는가. 클래스가 없으면 화면 폭이 정한 기본값을 본다. */
function 필터판열림() {
  if (document.body.classList.contains('filters-on')) return true;
  if (document.body.classList.contains('filters-off')) return false;
  return globalThis.matchMedia?.('(min-width: 64rem)').matches ?? false;
}

function refresh({ keepScroll = false } = {}) {
  const hasData = state.rows.length > 0;
  dom.시작화면.classList.toggle('hidden', hasData);
  dom.본화면.classList.toggle('hidden', !hasData);

  const students = new Set(state.dataset.students?.map((student) => student.sid)).size;
  dom.요약.textContent = hasData
    ? `파일 ${state.dataset.files?.length ?? 0}개 · 학생 ${students}명 · 지원 ${state.rows.length}건`
    : '';

  if (!hasData) { clear(dom.칩줄); clear(dom.알림줄); clear(dom.요약띠); return; }

  const visible = applyQuery(state.rows, {
    filters: state.view.filters,
    search: state.search,
    sorts: state.view.sorts
  });

  dom.표없음.textContent = '걸려 있는 필터에 맞는 지원 기록이 없습니다. 위 칩에서 필터를 하나씩 떼어 보세요.';

  paintToolbar();
  팝오버그리기();
  paintSummary(visible, state.rows.length);
  paintChips();
  paintNotices();
  filters.render();

  if (keepScroll) {
    const top = dom.표.scrollTop;
    table.render({ rows: visible, registry: state.registry, state: viewForTable() });
    dom.표.scrollTop = top;
  } else {
    table.render({ rows: visible, registry: state.registry, state: viewForTable() });
  }
}

/** 표가 직접 만지는 상태 조각. 같은 객체를 넘겨야 리사이즈가 반영된다. */
function viewForTable() {
  return {
    columns: state.view.columns,
    widths: state.view.widths,
    pinned: state.view.pinned,
    sorts: state.view.sorts
  };
}

// ── 자료 읽어 오기 ────────────────────────────────────────────────────────────

async function reload() {
  state.dataset = await loadDataset(state.db);
  state.rows = buildRows(state.dataset);
  state.registry = buildRegistry(state.rows);

  state.view = pruneView(state.view, state.registry);
  if (state.view.columns.length === 0) {
    state.view.columns = defaultColumns(state.registry);
  }
  saveView(state.view);
  refresh();
}

// ── 불러오기 ──────────────────────────────────────────────────────────────────

async function handleFiles(files) {
  if (files.length === 0) return;
  busy(true);
  try {
    const uploads = await readFiles(files);
    const profiles = new ProfileSet([...bundledProfiles, ...await loadProfiles(state.db)]);
    const prepared = await prepareUploads(uploads, {
      profiles,
      existingFiles: await listFiles(state.db),
      currentYear: CURRENT_YEAR
    });

    busy(false);
    const decisions = await confirmUploads(dom.확인상자, prepared, CURRENT_YEAR);
    if (!decisions) return;

    busy(true);
    const dataset = await commitSheets(prepared.sheets, {
      decisions,
      existingStudents: state.dataset.students ?? []
    });
    await saveDataset(state.db, dataset);
    state.warnings = dataset.warnings ?? [];
    await reload();
    // 자료를 처음 넣었으면 브라우저에 함부로 비우지 말라고 청한다
    if ((state.dataset.files ?? []).length > 0) requestPersistence();
  } catch (error) {
    console.error(error);
    alert(`불러오지 못했습니다.\n\n${error?.message ?? error}`);
  } finally {
    busy(false);
  }
}

// ── 단추 엮기 ─────────────────────────────────────────────────────────────────

bindDropzone({
  zone: pick('#투하영역'),
  input: dom.파일입력,
  triggers: [pick('#파일선택')],
  onFiles: handleFiles
});

dom.검색.addEventListener('input', debounce((event) => {
  state.search = event.target.value;
  refresh();
}, 180));

pick('#필터토글').addEventListener('click', () => 필터판보이기(!필터판열림()));

// 뒤를 덮은 막을 누르면 닫는다. 덮개를 눌러 닫는 것은 사람이 먼저 해 보는 동작이다
dom.필터막.addEventListener('click', () => 필터판보이기(false));

// Esc로도 닫는다. 대화상자가 열려 있으면 그쪽이 먼저 받는다
globalThis.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (열린열 !== null) { 팝오버닫기(); return; }
  if (dom.필터막.classList.contains('hidden')) return;
  필터판보이기(false);
});

// ── 툴바 (#3) ────────────────────────────────────────────────────────────────

const 고정조정 = (step) => updateView({
  pinned: Math.max(0, Math.min(MAX_PINNED, state.view.columns.length, state.view.pinned + step))
});
pick('#고정줄이기').addEventListener('click', () => 고정조정(-1));
pick('#고정늘리기').addEventListener('click', () => 고정조정(1));

pick('#정렬초기화').addEventListener('click', () => updateView({ sorts: [] }));
pick('#필터초기화').addEventListener('click', () => updateView({ filters: [] }));

// 열 구성·차례·너비를 한꺼번에 되돌린다. 하나씩 되돌리게 하면 아무도 안 쓴다
pick('#열초기화').addEventListener('click', () => {
  const base = emptyView();
  updateView({ columns: defaultColumns(state.registry), widths: {}, pinned: base.pinned });
});

pick('#인쇄').addEventListener('click', () => globalThis.print());

pick('#열선택').addEventListener('click', () => {
  openColumns(dom.열상자, {
    registry: state.registry,
    columns: state.view.columns,
    pinned: state.view.pinned,
    onApply: ({ columns, pinned }) => {
      state.view = { ...state.view, columns, pinned };
      saveView(state.view);
      refresh();
    }
  });
});

pick('#파일열기').addEventListener('click', async () => {
  const rowCounts = new Map();
  for (const application of state.dataset.applications ?? []) {
    rowCounts.set(application.fileHash, (rowCounts.get(application.fileHash) ?? 0) + 1);
  }
  openFiles(dom.파일상자, {
    files: state.dataset.files ?? [],
    rowCounts,
    storage: await storageEstimate(),
    onRemove: async (hash) => {
      busy(true);
      await removeFile(state.db, hash);
      await reload();
      busy(false);
      dom.파일상자.close();
    },
    onClearAll: () => { dom.파일상자.close(); wipe(); },
    onAdd: () => { dom.파일상자.close(); dom.파일입력.click(); }
  });
});

async function wipe() {
  if (!confirm('불러온 자료를 모두 지웁니다. 되돌릴 수 없습니다.\n\n원본 엑셀은 그대로 있으니 다시 불러올 수 있습니다. 계속할까요?')) return;
  busy(true);
  await clearAll(state.db);
  forgetView();
  state.view = emptyView();
  state.warnings = [];
  state.search = '';
  dom.검색.value = '';
  filters.reset();
  await reload();
  busy(false);
}

pick('#전체지우기').addEventListener('click', wipe);

// ── 시작 ──────────────────────────────────────────────────────────────────────

async function start() {
  state.view = loadView();
  /*
   * 사람이 한 번이라도 전환했으면 그 선택을 되살린다. 아니면 화면 폭이 정한 기본값이다.
   *
   * **좁은 화면에서는 늘 닫은 채로 시작한다.** 거기서 패널은 표를 통째로 덮는 덮개라,
   * 넓은 화면에서 켜 둔 선택을 그대로 되살리면 자료를 보러 들어와 덮개부터 만난다.
   * 그 선택은 다른 화면 폭에서 한 것이다.
   */
  const 넓은화면 = globalThis.matchMedia?.('(min-width: 64rem)').matches ?? false;
  if (!넓은화면) 필터판보이기(false, { 기억: false });
  else if (typeof state.view.filtersOpen === 'boolean') 필터판보이기(state.view.filtersOpen);
  try {
    state.db = await openDatabase();
  } catch (error) {
    dom.시작화면.prepend(el('p', {
      class: 'card mb-6 border-fail/40 bg-fail-soft px-5 py-4 text-base text-fail',
      text: error?.message ?? '이 브라우저에서는 자료를 보관할 수 없습니다.'
    }));
    refresh();
    return;
  }
  await reload();
}

start();
