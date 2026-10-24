/**
 * 숫자·글자 칸에서 「값이 없다」는 뜻의 표기 (식별 열은 `anonymize.js`의 `isBlankMark`가 본다).
 *
 * **열을 고르는 쪽(`resolveColumns`)과 값을 읽는 쪽(`buildRecords`)이 이 하나를 쓴다.**
 * 따로 두었더니 읽는 쪽은 `-`·`0`을 빈칸으로 보는데 고르는 쪽은 범위 밖 값으로 세어,
 * 자리채움 몇 칸 때문에 멀쩡한 내신 열이 통째로 배정에서 빠졌다 (§5).
 */

/** 엑셀에서 자리를 채우려고 넣는 표기들 */
export const BLANK_MARKS = new Set(['-', '--', '.', '없음', '해당없음', '미해당', 'N/A', 'n/a']);

/**
 * @param {string} key 논리 필드 키
 * @param {unknown} raw 셀 값
 */
export function isBlankCell(key, raw) {
  if (raw === null || raw === undefined) return true;
  const text = String(raw).normalize('NFC').trim();
  if (text === '' || BLANK_MARKS.has(text)) return true;
  /*
   * **내신과 수능 등급의 0은 빈칸이다.** 등급에 0은 나올 수 없어, 값이 없는 자리를
   * 0으로 채운 것이다. 표준점수·백분위의 0은 있을 수 있는 값이라 건드리지 않는다.
   */
  const parts = key.split('.');
  const 등급칸 = parts[0] === 'gpa' || (parts[0] === 'suneung' && parts.at(-1) === 'grade');
  return 등급칸 && Number(text) === 0;
}
