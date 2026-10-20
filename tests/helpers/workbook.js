/**
 * 테스트용 엑셀·zip 생성기.
 *
 * 실제 학교 자료는 저장소에 들어올 수 없으므로(§11) 픽스처를 코드로 만든다.
 * 바이너리 파일을 커밋하지 않아도 되고, 어떤 자료를 가정했는지 테스트에 그대로 드러난다.
 */

import { utils as sheetUtils, write as writeWorkbook } from 'xlsx';
import { zipSync } from 'fflate';

/**
 * 격자들을 시트로 담은 xlsx 바이트열을 만든다.
 * @param {Record<string, unknown[][]>} sheets 시트명 → 행렬
 * @returns {Uint8Array}
 */
export function makeWorkbook(sheets) {
  const workbook = sheetUtils.book_new();
  for (const [sheetName, grid] of Object.entries(sheets)) {
    sheetUtils.book_append_sheet(workbook, sheetUtils.aoa_to_sheet(grid), sheetName);
  }
  return new Uint8Array(writeWorkbook(workbook, { type: 'array', bookType: 'xlsx' }));
}

/**
 * @param {Record<string, Uint8Array>} entries 파일명(또는 경로) → 내용
 * @returns {Uint8Array}
 */
export function makeZip(entries) {
  return zipSync(entries);
}

/** 센진학 계열 표본. 헤더 1행, `학년` 열에 학년도가 들어 있다. */
export function senjinhakGrid(year = 2026) {
  return [
    ['학년', '학번', '이름', '지역', '대학', '모집단위', '전형명', '계열', '지원시기', '전과목', '1단계', '최종'],
    [year, '30101', '김가온', '서울', '서울대학교', '컴퓨터공학부', '학생부종합 일반전형', '자연', '수시', 1.82, '합', '합'],
    [year, '30101', '김가온', '서울', '연세대학교', '인공지능학과', '활동우수형', '자연', '수시', 1.82, '합', '불'],
    [year, '30102', '박서린', '서울', '성균관대학교', '경영학과', '학생부종합', '인문', '수시', 2.41, '합', '합'],
    [year, '30103', '이도윤', '경기', '아주대학교', '기계공학과', '학생부교과', '자연', '수시', 3.15, null, '불']
  ];
}

/**
 * 대교협 계열 표본. 헤더 2행, `학년` 열에는 학년도가 아니라 **학년(3)** 이 들어 있다.
 * 학년도 인식이 이 값을 학년도로 오해하면 안 된다.
 */
export function kcueGrid() {
  return [
    ['학년', '반', '번호', '이름', '대학명', '모집시기', '전형유형', '모집단위', '1단계', '최종단계', '전교과', '한국사', '국어', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '등급', '과목', '표점', '백분위', '등급'],
    [3, 5, 7, '최윤슬', '고려대학교(서울)', '수시', '학생부위주(종합)', '아동청소년학과', '불합격', '불합격', 6.36, 5, '화법과 작문', 88, 25, 7],
    [3, 5, 7, '최윤슬', '한양대학교(서울)', '수시', '학생부위주(종합)', '사회학과', '불합격', '불합격', 6.36, 5, '화법과 작문', 88, 25, 7],
    [3, 2, 4, '정하람', '중앙대학교', '수시', '논술위주', '경영학부', '합격', '불합격', 4.21, 4, '언어와 매체', 102, 68, 4]
  ];
}

/**
 * CP949로 적은 바이트열.
 *
 * 표준에는 euc-kr **디코더**만 있고 인코더가 없다. 그래서 디코더로 표를 거꾸로 만들어 쓴다.
 * 시험용이라 느려도 된다 — 한 번 만들어 두고 다시 쓴다.
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
let cp949Table = null;
export function toCp949(text) {
  if (!cp949Table) {
    const decoder = new TextDecoder('euc-kr');
    cp949Table = new Map();
    for (let high = 0x81; high <= 0xfe; high += 1) {
      for (let low = 0x41; low <= 0xfe; low += 1) {
        const char = decoder.decode(new Uint8Array([high, low]));
        if (char.length === 1 && char !== '�' && !cp949Table.has(char)) {
          cp949Table.set(char, [high, low]);
        }
      }
    }
  }
  const out = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else out.push(...(cp949Table.get(char) ?? [0x3f]));
  }
  return new Uint8Array(out);
}

/**
 * 항목 하나짜리 zip을 손으로 만든다 — **이름 바이트를 날것 그대로 넣고 UTF-8 플래그를 세우지 않는다.**
 *
 * `zipSync`는 늘 UTF-8 플래그를 세우므로 국내 압축 도구가 내놓는 모양을 만들 수 없다.
 * 그 모양이 바로 한글 이름이 깨지는 자리라, 시험하려면 직접 만들어야 한다.
 *
 * @param {Uint8Array} nameBytes
 * @param {Uint8Array} content 무압축으로 담는다
 * @returns {Uint8Array}
 */
export function makeLegacyZip(nameBytes, content) {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of content) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;

  const width = nameBytes.length;
  const local = new Uint8Array(30 + width + content.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0, true);   // 범용 플래그 — 11번 비트(UTF-8)를 세우지 않는다
  localView.setUint16(8, 0, true);   // 저장(무압축)
  localView.setUint32(14, crc, true);
  localView.setUint32(18, content.length, true);
  localView.setUint32(22, content.length, true);
  localView.setUint16(26, width, true);
  local.set(nameBytes, 30);
  local.set(content, 30 + width);

  const central = new Uint8Array(46 + width);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint32(16, crc, true);
  centralView.setUint32(20, content.length, true);
  centralView.setUint32(24, content.length, true);
  centralView.setUint16(28, width, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}
