/**
 * 대학×전형 요약표의 머리(합친 연도·묶음 기준)와 각주 (roadmap.md 1단계).
 *
 * 표 자체는 지원 목록과 **같은 표 컴포넌트**(`createTable`)가 그린다. 정렬·열 너비·열 순서·
 * 열 고정이 두 표에서 다르게 움직이면 상담 중에 손이 헷갈린다. 여기는 그 표에 없는 것만 맡는다.
 */

import { el, clear } from './dom.js';
import { GROUPINGS, SMALL_SAMPLE } from '../analysis/summary.js';

/**
 * @param {HTMLElement} head
 * @param {HTMLElement} notes
 * @param {object} options
 * @param {ReturnType<import('../analysis/summary.js').summarize>} options.summary
 * @param {string|null} options.gpaLabel
 * @param {string} options.grouping
 * @param {(grouping: string) => void} options.onGrouping
 */
export function paintSummaryChrome(head, notes, { summary, gpaLabel, grouping, onGrouping }) {
  const current = grouping in GROUPINGS ? grouping : 'univAdm';

  const 연도 = summary.years
    ? summary.years.from === summary.years.to
      ? `고3 년도 ${summary.years.from}`
      : `고3 년도 ${summary.years.from}~${summary.years.to} 합산`
    : '고3 년도 없음';

  clear(head).append(
    /*
     * **여러 해를 합쳤다는 사실을 늘 적는다.** 합격선은 해마다 움직이는데 합친 숫자만
     * 보이면 그 사실이 숨는다.
     */
    el('p', { class: 'text-base font-semibold text-ink', text: 연도 }),
    el('p', {
      class: 'text-base text-ink-soft',
      text: gpaLabel ? `합격자 내신: ${gpaLabel}` : '내신 열이 없어 합격자 내신을 내지 않습니다'
    }),
    el('div', {
      class: 'flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-0.5 sm:ml-auto',
      attrs: { role: 'group', 'aria-label': '묶음 기준' }
    }, Object.entries(GROUPINGS).map(([id, choice]) => el('button', {
      // 다른 전환 단추(보기·필터 패널)와 같은 모양이다 — 선택한 쪽이 채워진다
      class: `btn btn-sm min-h-8 border-transparent ${id === current ? 'btn-primary' : ''}`,
      text: choice.label,
      attrs: { type: 'button', 'aria-pressed': String(id === current) },
      on: { click: () => { if (id !== current) onGrouping(id); } }
    })))
  );

  /*
   * **숫자의 정의를 표 아래에 늘 둔다.** 「합격 3」이 건인지 명인지, 범위가 몇 건에서
   * 나왔는지 설명하지 못하면 상담에 쓸 수 없다.
   */
  const 문장 = [
    '지원·합격·불합격은 지원 건수 기준입니다. 한 학생이 같은 대학에 두 번 지원했다면 2건으로 계산합니다.',
    `합격률 = (합격 + 충원합격) ÷ 최종 판정. 최종 판정이 ${SMALL_SAMPLE}건 미만이면 합격률을 비워 둡니다.`,
    gpaLabel
      ? `합격자 내신은 합격·충원합격한 학생만으로 냅니다. ${SMALL_SAMPLE}명 미만이면 값을 그대로, 그 이상이면 최저 / 중앙값 / 최고를 적습니다. 내신 빈칸은 내신이 비어 여기서 빠진 학생 수입니다.`
      : null,
    '1단계 불합격은 최종 판정이 없어 합격률의 분모에서 빠지지만, 따로 적어 둡니다.',
    summary.hasRegister ? '등록은 합격·충원합격한 지원 중 등록한 건수입니다.' : null,
    summary.hasWaitRank ? '충원 예비순위는 충원합격한 지원의 최초 예비순위 중 가장 뒤 번호입니다.' : null,
    '줄을 누르면 그 대학·전형으로 필터를 걸고 지원 목록으로 돌아갑니다.'
  ].filter(Boolean);
  clear(notes).append(...문장.map((text) => el('li', { text })));
}
