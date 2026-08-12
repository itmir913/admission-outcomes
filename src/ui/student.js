/**
 * 학생 상세 (§7).
 *
 * 상담 중 가장 오래 보는 화면이다. 표에서 행을 누르거나 차트의 점을 누르면 열린다.
 *
 * 여기 뜨는 것은 익명 ID와 성적·지원 이력뿐이다. 이름과 학번은 보관소에 아예 없다 —
 * 화면에서 가리는 것이 아니라 처음부터 없다(CLAUDE.md §1).
 */

import { el, clear, openDialog, dialogFrame, formatNumber } from './dom.js';
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

/** 한 학생의 지원 건을 결과별로 센다. */
export function summarize(rows) {
  const tally = { 지원: rows.length, 합격: 0, 불합격: 0, 기타: 0 };
  for (const row of rows) {
    const outcome = row['#outcome'];
    if (outcome?.passed) tally.합격 += 1;
    else if (outcome?.code === 'fail') tally.불합격 += 1;
    else tally.기타 += 1;
  }
  return tally;
}

/** 타일 하나. 이름과 값을 크게 붙여 놓는다. */
function tile(label, value, tone = '') {
  return el('div', { class: `card px-4 py-3 ${tone}` }, [
    el('p', { class: 'text-sm text-ink-soft', text: label }),
    el('p', { class: 'mt-0.5 text-2xl font-bold tabular-nums', text: value })
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
  const outcome = row['#outcome'] ?? { code: 'none', label: '기록 없음', mark: '·' };
  const tone = outcome.code === 'pass' ? 'pass' : outcome.code === 'waitPass' ? 'wait'
    : outcome.code === 'fail' ? 'fail' : outcome.code === 'unknown' ? 'unknown' : 'none';
  const stripe = { pass: 'bg-pass', wait: 'bg-wait', fail: 'bg-fail', unknown: 'bg-wait', none: 'bg-line' }[tone];

  const line = (label, value) => (isBlank(value) ? null : el('div', {}, [
    el('dt', { class: 'text-sm text-ink-soft', text: label }),
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
 * 학생 한 명을 펼친다.
 *
 * @param {HTMLDialogElement} dialog
 * @param {object} options
 * @param {string} options.sid
 * @param {object[]} options.rows 이 학생의 모든 지원 행 (필터를 걸지 않은 전체)
 * @param {number} [options.filteredCount] 지금 조건에 걸린 이 학생의 건수
 */
export function openStudent(dialog, { sid, rows }) {
  let order = '기본';

  const cards = el('div', { class: 'mt-4 space-y-3' });
  function paintCards() {
    const sorted = [...rows].sort(CARD_ORDERS[order].compare);
    clear(cards).append(...sorted.map(applicationCard));
  }
  paintCards();

  const tally = summarize(rows);
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

  const body = el('div', {}, [
    el('div', { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' }, [
      tile('지원', tally.지원),
      tile('합격', tally.합격, 'border-pass/40 bg-pass-soft'),
      tile('불합격', tally.불합격, 'border-fail/40 bg-fail-soft'),
      tile('기타', tally.기타)
    ]),

    gpa.length > 0
      ? el('section', { class: 'mt-6' }, [
          el('h3', { class: 'text-lg font-bold tracking-tight', text: '내신' }),
          el('div', { class: 'mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5' },
            gpa.map((entry) => el('div', { class: 'card px-3 py-2' }, [
              el('p', { class: 'truncate text-sm text-ink-soft', text: entry.label, attrs: { title: entry.label } }),
              el('p', { class: 'text-xl font-bold tabular-nums', text: formatNumber(entry.value) })
            ])))
        ])
      : null,

    byArea.size > 0
      ? el('section', { class: 'mt-6' }, [
          el('h3', { class: 'text-lg font-bold tracking-tight', text: '수능' }),
          el('div', { class: 'mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5' },
            [...byArea].map(([area, parts]) => el('div', { class: 'card px-3 py-2' }, [
              el('p', { class: 'text-sm font-semibold', text: area }),
              ...Object.entries(parts).map(([part, value]) => el('p', {
                class: 'text-base tabular-nums',
                text: `${PART_LABEL[part] ?? part} ${formatNumber(value)}`
              }))
            ])))
        ])
      : null,

    el('section', { class: 'mt-6' }, [
      el('div', { class: 'flex flex-wrap items-center gap-3' }, [
        el('h3', { class: 'text-lg font-bold tracking-tight', text: `지원 이력 ${rows.length}건` }),
        el('label', { class: 'ml-auto flex items-center gap-2 text-sm text-ink-soft' }, [
          '차례',
          el('select', {
            class: 'field min-h-9 w-auto text-sm',
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
