/**
 * 열이 한 키로 모이는지 재는 회귀 검사 (docs/design-field-keys.md §7).
 *
 * 사전 자체는 `dict.test.js`가 지킨다. 여기서는 **자료를 실제로 넣어 보고** 같은
 * 뜻의 열이 한 열로 모이는지, 모르는 열이 조용히 사라지지 않는지를 본다.
 *
 * 이 파일이 지키는 것은 설계의 출발점이던 사고다 — 대교협 자료와 센진학 자료를
 * 함께 불러오면 내신 열이 하나도 겹치지 않았고, 화면은 멀쩡했다(§5).
 */

import { describe, it, expect } from 'vitest';
import { buildDataset } from '../src/ingest/buildRecords.js';
import { buildRows } from '../src/analysis/rows.js';
import { buildRegistry, fieldLabel, primaryGpaField } from '../src/analysis/registry.js';
import { resolveSheet } from '../src/ingest/resolveColumns.js';
import { isKnownFieldKey } from '../src/ingest/profile.js';
import { bundledProfiles } from '../src/dict/header-profiles/index.js';
import fields from '../src/dict/fields.json' with { type: 'json' };

/** 머리글 두 줄과 자료 몇 줄로 시트 하나를 만든다 */
function sheet(top, sub, rows, cohortYear) {
  const grid = [top, sub, ...rows];
  const resolved = resolveSheet(grid);
  return { grid, headerRows: resolved.headerRows, cohortYear, columns: resolved.columns, resolved };
}

describe('표기가 달라도 한 열로 모인다', () => {
  /*
   * 2025년 자료는 `국영수사`로, 2026년 자료는 `국수영사`로 적는다. 같은 조합이다.
   * 대학명과 결과 표기도 함께 다르게 적어, 스칼라·값 사전과 조합 사전이 같은
   * 결과를 내는지 한 번에 본다.
   */
  const 작년 = sheet(
    ['이름', '대학명', '모집단위', '최종단계', '전교과', '국영수사'],
    ['', '', '', '', '100', '100'],
    [['김가온', '서울대학교', '컴퓨터공학부', '합격', 2.13, 2.31]],
    2025
  );
  const 올해 = sheet(
    ['성명', '대학이름', '학과', '합불여부', '전과목', '국수영사'],
    ['', '', '', '', '100', '100'],
    [['김가온', '연세대학교', '인공지능학과', '합', 2.13, 2.31]],
    2026
  );

  it('두 양식이 같은 키를 낸다', () => {
    expect(작년.columns['gpa.국수영사']).toBe(5);
    expect(올해.columns['gpa.국수영사']).toBe(5);
    expect(작년.columns['gpa.전교과']).toBe(4);
    expect(올해.columns['gpa.전교과']).toBe(4);
  });

  it('함께 불러오면 내신 열이 나뉘지 않는다', async () => {
    const dataset = await buildDataset([작년, 올해]);
    const registry = buildRegistry(buildRows(dataset));
    const 내신 = registry.filter((field) => field.group === 'gpa');

    // 예전에는 gpa.국영수사(1행)와 gpa.국수영사(1행)로 나뉘었고 화면은 멀쩡했다
    expect(내신.map((field) => field.key).sort()).toEqual(['gpa.국수영사', 'gpa.전교과']);
    expect(내신.every((field) => field.filled === 2)).toBe(true);
  });

  it('대학명과 결과 표기도 함께 모인다', async () => {
    const dataset = await buildDataset([작년, 올해]);
    const rows = buildRows(dataset);
    expect(rows.map((row) => row.outcome)).toEqual(['pass', 'pass']);
    expect(rows.map((row) => row.univ)).toEqual(['서울대학교', '연세대학교']);
  });

  it('한 학생의 한 조합이 카드 두 칸으로 나오지 않는다', async () => {
    const dataset = await buildDataset([작년, 올해]);
    const student = dataset.students.find((item) => Object.keys(item.gpa).length > 0);
    expect(Object.keys(student.gpa).sort()).toEqual(['국수영사', '전교과']);
  });
});

describe('두 머리글이 한 키로 가면 뒤 열이 조용히 사라지지 않는다', () => {
  /*
   * `국영수사`와 `국수영사`가 **같은 시트에** 함께 실리는 날이 올 수 있다. 그러면 앞
   * 열이 키를 차지하고 뒤 열은 자리를 잃는데, 그 사실이 보고되지 않으면 내신 열
   * 하나가 내신 묶음에서 그냥 사라진다.
   *
   * 프로파일은 머리글 글자를 보관하지 않으므로(키·열 번호·일방향 지문뿐) 프로파일
   * 키만으로는 이것을 볼 수 없다. 격자를 넣어 본다.
   */
  it('뒤 열이 미해결로 보고된다', () => {
    const { resolved } = sheet(
      ['이름', '대학명', '최종단계', '전교과', '국영수사', '국수영사'],
      ['', '', '', '100', '100', '100'],
      [['김가온', '서울대학교', '합격', 2.13, 2.31, 2.31]],
      2025
    );
    expect(resolved.columns['gpa.국수영사']).toBe(4);
    const 미해결 = resolved.unresolved.find((item) => item.index === 5);
    expect(미해결).toBeTruthy();
    expect(미해결.reason).toContain('이미 차지했습니다');
  });
});

describe('사전에 없는 열은 extra 로 가고 보고된다', () => {
  /*
   * 반영비를 읽는 규칙이 없으므로 지어낼 길이 없다. 예전에는 숫자를 뽑아
   * `전교과(5등급)`에서 `gpa.전교과(5)`라는 없는 반영비를 만들었고, 값이 1~5라
   * 값 교차검증도 통과했다.
   */
  const 낯선것 = sheet(
    ['이름', '대학명', '최종단계', '전교과', '전교과', '국수영'],
    ['', '', '', '100', '5등급', '탐1탐2'],
    [['김가온', '서울대학교', '합격', 2.13, 3, 2.5]],
    2025
  );

  it('키가 되지 않는다', () => {
    expect(Object.keys(낯선것.columns).filter((key) => key.startsWith('gpa.')))
      .toEqual(['gpa.전교과']);
  });

  it('미해결로 보고된다 — 조용히 사라지지 않는다', () => {
    expect(낯선것.resolved.unresolved.map((item) => item.index)).toEqual([4, 5]);
  });

  it('값은 extra 로 보존된다', async () => {
    const dataset = await buildDataset([낯선것]);
    const row = buildRows(dataset)[0];
    expect(row['extra.전교과·5등급']).toBe(3);
    expect(row['extra.국수영·탐1탐2']).toBe(2.5);
  });

  it('해석하지 못한 열도 필터·축이 된다', async () => {
    const registry = buildRegistry(buildRows(await buildDataset([낯선것])));
    const extra = registry.filter((field) => field.group === 'extra');
    expect(extra.map((field) => fieldLabel(field.key)).sort())
      .toEqual(['국수영·탐1탐2', '전교과·5등급']);
  });
});

describe('대표 내신은 사전이 정한다', () => {
  it('전과목 평균 열이 대표가 된다 — 표기가 무엇이든', async () => {
    const 센진학 = sheet(
      ['이름', '대학명', '최종단계', '과학', '전과목'],
      ['', '', '', '100', '100'],
      [['김가온', '서울대학교', '합격', 6.88, 2.13]],
      2025
    );
    const registry = buildRegistry(buildRows(await buildDataset([센진학])));
    // `과학 6.88`처럼 그 학생을 대표하지 않는 값이 올라오면 안 된다
    expect(primaryGpaField(registry).key).toBe('gpa.전교과');
  });

  it('그 열이 없으면 값이 가장 많은 열로 되돌아간다', async () => {
    /*
     * 내신 구역은 `전교과` 표지로 열리므로 이름 경로로는 이런 양식이 만들어지지
     * 않는다. 프로파일이 열을 직접 가리키는 경우를 재려고 columns 를 그대로 준다.
     */
    const 전교과없음 = {
      grid: [
        ['이름', '대학명', '최종단계', '국수영사'],
        ['김가온', '서울대학교', '합격', 2.31],
        ['박서린', '연세대학교', '불합격', 3.4]
      ],
      headerRows: 1,
      cohortYear: 2025,
      columns: { 'identity.name': 0, univ: 1, final: 2, 'gpa.국수영사': 3 }
    };
    const registry = buildRegistry(buildRows(await buildDataset([전교과없음])));
    // 되돌아가지 않으면 기본 열 목록에서 내신이 빠져 표가 내신 없이 열린다
    expect(primaryGpaField(registry).key).toBe('gpa.국수영사');
  });
});

describe('동봉 프로파일이 사전과 어긋나지 않는다', () => {
  /*
   * **프로파일 경로는 사전을 거치지 않는다.** 프로파일에 날것 머리글이 키로 적혀
   * 있으면 사전을 통째로 우회해 같은 조합이 다시 두 열로 나뉜다. 그것을 막는 장치는
   * `isKnownFieldKey` 하나뿐이다.
   */
  it.each(bundledProfiles.map((profile) => [profile.id, profile]))('%s 의 모든 키가 사전에 있다', (id, profile) => {
    const 낯선키 = Object.keys(profile.columns).filter((key) => !isKnownFieldKey(key));
    expect(낯선키).toEqual([]);
  });

  it('프로파일로 읽어 만든 학생 레코드의 내신 키가 전부 사전에 있다', async () => {
    /*
     * 내신 묶음은 **사전의 키와 정확히 같은 집합**이어야 한다. 상류 문지기가 둘
     * 있지만(이름 경로의 사전 경유, 프로파일 경로의 `isKnownFieldKey`), 새 경로가
     * `student.gpa`에 쓰는 날 이 검사가 그것을 잡는다.
     */
    const 사전키 = new Set([...fields.repeating.gpa.combos, ...fields.repeating.gpa.subjects]
      .map((entry) => entry.key));
    const kcue = bundledProfiles.find((profile) => profile.id === 'kcue-2027');
    const 내신열 = Object.entries(kcue.columns).filter(([key]) => key.startsWith('gpa.'));
    const row = [];
    for (const [, index] of 내신열) row[index] = 2.5;
    row[kcue.columns.univ] = '서울대학교';
    row[kcue.columns.dept] = '컴퓨터공학부';
    row[kcue.columns.final] = '합격';
    row[kcue.columns['identity.class']] = '5';
    row[kcue.columns['identity.number']] = '7';
    row[kcue.columns['identity.name']] = '김가온';

    const dataset = await buildDataset([{
      grid: [[], [], row], headerRows: 2, cohortYear: 2025, columns: kcue.columns
    }]);
    const 쓰인키 = dataset.students.flatMap((student) => Object.keys(student.gpa));
    expect(쓰인키.length).toBeGreaterThan(20);
    expect(쓰인키.filter((key) => !사전키.has(key))).toEqual([]);
  });

  it('수능 요약 열은 영역으로 받지 않는다', () => {
    // 국·수·영·탐 등급의 평균이라 영역별 등급과 나란히 놓이면 분모가 틀어진다
    expect(isKnownFieldKey('suneung.국수영(탐1탐2).grade')).toBe(false);
    const kcue2027 = bundledProfiles.find((profile) => profile.id === 'kcue-2027');
    expect(Object.keys(kcue2027.columns).some((key) => key.includes('탐1탐2'))).toBe(false);
  });
});

describe('동봉 프로파일은 올릴 때마다 묻지 않는다', () => {
  /*
   * 프로파일은 **사람이 확인해 둔 답**이다. 그 답에 「담을 논리 필드가 없다」까지
   * 적혀 있으면(`extraColumns`) 올릴 때마다 다시 묻지 않는다.
   *
   * 묻게 두면 올릴 때마다 같은 열 열다섯 개가 뜨고, 사람은 그 안내를 읽지 않게 된다 —
   * **그러면 양식이 열을 새로 얻었을 때도 지나친다.** 알림이 뜻을 가지려면 드물어야 한다.
   */
  it.each(bundledProfiles.map((profile) => [profile.id, profile]))(
    '%s 는 자기 양식의 모든 열에 답을 갖고 있다', (id, profile) => {
      const 답한열 = new Set([...Object.values(profile.columns), ...(profile.extraColumns ?? [])]);
      const 끝 = Math.max(...답한열);
      const 답없는열 = [];
      for (let index = 0; index <= 끝; index += 1) if (!답한열.has(index)) 답없는열.push(index);
      expect(답없는열).toEqual([]);
    }
  );

  it('논리 필드와 확정된 extra 가 같은 열을 가리키지 않는다', () => {
    for (const profile of bundledProfiles) {
      const 쓰는열 = new Set(Object.values(profile.columns));
      const 겹침 = (profile.extraColumns ?? []).filter((index) => 쓰는열.has(index));
      expect(겹침, profile.id).toEqual([]);
    }
  });
});
