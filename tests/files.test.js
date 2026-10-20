import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import {
  isExcelName, isZipBytes, isSpreadsheetBytes, expandUploads, normalizeCell, readSheets, loadUploads
} from '../src/ingest/files.js';
import { makeWorkbook, makeZip, senjinhakGrid, kcueGrid } from './helpers/workbook.js';

const encoder = new TextEncoder();
const upload = (name, bytes) => ({ name, bytes });

describe('파일 종류 판별', () => {
  it('엑셀 확장자를 알아본다', () => {
    for (const name of ['a.xlsx', 'a.XLSX', 'a.xls', 'a.xlsm', 'a.xlsb', '2024학년도.xlsx']) {
      expect(isExcelName(name)).toBe(true);
    }
  });

  it('엑셀이 아닌 것을 걸러낸다', () => {
    for (const name of ['a.csv', 'a.pdf', 'a.hwp', 'a.zip', 'xlsx', '']) {
      expect(isExcelName(name)).toBe(false);
    }
  });

  it('스프레드시트 실체를 매직 바이트로 확인한다', () => {
    expect(isSpreadsheetBytes(makeWorkbook({ s: [['a']] }))).toBe(true);
    expect(isSpreadsheetBytes(encoder.encode('학년,이름,대학'))).toBe(false);
    // .xls는 zip이 아니라 OLE2 복합 문서다
    const ole2 = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(isSpreadsheetBytes(ole2)).toBe(true);
  });

  it('zip을 확장자가 아니라 매직 바이트로 알아본다', () => {
    // 확장자를 바꿔 올리는 일이 실제로 있다
    expect(isZipBytes(makeZip({ 'a.txt': encoder.encode('x') }))).toBe(true);
    expect(isZipBytes(encoder.encode('그냥 텍스트'))).toBe(false);
    expect(isZipBytes(new Uint8Array(2))).toBe(false);
  });
});

describe('업로드 전개', () => {
  it('엑셀 여러 개를 그대로 통과시킨다', () => {
    const result = expandUploads([
      upload('2024.xlsx', makeWorkbook({ result: senjinhakGrid(2024) })),
      upload('2025.xlsx', makeWorkbook({ result: senjinhakGrid(2025) }))
    ]);
    expect(result.files.map((file) => file.name)).toEqual(['2024.xlsx', '2025.xlsx']);
    expect(result.skipped).toEqual([]);
  });

  it('zip을 해제해 안의 엑셀을 꺼낸다', () => {
    const archive = makeZip({
      '2024.xlsx': makeWorkbook({ result: senjinhakGrid(2024) }),
      '2025.xlsx': makeWorkbook({ result: senjinhakGrid(2025) })
    });
    const result = expandUploads([upload('진학결과.zip', archive)]);
    expect(result.files.map((file) => file.name).sort()).toEqual(['2024.xlsx', '2025.xlsx']);
  });

  it('zip으로 올린 것과 여러 개로 올린 것이 같은 결과를 낸다', () => {
    // 두 경로가 나뉘면 zip 쪽만 조용히 낡는다
    const a = makeWorkbook({ result: senjinhakGrid(2024) });
    const b = makeWorkbook({ result: senjinhakGrid(2025) });
    const direct = expandUploads([upload('2024.xlsx', a), upload('2025.xlsx', b)]);
    const zipped = expandUploads([upload('묶음.zip', makeZip({ '2024.xlsx': a, '2025.xlsx': b }))]);

    const shape = (result) => result.files
      .map((file) => [file.name, file.bytes.length])
      .sort((left, right) => left[0].localeCompare(right[0]));
    expect(shape(zipped)).toEqual(shape(direct));
  });

  it('zip 안의 폴더 구조를 무시하고 파일명만 쓴다', () => {
    const archive = makeZip({
      '진학결과/2024/수시.xlsx': makeWorkbook({ result: senjinhakGrid(2024) })
    });
    expect(expandUploads([upload('a.zip', archive)]).files[0].name).toBe('수시.xlsx');
  });

  it('경로 순회를 시도하는 항목 이름을 무해하게 만든다', () => {
    const archive = zipSync({
      '../../탈출.xlsx': makeWorkbook({ result: senjinhakGrid(2024) })
    });
    const result = expandUploads([upload('a.zip', archive)]);
    expect(result.files[0].name).toBe('탈출.xlsx');
    expect(result.files[0].name).not.toContain('..');
  });

  it('xlsx도 zip이지만 압축 파일로 취급하지 않는다', () => {
    // xlsx의 실체는 zip이라 매직 바이트만 보면 구분되지 않는다
    const result = expandUploads([upload('결과.xlsx', makeWorkbook({ result: senjinhakGrid() }))]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('결과.xlsx');
  });

  it('zip으로 나온 파일에 출처를 남긴다', () => {
    const archive = makeZip({ '2024.xlsx': makeWorkbook({ result: senjinhakGrid(2024) }) });
    expect(expandUploads([upload('묶음.zip', archive)]).files[0].container).toBe('묶음.zip');
  });

  it('macOS 부산물과 숨김 파일을 건너뛴다', () => {
    const archive = makeZip({
      '__MACOSX/._2024.xlsx': encoder.encode('쓰레기'),
      '.DS_Store': encoder.encode('쓰레기'),
      '~$임시.xlsx': encoder.encode('쓰레기'),
      '2024.xlsx': makeWorkbook({ result: senjinhakGrid(2024) })
    });
    const result = expandUploads([upload('a.zip', archive)]);
    expect(result.files.map((file) => file.name)).toEqual(['2024.xlsx']);
  });

  it('압축 안의 압축은 해제하지 않고 알린다', () => {
    const inner = makeZip({ '2024.xlsx': makeWorkbook({ result: senjinhakGrid(2024) }) });
    const outer = makeZip({ '안쪽.zip': inner, '2025.xlsx': makeWorkbook({ result: senjinhakGrid(2025) }) });
    const result = expandUploads([upload('바깥.zip', outer)]);
    expect(result.files.map((file) => file.name)).toEqual(['2025.xlsx']);
    expect(result.skipped.some((item) => item.reason.includes('압축 안의 압축'))).toBe(true);
  });

  it('엑셀이 아닌 파일을 이유와 함께 건너뛴다', () => {
    const result = expandUploads([upload('안내문.pdf', encoder.encode('%PDF'))]);
    expect(result.files).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/엑셀/);
  });

  it('엑셀이 없는 zip을 알린다', () => {
    const archive = makeZip({ '메모.txt': encoder.encode('내용') });
    const result = expandUploads([upload('a.zip', archive)]);
    expect(result.files).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/엑셀 파일이 없습니다/);
  });

  it('항목이 너무 많은 압축을 거부한다', () => {
    const entries = {};
    for (let index = 0; index < 5; index += 1) entries[`f${index}.xlsx`] = encoder.encode('x');
    const result = expandUploads([upload('폭탄.zip', makeZip(entries))], {
      limits: { maxEntries: 3, maxTotalBytes: 1024 }
    });
    expect(result.files).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/너무 많습니다/);
  });

  it('전체 용량 상한을 넘으면 멈춘다', () => {
    const big = new Uint8Array(2048);
    const result = expandUploads([upload('a.zip', makeZip({ 'a.xlsx': big, 'b.xlsx': big }))], {
      limits: { maxEntries: 10, maxTotalBytes: 1024 }
    });
    expect(result.skipped.some((item) => item.reason.includes('용량'))).toBe(true);
  });

  it('깨진 압축 파일을 알린다', () => {
    const broken = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const result = expandUploads([upload('깨짐.zip', broken)]);
    expect(result.skipped[0].reason).toMatch(/압축을 해제할 수 없습니다/);
  });
});

describe('셀 정규화', () => {
  it('빈 값을 null로 통일한다', () => {
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(undefined)).toBeNull();
    expect(normalizeCell('')).toBeNull();
    expect(normalizeCell('   ')).toBeNull();
  });

  it('앞뒤 공백을 없앤다', () => {
    expect(normalizeCell('  고려대학교  ')).toBe('고려대학교');
  });

  it('텍스트 강제용 작은따옴표를 떼어낸다', () => {
    // 엑셀에서 텍스트 서식으로 저장된 셀이 이렇게 들어온다
    expect(normalizeCell("'-")).toBe('-');
    expect(normalizeCell("'30101")).toBe('30101');
  });

  it('숫자와 불리언은 그대로 둔다', () => {
    expect(normalizeCell(1.82)).toBe(1.82);
    expect(normalizeCell(0)).toBe(0);
    expect(normalizeCell(false)).toBe(false);
  });

  it('0을 빈 값으로 오해하지 않는다', () => {
    expect(normalizeCell(0)).not.toBeNull();
  });
});

describe('시트 읽기', () => {
  it('격자로 전개하고 파일 해시를 붙인다', async () => {
    const bytes = makeWorkbook({ result: senjinhakGrid(2026) });
    const { sheets } = await readSheets([{ name: '2026.xlsx', bytes }]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetName).toBe('result');
    expect(sheets[0].grid[0][0]).toBe('학년');
    expect(sheets[0].fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('같은 내용이면 같은 해시가 나온다', async () => {
    const grid = senjinhakGrid(2026);
    const first = await readSheets([{ name: 'a.xlsx', bytes: makeWorkbook({ s: grid }) }]);
    const second = await readSheets([{ name: '이름만다름.xlsx', bytes: makeWorkbook({ s: grid }) }]);
    expect(second.sheets[0].fileHash).toBe(first.sheets[0].fileHash);
  });

  it('시트 여러 개를 각각 전개한다', async () => {
    const bytes = makeWorkbook({ '2024': senjinhakGrid(2024), '2025': senjinhakGrid(2025) });
    const { sheets } = await readSheets([{ name: '통합.xlsx', bytes }]);
    expect(sheets.map((sheet) => sheet.sheetName)).toEqual(['2024', '2025']);
  });

  it('빈 시트를 버린다', async () => {
    // 양식 파일에는 빈 시트가 흔히 붙어 있다
    const bytes = makeWorkbook({ 빈시트: [[]], result: senjinhakGrid(2026) });
    const { sheets } = await readSheets([{ name: 'a.xlsx', bytes }]);
    expect(sheets.map((sheet) => sheet.sheetName)).toEqual(['result']);
  });

  it('내용이 없는 파일을 알린다', async () => {
    const { sheets, skipped } = await readSheets([{ name: '빈파일.xlsx', bytes: makeWorkbook({ s: [[]] }) }]);
    expect(sheets).toEqual([]);
    expect(skipped[0].reason).toMatch(/내용이 있는 시트가 없습니다/);
  });

  it('확장자만 엑셀인 파일을 걸러낸다', async () => {
    // SheetJS는 임의의 텍스트도 표로 파싱하려 든다. 넘기기 전에 막아야 한다
    const { sheets, skipped } = await readSheets([{ name: '가짜.xlsx', bytes: encoder.encode('학년,이름,대학') }]);
    expect(sheets).toEqual([]);
    expect(skipped[0].reason).toMatch(/엑셀 파일이 아닙니다/);
  });

  it('깨진 엑셀을 알린다', async () => {
    // zip 머리만 있고 알맹이가 없는 경우
    const broken = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const { skipped } = await readSheets([{ name: '깨짐.xlsx', bytes: broken }]);
    expect(skipped[0].reason).toMatch(/읽을 수 없습니다/);
  });

  it('2행 헤더를 그대로 보존한다', async () => {
    // 헤더 병합은 뒷단계(§4)의 몫이다. 여기서는 원형을 지켜야 한다
    const bytes = makeWorkbook({ empty: kcueGrid() });
    const { sheets } = await readSheets([{ name: '대교협.xlsx', bytes }]);
    expect(sheets[0].grid[0][11]).toBe('한국사');
    expect(sheets[0].grid[1][11]).toBe('등급');
  });

  it('학번의 앞자리 0을 잃지 않는다', async () => {
    const bytes = makeWorkbook({ s: [['학번'], ['00042'], ['00043'], ['00044']] });
    const { sheets } = await readSheets([{ name: 'a.xlsx', bytes }]);
    expect(sheets[0].grid[1][0]).toBe('00042');
  });
});

describe('업로드 전체 경로', () => {
  it('엑셀 여러 개와 zip이 같은 결과를 낸다', async () => {
    const a = makeWorkbook({ result: senjinhakGrid(2024) });
    const b = makeWorkbook({ result: senjinhakGrid(2025) });

    const direct = await loadUploads([upload('2024.xlsx', a), upload('2025.xlsx', b)]);
    const zipped = await loadUploads([upload('묶음.zip', makeZip({ '2024.xlsx': a, '2025.xlsx': b }))]);

    const shape = (result) => result.sheets
      .map((sheet) => `${sheet.fileName}:${sheet.sheetName}:${sheet.fileHash}`)
      .sort();
    expect(shape(zipped)).toEqual(shape(direct));
  });

  it('건너뛴 것을 한데 모아 돌려준다', async () => {
    const result = await loadUploads([
      upload('결과.xlsx', makeWorkbook({ result: senjinhakGrid(2024) })),
      upload('안내문.pdf', encoder.encode('%PDF')),
      upload('빈파일.xlsx', makeWorkbook({ s: [[]] }))
    ]);
    expect(result.sheets).toHaveLength(1);
    expect(result.skipped).toHaveLength(2);
  });

  it('아무것도 올리지 않아도 터지지 않는다', async () => {
    expect(await loadUploads([])).toEqual({ sheets: [], skipped: [] });
  });
});
