/**
 * 표 — 상담의 주 도구 (§7).
 *
 * 라이브러리를 쓰지 않는 이유는 §8에 있다. 정렬·리사이즈·고정을 우리가 통제해야 하고,
 * 자료 규모가 그리드 라이브러리를 정당화하지 않는다.
 *
 * 대교협은 81열이다. 전부 표시하면 가로 스크롤이 불가피한데, 그때 익명 ID와 대학이
 * 화면 밖으로 나가면 표를 읽을 수 없다. **열 고정이 장식이 아닌 이유다.**
 *
 * 행이 많아도 눈에 보이는 만큼만 그린다. 1만 행 × 12열이면 12만 칸이고,
 * 다 그리면 필터를 건드릴 때마다 화면이 멈춘다.
 */

import { el, clear, formatNumber, debounce } from './dom.js';
import { valueLabel, isBlank } from '../analysis/registry.js';
import { toggleSort } from '../analysis/query.js';

/** 행 높이. CSS의 `--spacing-row`와 같아야 창 밖 행 수 계산이 맞는다. */
const ROW_HEIGHT = 44;
/** 창 위아래로 더 그려 두는 행. 스크롤할 때 빈칸이 스쳐 지나가지 않게 한다. */
const OVERSCAN = 8;

/** 이만큼 움직이기 전에는 누른 것으로 본다. 손이 떨려도 열이 옮겨 가면 안 된다. */
export const DRAG_SLOP = 5;

export const MIN_WIDTH = 64;
export const DEFAULT_WIDTH = 150;

/** 열마다 어울리는 기본 너비. 대학명은 넓게, 등급은 좁게. */
export function suggestWidth(field) {
  // 익명 ID는 `2025-A3F2-7K9M` 꼴이라 14글자다. 줄이면 주키가 말줄임표로 끝난다
  if (field.key === 'sid') return 182;
  if (field.key === 'univ' || field.key === 'dept' || field.key === 'admName') return 200;
  // 정렬 화살표가 이름 옆에 붙는다. 100px면 「고3 년도」가 「고…」로 잘린다
  if (field.group === 'gpa' || field.type === 'year') return 120;
  if (field.numeric) return 110;
  return DEFAULT_WIDTH;
}

/**
 * 지금 그려야 할 행 구간.
 *
 * DOM에서 떼어 놓고 따로 검증한다 — 여기가 틀리면 표의 일부가 통째로 사라지는데,
 * 스크롤해 보기 전에는 아무도 모른다.
 *
 * @param {number} scrollTop
 * @param {number} viewportHeight
 * @param {number} rowCount
 * @returns {{start: number, end: number}}
 */
export function visibleWindow(scrollTop, viewportHeight, rowCount) {
  // 아직 자리를 잡지 못한 순간(높이 0)에도 한 화면은 그려 둔다.
  // 안 그리면 스크롤할 것이 없어 스크롤 이벤트도 영영 오지 않는다
  const viewport = viewportHeight > 0 ? viewportHeight : 600;
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT));
  const count = Math.ceil(viewport / ROW_HEIGHT);
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(rowCount, first + count + OVERSCAN)
  };
}


/** 셀 하나를 화면 글자로. */
export function cellText(key, value) {
  if (isBlank(value)) return '';
  if (typeof value === 'number') return formatNumber(value);
  return valueLabel(key, value);
}

/**
 * 표 하나를 만든다.
 *
 * @param {object} options
 * @param {HTMLElement} options.scroller 스크롤되는 겉틀
 * @param {HTMLElement} options.colgroup
 * @param {HTMLElement} options.headRow
 * @param {HTMLElement} options.body
 * @param {HTMLElement} options.empty 결과가 없을 때 보일 자리
 * @param {(row: object) => void} [options.onRowOpen]
 * @param {(state: object) => void} [options.onStateChange] 정렬·너비가 바뀔 때
 */
export function createTable({ scroller, colgroup, headRow, searchRow, body, empty, onRowOpen, onStateChange, onColumnSearch, columnSearch = () => '', columnFiltered = () => false, onColumnFilter }) {
  /** @type {object[]} */
  let rows = [];
  /** @type {Map<string, object>} */
  let fields = new Map();
  /** @type {{columns: string[], widths: Record<string, number>, pinned: number, sorts: object[]}} */
  let state = { columns: [], widths: {}, pinned: 2, sorts: [] };

  /** 지금 그려 둔 창. 같은 창이면 다시 그리지 않는다 */
  let drawn = { start: -1, end: -1 };
  /** 열을 끌어 옮긴 직후인지. 뒤따라 오는 click 한 번을 정렬로 세지 않는다 */
  let swallowClick = false;
  /** 지금 값 목록이 떠 있는 열. 깔때기 단추가 눌린 모양을 하게 한다 */
  let openFilterKey = null;

  const announce = () => onStateChange?.(state);

  /** 고정 열이 앉을 왼쪽 자리. 앞선 열들의 실제 너비 합이다. */
  function pinOffsets() {
    const offsets = [];
    let sum = 0;
    for (let index = 0; index < state.pinned && index < state.columns.length; index += 1) {
      offsets.push(sum);
      sum += state.widths[state.columns[index]] ?? DEFAULT_WIDTH;
    }
    return offsets;
  }

  /**
   * 고정 열의 왼쪽 자리만 고쳐 쓴다. **머리를 다시 그리지 않는다.**
   *
   * 너비를 끄는 동안 머리를 다시 그렸더니, 손에 쥐고 있던 손잡이가 그 자리에서
   * 떨어져 나가 포인터 붙듦(capture)과 이벤트가 함께 끊겼다 — 끌다 말고 놓인다.
   * 자리 값만 바꾸면 쥔 것은 그대로다.
   */
  function movePinned() {
    const offsets = pinOffsets();
    const rows = [headRow, searchRow, ...body.children].filter(Boolean);
    for (const row of rows) {
      for (let index = 0; index < state.pinned && index < row.children.length; index += 1) {
        const cell = /** @type {HTMLElement} */ (row.children[index]);
        if (cell.classList.contains('pinned')) cell.style.left = `${offsets[index]}px`;
      }
    }
  }

  function renderColgroup() {
    clear(colgroup).append(...state.columns.map((key) => el('col', {
      style: { width: `${state.widths[key] ?? DEFAULT_WIDTH}px` }
    })));
  }

  /**
   * 검색 칸이 앉을 자리 — 첫 줄의 **실제** 높이를 재어 CSS 에 넘긴다.
   *
   * 손으로 적어 둔 값과 어긋나면 두 줄 사이가 벌어지고, 그 틈으로 지나가는
   * 자료가 비친다. 글자 크기 하나만 바뀌어도 어긋나므로 매번 다시 잰다.
   */
  function measureHead() {
    const table = headRow.closest('table');
    if (!table) return;
    table.style.setProperty('--head-row1', `${headRow.getBoundingClientRect().height}px`);
  }

  function renderHead() {
    const offsets = pinOffsets();
    clear(headRow);
    if (searchRow) clear(searchRow);

    state.columns.forEach((key, index) => {
      const field = fields.get(key);
      const rank = state.sorts.findIndex((sort) => sort.key === key);
      const sort = rank === -1 ? null : state.sorts[rank];
      const pinned = index < state.pinned;

      const label = el('span', { class: 'truncate', text: field?.label ?? key });
      /*
       * 머리줄에는 **화살표만** 둔다.
       *
       * 몇째로 정렬됐는지는 표 위 정렬 칩줄이 숫자로 적고 있다. 여기에 ①②③을
       * 겹쳐 적었더니 같은 말이 두 번일 뿐 아니라, 동그라미 숫자가 열다섯까지밖에
       * 없어 열이 더 많은 표에서는 적을 글자가 떨어졌다.
       */
      const marks = el('span', { class: 'sort-mark shrink-0', text: sort ? (sort.dir === 'asc' ? '▲' : '▼') : '' });

      // 머리 칸도 몸 칸도 왼쪽이다. 숫자 열이라고 오른쪽으로 보내지 않는다
      const button = el('button', {
        class: 'flex min-w-0 flex-1 items-center gap-1',
        attrs: {
          type: 'button',
          title: `${field?.label ?? key} — 누르면 정렬 순위가 하나씩 쌓인다 (오름 → 내림 → 해제). Shift+누르면 이 열만으로 정렬. 끌면 열 순서가 바뀐다`,
          'aria-label': `${field?.label ?? key} 기준 정렬`
        },
        on: {
          click: (event) => {
            // 끌고 난 직후의 클릭은 정렬이 아니다
            if (swallowClick) { swallowClick = false; return; }
            state.sorts = toggleSort(state.sorts, key, event.shiftKey);
            announce();
            paint();
          }
        }
      }, [label, marks]);

      /*
       * 손잡이는 **눈에 보여야 한다.** 투명하게 두고 글귀로 "드래그하세요"라고
       * 적어 두었더니, 글귀는 마우스를 올려야 뜨는데 올릴 자리를 모르는 것이
       * 문제였다. 평소에는 회색 띠로 서 있고, 잡을 수 있게 되면 파래진다.
       */
      const handle = el('span', {
        /*
         * **잡는 자리는 넓게, 보이는 선은 가늘게.** 띠를 통째로 칠했더니 8px짜리
         * 회색 기둥이 열마다 서서 자료보다 눈에 먼저 들어왔다. 선은 2px만 그리고,
         * 손이 닿는 자리는 그대로 8px다.
         */
        class: 'absolute right-0 top-0 h-full w-2 cursor-col-resize before:absolute before:inset-y-0 before:right-0 before:w-0.5 before:bg-line before:transition-colors hover:before:bg-brand',
        attrs: { role: 'separator', 'aria-label': `${field?.label ?? key} 열 너비 조정` },
        on: { pointerdown: (event) => startResize(event, key) }
      });

      searchRow?.append(el('th', {
        class: `${pinned ? 'pinned' : ''} ${pinned && index === state.pinned - 1 ? 'pin-edge' : ''}`,
        style: pinned ? { left: `${offsets[index]}px` } : {}
      }, [
        el('div', { class: 'col-search' }, [
          el('input', {
            attrs: {
              type: 'search', value: columnSearch(key), placeholder: '검색',
              'aria-label': `${field?.label ?? key} 안에서 검색`
            },
            /*
             * 글자마다 다시 계산하지 않는다. 열이 80개인 표에서 한 글자마다 전체를
             * 다시 거르면 손가락이 멈출 때까지 화면이 따라오지 못한다.
             */
            on: { input: debounce((event) => onColumnSearch?.(key, event.target.value), 220) }
          }),
          // 누르면 그 열의 값 목록이 뜬다. 글자로 찾는 것과 목록에서 선택하는 것은 다른 조작이다
          el('button', {
            text: '≡',
            attrs: {
              type: 'button',
              /*
               * **걸린 열은 단추가 말한다.** 값 목록으로 거르면 머리줄에는 아무 흔적이
               * 남지 않아, 왜 행이 줄었는지 알려면 위쪽 칩줄까지 올라가야 했다.
               * 색만으로 알리지 않도록 읽어 주는 이름에도 적는다 (§9).
               */
              'aria-label': columnFiltered(key)
                ? `${field?.label ?? key} 값 목록 — 지금 걸려 있음`
                : `${field?.label ?? key} 값 목록`,
              'data-filtered': columnFiltered(key) ? 'true' : null,
              'aria-expanded': String(openFilterKey === key),
              title: columnFiltered(key) ? '이 열에 값 필터가 걸려 있습니다' : '값 목록에서 선택'
            },
            on: {
              click: (event) => {
                event.stopPropagation();
                onColumnFilter?.(key, event.currentTarget);
              }
            }
          })
        ])
      ]));

      headRow.append(el('th', {
        class: `relative ${sort ? 'sorted' : ''} ${pinned ? 'pinned' : ''} ${pinned && index === state.pinned - 1 ? 'pin-edge' : ''}`,
        attrs: {
          scope: 'col',
          'data-key': key,
          'aria-sort': sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
        },
        style: pinned ? { left: `${offsets[index]}px` } : {},
        on: { pointerdown: (event) => startReorder(event, index) }
      }, [el('span', { class: 'flex h-full items-center gap-1 pr-2' }, [button]), handle]));
    });

    measureHead();
  }

  /**
   * 머리를 끌어 열 순서를 바꾼다.
   *
   * 같은 손짓이 정렬도 하고 자리도 옮기므로, **얼마나 움직였는지로 둘을 구별한다.**
   * `DRAG_SLOP`을 넘기 전에는 아무 일도 일어나지 않고, 넘지 않은 채 손을 떼면 클릭이다.
   */
  function startReorder(event, from) {
    // 왼쪽 단추만, 그리고 너비 손잡이를 잡은 것은 아닐 때
    if (event.button !== 0 || event.target.getAttribute('role') === 'separator') return;

    // 앞선 드래그의 삼킴 표시를 여기서 턴다. 끌고 나서 click이 안 올 수도 있는데
    // (포인터 취소·머리줄이 새로 그려짐) 그때 표시가 남으면 **다음 클릭 하나가 먹힌다**
    swallowClick = false;
    const startX = event.clientX;
    let dragging = false;
    let to = from;

    const move = (moveEvent) => {
      if (!dragging && Math.abs(moveEvent.clientX - startX) < DRAG_SLOP) return;
      dragging = true;
      to = columnIndexAt(moveEvent.clientX);
      markDrop(to);
    };

    const up = () => {
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
      markDrop(null);
      if (!dragging || to === from) return;
      // 움직였으면 이어서 올 click은 정렬이 아니다
      swallowClick = true;
      const rest = state.columns.filter((_, index) => index !== from);
      state.columns = [...rest.slice(0, to), state.columns[from], ...rest.slice(to)];
      announce();
      paint();
    };

    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
  }

  /** 지금 손이 있는 x가 몇 번째 열인지. 칸의 한가운데를 경계로 삼는다. */
  function columnIndexAt(clientX) {
    const cells = headRow.children;
    for (let index = 0; index < cells.length; index += 1) {
      const box = cells[index].getBoundingClientRect();
      if (clientX < box.left + box.width / 2) return index;
    }
    return Math.max(0, cells.length - 1);
  }

  /** 떨어뜨릴 자리를 선으로 알린다. 없으면 선을 지운다. */
  function markDrop(index) {
    for (const cell of headRow.children) cell.classList.remove('drop-mark');
    if (index !== null) headRow.children[index]?.classList.add('drop-mark');
  }

  /** 드래그로 너비 조정. */
  function startResize(event, key) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.widths[key] ?? DEFAULT_WIDTH;
    const handle = /** @type {HTMLElement} */ (event.currentTarget);
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent) => {
      state.widths[key] = Math.max(MIN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX));
      renderColgroup();
      // 고정 열의 너비가 바뀌면 뒤따르는 고정 열의 자리도 바뀐다
      if (state.columns.indexOf(key) < state.pinned) movePinned();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      announce();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }


  /**
   * 행이 시작하는 자리. 스크롤 상자 안에서 표 위에 놓인 것들의 높이다.
   *
   * 요약 띠가 같은 상자 안에서 스크롤되므로(#2) `scrollTop`이 그만큼 더 크다.
   * 빼지 않으면 창이 아래로 밀려 윗행이 빈 채로 남는다.
   */
  const rowsTop = () =>
    body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

  const windowRange = () =>
    visibleWindow(scroller.scrollTop - rowsTop(), scroller.clientHeight, rows.length);

  function renderBody(force = false) {
    const { start, end } = windowRange();
    if (!force && start === drawn.start && end === drawn.end) return;
    drawn = { start, end };

    const offsets = pinOffsets();
    const parts = [];

    // 창 위아래의 빈자리를 높이만 가진 행으로 채운다. 스크롤 막대가 실제 행 수를 나타내야 한다
    if (start > 0) {
      parts.push(el('tr', { attrs: { 'aria-hidden': 'true' }, style: { height: `${start * ROW_HEIGHT}px` } }));
    }

    for (let index = start; index < end; index += 1) {
      const row = rows[index];
      const outcome = row['#outcome'];
      const tr = el('tr', {
        class: 'cursor-pointer',
        attrs: { tabindex: '0', 'data-sid': row.sid ?? '' },
        on: {
          click: () => onRowOpen?.(row),
          keydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRowOpen?.(row); }
          }
        }
      });

      state.columns.forEach((key, columnIndex) => {
        const field = fields.get(key);
        const pinned = columnIndex < state.pinned;
        const text = cellText(key, row[key]);

        // 결과 열만 색과 모양을 함께 붙인다. 색만으로 구분하지 않는다 (§7)
        const content = key === 'outcome' && outcome
          ? el('span', { class: `tag tag-${outcome.code === 'waitPass' ? 'wait' : outcome.code === 'pass' ? 'pass' : outcome.code === 'fail' ? 'fail' : outcome.code === 'unknown' ? 'unknown' : 'none'}` }, [
              el('span', { attrs: { 'aria-hidden': 'true' }, text: outcome.mark }),
              el('span', { text: outcome.label })
            ])
          : text;

        tr.append(el('td', {
          // `figure`는 자릿수만 맞춘다. 정렬은 스타일시트 한 자리에서만 정한다
          class: `${field?.numeric ? 'figure' : ''} ${pinned ? 'pinned' : ''} ${pinned && columnIndex === state.pinned - 1 ? 'pin-edge' : ''}`,
          // 잘린 값을 마우스로 확인할 수 있게 한다
          attrs: text ? { title: text } : {},
          style: pinned ? { left: `${offsets[columnIndex]}px` } : {}
        }, [content]));
      });

      parts.push(tr);
    }

    if (end < rows.length) {
      parts.push(el('tr', { attrs: { 'aria-hidden': 'true' }, style: { height: `${(rows.length - end) * ROW_HEIGHT}px` } }));
    }

    clear(body).append(...parts);
  }

  const repaintBody = () => renderBody(true);

  function paint() {
    const hasRows = rows.length > 0;
    /*
     * 결과가 없어도 **아무것도 감추지 않는다.**
     *
     * 스크롤 상자를 통째로 감췄더니 그 안에 든 요약 띠·검색칸·단추줄·칩이 함께
     * 사라졌다. 검색어를 잘못 쳐서 0건이 된 사람은 고쳐 칠 칸마저 잃고, 화면에는
     * "없습니다" 한 줄만 남는다. 빠져나올 길을 지우면 안 된다.
     *
     * 표도 머리줄까지는 남긴다. 머리줄의 열별 검색칸이 0건을 만든 장본인일 때가
     * 많아서, 그 칸이 보여야 무엇을 지울지 알 수 있다. 비는 것은 몸통뿐이다.
     */
    empty.classList.toggle('hidden', hasRows);
    renderColgroup();
    renderHead();
    repaintBody();
  }

  scroller.addEventListener('scroll', () => renderBody(), { passive: true });

  // 창 크기가 바뀌면 보이는 행 수도 바뀐다. 다시 그리지 않으면 아래쪽이 빈 채로 남는다
  if (globalThis.ResizeObserver) {
    new globalThis.ResizeObserver(() => renderBody(true)).observe(scroller);
  }

  return {
    /**
     * @param {{rows: object[], registry: object[], state: object}} next
     */
    render(next) {
      rows = next.rows;
      fields = new Map(next.registry.map((field) => [field.key, field]));
      state = next.state;
      // 너비가 정해지지 않은 열에 어울리는 값을 넣어 준다
      for (const key of state.columns) {
        if (!state.widths[key]) state.widths[key] = suggestWidth(fields.get(key) ?? { key });
      }
      scroller.scrollTop = 0;
      drawn = { start: -1, end: -1 };
      paint();
    },
    /** 자료는 그대로 두고 정렬·열만 다시 그린다. */
    repaint: paint,
    /** 어느 열의 값 목록이 떠 있는지 알려 준다. 깔때기 단추의 모양이 따라간다. */
    markOpenFilter(key) {
      if (openFilterKey === key) return;
      openFilterKey = key;
      renderHead();
    },
    get state() { return state; }
  };
}
