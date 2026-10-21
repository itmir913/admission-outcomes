/**
 * 예시 양식은 **해석되는 채로 남아 있어야 한다**.
 *
 * 체험용 파일이 해석되지 않으면, 처음 들어온 사람이 보는 첫 화면이 「대학명 열을
 * 찾지 못함」이다. 양식 사전이 바뀌거나 예시가 바뀌어도 이 짝이 어긋나지 않게 묶어 둔다.
 */

import { describe, it, expect } from 'vitest';

import { sampleGrid, sampleWorkbook, SAMPLE_FILE_NAME } from '../src/sample/sampleWorkbook.js';
import { resolveSheet } from '../src/ingest/resolveColumns.js';
import { headerFingerprint } from '../src/ingest/headerHash.js';
import { bundledProfiles } from '../src/dict/header-profiles/index.js';
import { ProfileSet } from '../src/ingest/profile.js';

describe('예시 양식', () => {
  it('열을 하나도 남기지 않고 이름으로 해석된다', () => {
    const reading = resolveSheet(sampleGrid());
    expect(reading.headerRows).toBe(2);
    expect(reading.unresolved ?? []).toEqual([]);
    // 상담에서 보는 축이 전부 들어 있다
    for (const key of ['univ', 'dept', 'final', 'gpa.전교과', 'suneung.국어.grade', 'suneung.한국사.grade']) {
      expect(Object.keys(reading.columns)).toContain(key);
    }
  });

  it('고3 년도 열을 두지 않는다', () => {
    // 연도를 사람이 확정하는 길을 체험에서도 지난다 (CLAUDE.md 2)
    const reading = resolveSheet(sampleGrid());
    expect(reading.columns.sourceYear).toBeUndefined();
  });

  /*
   * 예시 양식에는 프로파일이 붙어 있다. 체험 첫 화면이 「등록된 양식과 달라 열
   * 이름으로 해석했습니다」로 시작하면, 처음 온 사람은 제 파일이 잘못된 줄 안다.
   *
   * 생성기를 고치면 지문이 달라져 이 검사가 걸린다. 걸리지 않고 지나가면 프로파일이
   * 조용히 놀고, 화면은 다시 노란 경고로 맞는다.
   */
  it('동봉한 프로파일의 지문과 맞는다', async () => {
    const grid = sampleGrid();
    const picked = new ProfileSet(bundledProfiles).select({
      fingerprint: await headerFingerprint(grid, 2)
    });
    expect(picked?.profile?.id).toBe('sample-2026');
    // 프로파일의 번호와 이름 해석의 번호가 같은 곳을 가리킨다
    expect(picked.profile.columns).toEqual(resolveSheet(grid).columns);
  });

  it('같은 씨앗이면 같은 파일이 나온다', () => {
    expect(sampleWorkbook({ students: 3 })).toEqual(sampleWorkbook({ students: 3 }));
  });

  it('가상 데이터임이 파일 이름에 드러난다', () => {
    expect(SAMPLE_FILE_NAME).toContain('예시');
    expect(SAMPLE_FILE_NAME).toContain('가상');
  });
});
