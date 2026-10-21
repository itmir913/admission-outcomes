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

/** 지원 카드를 늘어놓는 차례. */
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
      el('dl', { class: 'mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4' }, [
        line('모집단위', row.dept),
        line('전형유형', row.admType),
        line('전형명', row.admName),
        line('계열', row.track),
        line('모집시기', row.period),
        line('1단계', row.stage1),
        line('불합격 사유', row.failReason),
        line('예비순위', row.waitRank),
        row.registered && row.registered !== 'none'
          ? line('등록', valueLabel('registered', row.registered)) : null
      ].filter(Boolean))
    ])
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

  const cards = el('div', { class: 'mt-3 space-y-3' });
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

  const PART_LABEL = { subject: '과목', stdScore: '표점', percentile: '백분위', grade: '등급' };

  // 사이 간격을 **한 군데서** 준다. 조각마다 mt 를 달면 조각 하나가 빠질 때 간격이 어긋난다
  const body = el('div', { class: 'space-y-6' }, [
    summaryCard(tally),

    gpa.length > 0
      ? el('section', {}, [
          el('h3', { class: 'text-lg font-bold tracking-tight', text: '내신' }),
          el('div', { class: 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5' },
            gpa.map((entry) => el('div', { class: 'card px-3 py-2' }, [
              el('p', { class: 'truncate text-base text-ink-soft', text: entry.label, attrs: { title: entry.label } }),
              el('p', { class: 'text-xl font-bold tabular-nums', text: formatNumber(entry.value) })
            ])))
        ])
      : null,

    byArea.size > 0
      ? el('section', {}, [
          el('h3', { class: 'text-lg font-bold tracking-tight', text: '수능' }),
          el('div', { class: 'mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5' },
            [...byArea].map(([area, parts]) => el('div', { class: 'card px-3 py-2' }, [
              el('p', { class: 'text-base font-semibold', text: area }),
              ...Object.entries(parts).map(([part, value]) => el('p', {
                class: 'text-base tabular-nums',
                text: `${PART_LABEL[part] ?? part} ${formatNumber(value)}`
              }))
            ])))
        ])
      : null,

    el('section', {}, [
      el('div', { class: 'flex flex-wrap items-center gap-3' }, [
        el('h3', { class: 'text-lg font-bold tracking-tight', text: `지원 이력 ${rows.length}건` }),
        el('label', { class: 'ml-auto flex items-center gap-2 text-base text-ink-soft' }, [
          '차례',
          el('select', {
            class: 'field min-h-9 w-auto text-base',
            attrs: { 'aria-label': '지원 카드 차례' },
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
