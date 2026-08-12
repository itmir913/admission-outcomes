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
