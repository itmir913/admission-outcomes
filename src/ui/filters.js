/**
 * 조건 좁히기 (§7).
 *
 * 필터 개수에 제한을 두지 않는다. 자료에 있는 어떤 열이든 조건으로 걸 수 있고,
 * `extra`로 보존한 미지 열도 마찬가지다 — 필터가 레지스트리에서 나오기 때문이다(§6).
 *
 * 값 옆의 건수는 **그 열에 걸린 조건을 뺀 채** 센다. 빼지 않으면 이미 고른 값만
 * 숫자가 남아서, 조건을 넓히려는 사람이 갈 곳을 잃는다.
 */

import { el, clear, formatNumber, debounce } from './dom.js';
import { valueLabel, isBlank, GROUP_LABEL, GROUP_ORDER, primaryGpaField } from '../analysis/registry.js';
import { facetCounts } from '../analysis/query.js';

/** 처음부터 펼쳐 두는 조건. 상담에서 가장 먼저 좁히는 것들이다. */
const OPENING = ['cohortYear', 'outcome', 'univ', 'track', 'admType', 'period', 'region'];

/** 값이 이보다 많으면 목록 안에 검색칸을 둔다. */
const SEARCHABLE_AT = 12;

/**
 * @param {object} options
 * @param {HTMLElement} options.mount
 * @param {() => {rows: object[], registry: object[], filters: object[], search: string}} options.read
 * @param {(filters: object[]) => void} options.onChange
 */
export function createFilters({ mount, read, onChange }) {
  /** 펼쳐 둔 열. 조건이 걸려 있지 않아도 자리는 지킨다 */
  let open = [];
  /** 값 목록 안 검색어 */
  const localSearch = new Map();

  const commit = (filters) => onChange(filters.filter(isMeaningful));

  /** 아무것도 안 거르는 조건은 목록에서 뺀다. 칩이 늘어지면 읽히지 않는다 */
  function isMeaningful(filter) {
    if (filter.op === 'in') return (filter.values ?? []).length > 0;
    if (filter.op === 'range') return filter.min !== null || filter.max !== null;
    return true;
  }

  function setFilter(key, next) {
    const { filters } = read();
    const rest = filters.filter((filter) => filter.key !== key);
    commit(next ? [...rest, next] : rest);
  }

  // ── 값 고르기 (글자·enum 열) ─────────────────────────────────────────────
  function valueBlock(field, filter, counts) {
    const chosen = new Set((filter?.values ?? []).map((value) => (isBlank(value) ? null : value)));
    const needle = (localSearch.get(field.key) ?? '').trim().toLowerCase();

    const entries = [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: valueLabel(field.key, value) }))
      .filter((entry) => entry.count > 0 || chosen.has(entry.value))
      .filter((entry) => !needle || entry.label.toLowerCase().includes(needle))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ko'));

    const list = el('div', { class: 'mt-2 max-h-64 space-y-0.5 overflow-y-auto pr-1' },
      entries.map((entry) => {
        const id = `f-${field.key}-${String(entry.value)}`;
        return el('label', {
          class: 'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-brand-soft',
          attrs: { for: id }
        }, [
          el('input', {
            class: 'size-4 shrink-0 accent-brand',
            attrs: { type: 'checkbox', id, checked: chosen.has(entry.value) },
            on: {
              change: (event) => {
                const next = new Set(chosen);
                if (event.currentTarget.checked) next.add(entry.value);
                else next.delete(entry.value);
                setFilter(field.key, { key: field.key, op: 'in', values: [...next] });
              }
            }
          }),
          el('span', { class: 'min-w-0 flex-1 truncate text-base', text: entry.label, attrs: { title: entry.label } }),
          el('span', { class: 'shrink-0 text-sm tabular-nums text-ink-soft', text: entry.count })
        ]);
      })
    );

    const search = entries.length > SEARCHABLE_AT || needle
      ? el('input', {
          class: 'field mt-2 min-h-9 text-sm',
          attrs: { type: 'search', placeholder: `${field.label} 안에서 찾기`, value: localSearch.get(field.key) ?? '' },
          on: {
            input: debounce((event) => {
              localSearch.set(field.key, event.target.value);
              render();
            }, 150)
          }
        })
      : null;

    return el('div', {}, [
      search,
      entries.length === 0 ? el('p', { class: 'mt-2 px-2 text-sm text-ink-soft', text: '해당하는 값이 없습니다.' }) : list
    ]);
  }

  // ── 범위 고르기 (숫자 열) ────────────────────────────────────────────────
  function rangeBlock(field, filter) {
    const low = field.range?.min ?? 0;
    const high = field.range?.max ?? 0;
    // 내신은 소수 둘째 자리까지 온다. 정수로 반올림하면 1.95와 2.04가 한 칸이 된다
    const step = field.type === 'year' ? 1 : 0.01;
    const min = filter?.min ?? low;
    const max = filter?.max ?? high;

    const push = (nextMin, nextMax) => {
      const lowered = Math.min(nextMin, nextMax);
      const raised = Math.max(nextMin, nextMax);
      // 전체 범위를 그대로 고른 것은 조건이 아니다
      const isAll = lowered <= low && raised >= high;
      setFilter(field.key, isAll ? null : { key: field.key, op: 'range', min: lowered, max: raised });
    };

    const numberInput = (value, onCommit, label) => el('input', {
      class: 'field min-h-10 w-24 text-center text-base num',
      attrs: { type: 'number', step, min: low, max: high, value: formatNumber(value), 'aria-label': label },
      on: { change: (event) => onCommit(Number(event.target.value)) }
    });

    const slider = (value, onInput, label, extra) => el('input', {
      class: `dual-range ${extra}`,
      attrs: { type: 'range', min: low, max: high, step, value, 'aria-label': label },
      on: { input: (event) => onInput(Number(event.target.value)) }
    });

    return el('div', { class: 'mt-3' }, [
      el('div', { class: 'flex items-center justify-between gap-2' }, [
        numberInput(min, (value) => push(value, max), `${field.label} 하한`),
        el('span', { class: 'text-ink-soft', text: '~' }),
        numberInput(max, (value) => push(min, value), `${field.label} 상한`)
      ]),
      el('div', { class: 'dual-range-wrap mt-4' }, [
        slider(min, (value) => push(value, max), `${field.label} 하한 슬라이더`, 'dual-range-low'),
        slider(max, (value) => push(min, value), `${field.label} 상한 슬라이더`, 'dual-range-high')
      ]),
      el('p', { class: 'mt-2 text-sm text-ink-soft', text: `자료 범위 ${formatNumber(low)} ~ ${formatNumber(high)}` })
    ]);
  }

  function block(field, filters, rows, search) {
    const filter = filters.find((item) => item.key === field.key);
    const active = Boolean(filter);

    const head = el('div', { class: 'flex items-center gap-2' }, [
      el('h3', { class: 'min-w-0 flex-1 truncate text-base font-semibold', text: field.label, attrs: { title: field.label } }),
      active
        ? el('button', {
            class: 'btn btn-sm border-transparent px-2 text-sm text-brand',
            text: '해제',
            attrs: { type: 'button' },
            on: { click: () => setFilter(field.key, null) }
          })
        : null,
      el('button', {
        class: 'btn btn-sm border-transparent px-2 text-sm text-ink-soft',
        text: '✕',
        attrs: { type: 'button', 'aria-label': `${field.label} 조건 접기`, title: '조건 목록에서 빼기' },
        on: {
          click: () => {
            open = open.filter((key) => key !== field.key);
            setFilter(field.key, null);
            render();
          }
        }
      })
    ]);

    // 숫자여도 값이 몇 가지뿐이면 골라 담는 편이 낫다.
    // 고3 년도·수능 등급은 다중 선택이, 내신·백분위는 범위가 자연스럽다
    const body = field.numeric && field.cardinality > SEARCHABLE_AT
      ? rangeBlock(field, filter)
      : valueBlock(field, filter, facetCounts(rows, filters, field.key, { search }));

    return el('section', {
      class: `card px-3 py-3 ${active ? 'border-brand/40 ring-1 ring-brand/20' : ''}`
    }, [head, body]);
  }

  /** 아직 안 펼친 열을 묶음별로 골라 넣는 칸. */
  function adder(registry) {
    const shown = new Set(open);
    const options = [el('option', { text: '조건 추가…', attrs: { value: '' } })];

    for (const group of GROUP_ORDER) {
      const inGroup = registry.filter((field) => field.group === group && !shown.has(field.key) && field.filled > 0);
      if (inGroup.length === 0) continue;
      options.push(el('optgroup', { attrs: { label: GROUP_LABEL[group] ?? group } },
        inGroup.map((field) => el('option', {
          text: `${field.label} (${field.cardinality}가지)`,
          attrs: { value: field.key }
        }))
      ));
    }

    return el('select', {
      class: 'field',
      attrs: { 'aria-label': '조건 추가' },
      on: {
        change: (event) => {
          const key = event.target.value;
          if (!key) return;
          open = [...open, key];
          render();
        }
      }
    }, options);
  }

  function render() {
    const { rows, registry, filters, search } = read();
    const byKey = new Map(registry.map((field) => [field.key, field]));

    if (open.length === 0) {
      open = OPENING.filter((key) => byKey.get(key)?.filled > 0);
      // 내신이 있으면 대표 조합 하나를 범위 조건으로 함께 연다
      const gpa = primaryGpaField(registry);
      if (gpa) open.push(gpa.key);
    }
    // 조건이 걸린 열은 접혀 있어도 보이게 한다
    for (const filter of filters) {
      if (!open.includes(filter.key)) open = [...open, filter.key];
    }

    clear(mount).append(
      el('div', { class: 'flex items-center justify-between gap-2' }, [
        el('h2', { class: 'text-lg font-bold tracking-tight', text: '조건 좁히기' }),
        filters.length > 0
          ? el('button', {
              class: 'btn btn-sm', text: '전체 해제', attrs: { type: 'button' },
              on: { click: () => commit([]) }
            })
          : null
      ]),
      el('div', { class: 'mt-3 space-y-3' },
        open.map((key) => byKey.get(key)).filter(Boolean)
          .map((field) => block(field, filters, rows, search))
      ),
      el('div', { class: 'mt-4' }, [adder(registry)])
    );
  }

  return { render, reset() { open = []; localSearch.clear(); } };
}
