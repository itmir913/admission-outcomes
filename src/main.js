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

import './styles.css';

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
  단계: pick('#단계'),
  요약: pick('#요약'),
  시작화면: pick('#시작화면'),
  본화면: pick('#본화면'),
  필터판: pick('#필터판'),
  검색: /** @type {HTMLInputElement} */ (pick('#검색')),
  건수: pick('#건수'),
  칩줄: pick('#칩줄'),
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
  body: pick('#본문행'),
  empty: dom.표없음,
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

// ── 조건 좁히기 ───────────────────────────────────────────────────────────────
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
  }
});

// ── 다시 그리기 ───────────────────────────────────────────────────────────────

/** 상단 3단계 표시. 지금 어디인지 늘 보이게 둔다 (§7). */
function paintSteps(hasData, narrowed) {
  const steps = [
    { label: '① 불러오기', done: hasData },
    { label: '② 조건 좁히기', done: narrowed },
    { label: '③ 사례 보기', done: false }
  ];
  clear(dom.단계).append(...steps.flatMap((step, index) => [
    index > 0 ? el('li', { class: 'text-line', attrs: { 'aria-hidden': 'true' }, text: '→' }) : null,
    el('li', {
      class: `rounded-lg px-2 py-1 ${step.done ? 'bg-brand-soft text-brand' : ''}`,
      text: step.label
    })
  ].filter(Boolean)));
}

/** 활성 필터 칩. 하나씩 뗄 수 있고 전체 해제도 있다 (§7). */
function paintChips() {
  clear(dom.칩줄);
  if (state.view.filters.length === 0) return;

  for (const filter of state.view.filters) {
    dom.칩줄.append(el('span', { class: 'chip' }, [
      el('span', { text: describeFilter(filter, fieldLabel(filter.key)) }),
      el('button', {
        class: 'text-brand/70 hover:text-brand',
        text: '✕',
        attrs: { type: 'button', 'aria-label': `${fieldLabel(filter.key)} 조건 해제` },
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
  dom.칩줄.append(el('button', {
    class: 'btn btn-sm', text: '조건 전체 해제', attrs: { type: 'button' },
    on: {
      click: () => {
        state.view = { ...state.view, filters: [] };
        saveView(state.view);
        refresh();
      }
    }
  }));
}

/** 사람이 손봐야 할 것을 알린다. 조용히 넘어가면 틀린 자료가 그대로 상담에 쓰인다. */
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

function refresh({ keepScroll = false } = {}) {
  const hasData = state.rows.length > 0;
  dom.시작화면.classList.toggle('hidden', hasData);
  dom.본화면.classList.toggle('hidden', !hasData);

  const students = new Set(state.dataset.students?.map((student) => student.sid)).size;
  dom.요약.textContent = hasData
    ? `파일 ${state.dataset.files?.length ?? 0}개 · 학생 ${students}명 · 지원 ${state.rows.length}건`
    : '';

  paintSteps(hasData, state.view.filters.length > 0 || state.search.trim() !== '');
  if (!hasData) { clear(dom.칩줄); clear(dom.알림줄); return; }

  const visible = applyQuery(state.rows, {
    filters: state.view.filters,
    search: state.search,
    sorts: state.view.sorts
  });

  dom.건수.textContent = visible.length === state.rows.length
    ? `${state.rows.length}건`
    : `${state.rows.length}건 중 ${visible.length}건`;
  dom.표없음.textContent = '조건에 맞는 지원 기록이 없습니다. 위 칩에서 조건을 하나씩 떼어 보세요.';

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
  triggers: [pick('#파일고르기')],
  onFiles: handleFiles
});

dom.검색.addEventListener('input', debounce((event) => {
  state.search = event.target.value;
  refresh();
}, 180));

pick('#필터토글').addEventListener('click', () => {
  dom.필터판.classList.toggle('hidden');
  dom.필터판.classList.toggle('block');
});

pick('#정렬해제').addEventListener('click', () => {
  state.view = { ...state.view, sorts: [] };
  saveView(state.view);
  refresh();
});

pick('#인쇄').addEventListener('click', () => globalThis.print());

pick('#열고르기').addEventListener('click', () => {
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
