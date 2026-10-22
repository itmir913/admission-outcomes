/**
 * 필터 (§7).
 *
 * 필터 개수에 제한을 두지 않는다. 자료에 있는 어떤 열이든 필터로 걸 수 있고,
 * `extra`로 보존한 미지 열도 마찬가지다 — 필터가 레지스트리에서 나오기 때문이다(§6).
 *
 * 값 옆의 건수는 **그 열에 걸린 필터를 뺀 채** 센다. 빼지 않으면 이미 선택한 값만
 * 숫자가 남아서, 범위를 넓히려는 사람이 갈 곳을 잃는다.
 */

import { el, clear, formatNumber, debounce } from './dom.js';
import { valueLabel, isBlank, GROUP_LABEL, GROUP_ORDER, primaryGpaField, bucketLabel } from '../analysis/registry.js';
import { facetCounts, facetBuckets, 뜻있는열, 뜻차례 } from '../analysis/query.js';

/** 처음부터 열어 두는 필터. 상담에서 가장 먼저 거는 것들이다. */
const OPENING = ['cohortYear', 'outcome', 'univ', 'track', 'admType', 'period', 'region'];

/** 값이 이보다 많으면 목록 안에 검색칸을 둔다. */
const SEARCHABLE_AT = 12;

/**
 * 범위를 확정하기까지 기다리는 시간.
 *
 * 슬라이더를 끄는 동안 값이 바뀔 때마다 다시 계산하면, 한 번 끌 때 표를 수십 번
 * 다시 그린다. 그러면 손잡이가 손가락을 못 따라온다.
 */
const RANGE_SETTLE = 220;

/**
 * 값 목록을 늘어놓는 순서.
 *
 * 순서가 있는 값(연도·등급)은 **값순**이어야 한다. 사전순으로 두면 2025·2023·2024처럼
 * 늘어서서, 어느 해가 빠졌는지 눈으로 셀 수 없다.
 *
 * 그 밖의 값은 **사전순**이다 (2026-10-22, 사용자). 건수순으로 두었더니 대학이
 * 수십 가지인 목록에서 찾는 이름이 어디쯤에 있는지 확인할 수가 없었다 — 건수는 사람이
 * 외우고 있는 것이 아니다. 많이 간 곳이 어디인지는 옆에 적힌 건수가 말한다.
 *
 * **「(빈칸)」은 맨 뒤다.** 이름이 아니라 「이름이 없다」는 표시이고, 괄호로 시작해
 * 사전순으로는 맨 앞에 서서 목록의 첫 줄을 차지한다.
 *
 * 결과·등록처럼 **뜻 순서가 있는 열**은 그 순서다 (2026-10-22, 사용자). 합격·충원합격·
 * 불합격을 사전순으로 세우면 불합격이 맨 위에 선다. 그 차례는 표가 쓰는 것을 그대로
 * 가져온다 — 두 군데 적어 두면 표와 목록이 서로 다른 차례로 서는 날이 온다.
 *
 * @param {object} field
 */
export function entryOrder(field) {
  if (뜻있는열(field.key)) {
    return (left, right) => 뜻차례(field.key, left.value) - 뜻차례(field.key, right.value);
  }
  if (field.type === 'year') {
    // 최근 해가 위다. 상담에서 먼저 보는 것은 작년이지 10년 전이 아니다
    return (left, right) => Number(right.value) - Number(left.value);
  }
  if (field.numeric) {
    // 등급·순위는 작은 값이 앞선다
    return (left, right) => Number(left.value) - Number(right.value);
  }
  const 빈칸 = (entry) => Number(isBlank(entry.value));
  return (left, right) => 빈칸(left) - 빈칸(right)
    || left.label.localeCompare(right.label, 'ko');
}

/**
 * 값 하나를 그 열의 `in` 필터에 더한다. **바뀔 것이 없으면 `null`.**
 *
 * 패널 밖에서도 값을 더할 자리가 있어 따로 떼어 둔다 — 학생 상세의 대학명이 그렇다.
 *
 * **돌려주는 배열·필터·`values`를 모두 새로 만든다.** `query.js`의 라벨 캐시가
 * `values` **배열 객체**를 키로 삼기 때문이다. 제자리에서 고치면 캐시가 옛 라벨
 * 집합을 그대로 돌려주어, 더한 값이 칩에는 적혀 있는데 표에서는 걸리지 않는다 —
 * 예외도 테스트 실패도 없이 거르는 결과만 틀린다(§5).
 *
 * **같은 열의 `in`이 여럿이면 하나로 합친다.** 보관된 화면 상태는 모양만 검사해
 * 들어오므로(`prefs.js`) 둘이 섞여 있을 수 있고, 둘이 남으면 교집합이 되어
 * 표가 비는 까닭을 칩줄에서도 읽을 수 없다. 합치면서 **라벨이 같은 값은 하나로
 * 줄인다.** 겹친 채로 두면 거르는 결과는 맞는데 칩이 「가온대학교, 가온대학교」로
 * 적히고, 「… 외 N」의 N까지 틀린다(`describeFilter`는 `values.length`로 센다).
 *
 * **이 함수는 `in`만 다룬다.** 같은 열의 다른 op를 함께 손대면 무엇을 지우는
 * 함수인지 흐려진다. 머리줄 검색(`contains`)은 다른 자리에 있는 다른 조작이다.
 *
 * 받는 값은 **비어 있지 않은 것**이다. 빈칸을 고르는 길은 값 목록에 따로 있다.
 *
 * @param {object[]} filters
 * @param {string} key
 * @param {unknown} value 비어 있지 않은 값
 * @returns {object[]|null}
 */
export function addValueFilter(filters, key, value) {
  const mine = filters.filter((filter) => filter.key === key && filter.op === 'in');

  /*
   * 같은 값인지는 **라벨로 본다.** 세는 쪽(`facetCounts`)도 거르는 쪽(`query.js`)도
   * 라벨로 견주므로, 여기만 원값으로 보면 목록에서 한 줄인 것이 필터에는 둘로 들어간다.
   */
  const seen = new Map();
  for (const filter of mine) {
    for (const item of filter.values ?? []) {
      const label = isBlank(item) ? null : valueLabel(key, item);
      if (!seen.has(label)) seen.set(label, item);
    }
  }

  const already = seen.has(valueLabel(key, value));
  const 합칠것이있다 = mine.length > 1
    || mine.some((filter) => (filter.values ?? []).length !== seen.size);
  if (already && !합칠것이있다) return null;

  const values = [...seen.values()];
  const rest = filters.filter((filter) => !(filter.key === key && filter.op === 'in'));
  return [...rest, { key, op: 'in', values: already ? values : [...values, value] }];
}

/**
 * @param {object} options
 * @param {HTMLElement} options.mount
 * @param {() => {rows: object[], registry: object[], filters: object[], search: string}} options.read
 * @param {(filters: object[]) => void} options.onChange
 * @param {() => void} [options.onClose] 좁은 화면에서 패널을 닫는다
 */
export function createFilters({ mount, read, onChange, onClose }) {
  /** 열어 둔 열. 필터가 걸려 있지 않아도 자리는 지킨다 */
  let open = [];
  /** 값 목록 안 검색어 */
  const localSearch = new Map();
  /** 지금 손잡이를 잡고 있는 열. 잡고 있는 동안에는 패널을 다시 그리지 않는다 */
  let gripped = null;

  const commit = (filters) => onChange(filters.filter(isMeaningful));

  /** 아무것도 안 거르는 필터는 목록에서 뺀다. 칩이 늘어지면 한눈에 안 들어온다 */
  function isMeaningful(filter) {
    if (filter.op === 'contains') return String(filter.text ?? '').trim() !== '';
    if (filter.op === 'in') return (filter.values ?? []).length > 0;
    if (filter.op === 'range') return filter.min !== null || filter.max !== null;
    return true;
  }

  /**
   * 이 패널이 맡은 필터만 갈아 끼운다.
   *
   * **같은 열의 머리줄 검색(`contains`)은 건드리지 않는다.** 둘은 다른 조작이고
   * 다른 자리에 있다. 여기서 함께 지우면, 왼쪽에서 값을 하나 선택했을 뿐인데
   * 머리줄에 적어 둔 검색어가 소리 없이 사라진다.
   */
  function setFilter(key, next) {
    const { filters } = read();
    const rest = filters.filter((filter) => filter.key !== key || filter.op === 'contains');
    commit(next ? [...rest, next] : rest);
  }

  // ── 값 선택 (글자·enum 열) ─────────────────────────────────────────────
  function valueBlock(field, filter, counts, redraw) {
    const chosen = new Set((filter?.values ?? []).map((value) => (isBlank(value) ? null : value)));
    const needle = (localSearch.get(field.key) ?? '').trim().toLowerCase();

    // 선택한 값이 다른 필터 때문에 한 건도 안 남으면 목록에서 사라져, 체크를 풀 자리가 없어진다
    const 건수 = new Map(counts);
    for (const value of chosen) if (!건수.has(value)) 건수.set(value, { count: 0, texts: [] });

    const entries = [...건수.entries()]
      .map(([value, bucket]) => ({
        value,
        count: bucket.count,
        ...bucketLabel(field.key, value, bucket.texts)
      }))
      .filter((entry) => entry.count > 0 || chosen.has(entry.value))
      .filter((entry) => !needle || entry.terms.some((term) => term.toLowerCase().includes(needle)))
      .sort(entryOrder(field));

    const list = el('div', { class: 'mt-2 max-h-64 scroll-stable space-y-0.5 overflow-y-auto' },
      entries.map((entry) => {
        const id = `f-${field.key}-${String(entry.value)}`;
        return el('label', {
          class: 'flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-brand-soft',
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
          el('span', { class: 'shrink-0 text-base tabular-nums text-ink-soft', text: entry.count })
        ]);
      })
    );

    const search = entries.length > SEARCHABLE_AT || needle
      ? el('input', {
          class: 'field mt-2 min-h-9 text-base',
          attrs: { type: 'search', placeholder: `${field.label} 안에서 찾기`, value: localSearch.get(field.key) ?? '' },
          on: {
            input: debounce((event) => {
              localSearch.set(field.key, event.target.value);
              redraw();
            }, 150)
          }
        })
      : null;

    /*
     * **「전체 선택」을 둔다.**
     *
     * 수십 가지 가운데 하나만 빼고 보려면, 없을 때는 나머지를 전부 손으로 눌러야 한다.
     * 전부 선택한 뒤 하나를 해제하는 길이 있으면 두 번이면 끝난다.
     *
     * 선택하는 것은 **지금 목록에 보이는 값**이다. 안에서 찾기로 줄여 둔 목록이라면
     * 거기 보이는 것만 선택한다 — 보이지 않는 것까지 선택하면, 눌러 놓고 무엇을
     * 선택했는지 화면에서 셀 수 없다 (§5). 그 사실을 단추의 설명에 적어 둔다.
     *
     * 테두리를 두르지 않는다. 값 목록 위에 선 작은 조작이라, 상자를 치면 목록보다
     * 단추가 먼저 눈에 띈다.
     */
    const 선택한수 = entries.filter((entry) => chosen.has(entry.value)).length;
    /*
     * **쓸 수 없을 때 숨기지 않고 흐리게 둔다.**
     *
     * 안 보이게 두었더니 전부 선택한 화면에서 「전체 선택」이 사라진 자리만 남아,
     * 「전체 해제」가 가운데로 밀려난 것처럼 보였다 — 단추가 없어졌다고 인식된다.
     * 자리를 지키는 것만으로는 모자라고(D15), **왜 못 누르는지도 보여야 한다.**
     * 흐린 글자는 「여기 있는데 지금은 할 일이 없다」를 말한다.
     */
    const 글자단추 = (text, label, off, onClick) => el('button', {
      class: `text-base underline-offset-4 ${off
        ? 'cursor-default text-ink-soft'
        : 'text-brand hover:underline'}`,
      text,
      attrs: {
        type: 'button',
        disabled: off,
        'aria-label': `${field.label} ${label}`,
        title: off ? '지금은 할 일이 없습니다' : null
      },
      on: { click: onClick }
    });

    const 선택줄 = entries.length === 0 ? null : el('div', {
      class: 'mt-2 flex min-h-9 items-center gap-3 px-2'
    }, [
      글자단추('전체 선택', needle ? '찾은 값 전체 선택' : '값 전체 선택', 선택한수 === entries.length, () => {
        const next = new Set(chosen);
        for (const entry of entries) next.add(entry.value);
        setFilter(field.key, { key: field.key, op: 'in', values: [...next] });
      }),
      글자단추('전체 해제', needle ? '찾은 값 전체 해제' : '값 전체 해제', 선택한수 === 0, () => {
        const next = new Set(chosen);
        for (const entry of entries) next.delete(entry.value);
        setFilter(field.key, next.size === 0
          ? null
          : { key: field.key, op: 'in', values: [...next] });
      })
    ]);

    return el('div', {}, [
      search,
      선택줄,
      entries.length === 0 ? el('p', { class: 'mt-2 px-2 text-base text-ink-soft', text: '해당하는 값이 없습니다.' }) : list
    ]);
  }

  // ── 범위 선택 (숫자 열) ────────────────────────────────────────────────
  /**
   * 범위 블록.
   *
   * **값이 바뀌는 즉시 확정하지 않는다.** 확정하면 표와 패널을 통째로 다시 그리는데,
   * 그 순간 지금 잡고 있던 손잡이가 새로 만든 요소로 갈려서 드래그가 끊긴다.
   * 그래서 끄는 동안에는 숫자만 제자리에서 고쳐 쓰고, 손을 떼거나(`change`)
   * 잠시 멈췄을 때만(`RANGE_SETTLE`) 확정한다.
   */
  function rangeBlock(field, filter, 빈칸건수) {
    const low = field.range?.min ?? 0;
    const high = field.range?.max ?? 0;
    // 내신은 소수 둘째 자리까지 온다. 정수로 반올림하면 1.95와 2.04가 한 칸이 된다
    const step = field.type === 'year' ? 1 : 0.01;

    /** 화면에 떠 있는 값. 확정 전에도 여기까지는 즉시 따라온다 */
    let shown = { min: filter?.min ?? low, max: filter?.max ?? high };

    const push = ({ min, max }) => {
      const lowered = Math.min(min, max);
      const raised = Math.max(min, max);
      // 전체 범위를 그대로 둔 것은 필터가 아니다
      const isAll = lowered <= low && raised >= high;
      setFilter(field.key, isAll ? null : { key: field.key, op: 'range', min: lowered, max: raised });
    };

    // 멈춘 뒤에만 확정한다. 아직 잡고 있으면 손을 뗄 때 `change`가 받아 준다
    const settle = debounce(() => { if (gripped !== field.key) push(shown); }, RANGE_SETTLE);

    const lowInput = numberInput('하한');
    const highInput = numberInput('상한');
    const lowSlider = slider('하한 슬라이더', 'dual-range-low');
    const highSlider = slider('상한 슬라이더', 'dual-range-high');
    /*
     * **자료에 있는 범위만 적는다. 지금 선택한 값은 적지 않는다.**
     *
     * 둘을 한 줄에 함께 적었더니, 손잡이를 끄는 동안 앞쪽 숫자가 바뀌며 줄 길이가
     * 변해 줄바꿈이 한 줄과 두 줄 사이를 오갔다. 그때마다 아래 글귀와 카드 높이가
     * 들썩여서, 끌고 있는 손잡이가 손가락 밑에서 움직인다.
     *
     * 지운 쪽이 선택한 값인 까닭은 **그것이 바로 위 입력칸에 이미 적혀 있기** 때문이다.
     * 그쪽은 사람이 고쳐 쓸 수 있는 진짜 값이고, 여기 것은 같은 사실의 사본이었다.
     * 남은 글은 자료가 바뀌기 전에는 변하지 않으므로 줄 길이도 변하지 않는다.
     */
    const dataRange = el('p', {
      class: 'mt-2 text-base text-ink-soft figure',
      text: `데이터 범위 ${formatNumber(low)} ~ ${formatNumber(high)}`
    });

    function numberInput(role) {
      return el('input', {
        class: 'field min-h-10 w-24 text-center text-base figure',
        attrs: { type: 'number', step, min: low, max: high, 'aria-label': `${field.label} ${role}` }
      });
    }

    function slider(role, extra) {
      return el('input', {
        class: `dual-range ${extra}`,
        attrs: { type: 'range', min: low, max: high, step, 'aria-label': `${field.label} ${role}` }
      });
    }

    /** 네 요소를 지금 값에 맞춘다. 다시 그리지 않고 제자리에서 고쳐 쓴다 */
    function syncControls(skip) {
      const lowered = Math.min(shown.min, shown.max);
      const raised = Math.max(shown.min, shown.max);
      for (const [node, value] of [[lowInput, lowered], [highInput, raised],
        [lowSlider, shown.min], [highSlider, shown.max]]) {
        if (node !== skip) node.value = String(value);
      }
    }

    /** @param {HTMLInputElement} node @param {'min'|'max'} side */
    function track(node, side) {
      node.addEventListener('pointerdown', () => { gripped = field.key; });
      node.addEventListener('input', (event) => {
        shown = { ...shown, [side]: Number(event.currentTarget.value) };
        syncControls(event.currentTarget);
        settle();
      });
      node.addEventListener('change', (event) => {
        shown = { ...shown, [side]: Number(event.currentTarget.value) };
        gripped = null;
        push(shown);
      });
    }

    track(lowInput, 'min');
    track(highInput, 'max');
    track(lowSlider, 'min');
    track(highSlider, 'max');
    syncControls(null);

    return el('div', { class: 'mt-3' }, [
      el('div', { class: 'flex items-center justify-between gap-2' }, [
        lowInput,
        el('span', { class: 'text-ink-soft', attrs: { 'aria-hidden': 'true' }, text: '~' }),
        highInput
      ]),
      el('div', { class: 'dual-range-wrap mt-4' }, [lowSlider, highSlider]),
      dataRange,
      /*
       * **빠지는 건수를 적는다.**
       *
       * 범위를 조금만 줄여도 이 열이 빈칸인 행은 전부 빠진다. 숫자 열에는 「(빈칸)」
       * 선택지가 없어서 다시 넣을 조작도 없으니, 내신을 적지 않은 학생이 손잡이를
       * 1px 끄는 순간 통째로 빠져 버린다. 적어도 몇 건인지는 보여야 한다 (§5).
       */
      빈칸건수 > 0
        ? el('p', {
            class: 'mt-1 text-base text-ink-soft',
            text: `이 열이 빈칸인 ${빈칸건수}건은 범위를 줄이면 함께 빠집니다.`
          })
        : null
    ]);
  }

  function block(field, filters, rows, search, { redraw = render, withHead = true } = {}) {
    /*
     * **머리줄 검색(`contains`)은 이 칸의 필터가 아니다.**
     *
     * 한 열에 머리줄 검색과 값 선택이 함께 걸릴 수 있는데, 배열에서 검색이 앞에 오면
     * 여기서 그것을 집어 `values`가 빈 집합이 됐다. 그러면 이미 선택한 값들이 꺼진 채로
     * 보이고, 다음 값을 누르는 순간 **앞서 선택한 것이 조용히 사라진다.** 범위 칸도
     * 같은 까닭으로 걸린 범위를 전체 범위처럼 보여 주다가, 한쪽을 건드리면 반대쪽이
     * 풀렸다. 이 칸이 다루는 것만 집는다 (§5).
     */
    const filter = filters.find((item) => item.key === field.key && item.op !== 'contains');
    const active = Boolean(filter);

    // 숫자여도 값이 몇 가지뿐이면 목록에서 선택하는 편이 낫다.
    // 고3 년도·수능 등급은 다중 선택이, 내신·백분위는 범위가 자연스럽다
    const 범위칸 = field.numeric && field.cardinality > SEARCHABLE_AT;

    /*
     * 제목과 두 단추 사이를 띄운다. gap-1(4px)로 붙여 두었더니 「해제」와 「✕」가
     * 한 덩어리로 보여, 어느 쪽이 값만 지우고 어느 쪽이 열을 빼는지 눈으로 구분되지
     * 않았다. 카드 여백을 늘리는 대신 단추 사이만 벌린다 — 여백을 늘리면 좁은
     * 사이드바에서 값 목록이 그만큼 줄어든다.
     */
    const head = el('div', { class: 'flex min-h-9 items-center gap-2' }, [
      el('h3', { class: 'min-w-0 flex-1 truncate text-base font-semibold', text: field.label, attrs: { title: field.label } }),
      /*
       * **「해제」는 범위 칸에만 둔다** (2026-10-22, 사용자).
       *
       * 값 목록에는 목록 자신의 「전체 해제」가 있어서, 제목 줄의 「해제」와 하는 일이
       * 글자까지 같았다. 같은 일을 하는 단추가 둘이면 어느 쪽이 더 많이 지우는지
       * 재어 보게 된다. 범위 칸에는 짝이 없으므로 거기서는 이 단추가 유일한 길이다.
       *
       * **쓸 수 없을 때도 자리를 지킨다**(D15). 범위를 잡는 순간 단추가 생기면
       * 머리줄이 그만큼 높아져 카드가 들썩이고, 잡고 있던 손잡이가 손가락 밑에서 밀려난다.
       */
      범위칸 ? el('button', {
        // 테두리를 두르지 않는다. 글자만으로도 누를 수 있다는 것이 드러나고, 제목 줄이 조용해진다
        class: `text-base underline-offset-4 ${active
          ? 'text-brand hover:underline'
          : 'invisible pointer-events-none'}`,
        text: '해제',
        attrs: {
          type: 'button',
          disabled: !active,
          'aria-hidden': active ? null : 'true',
          tabindex: active ? null : '-1',
          'aria-label': `${field.label}에 걸어 둔 범위 해제`,
          title: '걸어 둔 범위만 해제한다 — 열은 그대로 둔다'
        },
        on: { click: () => setFilter(field.key, null) }
      }) : null,
      el('button', {
        class: 'btn btn-sm border-transparent px-2 text-base text-ink-soft',
        text: '✕',
        attrs: { type: 'button', 'aria-label': `${field.label}을(를) 필터 목록에서 빼기`, title: '이 열을 필터 목록에서 뺀다' },
        on: {
          click: () => {
            open = open.filter((key) => key !== field.key);
            setFilter(field.key, null);
            render();
          }
        }
      })
    ]);

    const body = 범위칸
      // 같은 패널의 두 숫자가 다른 바탕 위에 서지 않도록, 빈칸 건수도 값 목록과 같은 셈을 쓴다
      ? rangeBlock(field, filter, facetCounts(rows, filters, field.key, { search }).get(null) ?? 0)
      // 건수와 「무엇을 품었는지」를 같은 셈에서 받는다. 둘이 다른 바탕에 서면 이름이 거짓이 된다
      : valueBlock(field, filter, facetBuckets(rows, filters, field.key, { search }), redraw);

    // 팝오버에는 제목줄이 따로 있다. 여기서 또 그리면 같은 제목이 두 번 나온다
    if (!withHead) return el('div', {}, [body]);

    /*
     * 위 여백만 좁다. 머리줄 높이는 단추(36px)가 정하는데 제목 글자는 그 안에서
     * 가운데 서므로, 좌우와 같은 여백을 주면 제목 위만 8px 더 벌어져 보인다.
     */
    return el('section', {
      class: `card px-3 pb-3 pt-1 ${active ? 'border-brand/40 ring-1 ring-brand/20' : ''}`
    }, [head, body]);
  }

  /** 아직 열지 않은 열을 묶음별로 선택해 넣는 칸. */
  function adder(registry) {
    const shown = new Set(open);
    const options = [el('option', { text: '필터 추가…', attrs: { value: '' } })];

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
      attrs: { 'aria-label': '필터 추가' },
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
      // 내신이 있으면 대표 조합 하나를 범위 필터로 함께 연다
      const gpa = primaryGpaField(registry);
      if (gpa) open.push(gpa.key);
    }
    // 필터가 걸린 열은 접혀 있어도 보이게 한다
    for (const filter of filters) {
      if (!open.includes(filter.key)) open = [...open, filter.key];
    }

    clear(mount).append(
      el('div', { class: 'flex min-h-9 items-center gap-2' }, [
        el('h2', { class: 'flex-1 text-lg font-bold tracking-tight', text: '필터' }),
        // 「전체 해제」도 자리를 지킨다. 생겼다 사라지면 아래 카드가 통째로 밀린다
        el('button', {
          class: `btn btn-sm ${filters.length > 0 ? '' : 'invisible pointer-events-none'}`,
          text: '전체 해제',
          attrs: {
            type: 'button',
            disabled: filters.length === 0,
            'aria-hidden': filters.length > 0 ? null : 'true',
            tabindex: filters.length > 0 ? null : '-1'
          },
          on: { click: () => commit([]) }
        }),
        // 좁은 화면에서는 이 패널이 「필터」 단추를 덮는다. 닫는 길이 여기 있어야 한다
        el('button', {
          class: 'btn btn-sm lg:hidden', text: '닫기',
          attrs: { type: 'button', 'aria-label': '필터 패널 닫기' },
          on: { click: () => onClose?.() }
        })
      ]),
      el('div', { class: 'mt-3 space-y-3' },
        open.map((key) => byKey.get(key)).filter(Boolean)
          .map((field) => block(field, filters, rows, search))
      ),
      el('div', { class: 'mt-4' }, [adder(registry)])
    );
  }

  return {
    render,
    /**
     * 열 하나의 조건 블록만 따로 그려 준다. 머리줄의 깔때기 단추가 쓴다.
     *
     * **왼쪽 패널과 같은 블록이다.** 둘을 따로 만들면 한쪽만 고쳐도 아무것도 울지 않고
     * 조작이 어긋난다 — 같은 열인데 자리에 따라 다르게 거르는 표가 된다.
     *
     * @param {string} key
     * @param {() => void} redraw 블록 안에서 상태가 바뀌었을 때 다시 그릴 함수
     */
    blockFor(key, redraw) {
      const { rows, registry, filters, search } = read();
      const field = registry.find((item) => item.key === key);
      if (!field) return null;
      return block(field, filters, rows, search, { redraw, withHead: false });
    },
    reset() { open = []; localSearch.clear(); gripped = null; }
  };
}
