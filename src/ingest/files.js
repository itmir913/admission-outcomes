/**
 * 업로드 처리 (§3).
 *
 * 엑셀 여러 개를 한꺼번에 올리거나, 그것들을 담은 zip 하나를 올린다.
 * **zip은 압축을 해제하는 단계가 하나 더 있을 뿐, 그 뒤로는 완전히 같은 경로를 탄다.**
 * 분기를 만들면 zip 경로만 조용히 낡는다.
 */

import { unzipSync } from 'fflate';
import { read as readWorkbook, utils as sheetUtils } from 'xlsx';
import { sha256Hex } from '../core/hash.js';

export const EXCEL_EXTENSIONS = ['.xlsx', '.xlsm', '.xlsb', '.xls'];

/** 압축 폭탄 방어. 학교 자료 규모를 한참 넘는 선에서 자른다. */
export const ARCHIVE_LIMITS = {
  maxEntries: 200,
  maxTotalBytes: 512 * 1024 * 1024
};

/** @param {string} name */
export function isExcelName(name) {
  const lower = String(name ?? '').toLowerCase();
  return EXCEL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * zip 여부를 확장자가 아니라 매직 바이트로 본다.
 * 확장자를 바꿔 올리는 일이 실제로 있다.
 * @param {Uint8Array} bytes
 */
export function isZipBytes(bytes) {
  return bytes?.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/**
 * 진짜 스프레드시트인지 매직 바이트로 확인한다.
 *
 * SheetJS는 임의의 텍스트도 표로 파싱하려 든다. 확장자만 바꾼 파일이 조용히 통과하면
 * 엉뚱한 자료가 상담 화면에 올라간다. 넘기기 전에 걸러낸다.
 *
 *   xlsx·xlsm·xlsb → zip (PK)
 *   xls            → OLE2 복합 문서 (D0 CF 11 E0 A1 B1 1A E1)
 *
 * @param {Uint8Array} bytes
 */
export function isSpreadsheetBytes(bytes) {
  if (isZipBytes(bytes)) return true;
  const ole2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes?.length >= ole2.length && ole2.every((byte, index) => bytes[index] === byte);
}

/**
 * zip 항목 이름의 글자 인코딩을 알아낸다.
 *
 * zip은 이름 바이트가 어떤 인코딩인지를 **플래그 한 비트로만** 밝힌다(범용 플래그 11번).
 * 그런데 국내에서 흔히 쓰는 압축 도구 상당수가 그 비트를 세우지 않은 채 CP949로 적는다.
 * 그러면 읽는 쪽은 규격대로 바이트를 latin1로 받아 `ÁøÇÐ°á°ú.xlsx` 같은 이름을 얻는다.
 *
 * **바이트 자체는 그대로 남아 있다.** latin1은 바이트와 글자가 1:1이라 되읽을 수 있다.
 *
 * 순서가 중요하다. **엄격한 UTF-8을 먼저 시도한다** — 성공하면 그것이 UTF-8이 맞다.
 * 잘못된 바이트열은 엄격 모드가 거절하므로, 성공 자체가 근거가 된다.
 * 거절당하면 CP949로 읽고, 그것도 대체 문자가 나오면 **원래 이름을 그대로 둔다**(§5).
 *
 * CP949 이름이 우연히 올바른 UTF-8이기도 한 경우는 막지 못한다. 한글 구간의 바이트 조합이
 * UTF-8 규칙과 어긋나는 쪽이 대부분이라 드물고, 틀렸을 때 손해는 이름 한 줄이 이상해지는 것뿐이다.
 *
 * @param {string} name fflate가 돌려준 이름
 * @returns {string}
 */
export function decodeEntryName(name) {
  let hasHighByte = false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    // 0xFF를 넘는 글자가 있으면 이미 제대로 해석된 이름이다 (UTF-8 플래그가 서 있었다)
    if (code > 0xff) return name;
    if (code >= 0x80) hasHighByte = true;
  }
  // 순 ASCII면 어느 인코딩으로 읽어도 같다
  if (!hasHighByte) return name;

  const bytes = new Uint8Array(name.length);
  for (let index = 0; index < name.length; index += 1) bytes[index] = name.charCodeAt(index);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // UTF-8이 아니다. 다음 후보로 넘어간다
  }
  try {
    const decoded = new TextDecoder('euc-kr').decode(bytes);
    if (!decoded.includes('�')) return decoded;
  } catch {
    // 이 실행 환경에 euc-kr 표가 없다. 원래 이름을 그대로 둔다
  }
  return name;
}

/**
 * zip 항목 이름에서 파일명만 남긴다.
 * 폴더 구조는 쓰지 않으므로 경로 순회(`../`)가 끼어들 여지를 없앤다.
 * @param {string} entryName
 */
function baseName(entryName) {
  const parts = String(entryName).split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

/** macOS가 zip에 끼워 넣는 부산물과 숨김 파일을 걸러낸다. */
function isNoise(entryName) {
  const name = baseName(entryName);
  return entryName.startsWith('__MACOSX/') || name.startsWith('.') || name.startsWith('~$');
}

/**
 * @typedef {{ name: string, bytes: Uint8Array, container?: string }} SourceFile
 */

/**
 * 업로드된 것들을 엑셀 파일 목록으로 전개한다.
 *
 * zip 안의 zip은 해제하지 않는다. 자료 정리에 필요한 구조가 아니고,
 * 중첩 압축은 압축 폭탄의 통로가 된다.
 *
 * @param {SourceFile[]} uploads
 * @param {{limits?: typeof ARCHIVE_LIMITS}} [options]
 * @returns {{ files: SourceFile[], skipped: {name: string, reason: string}[] }}
 */
export function expandUploads(uploads, { limits = ARCHIVE_LIMITS } = {}) {
  /** @type {SourceFile[]} */
  const files = [];
  /** @type {{name: string, reason: string}[]} */
  const skipped = [];

  for (const upload of uploads) {
    const { name, bytes } = upload;

    if (!isZipBytes(bytes)) {
      if (isExcelName(name)) files.push({ name, bytes });
      else skipped.push({ name, reason: '엑셀 파일이 아닙니다.' });
      continue;
    }

    // xlsx 자체가 zip이므로 먼저 오피스 문서인지 본다.
    // 이 조회는 작은 파일 하나만 해제하므로 값이 싸다
    let officeMarker;
    try {
      officeMarker = unzipSync(bytes, { filter: (entry) => entry.name === '[Content_Types].xml' });
    } catch {
      skipped.push({ name, reason: '압축을 해제할 수 없습니다.' });
      continue;
    }
    if (Object.keys(officeMarker).length > 0) {
      if (isExcelName(name)) files.push({ name, bytes });
      else skipped.push({ name, reason: '엑셀 파일이 아닙니다.' });
      continue;
    }

    // **해제하기 전에 걸러낸다.** 다 해제해 놓고 크기를 재면 그때는 이미 늦다 —
    // 압축 폭탄은 해제하는 순간 메모리를 삼킨다
    let seen = 0;
    let declaredBytes = 0;
    let tooManyEntries = false;
    let tooLarge = false;
    const nested = [];

    let entries;
    try {
      entries = unzipSync(bytes, {
        filter: (entry) => {
          // **엑셀만 센다.** macOS가 넣는 `__MACOSX/._*` 부산물까지 세면 엑셀 101개짜리
          // 압축이 202개로 잡혀, 멀쩡한 묶음이 손댈 길 없이 통째로 막혔다
          if (isNoise(entry.name)) return false;
          const inner = baseName(entry.name);
          if (!isExcelName(inner)) {
            if (inner.toLowerCase().endsWith('.zip')) nested.push(decodeEntryName(inner));
            return false;
          }
          seen += 1;
          if (seen > limits.maxEntries) { tooManyEntries = true; return false; }
          declaredBytes += entry.originalSize ?? 0;
          /*
           * 한도를 넘으면 **그 압축은 통째로 거절한다.** 예전에는 넘은 뒤의 것만
           * 빼고 앞쪽 파일을 그대로 가져왔다. 건너뛴 목록에는 압축 이름만 올라가서,
           * 사람은 전부 거절된 줄 아는데 일부는 이미 들어와 있었다 (§5).
           */
          if (declaredBytes > limits.maxTotalBytes) { tooLarge = true; return false; }
          return true;
        }
      });
    } catch {
      skipped.push({ name, reason: '압축을 해제할 수 없습니다.' });
      continue;
    }

    if (tooManyEntries) {
      skipped.push({ name, reason: `압축 안에 파일이 너무 많습니다(${seen}개 이상).` });
      continue;
    }
    if (tooLarge) {
      skipped.push({ name, reason: '전체 용량이 너무 큽니다. 압축을 나눠 올려 주세요.' });
      continue;
    }
    for (const inner of nested) {
      skipped.push({ name: inner, reason: '압축 안의 압축은 해제하지 않습니다.' });
    }

    let found = 0;
    for (const [entryName, innerBytes] of Object.entries(entries)) {
      if (!innerBytes?.length) continue;
      files.push({ name: decodeEntryName(baseName(entryName)), bytes: innerBytes, container: name });
      found += 1;
    }
    if (found === 0) {
      skipped.push({ name, reason: '압축 안에 엑셀 파일이 없습니다.' });
    }
  }

  return { files, skipped };
}

/**
 * 셀 값을 정리한다. 빈 셀은 null로 통일한다.
 *
 * 엑셀에서 텍스트로 강제된 셀은 `'-` 처럼 앞에 작은따옴표가 붙어 나온다.
 * 그대로 두면 대학명·결과 값에 섞여 들어간다.
 *
 * @param {unknown} value
 */
export function normalizeCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  const text = String(value).replace(/^'/, '').trim();
  return text === '' ? null : text;
}

/**
 * @typedef {object} SheetSource
 * @property {string} fileName
 * @property {string} [container] zip으로 올렸다면 그 zip 이름
 * @property {string} fileHash 같은 파일을 다시 올렸는지 판별한다
 * @property {string} sheetName
 * @property {unknown[][]} grid 헤더를 포함한 전체 행렬
 */

/**
 * 엑셀 파일들을 시트 단위 격자로 전개한다.
 *
 * 비어 있는 시트는 버린다. 양식 파일에는 빈 시트가 흔히 붙어 있다.
 *
 * @param {SourceFile[]} files
 * @returns {Promise<{ sheets: SheetSource[], skipped: {name: string, reason: string}[] }>}
 */
export async function readSheets(files) {
  /** @type {SheetSource[]} */
  const sheets = [];
  /** @type {{name: string, reason: string}[]} */
  const skipped = [];

  for (const file of files) {
    if (!isSpreadsheetBytes(file.bytes)) {
      skipped.push({ name: file.name, reason: '엑셀 파일이 아닙니다. 확장자만 바뀐 파일일 수 있습니다.' });
      continue;
    }
    let workbook;
    try {
      workbook = readWorkbook(file.bytes, { type: 'array', cellDates: true, cellFormula: false });
    } catch {
      skipped.push({ name: file.name, reason: '엑셀을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.' });
      continue;
    }
    const fileHash = await sha256Hex(file.bytes);
    let usable = 0;

    for (const sheetName of workbook.SheetNames) {
      const raw = sheetUtils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1, defval: null, blankrows: false, raw: true
      });
      const grid = raw.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []));
      if (!grid.some((row) => row.some((cell) => cell !== null))) continue;
      sheets.push({ fileName: file.name, container: file.container, fileHash, sheetName, grid });
      usable += 1;
    }
    if (usable === 0) skipped.push({ name: file.name, reason: '내용이 있는 시트가 없습니다.' });
  }

  return { sheets, skipped };
}

/**
 * 업로드 한 번의 전체 경로. 엑셀 여러 개든 zip 하나든 여기로 들어온다.
 *
 * @param {SourceFile[]} uploads
 * @returns {Promise<{ sheets: SheetSource[], skipped: {name: string, reason: string}[] }>}
 */
export async function loadUploads(uploads) {
  const expanded = expandUploads(uploads);
  const read = await readSheets(expanded.files);
  return { sheets: read.sheets, skipped: [...expanded.skipped, ...read.skipped] };
}
