/**
 * 대학×전형 요약표 화면 (roadmap.md 1단계).
 *
 * **목록표 컴포넌트를 재사용하지 않는다.** 그쪽은 열 고정·가상 스크롤·행 클릭=학생 열기에
 * 묶여 있고, 이쪽은 행 수십 개에 행 클릭=그 대학·전형으로 거르기다. 끼워 맞추면 같은
 * 행 클릭이 두 뜻을 갖는다.
 */

import { el, clear } from './dom.js';
import { formatNumber, valueLabel } from '../analysis/registry.js';
import { summarize, GROUPINGS, SMALL_SAMPLE } from '../analysis/summary.js';

const 수 = new Intl.NumberFormat('ko-KR');

/** 내신 칸의 글자. 값의 개수에 따라 적는 법이 다르다 (summary.js `gpaSpread`) */
function gpaText(group) {
  const gpa = group.gpa;
  if (!gpa || gpa.kind === 'none') return '';
  if (gpa.kind === 'list') return gpa.values.map(formatNumber).join(' · ');
  return `${formatNumber(gpa.min)} / 중앙 ${formatNumber(gpa.median)} / ${formatNumber(gpa.max)}`;
}

/**
 * 정렬 기준. 같은 값이면 대학명 → 전형 순으로 늘 같은 자리에 둔다 —
 * 정렬이 흔들리면 방금 보던 줄을 놓친다.
 */
const SORTS = {
  name: { label: '이름순', compare: () => 0 },
  count: { label: '지원 많은 순', compare: (left, right) => right.tally.지원 - left.tally.지원 },
  rate: {
    label: '합격률 높은 순',
    // 비율을 내지 않은 줄(표본 적음)은 뒤로 보낸다. 0%와 섞으면 「다 떨어졌다」처럼 보인다
    compare: (left, right) => (right.rate ?? -1) - (left.rate ?? -1)
  }
};

/**
 * @param {HTMLElement} mount
 * @param {object} options
 * @param {object[]} options.rows 필터·검색을 거친 행 — 요약 띠와 같은 집합
 * @param {{key: string, label: string}|null} options.gpaField 합격선에 쓸 내신 열
 * @param {string} options.grouping `GROUPINGS`의 키
 * @param {string} options.sort `SORTS`의 키
 * @param {(patch: {grouping?: string, sort?: string}) => void} options.onChange
 * @param {(filters: {key: string, value: unknown}[]) => void} options.onOpen 줄을 눌렀을 때
 */
export function renderSummaryTable(mount, { rows, gpaField, grouping, sort, onChange, onOpen }) {
  const 묶음 = GROUPINGS[grouping] ?? GROUPINGS.univAdm;
  const 정렬 = SORTS[sort] ?? SORTS.name;
  const summary = summarize(rows, { keys: 묶음.keys, gpaKey: gpaField?.key ?? null });

  const 이름 = (values) => values.map((value) => (value === null ? '' : String(value)));
  const groups = [...summary.groups].sort((left, right) => 정렬.compare(left, right)
    || 이름(left.values).join('\u001f').localeCompare(이름(right.values).join('\u001f'), 'ko'));

  const 고르개 = (choices, current, key) => el('div', {
    class: 'flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-0.5',
    attrs: { role: 'group' }
  }, Object.entries(choices).map(([id, choice]) => el('button', {
    // 다른 전환 단추(보기·필터 패널)와 같은 모양이다 — 선택한 쪽이 채워진다
    class: `btn btn-sm min-h-8 border-transparent ${id === current ? 'btn-primary' : ''}`,
    text: choice.label,
    attrs: { type: 'button', 'aria-pressed': String(id === current) },
    on: { click: () => { if (id !== current) onChange({ [key]: id }); } }
  })));

  const 연도 = summary.years
    ? summary.years.from === summary.years.to
      ? `고3 년도 ${summary.years.from}`
      : `고3 년도 ${summary.years.from}~${summary.years.to} 합산`
    : '고3 년도 없음';

  const head = el('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-2 py-3' }, [
    /*
     * **여러 해를 합쳤다는 사실을 늘 적는다.** 합격선은 해마다 움직이는데 합친 숫자만
     * 보이면 그 사실이 숨는다.
     */
    el('p', { class: 'text-base font-semibold text-ink', text: 연도 }),
    el('p', {
      class: 'text-base text-ink-soft',
      text: gpaField ? `합격자 내신: ${gpaField.label}` : '내신 열이 없어 합격자 내신을 내지 않습니다'
    }),
    el('div', { class: 'flex flex-wrap items-center gap-2 sm:ml-auto' }, [
      고르개(GROUPINGS, grouping in GROUPINGS ? grouping : 'univAdm', 'grouping'),
      고르개(SORTS, sort in SORTS ? sort : 'name', 'sort')
    ])
  ]);

  const 칸 = [
    ...묶음.keys.map((key) => ({ name: key === 'univ' ? '대학' : '전형', key })),
    { name: '지원' }, { name: '학생' },
    { name: '● 합격' }, { name: '△ 충원합격' }, { name: '✕ 불합격' }, { name: '1단계 불합격' },
    { name: '합격률' },
    ...(gpaField ? [{ name: '합격자 내신' }] : []),
    ...(summary.hasRegister ? [{ name: '등록' }] : []),
    ...(summary.hasWaitRank ? [{ name: '충원 예비순위' }] : [])
  ];

  const th = (name) => el('th', {
    class: 'sticky top-0 border-b border-line bg-canvas px-3 py-2 text-left text-base font-semibold whitespace-nowrap',
    attrs: { scope: 'col' },
    text: name
  });
  const td = (text, tone = '') => el('td', {
    class: `border-b border-line-soft px-3 py-2 text-base whitespace-nowrap tabular-nums ${tone}`,
    text
  });

  const body = groups.map((group) => {
    const 걸기 = () => onOpen(묶음.keys.map((key, index) => ({ key, value: group.values[index] })));
    const 이름칸 = 묶음.keys.map((key, index) => {
      const value = group.values[index];
      return td(value === null ? '(빈칸)' : valueLabel(key, value), index === 0 ? 'font-semibold' : '');
    });
    const 비율 = group.rate === null
      ? (group.judged === 0 ? '' : `표본 ${group.judged}건`)
      : `${(group.rate * 100).toFixed(1)}%`;
    const 내신 = gpaText(group);
    const tr = el('tr', {
      class: 'cursor-pointer hover:bg-brand-soft focus-visible:bg-brand-soft focus-visible:outline-none',
      attrs: {
        tabindex: '0',
        title: '눌러서 이 줄의 지원 기록을 목록으로 봅니다'
      },
      on: {
        click: 걸기,
        keydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); 걸기(); } }
      }
    }, [
      ...이름칸,
      td(`${수.format(group.tally.지원)}건`),
      td(`${수.format(group.tally.학생)}명`),
      td(String(group.tally.합격), 'text-pass-deep'),
      td(String(group.tally.충원합격), 'text-wait-deep'),
      td(String(group.tally.불합격), 'text-fail-deep'),
      td(group.stage1Fail === 0 ? '' : String(group.stage1Fail)),
      td(비율, group.rate === null ? 'text-ink-soft' : ''),
      ...(gpaField ? [td(group.gpaBlank > 0 ? `${내신}${내신 ? ' ' : ''}(빈칸 ${group.gpaBlank})` : 내신)] : []),
      ...(summary.hasRegister ? [td(group.registered === null ? '' : `${group.registered}명`)] : []),
      ...(summary.hasWaitRank ? [td(group.maxWaitRank === null ? '' : `${group.maxWaitRank}번까지`)] : [])
    ]);
    return tr;
  });

  /*
   * **숫자의 정의를 표 아래에 늘 둔다.** 「합격 3」이 건인지 명인지, 범위가 몇 건에서
   * 나왔는지 설명하지 못하면 상담에 쓸 수 없다.
   */
  const notes = [
    '지원·합격·불합격은 지원 건수입니다. 한 학생이 같은 줄에 두 번 지원하면 2건으로 셉니다. 학생은 사람 수입니다.',
    `합격률 = (합격 + 충원합격) ÷ 최종 판정이 나온 건수. 판정이 ${SMALL_SAMPLE}건 미만이면 비율 대신 건수만 적습니다.`,
    gpaField
      ? `합격자 내신은 합격·충원합격만으로 냅니다. ${SMALL_SAMPLE}명 미만이면 값을 그대로, 그 이상이면 최저 / 중앙값 / 최고를 적습니다. 괄호의 빈칸은 내신이 비어 범위에서 빠진 수입니다.`
      : null,
    '1단계 불합격은 최종 판정이 없어 합격률의 분모에서 빠지지만, 따로 적어 둡니다.',
    summary.hasRegister ? '등록은 합격·충원합격한 사람 중 등록한 수입니다.' : null,
    summary.hasWaitRank ? '충원 예비순위는 충원합격한 사람의 최초 예비순위 중 가장 뒤 번호입니다.' : null,
    '줄을 누르면 그 대학·전형으로 필터를 걸고 지원 목록으로 돌아갑니다.'
  ].filter(Boolean);

  clear(mount).append(
    head,
    groups.length === 0
      ? el('p', { class: 'py-12 text-center text-lg text-ink-soft', text: '걸려 있는 조건에 맞는 지원 기록이 없습니다.' })
      : el('table', { class: 'w-max min-w-full border-separate border-spacing-0' }, [
          el('thead', {}, [el('tr', {}, 칸.map((item) => th(item.name)))]),
          el('tbody', {}, body)
        ]),
    el('ul', { class: 'mt-4 list-disc space-y-1 pl-5 text-base text-ink-soft' }, notes.map((text) => el('li', { text })))
  );
}
