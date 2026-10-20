/**
 * DOM 잔손질.
 *
 * 프레임워크를 두지 않는다. 화면 하나에 표 하나가 중심이고, 그 표는
 * 정렬·리사이즈·고정을 우리가 직접 통제해야 해서(§8) 어차피 손으로 만든다.
 *
 * **모든 글자는 `textContent`로 넣는다.** 엑셀 셀 값이 곧 화면 글자라서,
 * `innerHTML`을 쓰는 순간 원본 파일의 내용이 화면을 조종할 수 있게 된다.
 */

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
export function pick(selector) {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`화면 요소를 찾지 못했습니다: ${selector}`);
  return /** @type {HTMLElement} */ (found);
}

/**
 * 요소 하나를 만든다.
 *
 * @param {string} tag
 * @param {{class?: string, text?: string, attrs?: Record<string, string|number|boolean|null>, style?: Record<string, string>, on?: Record<string, EventListener>}} [options]
 * @param {(Node|string|null|false|undefined)[]} [children]
 */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === false || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, value] of Object.entries(options.style ?? {})) {
    node.style.setProperty(name, value);
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(name, handler);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** @param {Element} node */
export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * 대화상자를 연다. 대화상자 안쪽 틀은 매번 새로 그린다.
 * @param {HTMLDialogElement} dialog
 * @param {Node} content
 */
export function openDialog(dialog, content) {
  clear(dialog).append(content);
  if (!dialog.open) dialog.showModal();
  // 바깥(backdrop)을 누르면 닫는다. 안쪽 클릭과 구분해야 한다
  dialog.onclick = (event) => {
    if (event.target === dialog) dialog.close();
  };
  return dialog;
}

/**
 * 대화상자 공통 틀: 제목 · 내용 · 아래 단추줄.
 *
 * @param {{title: string, note?: string, body: Node, footer?: Node, onClose?: () => void}} options
 */
export function dialogFrame({ title, note, body, footer, onClose }) {
  return el('div', { class: 'flex max-h-[86vh] flex-col' }, [
    el('div', { class: 'flex items-start gap-4 border-b border-line px-6 py-4' }, [
      el('div', { class: 'min-w-0 flex-1' }, [
        el('h2', { class: 'text-xl font-bold tracking-tight', text: title }),
        note ? el('p', { class: 'mt-1 text-base text-ink-soft', text: note }) : null
      ]),
      el('button', {
        class: 'btn btn-sm',
        text: '닫기',
        attrs: { type: 'button' },
        on: { click: () => onClose?.() }
      })
    ]),
    el('div', { class: 'min-h-0 flex-1 overflow-y-auto px-6 py-5' }, [body]),
    footer ? el('div', { class: 'flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4' }, [footer]) : null
  ]);
}

/**
 * 잠깐 기다렸다 한 번만 부른다. 검색은 글자마다 다시 계산하지 않는다 (§7).
 * @param {Function} run
 * @param {number} delay
 */
export function debounce(run, delay = 180) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => run(...args), delay);
  };
}

/** 숫자를 화면용으로 정리한다. */
export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '');
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
