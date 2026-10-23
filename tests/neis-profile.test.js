import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { prepareUploads, commitSheets } from '../src/ingest/pipeline.js';
import { ProfileSet } from '../src/ingest/profile.js';
import { bundledProfiles } from '../src/dict/header-profiles/index.js';
import { makeWorkbook } from './helpers/workbook.js';

const HEADER = ['지원자', '졸업학년도', '계열/학년/학과', '반', '번호', '성명', '대학', '진행상태',
  '모집시기', '평가단위명', '수험번호', '요청구분', '재요청사유', '최종처리일시'];

/** 가상 값. 첫 학생이 두 대학에 지원했고, 수험번호는 대학마다 다르다 */
function neisGrid() {
  return [
    HEADER,
    ['재학생', '2026', '3', '1', '7', '가상학생', '가나대학교', '대입전형자료생성완료', '수시',
      '논술전형-물리학과-수시(본교)', 'ZZ1111', '최초요청', null, '2026.09.12. 16:10:49'],
    ['재학생', '2026', '3', '1', '7', '가상학생', '다라대학교', '대입전형자료생성완료', '수시',
      '종합전형-화학과-수시(본교)', 'ZZ2222', '최초요청', null, '2026.09.13. 10:00:00'],
    ['재학생', '2026', '3', '2', '3', '다른학생', '가나대학교', '대입전형자료생성완료', '수시',
      '논술전형-물리학과-수시(본교)', 'ZZ3333', '최초요청', null, '2026.09.14. 09:00:00']
  ];
}

async function prepared() {
  return prepareUploads(
    [{ name: '반별제공현황.xlsx', bytes: makeWorkbook({ 제공현황: neisGrid() }) }],
    { profiles: new ProfileSet(bundledProfiles), currentYear: 2026 }
  );
}

describe('나이스 대입제공현황', () => {
  it('동봉 프로파일로 해석된다', async () => {
    const { sheets } = await prepared();
    expect(sheets[0].profile?.id).toBe('neis-2027');
  });

  it('졸업학년도를 고3 년도 그대로 읽는다 — 학년도로 읽으면 한 해 밀린다', async () => {
    const { sheets } = await prepared();
    expect(sheets[0].yearGuess.cohortYear).toBe(2026);
  });

  it('수험번호로 학생을 나누지 않는다 — 대학마다 다른 번호다', async () => {
    const dataset = await commitSheets((await prepared()).sheets);
    expect(dataset.applications).toHaveLength(3);
    expect(new Set(dataset.applications.map((row) => row.sid)).size).toBe(2);
  });

  it('수험번호·이름이 어디에도 남지 않는다', async () => {
    const dataset = await commitSheets((await prepared()).sheets);
    const text = JSON.stringify(dataset);
    for (const secret of ['ZZ1111', 'ZZ2222', 'ZZ3333', '가상학생', '다른학생']) expect(text).not.toContain(secret);
  });
});
