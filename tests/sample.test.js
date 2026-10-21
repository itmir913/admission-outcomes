/**
 * 예시 양식은 **해석되는 채로 남아 있어야 한다**.
 *
 * 체험용 파일이 해석되지 않으면, 처음 들어온 사람이 보는 첫 화면이 「대학명 열을
 * 찾지 못함」이다. 양식 사전이 바뀌거나 예시가 바뀌어도 이 짝이 어긋나지 않게 묶어 둔다.
 */

import { describe, it, expect } from 'vitest';

import { sampleGrid, sampleWorkbook, SAMPLE_FILE_NAME } from '../src/sample/sampleWorkbook.js';
import { resolveSheet } from '../src/ingest/resolveColumns.js';

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

  it('같은 씨앗이면 같은 파일이 나온다', () => {
    expect(sampleWorkbook({ students: 3 })).toEqual(sampleWorkbook({ students: 3 }));
  });

  it('지어낸 자료임이 파일 이름에 드러난다', () => {
    expect(SAMPLE_FILE_NAME).toContain('예시');
    expect(SAMPLE_FILE_NAME).toContain('가상');
  });
});
