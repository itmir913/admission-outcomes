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
import { buildRegistry, defaultColumns, fieldLabel, primaryGpaField } from './analysis/registry.js';
import { applyQuery, describeFilter, sortRows } from './analysis/query.js';
import { unknownOutcomeTerms } from './core/outcome.js';

import { pick, el, clear, debounce } from './ui/dom.js';
import { createTable } from './ui/table.js';
import { createFilters, addValueFilter } from './ui/filters.js';
import { readFiles, confirmUploads, bindDropzone } from './ui/upload.js';
import { openStudent } from './ui/student.js';
import { outcomeBar, passRate, rateNote, tallyOutcomes } from './ui/outcome.js';
import { openFiles, openColumns } from './ui/panels.js';
import { paintSummaryChrome } from './ui/summaryTable.js';
import { summarize, summaryRows, GROUPINGS, SMALL_SAMPLE } from './analysis/summary.js';
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
  조건딱지: pick('#조건딱지'),
  행수: pick('#행수'),
  쪽번호: /** @type {HTMLInputElement} */ (pick('#쪽번호')),
  쪽수: pick('#쪽수'),
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
  /** 지금 보는 쪽(0부터). 조건이 바뀌면 첫 쪽으로 돌아간다 */
  page: 0,
  warnings: []
};

function busy(on) {
  dom.진행.classList.toggle('hidden', !on);
  dom.진행.classList.toggle('grid', on);
}

// ── 표 ────────────────────────────────────────────────────────────────────────
/**
 * 열 이름 줄의 검색칸·값 목록. **두 표가 같은 것을 쓴다.** 요약표의 대학·전형 칸에서
 * 거른 것은 지원 목록의 같은 열 필터다 — 요약표는 그 결과를 묶어 셀 뿐이다.
 */
const 열필터 = {
  /** 열 이름 줄 검색칸에 지금 무엇이 적혀 있는지. 다시 그려도 글자가 남아야 한다 */
  columnSearch: (key) => {
    const found = state.view.filters.find((filter) => filter.key === key && filter.op === 'contains');
    return found?.text ?? '';
  },
  // 글자 검색은 칸에 그대로 보이지만, 값 목록으로 건 필터는 단추 말고 알릴 자리가 없다
  columnFiltered: (key) =>
    state.view.filters.some((filter) => filter.key === key && filter.op !== 'contains'),
  onColumnFilter: (key, anchor) => 팝오버열기(key, anchor),
  onColumnSearch: (key, text) => {
    const rest = state.view.filters.filter(
      (filter) => !(filter.key === key && filter.op === 'contains'));
    const next = String(text ?? '').trim() === '' ? rest : [...rest, { key, op: 'contains', text }];
    state.view = { ...state.view, filters: next };
    saveView(state.view);
    refresh({ keepScroll: true });
  }
};

const table = createTable({
  scroller: dom.표,
  colgroup: pick('#열너비'),
  headRow: pick('#헤더행'),
  searchRow: pick('#검색행'),
  body: pick('#본문행'),
  empty: dom.표없음,
  // 실제로 고정된 수가 달라졌으면 도구줄의 숫자도 따라가야 한다
  onPinnedChange: () => paintToolbar(),
  ...열필터,
  onRowOpen: (row) => {
    // 지금 걸린 조건과 무관하게 그 학생의 **전체** 이력을 보여 준다.
    // 상담에서 알고 싶은 것은 "이 학생이 어디에 어떻게 지원했나" 전부다
    openStudent(dom.학생상자, {
      sid: row.sid,
      rows: state.rows.filter((item) => item.sid === row.sid),
      /*
       * 카드의 대학명을 누르면 그 대학을 필터에 더하고 **모달을 닫는다.**
       *
       * 결과가 나타나는 곳(표·칩줄·요약띠)이 전부 모달 뒤에 가려져 있어서, 열어
       * 둔 채로는 눌렀는지조차 알 수 없다. 좁은 화면에서는 모달이 화면을 다 덮는다.
       * 되돌아오는 비용은 작다 — 그 대학으로 걸러도 이 학생의 해당 행은 표에 남는다.
       */
      onUnivFilter: (univ) => {
        const next = addValueFilter(state.view.filters, 'univ', univ);
        dom.학생상자.close();
        // 이미 걸려 있던 대학이다. 표도 칩줄도 지금 모습 그대로가 맞다
        if (!next) return;

        state.view = { ...state.view, filters: next };
        saveView(state.view);
        // 거르는 조건이 달라졌으니 표는 맨 위부터 본다. 왼쪽 패널에서 값을 고를 때와 같다
        refresh();
        /*
         * **포커스를 방금 생긴 칩으로 보낸다.**
         *
         * 모달이 닫히면 브라우저는 포커스를 모달을 열기 전 자리, 곧 방금 누른 표의
         * 행으로 되돌린다. 그런데 `refresh()`가 표를 다시 그려 그 행이 사라지므로
         * 포커스가 `body`로 떨어지고, 키보드로 보는 사람은 Tab이 문서 맨 앞에서
         * 다시 시작한다. 칩은 방금 한 일이 적힌 자리이자 그것을 되돌릴 자리다.
         *
         * **칩 자체에 세운다. ✕ 단추가 아니다.** 방금 Enter로 단추를 누르고 온
         * 사람의 손가락 밑에 지우는 단추를 놓지 않는다 — ✕는 다음 Tab 한 번 거리에 있다.
         */
        /** @type {HTMLElement|null} */
        (dom.칩줄.querySelector('[data-filter-key="univ"][data-filter-op="in"]'))?.focus();
      }
    });
  },
  onStateChange: (next) => {
    state.view = { ...state.view, sorts: next.sorts, widths: next.widths, pinned: next.pinned, columns: next.columns };
    saveView(state.view);
    refresh({ keepScroll: true });
  }
});

/**
 * 대학×전형 요약표. 지원 목록과 **같은 컴포넌트**다 — 정렬·너비·순서·고정이 똑같이 움직인다.
 * 다른 것은 줄을 눌렀을 때뿐이다. 학생이 아니라 그 대학·전형의 지원 목록으로 간다.
 */
const 요약격자 = createTable({
  scroller: dom.표,
  colgroup: pick('#요약열너비'),
  headRow: pick('#요약헤더행'),
  searchRow: pick('#요약검색행'),
  body: pick('#요약본문행'),
  empty: pick('#요약없음'),
  onPinnedChange: () => paintToolbar(),
  ...열필터,
  // 집계 칸(지원 건수 같은)은 원본 행의 열이 아니라 거를 수 없다
  canFilter: (key) => key === 'univ' || key === 'admType',
  onRowOpen: (row) => {
    const 묶음 = GROUPINGS[state.view.grouping] ?? GROUPINGS.univAdm;
    요약줄열기(묶음.keys.map((key, index) => ({ key, value: row['#values'][index] })));
  },
  onStateChange: (next) => {
    state.view = {
      ...state.view,
      summaryTable: { columns: next.columns, widths: next.widths, pinned: next.pinned, sorts: next.sorts }
    };
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
 * 요약 띠 (§7 · plan.md §6).
 *
 * **측정값의 정의를 늘 문장으로 함께 둔다.** 상담 중에 숫자의 근거를 설명하지
 * 못하면 그 숫자는 쓸 수 없다. "합격 12"가 건수인지 학생 수인지는 보는 사람마다 다르게 읽는다.
 */
function paintSummary(visible, total) {
  const tally = tallyOutcomes(visible);
  const rate = passRate(tally);
  const 걸러짐 = visible.length !== total;
  const 표본적음 = tally.합격 + tally.충원합격 + tally.불합격 < SMALL_SAMPLE;

  const cell = (name, value, tone = '') => el('div', { class: `stat ${tone}` }, [
    el('p', { class: 'stat-name', text: name }),
    el('p', { class: 'stat-value', text: value })
  ]);

  /*
   * **칸은 늘 여섯이다.** 2·3·6 어느 열수로 접어도 마지막 줄이 꽉 찬다.
   *
   * 판정 미상은 여기 일곱째 칸으로 두었다가 뺐다. 있는 해에만 생기는 칸이라
   * 홀로 한 줄을 차지했고, 그 줄이 비어 보였다. 아래 띠의 범례가 건수와 비율을
   * 그대로 적고 있어 수가 사라지지도 않는다.
   */
  const cells = [
    // 거른 상태에서는 「전체」가 아니다. 그때는 분모를 괄호로 밝힌다
    cell(걸러짐 ? `지원 (전체 ${total}건 중)` : '전체 지원', tally.지원),
    cell('학생', tally.학생),
    cell('합격', tally.합격, 'text-pass'),
    cell('충원합격', tally.충원합격, 'text-wait'),
    cell('불합격', tally.불합격, 'text-fail'),
    // 요약표와 같은 기준이다. 판정 1건에 「100.0%」를 띄우면 필터로 좁힌 자리가 합격선처럼 보인다
    cell('합격률', rate === null || 표본적음 ? '—' : `${(rate * 100).toFixed(1)}%`)
  ];

  clear(dom.요약띠).append(el('div', { class: 'card overflow-hidden' }, [
    el('div', { class: 'stat-grid' }, cells),
    el('div', { class: 'border-t border-line-soft px-4 py-3' }, [outcomeBar(tally)]),
    el('p', {
      class: 'border-t border-line-soft bg-canvas px-4 py-1.5 text-base text-ink-soft',
      text: 표본적음 && rate !== null
        ? `${rateNote(tally)} 최종 판정이 ${SMALL_SAMPLE}건 미만이라 합격률을 내지 않습니다.`
        : rateNote(tally)
    })
  ]));
}

/**
 * 칩 줄 — 지금 걸려 있는 **정렬과 필터**를 한 줄에 늘어놓는다 (§7, 참고 UI).
 *
 * 정렬을 먼저 둔다. 표가 왜 이 순서로 보이는지를 먼저 파악해야 하고,
 * 그다음이 무엇을 걸러 냈는지다. 둘 다 칩 하나씩 눌러 뗄 수 있다.
 */
function paintChips() {
  clear(dom.칩줄);

  /*
   * 걸린 것이 없으면 **표 다루는 법을 적는다.** 딱지도 「설명」으로 바뀐다 —
   * 「조건」과 두 글자로 길이가 같아, 바뀌어도 뒤따르는 글이 좌우로 움직이지 않는다.
   */
  const 걸린것 = state.view.sorts.length + state.view.filters.length;
  dom.조건딱지.textContent = 걸린것 ? '조건' : '설명';
  if (걸린것 === 0) {
    dom.칩줄.append(el('span', {
      class: 'truncate text-ink-soft',
      text: state.view.summary
        ? '줄을 누르면 그 대학·전형으로 필터를 걸고 지원 목록으로 갑니다'
        : '열 제목을 눌러 정렬 / 열을 드래그해 순서 변경 / 열 사이 선을 드래그해 너비 조절'
    }));
    return;
  }

  // 칩 전체가 단추다. ✕ 하나만 누를 수 있게 두면 손가락으로는 맞히기 어렵다
  state.view.sorts.forEach((sort, rank) => {
    dom.칩줄.append(el('button', {
      class: 'chip border-pass/30 bg-pass-soft text-pass',
      attrs: { type: 'button', 'aria-label': `${fieldLabel(sort.key)} 정렬 해제`, title: `${fieldLabel(sort.key)} 정렬 해제` },
      on: {
        click: () => updateView({
          sorts: state.view.sorts.filter((item) => item.key !== sort.key)
        })
      }
    }, [
      el('span', { class: 'chip-rank', text: String(rank + 1) }),
      el('span', { text: `${fieldLabel(sort.key)} ${sort.dir === 'asc' ? '▲' : '▼'}` }),
      el('span', { class: 'text-pass/70', attrs: { 'aria-hidden': 'true' }, text: '✕' })
    ]));
  });

  for (const filter of state.view.filters) {
    /*
     * 열과 op를 함께 적는다. 필터를 더한 쪽에서 이 칩을 찾아 포커스를 보내는데
     * (`onUnivFilter`), 열만으로 집으면 같은 열의 열 이름 줄 검색 칩이 먼저 걸린다.
     * 그러면 포커스가 엉뚱한 칩의 ✕에 가 앉고, 거기서 Enter를 누른 사람은 방금
     * 더한 필터 대신 적어 둔 검색어를 지운다 (§5).
     */
    dom.칩줄.append(el('span', {
      class: 'chip',
      attrs: { 'data-filter-key': filter.key, 'data-filter-op': filter.op, tabindex: '-1' }
    }, [
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
  지금표().markOpenFilter(null);
}

/** 내용만 다시 그린다. 자리는 그대로 둔다 — 값을 선택할 때마다 창이 뛰면 다음 값을 누를 수 없다. */
function 팝오버그리기() {
  if (열린열 === null) return;
  const field = state.registry.find((item) => item.key === 열린열);
  const body = filters.blockFor(열린열);
  clear(dom.열팝오버).append(
    el('div', { class: 'flex min-h-9 items-center gap-2 border-b border-line px-2.5' }, [
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
    /*
     * 높이를 재는 것은 **안쪽 값 목록 하나뿐이다.**
     *
     * 여기에도 320px 같은 고정 상한을 두었더니, 목록(256px)에 검색칸과 여백을
     * 더한 값이 그 상한을 몇 px 넘겨 바깥 막대가 하나 더 생겼다. 막대 둘이
     * 나란히 서면 어느 쪽이 무엇을 미는지 알 수 없다. 바깥은 화면이 아주
     * 낮을 때만 미끄러지게 두고, 보통은 안쪽 목록만 미끄러진다. 3rem은 제목줄
     * 몫이다 — 이걸 빼 두어야 창 전체가 80vh 안에 들어와 화면 밖으로 흐르지 않는다.
     */
    // 여백은 사방이 같다. 칸 안쪽 조각들은 제 여백을 두지 않는다
    el('div', { class: 'max-h-[calc(80vh-3rem)] overflow-y-auto p-2.5' }, [body].filter(Boolean))
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
  // **자리를 먼저 잰다.** markOpenFilter 가 열 이름 줄을 다시 그리면서 이 단추를 갈아 끼우는데,
  // 떨어져 나간 요소는 자리를 0으로 보고한다 — 그러면 창이 화면 왼쪽 위에 가서 붙는다
  const box = anchor.getBoundingClientRect();

  열린열 = key;
  dom.열팝오버.classList.remove('hidden');
  팝오버그리기();
  지금표().markOpenFilter(key);
  const 폭 = dom.열팝오버.offsetWidth;
  const 높이 = dom.열팝오버.offsetHeight;
  // 화면 밖으로 나가지 않게 가둔다. 오른쪽 끝 열에서 특히 자주 넘친다
  const left = Math.max(8, Math.min(box.left, globalThis.innerWidth - 폭 - 8));
  const 아래 = box.bottom + 4;
  const top = 아래 + 높이 > globalThis.innerHeight - 8 ? Math.max(8, box.top - 높이 - 4) : 아래;
  dom.열팝오버.style.left = `${left}px`;
  dom.열팝오버.style.top = `${top}px`;
}

/*
 * **어디를 눌렀는지는 누를 때 적어 둔다. 손을 뗀 뒤에 되묻지 않는다.**
 *
 * 바깥을 누르면 닫는데, 그 판단을 클릭이 올라온 뒤 `event.target`으로 하던 때는
 * 값 하나를 선택하면 창이 닫혔다. 체크박스가 바뀌면 `refresh()`가 창 안을 다시
 * 그리므로, 그 클릭이 아래까지 올라올 무렵 눌린 자리는 이미 **다른 요소**다 —
 * 글상자(label)를 누르면 브라우저가 체크박스로 한 번 더 클릭을 보내는데, 그때
 * 보내지는 것은 방금 다시 그려진 쪽이라 창 안을 거치지도 않는다. 그래서 「바깥을
 * 눌렀다」로 읽혔고, 여러 값을 이어 선택하려면 목록을 매번 다시 열어야 했다.
 *
 * `pointerdown`은 다시 그리기 전에 온다. 그 순간의 자리는 틀릴 수가 없다.
 */
let 팝오버안에서눌렀다 = false;
document.addEventListener('pointerdown', (event) => {
  팝오버안에서눌렀다 = dom.열팝오버.contains(/** @type {Node} */ (event.target));
}, true);

// 깔때기 단추 자신은 스스로 토글하므로 여기서 빼낸다
document.addEventListener('click', () => {
  if (열린열 === null) return;
  if (팝오버안에서눌렀다) return;
  팝오버닫기();
});

/*
 * 표를 **옆으로** 밀면 단추가 제자리를 떠난다. 따라다니게 만들기보다 닫는 편이 솔직하다.
 *
 * **세로로 미는 것은 닫을 까닭이 아니다.** 열 이름 줄은 붙어 있어 단추가 그대로 있고,
 * 무엇보다 값을 하나 선택하면 표가 짧아지면서 브라우저가 스크롤을 끌어올린다 —
 * 사람이 민 적도 없는데 그 한 번이 목록을 닫아, 여러 값을 이어 선택할 수 없었다.
 */
let 마지막가로 = 0;
dom.표.addEventListener('scroll', () => {
  const 가로 = dom.표.scrollLeft;
  if (가로 === 마지막가로) return;
  마지막가로 = 가로;
  팝오버닫기();
}, { passive: true });

/**
 * 툴바의 상태를 맞춘다 (#3).
 *
 * **쓸 수 없는 단추도 자리를 지킨다**(D15). 값에 따라 단추가 생겼다 사라지면
 * 그 줄의 높이가 바뀌고, 그때마다 표가 위아래로 들썩인다.
 */
function paintToolbar() {
  const 보이는고정 = 고정보이는수();
  dom.고정수.textContent = String(보이는고정);

  const disable = (selector, off) => {
    const node = pick(selector);
    node.disabled = off;
    node.setAttribute('aria-disabled', String(off));
  };
  disable('#고정줄이기', 보이는고정 <= 0);
  /*
   * **들어갈 자리가 없으면 「+」를 막는다.**
   *
   * 상한을 숫자로 박아 두지 않는다. 몇 개가 들어가는지는 화면 너비와 열 너비가
   * 정하고 그것은 사람마다 매 순간 다르다 — 숫자로 박으면 넓은 화면에서 필요 없이
   * 막기만 한다. 누를 수 없으니 「눌러도 아무 일 없음」도 생기지 않는다.
   */
  disable('#고정늘리기', 보이는고정 >= 지금보기().columns.length || !지금표().canPinMore());
  disable('#정렬초기화', 지금보기().sorts.length === 0);
  // 요약표의 열은 묶음 기준이 정한다. 고를 열이 따로 없다
  disable('#열선택', state.view.summary === true);
  disable('#필터초기화', state.view.filters.length === 0);
  disable('#열초기화', false);
}

/**
 * **도구줄에 적는 고정 수. 실제로 그려진 수다.**
 *
 * 사람이 정한 수(`state.view.pinned`)는 천장으로 남기고, 화면에는 그 천장과
 * 화면 너비가 함께 허락한 **실제 수**를 적는다. 좁은 화면에서 넷 중 하나만
 * 고정됐는데 「4」라고 적으면, 눈으로는 멀쩡해서 틀린 줄 모른다 (§5).
 *
 * 천장을 깎지 않는 까닭은 **창을 다시 넓히면 돌아와야** 하기 때문이다. 깎아
 * 버리면 열을 잠시 빼거나 창을 잠시 좁힌 것만으로 사람이 정해 둔 설정이 사라진다.
 *
 * 아직 폭을 재지 못해 표가 모른다고 답하면(`null`) 천장을 적는다 — 그 순간의
 * 숫자는 「안 들어간다」가 아니라 「아직 모른다」다.
 */
function 고정보이는수() {
  const 천장 = Math.min(지금보기().pinned, 지금보기().columns.length);
  return 지금표().drawnPinned() ?? 천장;
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
  /*
   * **열려 있을 때 눌린 모양을 한다** — 토글 단추의 관례이고, `aria-expanded`와 같은 말을 한다.
   * 닫혔을 때 강조했더니 늘 닫혀 있는 좁은 화면에서 단추가 늘 파래, 강조가 아무것도
   * 알리지 못하고 「먼저 누를 단추」처럼만 보였다.
   */
  토글.classList.toggle('btn-primary', on);
  // 좁은 화면이라 닫아 둔 것은 사람의 선택이 아니다. 적어 두면 넓은 화면의 선택을 덮는다
  if (기억 && state.view.filtersOpen !== on) updateView({ filtersOpen: on });
}

/** 지금 패널이 떠 있는가. 클래스가 없으면 화면 폭이 정한 기본값을 본다. */
function 필터판열림() {
  if (document.body.classList.contains('filters-on')) return true;
  if (document.body.classList.contains('filters-off')) return false;
  return globalThis.matchMedia?.('(min-width: 64rem)').matches ?? false;
}

/**
 * 보기 전환 — 지원 목록과 대학×전형 요약표 (roadmap.md 1단계).
 *
 * 요약표는 **목록과 같은 행 집합**을 받는다. 그래서 요약표의 합계가 요약 띠와 같다.
 * 도구줄(쪽 넘김·열 고정·정렬 초기화…)은 두 보기에서 같은 자리에 같은 모양으로 선다.
 * 단추는 지금 보이는 표를 다룬다(`지금표`). 요약표에 뜻이 없는 「열 선택」만 꺼 둔다.
 */
function paintView(visible) {
  const 요약 = state.view.summary === true;
  pick('#목록표').classList.toggle('hidden', 요약);
  pick('#요약표').classList.toggle('hidden', !요약);
  dom.쪽번호.disabled = 요약;
  for (const [selector, on] of [['#보기목록', !요약], ['#보기요약', 요약]]) {
    const node = pick(selector);
    node.setAttribute('aria-pressed', String(on));
    node.classList.toggle('btn-primary', on);
  }
  if (!요약) return;

  /*
   * 선택한 내신 열이 이 자료에 없으면(다른 양식을 올렸거나 지웠으면) 대표 내신으로 돌아간다.
   * 없는 열로 내면 범위가 통째로 빈칸이 되고, 왜 비었는지 알 길이 없다.
   */
  const gpaChoices = state.registry
    .filter((field) => field.group === 'gpa' && field.filled > 0)
    .map((field) => ({ key: field.key, label: fieldLabel(field.key) }));
  const gpa = gpaChoices.find((choice) => choice.key === state.view.summaryGpa)
    ?? primaryGpaField(state.registry) ?? null;
  const gpaLabel = gpa ? fieldLabel(gpa.key) : null;
  const 묶음 = GROUPINGS[state.view.grouping] ?? GROUPINGS.univAdm;
  const summary = summarize(visible, { keys: 묶음.keys, gpaKey: gpa?.key ?? null });
  const { rows, fields } = summaryRows(summary, { keys: 묶음.keys, gpaLabel });

  paintSummaryChrome(pick('#요약머리'), pick('#요약각주'), {
    summary,
    gpaLabel,
    gpaChoices,
    gpaKey: gpa?.key ?? null,
    onGpa: (key) => updateView({ summaryGpa: key }),
    grouping: state.view.grouping,
    onGrouping: (grouping) => updateView({ grouping })
  });

  /*
   * **열 목록은 묶음 기준과 자료가 정한다.** 사람이 바꾼 집계 열의 순서는 지키되, 지금 없는 열
   * (대학만으로 접었을 때의 전형, 등록 열이 없는 자료의 등록)은 빼고 새로 생긴 열은 뒤에 붙인다.
   */
  const 있는열 = fields.map((field) => field.key);
  const 보기 = state.view.summaryTable;
  // 묶음 열(대학·전형)은 늘 맨 앞이다. 대학만으로 묶었다 돌아오면 전형이 맨 뒤에 붙어 줄이 무엇인지 안 보였다
  const 나머지 = 있는열.filter((key) => !묶음.keys.includes(key));
  const columns = [
    ...묶음.keys,
    ...보기.columns.filter((key) => 나머지.includes(key)),
    ...나머지.filter((key) => !보기.columns.includes(key))
  ];
  const sorts = 보기.sorts.filter((sort) => 있는열.includes(sort.key));
  state.view = { ...state.view, summaryTable: { ...보기, columns, sorts } };

  /*
   * **도구줄은 목록과 똑같이 둔다.** 줄이 수십 개라 쪽은 늘 하나지만, 쪽 넘김을 감추면
   * 보기를 바꿀 때마다 도구줄 모양이 달라진다. 줄 수는 요약표의 줄로 적는다.
   */
  dom.쪽수.textContent = '/ 1쪽';
  dom.쪽번호.value = '1';
  for (const selector of ['#첫쪽', '#앞쪽', '#뒤쪽', '#끝쪽']) pick(selector).disabled = true;
  dom.행수.textContent = `${수.format(rows.length)}줄 · 지원 ${수.format(visible.length)}건`;

  pick('#요약없음').textContent = '걸려 있는 조건에 맞는 지원 기록이 없습니다. 위 칩에서 필터를 하나씩 떼어 보세요.';
  // 정렬을 걸지 않았으면 이름순으로 둔다. 다시 그릴 때마다 줄 순서가 흔들리면 보던 줄을 놓친다
  const 이름순 = [...rows].sort((left, right) => 묶음.keys
    .map((key) => String(left[key] ?? '').localeCompare(String(right[key] ?? ''), 'ko'))
    .find((order) => order !== 0) ?? 0);
  요약격자.render({
    rows: sortRows(이름순, sorts),
    registry: fields,
    state: { columns, widths: 보기.widths, pinned: 보기.pinned, sorts }
  });
}

/** 지금 보이는 표. 도구줄의 열 고정·정렬 초기화가 이 표를 다룬다 */
function 지금표() {
  return state.view.summary ? 요약격자 : table;
}

/** 지금 보이는 표의 열·정렬 상태 */
function 지금보기() {
  return state.view.summary ? state.view.summaryTable : state.view;
}

function 지금보기바꾸기(patch) {
  if (state.view.summary) updateView({ summaryTable: { ...state.view.summaryTable, ...patch } });
  else updateView(patch);
}

/**
 * 요약표의 줄을 누르면 그 대학·전형으로 거르고 목록으로 돌아간다.
 *
 * 같은 열의 값 목록 필터는 **누적하지 않고 바꾼다.** 줄 하나를 눌렀으면 그 줄만 보고
 * 싶은 것이다 — 누적하면 앞서 누른 대학이 남아 「이 줄의 지원」이 아닌 것이 섞인다.
 * 되돌아가는 길은 칩줄에 바로 보인다.
 */
function 요약줄열기(picked) {
  let next = state.view.filters;
  for (const { key, value } of picked) {
    next = next.filter((filter) => !(filter.key === key && (filter.op === 'in' || filter.op === 'blank')));
    next = [...next, value === null ? { key, op: 'blank' } : { key, op: 'in', values: [value] }];
  }
  state.view = { ...state.view, filters: next, summary: false };
  saveView(state.view);
  refresh();
  dom.표.scrollTop = 0;
}

function refresh({ keepScroll = false } = {}) {
  const 처음자리 = dom.표.scrollTop;
  const hasData = state.rows.length > 0;
  dom.시작화면.classList.toggle('hidden', hasData);
  dom.본화면.classList.toggle('hidden', !hasData);

  const students = new Set(state.dataset.students?.map((student) => student.sid)).size;
  dom.요약.textContent = hasData
    ? `파일 ${state.dataset.files?.length ?? 0}개 · 학생 ${students}명 · 전체 지원 ${state.rows.length}건`
    : '';

  if (!hasData) { clear(dom.칩줄); clear(dom.알림줄); clear(dom.요약띠); return; }

  const 시작 = globalThis.performance?.now() ?? Date.now();
  const visible = applyQuery(state.rows, {
    filters: state.view.filters,
    search: state.search,
    sorts: state.view.sorts
  });
  const 걸린시간 = (globalThis.performance?.now() ?? Date.now()) - 시작;

  /*
   * **조건이 바뀌면 첫 쪽으로 돌아간다.** 셋째 쪽을 보다가 필터를 걸었는데 그대로
   * 셋째 쪽이면, 앞 두 쪽에 걸린 행을 못 보고 지나간다. 너비·고정만 바꾼 것은
   * 조건이 아니므로 보던 쪽을 지킨다.
   */
  const 조건 = JSON.stringify([state.view.filters, state.search, state.view.sorts]);
  if (조건 !== 마지막조건) { 마지막조건 = 조건; state.page = 0; }
  state.page = Math.max(0, Math.min(state.page, 쪽수(visible.length) - 1));
  보는행 = visible;
  const 이쪽 = visible.slice(state.page * PAGE, (state.page + 1) * PAGE);
  paintPager(visible.length, 걸린시간);

  // 무엇 때문에 0건인지 말해 준다. 「없습니다」만으로는 어디를 되돌려야 하는지 모른다
  dom.표없음.textContent = state.search.trim()
    ? `「${state.search.trim()}」에 맞는 지원 기록이 없습니다. 검색어를 지우거나 줄여 보세요.`
    : '걸려 있는 필터에 맞는 지원 기록이 없습니다. 위 칩에서 필터를 하나씩 떼어 보세요.';

  paintToolbar();
  팝오버그리기();
  paintSummary(visible, state.rows.length);
  paintView(visible);
  paintChips();
  paintNotices();
  filters.render();

  table.render({ rows: 이쪽, registry: state.registry, state: viewForTable() });
  // 두 표 모두 그릴 때 맨 위로 돌아가므로, 자리는 그리기 전에 적어 둔 것으로 되돌린다
  if (keepScroll) dom.표.scrollTop = 처음자리;
  // 목록표가 0건이면 안내를 띄우는데, 요약표는 자기 자리에서 따로 말한다
  if (state.view.summary) dom.표없음.classList.add('hidden');
}

// ── 쪽 넘김 ──────────────────────────────────────────────────────────────────

/** 한 쪽에 담는 행 수 */
const PAGE = 500;
const 수 = new Intl.NumberFormat('ko-KR');
/** 지난번 조회의 조건. 바뀌었는지 보고 첫 쪽으로 되돌아간다 */
let 마지막조건 = '';
/** 조건에 맞는 전체 행. 인쇄는 보이는 쪽이 아니라 이것을 낸다 */
let 보는행 = [];

const 쪽수 = (count) => Math.max(1, Math.ceil(count / PAGE));

function paintPager(count, ms) {
  const 끝 = 쪽수(count) - 1;
  dom.쪽번호.value = String(state.page + 1);
  dom.쪽수.textContent = `/ ${수.format(끝 + 1)}쪽`;
  const disable = (selector, off) => { pick(selector).disabled = off; };
  disable('#첫쪽', state.page <= 0);
  disable('#앞쪽', state.page <= 0);
  disable('#뒤쪽', state.page >= 끝);
  disable('#끝쪽', state.page >= 끝);
  const 첫행 = count === 0 ? 0 : state.page * PAGE + 1;
  const 끝행 = Math.min(count, (state.page + 1) * PAGE);
  dom.행수.textContent = `${수.format(첫행)}–${수.format(끝행)} / ${수.format(count)}행 · ${ms.toFixed(1)}ms`;
}

function 쪽가기(page) {
  const next = Math.max(0, Math.min(page, 쪽수(보는행.length) - 1));
  if (next === state.page) { dom.쪽번호.value = String(state.page + 1); return; }
  state.page = next;
  // 쪽을 넘기면 표 맨 위부터 본다
  refresh();
}

pick('#보기목록').addEventListener('click', () => { if (state.view.summary) updateView({ summary: false }); });
pick('#보기요약').addEventListener('click', () => { if (!state.view.summary) updateView({ summary: true }); });
pick('#첫쪽').addEventListener('click', () => 쪽가기(0));
pick('#앞쪽').addEventListener('click', () => 쪽가기(state.page - 1));
pick('#뒤쪽').addEventListener('click', () => 쪽가기(state.page + 1));
pick('#끝쪽').addEventListener('click', () => 쪽가기(Infinity));

/** 쪽 번호 칸은 1부터 센다. 숫자가 아니면 보던 쪽으로 되돌린다 */
function 쪽번호적용() {
  const n = Number(dom.쪽번호.value);
  if (Number.isFinite(n) && n >= 1) 쪽가기(Math.floor(n) - 1);
  else dom.쪽번호.value = String(state.page + 1);
}
dom.쪽번호.addEventListener('keydown', (event) => { if (event.key === 'Enter') 쪽번호적용(); });
dom.쪽번호.addEventListener('blur', 쪽번호적용);

/*
 * **종이에는 조건에 맞는 전체를 낸다.** 화면은 한 쪽만 그리지만, 인쇄를 누른 사람이
 * 원하는 것은 지금 걸어 둔 조건의 결과이지 500행에서 잘린 조각이 아니다.
 * 표가 먼저 인쇄 모드로 들어간 뒤(같은 이벤트, 먼저 등록됨) 전체 행으로 다시 그린다.
 */
globalThis.addEventListener?.('beforeprint', () => {
  if (보는행.length > PAGE) table.render({ rows: 보는행, registry: state.registry, state: viewForTable() });
});
globalThis.addEventListener?.('afterprint', () => {
  if (보는행.length > PAGE) refresh({ keepScroll: true });
});

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
  /*
   * 파일 목록 상자는 **읽을 파일이 정해진 다음에** 닫는다.
   *
   * 열기 창을 띄우기 전에 닫아 두었더니, 창에서 취소만 눌러도 목록이 사라졌다 —
   * 아무것도 하지 않았는데 보던 화면을 잃는다. 읽을 파일이 실제로 정해진
   * 지금 닫는다. 그래야 다음에 설 확인 상자가 혼자 선다.
   */
  dom.파일상자.close();
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
    /*
     * 불러오기는 확인 상자가 서 있는 동안 끝낸다. 상자가 먼저 닫히면
     * 사람은 다 된 줄 알고 다음 일을 시작하는데 뒤에서는 아직 쓰고 있었다.
     */
    const loaded = await confirmUploads(dom.확인상자, prepared, CURRENT_YEAR, async (decisions) => {
      const dataset = await commitSheets(prepared.sheets, {
        decisions,
        existingStudents: state.dataset.students ?? []
      });
      await saveDataset(state.db, dataset);
      state.warnings = dataset.warnings ?? [];
      await reload();
    });
    if (!loaded) return;

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

/*
 * **「+」와 「−」는 지금 보이는 수에서 움직인다.**
 *
 * 천장이 5인데 셋만 들어가는 화면에서 「−」가 천장을 4로 내리면 화면은 그대로
 * 셋이고 숫자도 그대로 셋이다 — 눌렀는데 아무 일도 안 일어난다.
 */
const 고정조정 = (step) => 지금보기바꾸기({
  pinned: Math.max(0, Math.min(지금보기().columns.length, 고정보이는수() + step))
});
pick('#고정줄이기').addEventListener('click', () => 고정조정(-1));
pick('#고정늘리기').addEventListener('click', () => 고정조정(1));

pick('#정렬초기화').addEventListener('click', () => 지금보기바꾸기({ sorts: [] }));
pick('#필터초기화').addEventListener('click', () => updateView({ filters: [] }));

// 열 구성·순서·너비를 한꺼번에 되돌린다. 하나씩 되돌리게 하면 아무도 안 쓴다
pick('#열초기화').addEventListener('click', () => {
  const base = emptyView();
  // 요약표의 열 목록은 그릴 때마다 묶음 기준에서 다시 채워진다. 비워 두면 기본 순서로 돌아온다
  if (state.view.summary) 지금보기바꾸기({ columns: [], widths: {}, pinned: base.summaryTable.pinned });
  else updateView({ columns: defaultColumns(state.registry), widths: {}, pinned: base.pinned });
});

pick('#인쇄').addEventListener('click', () => globalThis.print());

/*
 * 예시 양식 내려받기.
 *
 * **나가는 것은 이 도구가 만든 가상 데이터뿐이다.** 보관소에 손대지 않고, 화면에 띄운
 * 자료와도 무관하다 — 눌러 볼 양식이 없는 사람이 체험할 길일 뿐이다 (CLAUDE.md 1).
 */
pick('#예시받기').addEventListener('click', async () => {
  busy(true);
  try {
    const { sampleWorkbook, SAMPLE_FILE_NAME } = await import('./sample/sampleWorkbook.js');
    const url = URL.createObjectURL(new Blob([sampleWorkbook()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const link = el('a', { attrs: { href: url, download: SAMPLE_FILE_NAME } });
    document.body.append(link);
    link.click();
    link.remove();
    // 브라우저가 다 읽을 때까지 기다렸다 거둔다. 바로 거두면 내려받기가 끊긴다
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    console.error(error);
    alert(`예시 양식을 만들지 못했습니다.

${error?.message ?? error}`);
  } finally {
    busy(false);
  }
});

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
    onAdd: () => dom.파일입력.click()
  });
});

async function wipe() {
  if (!confirm('진학결과 분석기에 불러온 데이터를 모두 초기화합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
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
      text: error?.message ?? '이 브라우저에서는 데이터를 보관할 수 없습니다.'
    }));
    refresh();
    return;
  }
  await reload();
}

start();
