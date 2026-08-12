/**
 * Crockford Base32 인코더.
 *
 * 익명 ID를 사람이 읽고 받아적을 수 있어야 하므로 Crockford 변형을 쓴다.
 * I, L, O, U를 뺀 32글자라서 1/I, 0/O 혼동이 없고, 욕설이 우연히 만들어지지 않는다.
 * 상담 기록에 "2026-A3F2-7K9M" 형태로 남는 값이므로 이 성질이 중요하다.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 바이트열을 Base32 문자열로 인코딩한다.
 * @param {Uint8Array} bytes
 * @param {number} [length] 잘라낼 글자 수. 생략하면 전부.
 * @returns {string}
 */
export function encodeBase32(bytes, length) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 0b11111];
      if (length !== undefined && out.length >= length) return out;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 0b11111];
  return length === undefined ? out : out.slice(0, length);
}

/**
 * 읽기 편하도록 일정 길이마다 하이픈을 넣는다. "A3F27K9M" → "A3F2-7K9M"
 * @param {string} text
 * @param {number} groupSize
 * @returns {string}
 */
export function group(text, groupSize = 4) {
  const parts = [];
  for (let i = 0; i < text.length; i += groupSize) parts.push(text.slice(i, i + groupSize));
  return parts.join('-');
}
