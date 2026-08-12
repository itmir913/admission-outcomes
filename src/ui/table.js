/**
 * 표 — 상담의 주 도구 (§7).
 *
 * 라이브러리를 쓰지 않는 이유는 §8에 있다. 정렬·리사이즈·고정을 우리가 통제해야 하고,
 * 자료 규모가 그리드 라이브러리를 정당화하지 않는다.
 *
 * 대교협은 81열이다. 전부 펼치면 가로 스크롤이 불가피한데, 그때 익명 ID와 대학이
 * 화면 밖으로 나가면 표를 읽을 수 없다. **열 고정이 장식이 아닌 이유다.**
 *
 * 행이 많아도 눈에 보이는 만큼만 그린다. 1만 행 × 12열이면 12만 칸이고,
 * 다 그리면 필터를 건드릴 때마다 화면이 멈춘다.
 */

import { el, clear, formatNumber } from './dom.js';
import { valueLabel, isBlank } from '../analysis/registry.js';
import { toggleSort } from '../analysis/query.js';

/** 행 높이. CSS의 `--spacing-row`와 같아야 창 밖 행 수 계산이 맞는다. */
const ROW_HEIGHT = 44;
/** 창 위아래로 더 그려 두는 행. 스크롤할 때 빈칸이 스쳐 지나가지 않게 한다. */
const OVERSCAN = 8;

export const MIN_WIDTH = 64;
export const DEFAULT_WIDTH = 150;

/** 열마다 어울리는 기본 너비. 대학명은 넓게, 등급은 좁게. */
export function suggestWidth(field) {
  if (field.key === 'sid') return 150;
  if (field.key === 'univ' || field.key === 'dept' || field.key === 'admName') return 200;
  if (field.group === 'gpa' || field.type === 'year') return 100;
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

/** 정렬 순번 배지. 1·2·3위를 눈으로 세게 한다. */
const ORDER_BADGE = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

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
export function createTable({ scroller, colgroup, headRow, body, empty, onRowOpen, onStateChange }) {
  /** @type {object[]} */
  let rows = [];
  /** @type {Map<string, object>} */
  let fields = new Map();
  /** @type {{columns: string[], widths: Record<string, number>, pinned: number, sorts: object[]}} */
  let state = { columns: [], widths: {}, pinned: 2, sorts: [] };

  /** 지금 그려 둔 창. 같은 창이면 다시 그리지 않는다 */
  let drawn = { start: -1, end: -1 };

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

  function renderColgroup() {
    clear(colgroup).append(...state.columns.map((key) => el('col', {
      style: { width: `${state.widths[key] ?? DEFAULT_WIDTH}px` }
    })));
  }

  function renderHead() {
    const offsets = pinOffsets();
    clear(headRow);

    state.columns.forEach((key, index) => {
      const field = fields.get(key);
      const rank = state.sorts.findIndex((sort) => sort.key === key);
      const sort = rank === -1 ? null : state.sorts[rank];
      const pinned = index < state.pinned;

      const label = el('span', { class: 'truncate', text: field?.label ?? key });
      const marks = el('span', { class: 'shrink-0 text-brand', text: sort ? (sort.dir === 'asc' ? '▲' : '▼') : '' });
      // 여러 열로 정렬 중일 때만 순번을 붙인다. 하나뿐이면 ①이 군더더기다
      const badge = state.sorts.length > 1 && rank !== -1
        ? el('span', { class: 'shrink-0 text-xs font-bold text-brand', text: ORDER_BADGE[rank] ?? `${rank + 1}` })
        : null;

      const button = el('button', {
        class: `flex min-w-0 flex-1 items-center gap-1 text-left ${field?.numeric ? 'justify-end' : ''}`,
        attrs: {
          type: 'button',
          title: `${field?.label ?? key} — 누르면 정렬, Shift+누르면 차순위로 쌓임`,
          'aria-label': `${field?.label ?? key} 기준 정렬`
        },
        on: {
          click: (event) => {
            state.sorts = toggleSort(state.sorts, key, event.shiftKey);
            announce();
            paint();
          }
        }
      }, [label, badge, marks]);

      const handle = el('span', {
        class: 'absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-brand/30',
        attrs: { role: 'separator', 'aria-label': `${field?.label ?? key} 열 너비 조정`, title: '드래그로 너비 조정 · 더블클릭하면 내용에 맞춤' },
        on: {
          pointerdown: (event) => startResize(event, key),
          dblclick: () => fitColumn(key)
        }
      });

      headRow.append(el('th', {
        class: `relative ${pinned ? 'pinned' : ''} ${pinned && index === state.pinned - 1 ? 'pin-edge' : ''}`,
        attrs: {
          scope: 'col',
          'aria-sort': sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
        },
        style: pinned ? { left: `${offsets[index]}px` } : {}
      }, [el('span', { class: 'flex h-full items-center gap-1 pr-2' }, [button]), handle]));
    });
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
      if (state.columns.indexOf(key) < state.pinned) { renderHead(); repaintBody(); }
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
   * 내용에 맞춰 너비를 잡는다.
   *
   * 지금 화면에 그려진 칸만 재는 것이 아니라 **모든 행의 값**을 잰다.
   * 창 밖 행이 더 길면 맞춤이 무의미해진다.
   */
  function fitColumn(key) {
    const field = fields.get(key);
    const canvas = fitColumn.canvas ?? (fitColumn.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    const style = getComputedStyle(document.body);
    context.font = `${style.fontSize} ${style.fontFamily}`;

    let widest = context.measureText(field?.label ?? key).width;
    for (const row of rows) {
      const text = cellText(key, row[key]);
      if (!text) continue;
      const width = context.measureText(text).width;
      if (width > widest) widest = width;
    }
    // 좌우 여백 + 정렬 표시 자리
    state.widths[key] = Math.max(MIN_WIDTH, Math.min(520, Math.ceil(widest) + 44));
    renderColgroup();
    renderHead();
    repaintBody();
    announce();
  }

  const windowRange = () => visibleWindow(scroller.scrollTop, scroller.clientHeight, rows.length);

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
          class: `${field?.numeric ? 'num' : ''} ${pinned ? 'pinned' : ''} ${pinned && columnIndex === state.pinned - 1 ? 'pin-edge' : ''}`,
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
    scroller.classList.toggle('hidden', !hasRows);
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
    get state() { return state; }
  };
}
