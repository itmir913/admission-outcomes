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

import { el, clear, debounce } from './dom.js';
import { valueLabel, isBlank } from '../analysis/registry.js';
import { toggleSort } from '../analysis/query.js';

/**
 * 행 높이의 **출발값**. CSS의 `--spacing-row`에서 왔다.
 *
 * 실제로 그려진 행은 이보다 높다 — 칸선 몫에 글자 배율까지 붙어 46~47px이 된다.
 * 그 차이만큼 자리 계산이 밀리면 오버스캔이 먹히다가 어느 순간 **아래쪽이 빈다.**
 * 그래서 그린 뒤에 한 번 재어 그 값을 쓴다(`measuredRowHeight`). 이 상수는 아직
 * 아무것도 그리지 못한 첫 순간에만 쓰인다.
 */
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
export function visibleWindow(scrollTop, viewportHeight, rowCount, rowHeight = ROW_HEIGHT) {
  // 아직 자리를 잡지 못한 순간(높이 0)에도 한 화면은 그려 둔다.
  // 안 그리면 스크롤할 것이 없어 스크롤 이벤트도 영영 오지 않는다
  const viewport = viewportHeight > 0 ? viewportHeight : 600;
  const step = rowHeight > 0 ? rowHeight : ROW_HEIGHT;
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / step));
  const count = Math.ceil(viewport / step);
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(rowCount, first + count + OVERSCAN)
  };
}


/** 셀 하나를 화면 글자로. */
export function cellText(key, value) {
  // 1단계의 `null`은 「해당 없음」이라는 값이다. 빈칸으로 접으면 값 목록에서 선택한
  // 「해당 없음」 1건이 표에서는 빈칸으로 보이고, 보고 그대로 쳐도 찾히지 않는다
  if (key === 'stage1Passed') return valueLabel(key, value);
  if (isBlank(value)) return '';
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
export function createTable({ scroller, colgroup, headRow, searchRow, body, empty, onRowOpen, onStateChange, onColumnSearch, columnSearch = () => '', columnFiltered = () => false, onColumnFilter, onPinnedChange }) {
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

  /**
   * **실제로 고정할 열 수.** 사람이 정한 수보다 적을 수 있다.
   *
   * 좁은 화면에서는 고정 열 너비의 합이 화면보다 넓어질 수 있다. 그러면 뒤쪽
   * 고정 열이 앞쪽 고정 열 위에 그대로 깔려 그 열이 통째로 가려지고, 고정되지
   * 않은 자료 열은 음수 자리로 밀려 **닿을 길이 없어진다.** 375px에서 기본값
   * 셋이 바로 그렇게 된다. 사람이 정한 수는 그대로 두고(화면이 넓어지면 돌아온다)
   * 자리만 화면에 맞춰 줄인다.
   */
  function 유효고정() {
    const 쓸수있는폭 = scroller.clientWidth || 0;
    /*
     * **폭을 못 재면 하나만 고정한다.** 상한을 끄면 시작 화면이 떠 있어 표가 아직
     * 자리를 못 받은 순간(폭 0)에 사람이 정한 수가 그대로 그려지고, 그 머리줄이
     * 겹친 채 남는다 — 실제로 375px에서 재현됐다 (§5).
     */
    if (쓸수있는폭 === 0) return Math.min(1, state.pinned, state.columns.length);
    const 한도 = 쓸수있는폭 * 0.6;
    let sum = 0;
    let count = 0;
    for (let index = 0; index < state.pinned && index < state.columns.length; index += 1) {
      const width = state.widths[state.columns[index]] ?? DEFAULT_WIDTH;
      if (count > 0 && sum + width > 한도) break;
      sum += width;
      count += 1;
    }
    return count;
  }

  /** 고정 열이 앉을 왼쪽 자리. 앞선 열들의 실제 너비 합이다. */
  function pinOffsets() {
    const offsets = [];
    let sum = 0;
    const 고정수 = 유효고정();
    for (let index = 0; index < 고정수 && index < state.columns.length; index += 1) {
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
    const 고정수 = 유효고정();
    const rows = [headRow, searchRow, ...body.children].filter(Boolean);
    /*
     * **고정에서 빠진 칸은 그 자리에서 떼 준다.**
     *
     * 너비를 끌어 한도를 넘기는 동안에는 머리줄을 다시 그릴 수 없다 — 손잡이 노드에
     * 포인터를 붙들어 두었으므로 노드가 바뀌면 끌기가 끊긴다. 앞쪽 자리만 고쳐 쓰면
     * 빠져야 할 뒤쪽 칸이 옛 자리를 달고 남아 고정 열끼리 포개진다. 끄는 그 순간이
     * 바로 사람이 그 자리를 보고 있는 때다.
     */
    for (const row of rows) {
      for (let index = 고정수; index < row.children.length; index += 1) {
        const cell = /** @type {HTMLElement} */ (row.children[index]);
        if (!cell.classList.contains('pinned')) continue;
        cell.classList.remove('pinned', 'pin-edge');
        cell.style.left = '';
      }
      /*
       * **다시 들어갈 자리가 생기면 되돌려 붙인다.** 빼기만 하면, 끌어 넓혔다가
       * 같은 끌기 안에서 도로 줄여도 고정이 돌아오지 않는다 — 사람은 아까 너비로
       * 되맞췄는데 왜 그대로인지 알 수 없다.
       *
       * 경계선은 **마지막 고정 칸에만** 둔다. 고정 수가 늘면 옛 경계가 앞자리에
       * 남아 선이 둘이 되고, 거기까지만 고정된 것처럼 보인다 — 좁은 화면에서
       * 고정이 어디서 끝나는지 알려 주는 단서가 그 선뿐이다 (§9).
       */
      for (let index = 0; index < 고정수 && index < row.children.length; index += 1) {
        const cell = /** @type {HTMLElement} */ (row.children[index]);
        cell.classList.add('pinned');
        cell.classList.toggle('pin-edge', index === 고정수 - 1);
      }
      if (고정수 > 0) {
        const edge = /** @type {HTMLElement} */ (row.children[고정수 - 1]);
        if (edge?.classList.contains('pinned')) edge.classList.add('pin-edge');
      }
      for (let index = 0; index < 고정수 && index < row.children.length; index += 1) {
        const cell = /** @type {HTMLElement} */ (row.children[index]);
        if (cell.classList.contains('pinned')) cell.style.left = `${offsets[index]}px`;
      }
    }
    // 끌기 경로도 도구줄에 알린다. 알리지 않으면 고정이 셋에서 하나로 줄어도 숫자는 셋이다
    if (고정수 !== 그린고정수) {
      그린고정수 = 고정수;
      onPinnedChange?.(고정수);
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
    /*
     * **치던 자리를 기억했다 돌려준다.**
     *
     * 머리줄 검색은 220ms 뒤에 표를 다시 그리는데, 그때 이 줄을 통째로 새로 만든다.
     * 글자는 새 칸에 그대로 남지만 커서가 사라져서, 잠깐 멈췄다 이어 치면 그 뒤
     * 글자가 어디에도 들어가지 않는다 — 사람은 다 쳤다고 믿고 덜 걸러진 표를 본다.
     */
    const 치던칸 = document.activeElement;
    /*
     * 검색칸과 「≡」 단추를 **따로 기억한다.**
     *
     * 둘을 한 가지로 치면 값 목록을 연 사람의 포커스가 검색칸으로 끌려가고,
     * 검색칸만 되돌리면 단추를 누른 사람은 포커스를 잃는다 — 그러면 Tab이 문서
     * 맨 앞으로 돌아가, 방금 연 목록까지 표 전체를 지나야 닿는다.
     */
    const 치던자리 = 치던칸?.closest?.('th');
    const 치던열 = 치던자리 && searchRow?.contains(치던칸)
      ? [...(searchRow?.children ?? [])].indexOf(치던자리)
      : -1;
    const 치던것 = 치던칸?.tagName === 'INPUT' ? 'search' : 'filter';
    const 커서 = 치던열 === -1 ? null : { start: 치던칸.selectionStart, end: 치던칸.selectionEnd };

    clear(headRow);
    if (searchRow) clear(searchRow);

    const 고정수 = 유효고정();
    const 바뀌었다 = 고정수 !== 그린고정수;
    그린고정수 = 고정수;
    state.columns.forEach((key, index) => {
      const field = fields.get(key);
      const rank = state.sorts.findIndex((sort) => sort.key === key);
      const sort = rank === -1 ? null : state.sorts[rank];
      const pinned = index < 고정수;

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
        class: `${pinned ? 'pinned' : ''} ${pinned && index === 고정수 - 1 ? 'pin-edge' : ''}`,
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
        class: `relative ${sort ? 'sorted' : ''} ${pinned ? 'pinned' : ''} ${pinned && index === 고정수 - 1 ? 'pin-edge' : ''}`,
        attrs: {
          scope: 'col',
          'data-key': key,
          'aria-sort': sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
        },
        style: pinned ? { left: `${offsets[index]}px` } : {},
        on: { pointerdown: (event) => startReorder(event, index) }
      }, [el('span', { class: 'flex h-full items-center gap-1 pr-2' }, [button]), handle]));
    });

    if (치던열 !== -1) {
      const 새자리 = searchRow?.children[치던열];
      const 새칸 = 치던것 === 'search'
        ? 새자리?.querySelector('input')
        : 새자리?.querySelector('button');
      if (새칸) {
        새칸.focus({ preventScroll: true });
        if (치던것 === 'search' && 커서?.start !== null && 커서?.start !== undefined) {
          새칸.setSelectionRange(커서.start, 커서.end ?? 커서.start);
        }
      }
    }

    measureHead();
    // **그린 뒤에 알린다.** 그리기 전에 읽으면 도구줄이 한 걸음 뒤처진 수를 적는다
    if (바뀌었다) onPinnedChange?.(고정수);
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

  /** 그려 본 행에서 잰 실제 높이. 재기 전에는 CSS 눈금을 쓴다 */
  let measuredRowHeight = ROW_HEIGHT;
  /** 다시 재다가 또 다시 재는 일을 막는다 */
  let 재측정중 = false;
  /** 머리줄을 마지막으로 그릴 때 쓴 고정 열 수. 바뀌면 다시 그려야 한다 */
  let 그린고정수 = -1;

  /**
   * 인쇄하는 동안에는 **가상 스크롤을 끈다.**
   *
   * 화면에서는 보이는 구간만 그리고 위아래 나머지는 높이만 가진 빈 행으로 메운다.
   * 종이에는 그 빈 행이 그대로 빈 자리로 찍혀, A4 50쪽을 넘기면서 정작 자료는
   * 한 화면 분량밖에 들어 있지 않았다. 종이에는 모든 행이 나와야 한다.
   */
  let 인쇄중 = false;

  const windowRange = () =>
    인쇄중
      ? { start: 0, end: rows.length }
      : visibleWindow(scroller.scrollTop - rowsTop(), scroller.clientHeight, rows.length, measuredRowHeight);

  /** 인쇄 전후로 그리는 범위를 바꾼다. 돌아올 때 다시 그려야 스크롤이 제자리를 찾는다 */
  const 인쇄모드 = (켬) => {
    인쇄중 = 켬;
    drawn = { start: -1, end: -1 };
    renderBody(true);
  };

  // 단추로 눌렀을 때도, Ctrl+P로 눌렀을 때도 같은 자리에서 받는다
  globalThis.addEventListener?.('beforeprint', () => 인쇄모드(true));
  globalThis.addEventListener?.('afterprint', () => 인쇄모드(false));

  function renderBody(force = false) {
    const { start, end } = windowRange();
    if (!force && start === drawn.start && end === drawn.end) return;
    drawn = { start, end };

    const offsets = pinOffsets();
    const 고정수 = 유효고정();
    const parts = [];

    // 창 위아래의 빈자리를 높이만 가진 행으로 채운다. 스크롤 막대가 실제 행 수를 나타내야 한다
    if (start > 0) {
      parts.push(el('tr', { attrs: { 'aria-hidden': 'true' }, style: { height: `${start * measuredRowHeight}px` } }));
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
        const pinned = columnIndex < 고정수;
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
          class: `${field?.numeric ? 'figure' : ''} ${pinned ? 'pinned' : ''} ${pinned && columnIndex === 고정수 - 1 ? 'pin-edge' : ''}`,
          // 잘린 값을 마우스로 확인할 수 있게 한다
          attrs: text ? { title: text } : {},
          style: pinned ? { left: `${offsets[columnIndex]}px` } : {}
        }, [content]));
      });

      parts.push(tr);
    }

    if (end < rows.length) {
      parts.push(el('tr', { attrs: { 'aria-hidden': 'true' }, style: { height: `${(rows.length - end) * measuredRowHeight}px` } }));
    }

    clear(body).append(...parts);

    /*
     * **그린 뒤에 한 번 잰다.** 칸선과 글자 배율 때문에 실제 행은 CSS 눈금보다 높다.
     * 그 차이를 모르면 위 빈자리가 실제보다 짧게 잡혀, 스크롤을 내릴수록 창과 그린
     * 구간이 어긋나다 아래쪽이 빈다.
     */
    const 실제행 = [...body.children].find((node) => node.getAttribute('aria-hidden') !== 'true');
    const 높이 = 실제행?.getBoundingClientRect().height ?? 0;
    // 한 번만 다시 그린다. 행마다 높이가 다른 날이 오면 두 값 사이를 오가며 멈추지 않는다
    if (높이 > 0 && Math.abs(높이 - measuredRowHeight) > 0.5 && !재측정중) {
      재측정중 = true;
      measuredRowHeight = 높이;
      // 자를 바꿨으니 빈자리도 다시 잰 값으로 그린다
      drawn = { start: -1, end: -1 };
      renderBody(true);
      재측정중 = false;
    }
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
    늦은보정();
  }

  /**
   * **자리를 받은 뒤에 다시 잰다.**
   *
   * 처음 그릴 때 표가 아직 폭을 못 받았으면 고정 열 수를 잘못 잡는다. 그 뒤
   * 레이아웃이 끝나도 스크롤 상자의 크기가 더 바뀌지 않으면 관찰자는 깨어나지
   * 않아, 그려 둔 고정 수가 틀린 채로 남는다 — 좁은 화면에서는 고정 열이 서로를
   * 덮어 자료 열에 닿을 수 없게 된다. 화면은 아무 말도 하지 않는다 (§5).
   *
   * **한 프레임만 보지 않는다.** 그 프레임 안에 레이아웃이 끝나지 않는 경우가
   * 네 번에 한 번꼴로 실제로 났다. 몇 번 더 재고, 스크롤할 때도 한 번 본다.
   */
  function 늦은보정() {
    const 재기 = () => {
      if (유효고정() === 그린고정수) return;
      renderHead();
      renderBody(true);
    };
    globalThis.requestAnimationFrame?.(() => {
      재기();
      globalThis.requestAnimationFrame?.(재기);
    });
    globalThis.setTimeout?.(재기, 150);
  }

  scroller.addEventListener('scroll', () => {
    if (유효고정() !== 그린고정수) renderHead();
    renderBody();
  }, { passive: true });

  // 창 크기가 바뀌면 보이는 행 수도 바뀐다. 다시 그리지 않으면 아래쪽이 빈 채로 남는다
  if (globalThis.ResizeObserver) {
    /*
     * 화면 폭이 바뀌면 **실제로 고정할 열 수**가 달라진다. 머리줄을 그대로 두면
     * 자리 값만 바뀌어 고정 표시와 실제 고정이 어긋나므로, 바뀐 때만 다시 그린다.
     */
    new globalThis.ResizeObserver(() => {
      if (유효고정() !== 그린고정수) {
        renderHead();
        // 도구줄이 적는 「지금 n개만」도 따라가야 한다
        onPinnedChange?.(유효고정());
      }
      renderBody(true);
    }).observe(scroller);
  }

  return {
    /**
     * 화면에 **실제로 그려진** 고정 열 수. 아직 한 번도 그리지 못했으면 `null`이다.
     *
     * 지금 계산한 값을 주면 안 된다 — 표가 아직 폭도 열도 못 받은 순간에 물으면
     * 0이 나오고, 도구줄은 「지금 0개만」이라 적는다. 세 열이 멀쩡히 고정돼 있는데
     * 하나도 고정 안 됐다고 적는 화면이다. 모르면 모른다고 답한다 (§5).
     */
    drawnPinned: () => (그린고정수 < 0 ? null : 그린고정수),

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
