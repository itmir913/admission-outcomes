/**
 * 헤더 지문 (§4).
 *
 * **파일 이름에 `fingerprint`를 쓰지 않는다.** 브라우저 지문채취(fingerprinting)가
 * 추적 기법 이름이라, 광고·추적 차단기의 기본 필터 목록이 경로에 그 낱말이 든 스크립트를
 * 통째로 막는다. 개발 서버에서 이 모듈 하나가 `ERR_BLOCKED_BY_CLIENT`로 떨어지면
 * 그걸 들여오는 모듈 그래프 전체가 죽고, 화면은 머리줄만 남는다 — 실제로 겪었다.
 * 개념 이름(`fingerprint`)은 프로파일 JSON과 문서에 그대로 두되, **경로에는 두지 않는다.**
 *
 * 프로파일의 열 인덱스를 믿어도 되는지 판별하는 장치다.
 * 열이 하나만 늘거나 이름이 하나만 바뀌어도 지문이 달라지므로,
 * "프로파일이 있으니 맞겠지" 하고 엉뚱한 열을 읽는 사고를 막는다.
 */

import { sha256Text, toHex } from '../core/hash.js';

/** 헤더 칸 하나를 지문용으로 정리한다. */
export function normalizeHeaderCell(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    // 전각 영숫자·기호를 반각으로
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    // 폭 없는 문자는 눈에 안 보이면서 지문만 바꾼다
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 헤더 행들을 지문용 문자열로 만든다.
 *
 * 오른쪽 끝의 빈 칸은 잘라낸다. 엑셀은 편집 흔적만으로도 빈 열을 붙여 두는데,
 * 그것 때문에 지문이 달라지면 멀쩡한 프로파일이 버려진다.
 *
 * @param {unknown[][]} grid
 * @param {number} headerRows
 * @returns {string}
 */
export function headerSignature(grid, headerRows = 1) {
  const rows = (grid ?? []).slice(0, Math.max(1, headerRows));
  const width = rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0);

  const cells = [];
  for (let row = 0; row < rows.length; row += 1) {
    const line = [];
    for (let column = 0; column < width; column += 1) {
      line.push(normalizeHeaderCell(rows[row]?.[column]));
    }
    while (line.length && line[line.length - 1] === '') line.pop();
    cells.push(line.join(''));
  }
  return cells.join('');
}

/**
 * @param {unknown[][]} grid
 * @param {number} headerRows
 * @returns {Promise<string>} 소문자 16진 해시
 */
export async function headerFingerprint(grid, headerRows = 1) {
  return toHex(await sha256Text(headerSignature(grid, headerRows)));
}
