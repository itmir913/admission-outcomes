/**
 * 업로드 처리 (§3).
 *
 * 엑셀 여러 개를 한꺼번에 올리거나, 그것들을 담은 zip 하나를 올린다.
 * **zip은 압축을 푸는 단계가 하나 더 있을 뿐, 그 뒤로는 완전히 같은 경로를 탄다.**
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
 * xlsx도 실체는 zip이라 매직 바이트만으로는 갈리지 않는다.
 * xlsx는 항상 `[Content_Types].xml`을 갖고 있으므로 그것으로 구분한다.
 * @param {Record<string, Uint8Array>} entries
 */
function looksLikeOfficeDocument(entries) {
  return Object.keys(entries).some((name) => name === '[Content_Types].xml');
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
 * 업로드된 것들을 엑셀 파일 목록으로 펼친다.
 *
 * zip 안의 zip은 풀지 않는다. 자료 정리에 필요한 구조가 아니고,
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
  let totalBytes = 0;

  for (const upload of uploads) {
    const { name, bytes } = upload;

    if (!isZipBytes(bytes)) {
      if (isExcelName(name)) files.push({ name, bytes });
      else skipped.push({ name, reason: '엑셀 파일이 아닙니다.' });
      continue;
    }

    let entries;
    try {
      entries = unzipSync(bytes);
    } catch {
      skipped.push({ name, reason: '압축을 풀 수 없습니다.' });
      continue;
    }

    // xlsx 자체가 zip이므로, 오피스 문서면 압축 파일로 취급하지 않는다
    if (looksLikeOfficeDocument(entries)) {
      if (isExcelName(name)) files.push({ name, bytes });
      else skipped.push({ name, reason: '엑셀 파일이 아닙니다.' });
      continue;
    }

    const names = Object.keys(entries);
    if (names.length > limits.maxEntries) {
      skipped.push({ name, reason: `압축 안에 파일이 너무 많습니다(${names.length}개).` });
      continue;
    }

    let found = 0;
    for (const entryName of names) {
      if (isNoise(entryName)) continue;
      const inner = baseName(entryName);
      const innerBytes = entries[entryName];
      if (!innerBytes?.length) continue;

      if (!isExcelName(inner)) {
        if (isZipBytes(innerBytes)) skipped.push({ name: inner, reason: '압축 안의 압축은 풀지 않습니다.' });
        continue;
      }
      totalBytes += innerBytes.length;
      if (totalBytes > limits.maxTotalBytes) {
        skipped.push({ name: inner, reason: '전체 용량이 너무 큽니다.' });
        break;
      }
      files.push({ name: inner, bytes: innerBytes, container: name });
      found += 1;
    }
    if (found === 0) skipped.push({ name, reason: '압축 안에 엑셀 파일이 없습니다.' });
  }

  return { files, skipped };
}

/**
 * 셀 값을 다듬는다. 빈 셀은 null로 통일한다.
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
 * 엑셀 파일들을 시트 단위 격자로 펼친다.
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
