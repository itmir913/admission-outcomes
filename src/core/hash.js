/**
 * SHA-256 해시. WebCrypto만 쓴다 (브라우저·Node 공통).
 *
 * 쓰이는 곳은 두 군데다.
 *   - 파일 중복 감지: 같은 파일을 다시 올렸는지 내용으로 판별한다
 *   - 학생 식별 키(§2): 이름·학번을 해시로 바꾼 뒤 원문을 버린다
 */

const textEncoder = new TextEncoder();

function subtle() {
  const provider = globalThis.crypto;
  if (!provider?.subtle) {
    throw new Error('이 브라우저에서는 보안 기능을 쓸 수 없습니다. HTTPS 또는 localhost에서 열어 주세요.');
  }
  return provider.subtle;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function sha256(bytes) {
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

/**
 * @param {string} text
 * @returns {Promise<Uint8Array>}
 */
export async function sha256Text(text) {
  // 한글은 입력기에 따라 자모 분리형(NFD)으로 들어올 수 있다.
  // 정규화하지 않으면 눈에 같은 이름이 다른 해시가 되어 같은 학생이 둘로 갈라진다.
  return sha256(textEncoder.encode(text.normalize('NFC')));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} 소문자 16진 문자열
 */
export function toHex(bytes) {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  return toHex(await sha256(bytes));
}
