/**
 * 학생 상세 (§7).
 *
 * 상담 중 가장 오래 보는 화면이다. 표에서 행을 누르거나 차트의 점을 누르면 열린다.
 *
 * 여기 뜨는 것은 익명 ID와 성적·지원 이력뿐이다. 이름과 학번은 보관소에 아예 없다 —
 * 화면에서 가리는 것이 아니라 처음부터 없다(CLAUDE.md §1).
 */

import { el, clear, openDialog, dialogFrame, formatNumber } from './dom.js';
import { outcomeBar, passRate, tallyOutcomes } from './outcome.js';
import { fieldLabel, valueLabel, isBlank } from '../analysis/registry.js';

/** 지원 카드를 늘어놓는 순서. */
export const CARD_ORDERS = {
  기본: {
    label: '연도 최신 → 합격 먼저 → 대학명',
    compare: (left, right) => (right.cohortYear ?? 0) - (left.cohortYear ?? 0)
      || Number(Boolean(right['#outcome']?.passed)) - Number(Boolean(left['#outcome']?.passed))
      || String(left.univ ?? '').localeCompare(String(right.univ ?? ''), 'ko')
  },
  대학: {
    label: '대학명',
    compare: (left, right) => String(left.univ ?? '').localeCompare(String(right.univ ?? ''), 'ko')
  },
  전형: {
    label: '전형유형',
    compare: (left, right) => String(left.admType ?? '').localeCompare(String(right.admType ?? ''), 'ko')
      || String(left.univ ?? '').localeCompare(String(right.univ ?? ''), 'ko')
  }
};

/**
  * 이 학생의 판정 요약.
  *
  * **전체 화면과 같은 모양이다** — 같은 함수로 세고 같은 띠로 그린다. 한 학생을
  * 열었을 때 숫자의 뜻이 바뀌면, 두 화면을 견주던 사람이 그 자리에서 길을 잃는다.
  */
function summaryCard(tally) {
  const rate = passRate(tally);
  const cell = (name, value, tone = '') => el('div', { class: `stat ${tone}` }, [
    el('p', { class: 'stat-name', text: name }),
    el('p', { class: 'stat-value', text: value })
  ]);

  return el('div', { class: 'card overflow-hidden' }, [
    /*
     * **0인 칸도 지우지 않는다.** 전체 화면에서는 판정 미상이 없으면 칸을 뺐는데,
     * 한 학생을 볼 때는 그 빈자리가 "세어 보지 않았다"는 뜻으로 보인다. 0이라고 적어
     * 두어야 읽은 결과임이 드러난다 (§5).
     */
    el('div', { class: 'stat-grid' }, [
      cell('지원', tally.지원),
      cell('합격률', rate === null ? '—' : `${(rate * 100).toFixed(1)}%`),
      cell('합격', tally.합격, 'text-pass'),
      cell('충원합격', tally.충원합격, 'text-wait'),
      cell('불합격', tally.불합격, 'text-fail'),
      cell('판정 미상', tally.미상, 'text-ink-soft')
    ]),
    el('div', { class: 'border-t border-line-soft px-4 py-3' }, [outcomeBar(tally)])
  ]);
}

/** 그 학생의 행에서 어떤 묶음의 값들을 모은다. 값이 없는 열은 내보내지 않는다. */
function collect(row, prefix) {
  return Object.entries(row)
    .filter(([key, value]) => key.startsWith(prefix) && !isBlank(value))
    .map(([key, value]) => ({ key, label: fieldLabel(key), value }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ko'));
}

/**
 * 지원 한 건을 카드로.
 *
 * 좌측 색 띠 + 결과 태그의 모양(●△✕)이 함께 뜻을 나른다. 색만으로 구분하지 않는다.
 */
function applicationCard(row) {
  const outcome = row['#outcome'] ?? { code: 'none', label: '기록 없음', mark: '?' };
  const tone = outcome.code === 'pass' ? 'pass' : outcome.code === 'waitPass' ? 'wait'
    : outcome.code === 'fail' ? 'fail' : outcome.code === 'unknown' ? 'unknown' : 'none';
  const stripe = { pass: 'bg-pass', wait: 'bg-wait', fail: 'bg-fail', unknown: 'bg-wait', none: 'bg-line' }[tone];

  const line = (label, value) => (isBlank(value) ? null : el('div', {}, [
    el('dt', { class: 'text-base text-ink-soft', text: label }),
    el('dd', { class: 'text-base font-medium', text: valueLabel('', value) })
  ]));

  /*
   * 지나온 자취는 **표식으로 적는다.** 1단계·예비순위·등록은 있을 때만 뜻이 있는 값이라,
   * 이름과 값을 나란히 적는 자리에 두면 비어 있는 칸이 늘 네댓 개씩 생긴다.
   */
  const 표식 = (text, tone) => el('span', { class: `tag tag-${tone}`, text });

  const marks = [
    isBlank(row.stage1) ? null : 표식(`1단계 ${valueLabel('', row.stage1)}`, 'none'),
    isBlank(row.waitRank) ? null : 표식(`예비 ${valueLabel('', row.waitRank)}`, 'wait'),
    row.registered && row.registered !== 'none'
      ? 표식(valueLabel('registered', row.registered), 'pass') : null
  ].filter(Boolean);

  return el('article', { class: 'card flex overflow-hidden' }, [
    el('div', { class: `w-1.5 shrink-0 ${stripe}`, attrs: { 'aria-hidden': 'true' } }),
    el('div', { class: 'min-w-0 flex-1 px-4 py-3' }, [
      el('div', { class: 'flex flex-wrap items-center gap-2' }, [
        el('span', { class: 'tag tag-none', text: `${row.cohortYear}년 고3` }),
        el('h4', { class: 'min-w-0 flex-1 truncate text-lg font-bold', text: String(row.univ ?? '(대학 미상)') }),
        el('span', { class: `tag tag-${tone}` }, [
          el('span', { attrs: { 'aria-hidden': 'true' }, text: outcome.mark }),
          el('span', { text: outcome.label })
        ])
      ]),

      // 대학 다음에 오는 것은 언제나 모집단위다. 이름표를 달지 않아도 무엇인지 안다
      isBlank(row.dept) ? null : el('p', {
        class: 'mt-1 truncate text-lg font-medium',
        text: String(row.dept),
        attrs: { title: String(row.dept) }
      }),

      el('dl', { class: 'mt-2 grid grid-cols-2 gap-x-4 gap-y-2' }, [
        line('전형유형', row.admType),
        line('전형명', row.admName),
        line('계열', row.track),
        line('모집시기', row.period)
      ].filter(Boolean)),

      marks.length > 0 ? el('div', { class: 'mt-2 flex flex-wrap gap-2' }, marks) : null,

      isBlank(row.failReason) ? null : el('p', {
        class: 'mt-2 rounded-lg bg-fail-soft px-3 py-1.5 text-base text-fail',
        text: `불합격 사유 ${valueLabel('', row.failReason)}`
      })
    ].filter(Boolean))
  ]);
}

/**
 * 학생 한 명을 연다.
 *
 * @param {HTMLDialogElement} dialog
 * @param {object} options
 * @param {string} options.sid
 * @param {object[]} options.rows 이 학생의 모든 지원 행 (필터를 걸지 않은 전체)
 * @param {number} [options.filteredCount] 지금 조건에 걸린 이 학생의 건수
 */
export function openStudent(dialog, { sid, rows }) {
  let order = '기본';

  // 넓은 화면에서는 두 줄로 세운다. 지원이 열 건을 넘는 학생이 흔해서, 한 줄이면 내려 보기만 길어진다
  const cards = el('div', { class: 'mt-3 grid gap-3 xl:grid-cols-2' });
  function paintCards() {
    const sorted = [...rows].sort(CARD_ORDERS[order].compare);
    clear(cards).append(...sorted.map(applicationCard));
  }
  paintCards();

  const tally = tallyOutcomes(rows);
  const sample = rows[0] ?? {};
  const gpa = collect(sample, 'gpa.');
  const suneung = collect(sample, 'suneung.');

  /** 수능은 영역별로 묶어 보여 준다. `suneung.국어.grade` 를 영역으로 되접는다 */
  const byArea = new Map();
  for (const entry of suneung) {
    const [, area, part] = entry.key.split('.');
    const parts = byArea.get(area) ?? {};
    parts[part] = entry.value;
    byArea.set(area, parts);
  }

  /*
   * 수능은 **성적표 모양 그대로** 보여 준다. 영역마다 카드를 세우면 같은 항목이
   * 카드마다 다른 높이에 적혀, 국어와 수학의 백분위를 견주려면 눈이 지그재그로 움직인다.
   * 한 줄에 한 영역, 한 칸에 한 항목이면 세로로 훑어 바로 비교된다.
   *
   * 열은 **자료에 있는 항목만** 세운다. 원점수는 우리 사전에 없는 항목이라 칸도 두지 않는다 —
   * 빈 칸이 늘어서면 "있는데 못 읽었다"로 보인다(§5).
   */
  const SUNEUNG_COLUMNS = [
    ['subject', '선택과목'],
    ['stdScore', '표준점수'],
    ['percentile', '백분위'],
    ['grade', '등급']
  ];
  // 성적표에 적히는 순서. 여기 없는 영역은 뒤에 붙인다
  const AREA_ORDER = ['국어', '수학', '영어', '한국사', '탐구1', '탐구2', '제2외국어'];

  const areaRows = [...byArea].sort(([left], [right]) => {
    const l = AREA_ORDER.indexOf(left);
    const r = AREA_ORDER.indexOf(right);
    return (l < 0 ? AREA_ORDER.length : l) - (r < 0 ? AREA_ORDER.length : r)
      || left.localeCompare(right, 'ko');
  });
  const usedColumns = SUNEUNG_COLUMNS.filter(([part]) =>
    areaRows.some(([, parts]) => !isBlank(parts[part])));

  const 칸 = (value, extra = '') => el('td', {
    class: `whitespace-nowrap border-t border-line px-3 py-2 text-center text-base tabular-nums ${extra}`,
    text: isBlank(value) ? '-' : formatNumber(value)
  });

  function suneungTable() {
    // 세로로는 미끄러지지 않는 상자다. 막대 자리를 비워 두면 오른쪽에 빈 띠만 남는다
    return el('div', { class: 'card mt-3 overflow-x-auto' }, [
      /*
       * 표가 **상자 너비를 다 쓴다.** 칸을 글자에 맞춰 줄이면 오른쪽에 빈 띠가
       * 남아, 성적표가 아니라 떠 있는 쪽지처럼 보인다. 글자는 줄바꿈하지 않고,
       * 좁아서 다 못 담으면 상자가 가로로 미끄러진다.
       */
      el('table', { class: 'w-full min-w-max border-collapse' }, [
        el('thead', {}, [
          el('tr', { class: 'bg-canvas' }, [
            el('th', { class: 'whitespace-nowrap px-3 py-2 text-center text-base font-semibold', text: '영역' }),
            ...usedColumns.map(([part, label]) => el('th', {
              class: `whitespace-nowrap px-3 py-2 text-center text-base font-semibold ${part === 'grade' ? 'text-brand' : ''}`,
              text: label
            }))
          ])
        ]),
        el('tbody', {}, areaRows.map(([area, parts]) => el('tr', {}, [
          el('th', {
            class: 'whitespace-nowrap border-t border-line px-3 py-2 text-center text-base font-semibold',
            attrs: { scope: 'row' },
            text: area
          }),
          // 등급은 가장 자주 찾는 값이라 한 번에 눈에 들어와야 한다
          ...usedColumns.map(([part]) => 칸(parts[part], part === 'grade' ? 'font-bold text-brand' : ''))
        ])))
      ])
    ]);
  }

  /*
   * 내신은 **조합까지 늘어놓고, 반영비만 접는다.**
   *
   * 상담에서 나란히 보는 것은 전교과와 국영수사과·국영수 같은 조합이다. 지원할
   * 전형에 따라 보는 줄이 달라서, 하나만 두면 매번 접힌 것을 열어야 한다.
   * 반면 `전교과(2/4/4)`처럼 반영비가 붙은 줄은 같은 조합을 비율만 바꿔 다시 센
   * 값이라 수가 금세 불어난다 — 그쪽만 접는다.
   *
   * 나누는 기준은 **괄호**다. 조합 이름은 학교마다 다르므로 이름을 목록으로 박아
   * 두면 다른 학교에서 통째로 빗나간다. 반영비가 붙었다는 사실은 양식과 무관하다.
   */
  const 전교과 = ['전교과', '전과목', '전교과목'];
  const 반영비붙음 = (entry) => entry.label.includes('(');
  const 조합순 = (left, right) => {
    const l = 전교과.some((word) => left.label.startsWith(word));
    const r = 전교과.some((word) => right.label.startsWith(word));
    return Number(r) - Number(l) || left.label.localeCompare(right.label, 'ko');
  };

  const mainGpa = gpa.filter((entry) => !반영비붙음(entry)).sort(조합순);
  const restGpa = gpa.filter(반영비붙음).sort(조합순);
  // 전부 반영비가 붙은 양식이라면 접을 것이 아니라 그게 전부다
  const 보일내신 = mainGpa.length > 0 ? mainGpa : restGpa;
  const 접을내신 = mainGpa.length > 0 ? restGpa : [];

  const gpaCard = (entry, big = false) => el('div', { class: 'card px-3 py-2' }, [
    el('p', { class: 'truncate text-base text-ink-soft', text: entry.label, attrs: { title: entry.label } }),
    el('p', { class: `${big ? 'text-3xl' : 'text-xl'} font-bold tabular-nums`, text: formatNumber(entry.value) })
  ]);

  // 사이 간격을 **한 군데서** 준다. 조각마다 mt 를 달면 조각 하나가 빠질 때 간격이 어긋난다
  const body = el('div', { class: 'space-y-6' }, [
    summaryCard(tally),

    gpa.length > 0
      ? el('section', {}, [
          el('h3', { class: 'text-lg font-bold tracking-tight', text: '내신' }),
          el('div', { class: 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5' },
            보일내신.map((entry, index) => gpaCard(entry, index === 0))),
          접을내신.length > 0
            ? el('details', { class: 'mt-3' }, [
                el('summary', {
                  class: 'cursor-pointer list-none rounded-lg border border-line bg-surface px-4 py-2 text-base font-medium hover:bg-brand-soft',
                  text: `반영비를 다르게 계산한 ${접을내신.length}개 더보기`
                }),
                el('div', { class: 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5' },
                  접을내신.map((entry) => gpaCard(entry)))
              ])
            : null
        ])
      : null,

    byArea.size > 0
      ? el('section', {}, [
          el('h3', { class: 'text-lg font-bold tracking-tight', text: '수능' }),
          suneungTable()
        ])
      : null,

    el('section', {}, [
      el('div', { class: 'flex flex-wrap items-center gap-3' }, [
        el('h3', { class: 'text-lg font-bold tracking-tight', text: `지원 이력 ${rows.length}건` }),
        // 좁은 화면에서 고르는 칸이 줄지 않으면 상자 밖으로 밀고 나간다
        el('label', { class: 'ml-auto flex min-w-0 items-center gap-2 text-base text-ink-soft' }, [
          '정렬',
          el('select', {
            class: 'field min-h-9 w-auto min-w-0 max-w-full text-base',
            attrs: { 'aria-label': '지원 카드 정렬' },
            on: { change: (event) => { order = event.target.value; paintCards(); } }
          }, Object.entries(CARD_ORDERS).map(([key, value]) => el('option', {
            text: value.label, attrs: { value: key, selected: key === order }
          })))
        ])
      ]),
      cards
    ])
  ]);

  openDialog(dialog, dialogFrame({
    title: sid,
    note: '이름과 학번은 보관하지 않습니다. 익명 ID로만 남습니다.',
    body,
    onClose: () => dialog.close()
  }));
}
