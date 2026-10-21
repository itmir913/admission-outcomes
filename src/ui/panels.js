/**
 * 곁다리 화면 둘 — 불러온 파일 목록과 열 선택.
 *
 * 파일 목록은 설정 깊숙이 숨기지 않는다. 무엇이 들어 있는지 늘 확인할 수 있어야
 * 사람이 이 도구를 믿고 쓴다(CLAUDE.md §1).
 */

import { el, clear, openDialog, dialogFrame } from './dom.js';
import { GROUP_LABEL, GROUP_ORDER } from '../analysis/registry.js';

/**
 * 불러온 파일 목록.
 *
 * @param {HTMLDialogElement} dialog
 * @param {object} options
 * @param {object[]} options.files
 * @param {Map<string, number>} options.rowCounts 파일 해시별 지원 건수
 * @param {(hash: string) => void} options.onRemove
 * @param {() => void} options.onClearAll
 * @param {() => void} options.onAdd
 * @param {{usage: number, quota: number}|null} [options.storage]
 */
export function openFiles(dialog, { files, rowCounts, onRemove, onClearAll, onAdd, storage }) {
  const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

  const body = el('div', {}, [
    files.length === 0
      ? el('p', { class: 'py-8 text-center text-lg text-ink-soft', text: '불러온 파일이 없습니다.' })
      : el('ul', { class: 'space-y-3' }, files.map((file) => el('li', { class: 'card flex flex-wrap items-center gap-3 px-5 py-4' }, [
          el('div', { class: 'min-w-0 flex-1' }, [
            el('p', { class: 'truncate text-lg font-semibold', text: file.name, attrs: { title: file.name } }),
            el('p', {
              class: 'mt-0.5 text-base text-ink-soft',
              text: [
                file.container ? `${file.container} 안` : null,
                (file.cohortYears ?? []).filter((year) => year !== null && year !== undefined).length > 0
                  ? `고3 ${file.cohortYears.filter(Boolean).join(', ')}년`
                  : '행마다 연도',
                `${rowCounts.get(file.hash) ?? 0}건`,
                (file.sheets ?? []).length > 1 ? `시트 ${file.sheets.length}장` : null,
                // 어떻게 읽어 냈는지를 남긴다. 나중에 값이 이상할 때 먼저 볼 자리다
                file.profileId ?? (file.resolvedBy === 'names' ? '이름으로 알아냄' : null)
              ].filter(Boolean).join(' · ')
            })
          ]),
          el('button', {
            class: 'btn btn-sm btn-danger', text: '이 파일 제외',
            attrs: { type: 'button' },
            on: {
              click: () => {
                if (confirm(`${file.name}이(가) 넣은 기록을 지웁니다. 계속할까요?`)) onRemove(file.hash);
              }
            }
          })
        ]))),

    storage
      ? el('p', { class: 'mt-5 text-base text-ink-soft', text: `브라우저 보관 ${megabytes(storage.usage)} / ${megabytes(storage.quota)}` })
      : null,

    el('div', { class: 'mt-5 rounded-xl bg-canvas px-4 py-3 text-base leading-relaxed text-ink-soft' }, [
      el('p', {}, [
        '이 보관소는 ',
        el('strong', { class: 'text-ink', text: '원본이 아니라 캐시' }),
        '입니다. 시크릿 모드·캐시 삭제·PC 교체로 사라집니다. 원본 엑셀은 따로 보관해 주세요.'
      ])
    ])
  ]);

  openDialog(dialog, dialogFrame({
    title: '현재 엑셀 파일',
    note: `${files.length}개`,
    body,
    onClose: () => dialog.close(),
    footer: el('div', { class: 'flex w-full items-center gap-3' }, [
      el('button', {
        class: 'btn btn-danger mr-auto', text: '자료 초기화', attrs: { type: 'button' },
        on: { click: onClearAll }
      }),
      el('button', { class: 'btn', text: '닫기', attrs: { type: 'button' }, on: { click: () => dialog.close() } }),
      el('button', { class: 'btn btn-primary', text: '파일 추가', attrs: { type: 'button' }, on: { click: onAdd } })
    ])
  }));
}

/**
 * 열 선택 — 표시/숨김 · 차례 바꾸기 · 좌측 고정.
 *
 * 대교협은 81열이다. 전부 켜 놓고 시작할 수 없어서 선택하는 화면이 반드시 필요하다.
 *
 * @param {HTMLDialogElement} dialog
 * @param {object} options
 * @param {object[]} options.registry
 * @param {string[]} options.columns 지금 보이는 열 (차례대로)
 * @param {number} options.pinned 좌측에 고정한 열 수
 * @param {(next: {columns: string[], pinned: number}) => void} options.onApply
 */
export function openColumns(dialog, { registry, columns, pinned, onApply }) {
  let chosen = [...columns];
  let pinCount = pinned;
  const byKey = new Map(registry.map((field) => [field.key, field]));

  // 두 목록이 각자 스크롤한다. 대화상자까지 함께 스크롤되면 스크롤바가 둘로 겹쳐
  // 어느 쪽이 움직이는지 알 수 없다
  const shownList = el('ol', { class: 'mt-2 max-h-[22rem] scroll-stable space-y-1 overflow-y-auto' });
  const pickList = el('div', { class: 'mt-2 max-h-[22rem] scroll-stable space-y-4 overflow-y-auto' });
  const pinNote = el('p', { class: 'mt-1 text-base text-ink-soft' });

  function move(key, delta) {
    const index = chosen.indexOf(key);
    const target = index + delta;
    if (target < 0 || target >= chosen.length) return;
    [chosen[index], chosen[target]] = [chosen[target], chosen[index]];
    paint();
  }

  /** 드래그로 차례 바꾸기. 버튼으로도 되게 두 길을 모두 연다. */
  function dropOn(fromKey, toKey) {
    if (fromKey === toKey) return;
    const rest = chosen.filter((key) => key !== fromKey);
    const at = rest.indexOf(toKey);
    chosen = [...rest.slice(0, at), fromKey, ...rest.slice(at)];
    paint();
  }

  function paintShown() {
    clear(shownList).append(...chosen.map((key, index) => {
      const field = byKey.get(key);
      const isPinned = index < pinCount;
      return el('li', {
        class: `flex min-h-11 items-center gap-2 rounded-xl border px-3 ${isPinned ? 'border-brand/40 bg-brand-soft' : 'border-line bg-surface'}`,
        attrs: { draggable: 'true' },
        on: {
          dragstart: (event) => event.dataTransfer.setData('text/plain', key),
          dragover: (event) => event.preventDefault(),
          drop: (event) => { event.preventDefault(); dropOn(event.dataTransfer.getData('text/plain'), key); }
        }
      }, [
        el('span', { class: 'cursor-grab text-ink-soft', attrs: { 'aria-hidden': 'true' }, text: '⠿' }),
        el('span', { class: 'min-w-0 flex-1 truncate text-base', text: field?.label ?? key, attrs: { title: field?.label ?? key } }),
        isPinned ? el('span', { class: 'shrink-0 text-base font-semibold text-brand', text: '고정' }) : null,
        el('button', {
          class: 'btn btn-sm border-transparent px-2', text: '↑',
          attrs: { type: 'button', 'aria-label': `${field?.label ?? key} 위로` },
          on: { click: () => move(key, -1) }
        }),
        el('button', {
          class: 'btn btn-sm border-transparent px-2', text: '↓',
          attrs: { type: 'button', 'aria-label': `${field?.label ?? key} 아래로` },
          on: { click: () => move(key, 1) }
        }),
        el('button', {
          class: 'btn btn-sm border-transparent px-2 text-ink-soft', text: '✕',
          attrs: { type: 'button', 'aria-label': `${field?.label ?? key} 숨기기` },
          on: { click: () => { chosen = chosen.filter((item) => item !== key); paint(); } }
        })
      ]);
    }));
  }

  function paintPicker() {
    const shown = new Set(chosen);
    clear(pickList);
    for (const group of GROUP_ORDER) {
      const inGroup = registry.filter((field) => field.group === group);
      if (inGroup.length === 0) continue;
      pickList.append(el('section', {}, [
        el('h4', { class: 'text-base font-bold text-ink-soft', text: GROUP_LABEL[group] ?? group }),
        el('div', { class: 'mt-1 flex flex-wrap gap-2' }, inGroup.map((field) => el('button', {
          class: `btn btn-sm ${shown.has(field.key) ? 'btn-primary' : ''} ${field.filled === 0 ? 'opacity-50' : ''}`,
          attrs: {
            type: 'button',
            title: field.filled === 0 ? '값이 하나도 없는 열입니다' : `${field.filled}건에 값이 있습니다`,
            'aria-pressed': shown.has(field.key)
          },
          on: {
            click: () => {
              chosen = shown.has(field.key)
                ? chosen.filter((key) => key !== field.key)
                : [...chosen, field.key];
              paint();
            }
          }
        }, [field.label])))
      ]));
    }
  }

  function paint() {
    pinCount = Math.min(pinCount, chosen.length);
    paintShown();
    paintPicker();
    pinNote.textContent = pinCount === 0
      ? '고정한 열이 없습니다. 가로로 스크롤하면 왼쪽 열도 함께 밀려납니다.'
      : `앞 ${pinCount}개 열이 왼쪽에 붙어 있습니다.`;
  }

  // 좁은 화면에서 좌우로 나누면 「자료에 있는 열」이 접혀 내려가 안 보인다.
  // 그 목록이 이 화면에 오는 이유 자체라, 768px부터 나누어 둘 다 한눈에 둔다
  const body = el('div', { class: 'grid gap-5 md:grid-cols-2' }, [
    el('section', {}, [
      el('h3', { class: 'text-lg font-bold tracking-tight', text: '보이는 열' }),
      el('p', { class: 'text-base text-ink-soft', text: '끌어다 놓거나 화살표로 차례를 바꿉니다. 표의 머리줄을 끌어도 됩니다.' }),
      shownList,
      el('div', { class: 'mt-4' }, [
        el('label', { class: 'text-base font-semibold', text: '왼쪽에 고정할 열 수' }),
        el('input', {
          class: 'field mt-1 w-24 text-center figure',
          attrs: { type: 'number', min: 0, max: 6, step: 1, value: pinCount, 'aria-label': '고정할 열 수' },
          on: { change: (event) => { pinCount = Math.max(0, Math.min(6, Number(event.target.value) || 0)); paint(); } }
        }),
        pinNote
      ])
    ]),
    el('section', {}, [
      el('h3', { class: 'text-lg font-bold tracking-tight', text: '자료에 있는 열' }),
      el('p', { class: 'text-base text-ink-soft', text: '누르면 켜지고 꺼집니다. 해석하지 못한 열도 그대로 쓸 수 있습니다.' }),
      pickList
    ])
  ]);

  paint();

  openDialog(dialog, dialogFrame({
    title: '열 선택',
    body,
    onClose: () => dialog.close(),
    footer: el('div', { class: 'flex w-full items-center justify-end gap-3' }, [
      el('button', { class: 'btn', text: '취소', attrs: { type: 'button' }, on: { click: () => dialog.close() } }),
      el('button', {
        class: 'btn btn-primary', text: '적용', attrs: { type: 'button' },
        on: { click: () => { onApply({ columns: chosen, pinned: pinCount }); dialog.close(); } }
      })
    ])
  }));
}
