/**
 * 판정을 세고 띠로 그린다.
 *
 * **전체 화면과 학생 한 명이 같은 함수를 쓴다.** 따로 두면 한쪽만 고쳐도 아무것도
 * 울지 않고, 같은 지원 건이 자리에 따라 다르게 세어진다 — 그런 어긋남은
 * 화면 어디에도 드러나지 않는다 (§5).
 */

import { el } from './dom.js';

/**
 * 지원 건을 판정별로 센다.
 *
 * 읽지 못한 표기(`unknown`)와 기록이 없는 건(`none`)을 합격에도 불합격에도 넣지 않는다.
 * 어느 한쪽에 밀어 넣으면 합격률이 조용히 틀리고, 틀린 티가 나지 않는다 (§5).
 *
 * @param {object[]} rows
 */
export function tallyOutcomes(rows) {
  const tally = { 지원: rows.length, 합격: 0, 충원합격: 0, 불합격: 0, 미상: 0, 학생: 0, 최종판정: 0 };
  const students = new Set();
  for (const row of rows) {
    if (row.sid) students.add(row.sid);
    const code = row['#outcome']?.code;
    if (code === 'pass') tally.합격 += 1;
    else if (code === 'waitPass') tally.충원합격 += 1;
    else if (code === 'fail') tally.불합격 += 1;
    else tally.미상 += 1;
    // 최종 열에서 읽은 판정만 센다. 1단계 탈락은 세되 비율의 분모에는 넣지 않는다
    if (row['#outcome']?.final && code !== 'unknown') tally.최종판정 += 1;
  }
  tally.학생 = students.size;
  return tally;
}

/**
 * 합격률. 분모는 **판정을 읽어 낸 지원 건수**다.
 *
 * 전체 건수로 나누면 읽지 못한 표기가 많은 해일수록 합격률이 낮게 나오는데,
 * 그건 그 해 실적이 아니라 우리 사전의 구멍이다.
 *
 * @returns {number|null} 셀 수 있는 건이 하나도 없으면 null
 */
export function passRate(tally) {
  /*
   * 분모는 **최종 열에서 판정을 읽어 낸 건수**다. 1단계 탈락만 적힌 건은 빠진다 —
   * 같은 파일의 1단계 합격은 아직 합격이 아니라 분자에 들어갈 수 없으므로,
   * 분모에만 넣으면 발표 전 파일이 「합격률 0.0%」로 보인다 (§5).
   */
  const judged = tally.최종판정 ?? (tally.합격 + tally.충원합격 + tally.불합격);
  return judged === 0 ? null : (tally.합격 + tally.충원합격) / judged;
}

/**
 * 판정 구성 막대.
 *
 * 숫자 넷만으로는 서로의 비율이 눈에 들어오지 않는다. 띠 하나가 그걸 대신한다.
 *
 * **차트 라이브러리를 들이지 않는다.** 범주 넷짜리 띠 하나를 그리려고
 * 단일 HTML 배포에 수십 KB를 얹을 까닭이 없다 (§6). 칸마다 분포를 세어
 * 보여 줄 일이 생기면 그때 다시 판단한다.
 *
 * **색만으로 구분하지 않는다** (§9). 칸마다 모양을 적고, 이름은 범례가 맡는다.
 *
 * @param {ReturnType<typeof tallyOutcomes>} tally
 * @returns {HTMLElement|null} 셀 것이 없으면 null
 */
export function outcomeBar(tally) {
  if (tally.지원 === 0) return null;
  const parts = [
    { name: '합격', mark: '●', count: tally.합격, tone: 'bg-pass text-white', ink: 'text-pass-deep' },
    { name: '충원합격', mark: '△', count: tally.충원합격, tone: 'bg-wait text-white', ink: 'text-wait-deep' },
    { name: '불합격', mark: '✕', count: tally.불합격, tone: 'bg-fail text-white', ink: 'text-fail-deep' },
    /*
     * 미상의 모양은 `?`다. 가운뎃점은 이 화면에서 머리글을 잇는 글자라서(`국어·수학`)
     * 모양이 아니라 글자 사이에 낀 먼지처럼 보인다.
     */
    { name: '판정 미상', mark: '?', count: tally.미상, tone: 'bg-line text-ink', ink: 'text-ink-soft' }
  ].filter((part) => part.count > 0);

  const 몫 = (count) => (count / tally.지원) * 100;

  /*
   * 칸 안의 글자는 **자리가 허락하는 만큼만** 적는다.
   *
   * 칸 너비는 비율이 정하는데 글자 길이는 비율이 정하지 않는다. 그래서 좁은 칸에
   * 숫자까지 밀어 넣으면 글자가 칸을 넘어 옆 칸을 덮는다. 넓으면 숫자까지,
   * 그보다 좁으면 모양만, 더 좁으면 아무것도 적지 않는다.
   */
  const 글자 = (part) => {
    const 비율 = 몫(part.count);
    if (비율 >= 18) return `${part.mark} ${비율.toFixed(1)}%`;
    if (비율 >= 5) return part.mark;
    return '';
  };

  return el('div', {}, [
    el('div', {
      class: 'flex h-6 w-full overflow-hidden rounded',
      attrs: { role: 'img', 'aria-label': parts.map((part) => `${part.name} ${part.count}건`).join(', ') }
    }, parts.map((part) => el('div', {
      class: `${part.tone} flex items-center justify-center overflow-hidden whitespace-nowrap text-base font-semibold`,
      // 칸 너비는 자료에서 나온다. 클래스로는 적을 수 없는 값이다 (§9의 예외)
      style: { width: `${몫(part.count).toFixed(2)}%` },
      attrs: { title: `${part.name} ${part.count}건 (${몫(part.count).toFixed(1)}%)` },
      text: 글자(part)
    }))),
    el('ul', {
      class: 'mt-2 flex flex-wrap gap-x-4 gap-y-1 text-base'
    }, parts.map((part) => el('li', {
      // 범례 글자는 띠의 색을 이어받는다. 어느 칸을 가리키는 말인지 색이 먼저 말해 준다
      class: `${part.ink} font-medium`,
      text: `${part.mark} ${part.name} ${part.count}건 (${몫(part.count).toFixed(1)}%)`
    })))
  ]);
}
