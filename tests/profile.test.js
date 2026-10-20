import { describe, it, expect } from 'vitest';
import {
  isKnownFieldKey, validateProfile, ProfileSet, matchProfile, buildProfile
} from '../src/ingest/profile.js';
import { headerSignature, headerFingerprint, normalizeHeaderCell } from '../src/ingest/headerHash.js';
import { senjinhakGrid, kcueGrid } from './helpers/workbook.js';

const baseProfile = (overrides = {}) => ({
  id: 'demo-2025',
  program: 'demo',
  year: 2025,
  headerRows: 1,
  fingerprint: 'a'.repeat(64),
  columns: { univ: 4 },
  ...overrides
});

describe('헤더 지문', () => {
  it('전각 문자를 반각으로 맞춘다', () => {
    expect(normalizeHeaderCell('ＡＢＣ')).toBe('ABC');
  });

  it('눈에 안 보이는 문자를 없앤다', () => {
    // 폭 없는 공백은 보이지 않으면서 지문만 바꾼다
    expect(normalizeHeaderCell('대학​명')).toBe('대학명');
  });

  it('연속 공백을 하나로 줄인다', () => {
    expect(normalizeHeaderCell('  모집   단위 ')).toBe('모집 단위');
  });

  it('같은 헤더면 같은 지문이 나온다', async () => {
    const left = await headerFingerprint(senjinhakGrid(2024), 1);
    const right = await headerFingerprint(senjinhakGrid(2026), 1);
    // 학년도 값이 달라도 헤더는 같다
    expect(left).toBe(right);
  });

  it('열 이름이 하나만 바뀌어도 지문이 달라진다', async () => {
    const grid = senjinhakGrid(2026);
    const changed = grid.map((row) => [...row]);
    changed[0][4] = '지원대학';
    expect(await headerFingerprint(changed, 1)).not.toBe(await headerFingerprint(grid, 1));
  });

  it('열이 하나 늘어나도 지문이 달라진다', async () => {
    const grid = senjinhakGrid(2026);
    const added = grid.map((row, index) => (index === 0 ? [...row, '비고'] : [...row, null]));
    expect(await headerFingerprint(added, 1)).not.toBe(await headerFingerprint(grid, 1));
  });

  it('오른쪽 끝의 빈 열은 지문에 영향을 주지 않는다', async () => {
    // 엑셀은 편집 흔적만으로도 빈 열을 붙여 둔다
    const grid = senjinhakGrid(2026);
    const padded = grid.map((row) => [...row, null, null]);
    expect(await headerFingerprint(padded, 1)).toBe(await headerFingerprint(grid, 1));
  });

  it('헤더 행 수가 다르면 지문이 달라진다', async () => {
    const grid = kcueGrid();
    expect(await headerFingerprint(grid, 2)).not.toBe(await headerFingerprint(grid, 1));
  });

  it('2행 헤더의 둘째 줄까지 반영한다', async () => {
    const grid = kcueGrid();
    const changed = grid.map((row) => [...row]);
    changed[1][13] = '표준점수';
    expect(await headerFingerprint(changed, 2)).not.toBe(await headerFingerprint(grid, 2));
  });

  it('열 순서만 바뀌어도 지문이 달라진다', () => {
    expect(headerSignature([['A', 'B']])).not.toBe(headerSignature([['B', 'A']]));
  });

  it('열 경계가 붙어 있어도 헷갈리지 않는다', () => {
    expect(headerSignature([['AB', 'C']])).not.toBe(headerSignature([['A', 'BC']]));
  });
});

describe('필드 키 검사', () => {
  it('공통 스키마에 있는 키를 인정한다', () => {
    for (const key of ['univ', 'dept', 'final', 'identity.name', 'cohortYear', 'sourceYear']) {
      expect(isKnownFieldKey(key)).toBe(true);
    }
  });

  it('내신 반영조합은 이름을 자유롭게 붙일 수 있다', () => {
    // 조합 이름은 학교·프로그램마다 다르다
    expect(isKnownFieldKey('gpa.전교과')).toBe(true);
    expect(isKnownFieldKey('gpa.국수영사과')).toBe(true);
    expect(isKnownFieldKey('gpa.우리학교만쓰는조합')).toBe(true);
  });

  it('수능은 영역과 항목까지 갖춰야 한다', () => {
    expect(isKnownFieldKey('suneung.국어.grade')).toBe(true);
    expect(isKnownFieldKey('suneung.탐구1.percentile')).toBe(true);
    expect(isKnownFieldKey('suneung.국어')).toBe(false);
    expect(isKnownFieldKey('suneung.국어.없는항목')).toBe(false);
  });

  it('모르는 키를 거절한다', () => {
    // year는 고3 년도인지 학년도인지 드러나지 않아 일부러 뺐다
    expect(isKnownFieldKey('year')).toBe(false);
    expect(isKnownFieldKey('아무거나')).toBe(false);
    expect(isKnownFieldKey('gpa.')).toBe(false);
    expect(isKnownFieldKey('')).toBe(false);
  });
});

describe('연도 기준 검사', () => {
  it('연도 열이 있으면 기준을 밝혀야 한다', () => {
    // 밝히지 않으면 자료 전체가 한 해씩 밀린 채로 멀쩡해 보인다
    const result = validateProfile(baseProfile({ columns: { univ: 4, sourceYear: 0 } }));
    expect(result.valid).toBe(false);
    expect(result.problems.join()).toMatch(/yearBasis/);
  });

  it('기준을 밝히면 통과한다', () => {
    for (const yearBasis of ['senior', 'admission']) {
      const profile = baseProfile({ columns: { univ: 4, sourceYear: 0 }, yearBasis });
      expect(validateProfile(profile).valid, yearBasis).toBe(true);
    }
  });

  it('엉뚱한 기준값을 거절한다', () => {
    const profile = baseProfile({ columns: { univ: 4, sourceYear: 0 }, yearBasis: '학년도' });
    expect(validateProfile(profile).valid).toBe(false);
  });

  it('연도 열이 없으면 기준을 요구하지 않는다', () => {
    // 대교협 파일에는 연도 열이 없다. 파일명에서 읽는다
    expect(validateProfile(baseProfile({ columns: { univ: 4 } })).valid).toBe(true);
  });
});

describe('프로파일 검사', () => {
  it('제대로 된 프로파일을 통과시킨다', () => {
    expect(validateProfile(baseProfile()).valid).toBe(true);
  });

  it('대학명 열이 없으면 거절한다', () => {
    const result = validateProfile(baseProfile({ columns: { dept: 1 } }));
    expect(result.valid).toBe(false);
    expect(result.problems.join()).toMatch(/대학명/);
  });

  it('두 필드가 같은 열을 가리키면 거절한다', () => {
    // 둘 중 하나는 반드시 틀렸다
    const result = validateProfile(baseProfile({ columns: { univ: 3, dept: 3 } }));
    expect(result.valid).toBe(false);
    expect(result.problems.join()).toMatch(/같은 열/);
  });

  it('모르는 필드 키를 거절한다', () => {
    const result = validateProfile(baseProfile({ columns: { univ: 1, 이상한키: 2 } }));
    expect(result.problems.join()).toMatch(/알 수 없는 필드 키/);
  });

  it('열 번호가 정수가 아니면 거절한다', () => {
    expect(validateProfile(baseProfile({ columns: { univ: 1.5 } })).valid).toBe(false);
    expect(validateProfile(baseProfile({ columns: { univ: -1 } })).valid).toBe(false);
  });

  it('지문 형식을 강제한다', () => {
    expect(validateProfile(baseProfile({ fingerprint: '짧음' })).valid).toBe(false);
  });

  it('빠진 항목을 모두 모아 알려준다', () => {
    const result = validateProfile({});
    expect(result.problems.length).toBeGreaterThan(3);
  });

  it('객체가 아닌 입력을 견딘다', () => {
    expect(validateProfile(null).valid).toBe(false);
    expect(validateProfile('문자열').valid).toBe(false);
  });
});

describe('프로파일 묶음', () => {
  it('잘못된 프로파일은 이유와 함께 따로 담는다', () => {
    // 조용히 사라지면 왜 안 먹었는지 알 수 없다
    const set = new ProfileSet([baseProfile(), baseProfile({ id: 'bad', columns: {} })]);
    expect(set.profiles).toHaveLength(1);
    expect(set.rejected).toHaveLength(1);
    expect(set.rejected[0].problems.join()).toMatch(/대학명/);
  });

  it('같은 id를 다시 넣으면 새 것이 이긴다', () => {
    // 사용자가 고친 프로파일이 동봉된 기본값을 덮어야 한다
    const set = new ProfileSet([baseProfile({ columns: { univ: 1 } })]);
    set.add(baseProfile({ columns: { univ: 9 } }));
    expect(set.profiles).toHaveLength(1);
    expect(set.profiles[0].columns.univ).toBe(9);
  });

  it('프로그램별로 최신 학년도부터 돌려준다', () => {
    const set = new ProfileSet([
      baseProfile({ id: 'a-2023', year: 2023 }),
      baseProfile({ id: 'a-2025', year: 2025 }),
      baseProfile({ id: 'a-2024', year: 2024 })
    ]);
    expect(set.byProgram('demo').map((profile) => profile.year)).toEqual([2025, 2024, 2023]);
  });
});

describe('프로파일 선택', () => {
  const fingerprint = 'b'.repeat(64);

  it('지문이 맞으면 학년도와 무관하게 쓴다', () => {
    // 지문이 같다는 것은 헤더가 글자 하나까지 같다는 뜻이다
    const set = new ProfileSet([baseProfile({ id: 'a-2024', year: 2024, fingerprint })]);
    expect(set.select({ fingerprint }).profile.year).toBe(2024);
  });

  it('후보가 여럿이면 가장 나중에 만든 것을 쓴다', () => {
    const set = new ProfileSet([
      baseProfile({ id: 'a-2024', year: 2024, fingerprint }),
      baseProfile({ id: 'a-2025', year: 2025, fingerprint })
    ]);
    expect(set.select({ fingerprint }).profile.year).toBe(2025);
  });

  it('지문이 다르면 고르지 않는다', () => {
    // 여기가 핵심이다. 헤더가 바뀌었는데 옛 인덱스를 쓰면 조용히 엉뚱한 열을 읽는다
    const set = new ProfileSet([baseProfile({ year: 2025, fingerprint })]);
    expect(set.select({ fingerprint: 'c'.repeat(64) })).toBeNull();
  });
});

describe('시트에 프로파일 맞추기', () => {
  it('헤더 행 수를 스스로 찾아 맞춘다', async () => {
    const grid = kcueGrid();
    const profile = await buildProfile({
      program: 'sample', year: 2025, headerRows: 2, grid, columns: { univ: 4 }
    });
    const matched = await matchProfile(new ProfileSet([profile]), { grid });
    expect(matched.profile.id).toBe('sample-2025');
    expect(matched.match).toBe('fingerprint');
    expect(matched.needsFallback).toBe(false);
  });

  it('어느 해에 만든 프로파일인지 알려준다', async () => {
    // 헤더 값(학년도)이 달라도 헤더 이름이 같으면 지문이 같다
    const profile = await buildProfile({
      program: 'sample', year: 2025, headerRows: 1, grid: senjinhakGrid(2025), columns: { univ: 4 }
    });
    const matched = await matchProfile(new ProfileSet([profile]), { grid: senjinhakGrid(2026) });
    expect(matched.match).toBe('fingerprint');
    expect(matched.profileYear).toBe(2025);
  });

  it('맞는 프로파일이 없으면 이름 매칭으로 내려보낸다', async () => {
    const matched = await matchProfile(new ProfileSet([]), { grid: senjinhakGrid(2026) });
    expect(matched.profile).toBeNull();
    expect(matched.needsFallback).toBe(true);
    expect(matched.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('헤더가 바뀌면 옛 프로파일을 쓰지 않고 폴백한다', async () => {
    const original = senjinhakGrid(2025);
    const profile = await buildProfile({
      program: 'sample', year: 2025, headerRows: 1, grid: original, columns: { univ: 4 }
    });
    const changed = senjinhakGrid(2026).map((row, index) => (index === 0 ? [...row, '추가열'] : [...row, null]));
    const matched = await matchProfile(new ProfileSet([profile]), { grid: changed });
    expect(matched.needsFallback).toBe(true);
  });
});

describe('프로파일 만들기', () => {
  it('확정한 매핑으로 저장할 수 있는 프로파일을 만든다', async () => {
    const grid = senjinhakGrid(2026);
    const profile = await buildProfile({
      program: 'newprogram', programLabel: '새 프로그램', year: 2026,
      headerRows: 1, grid, columns: { univ: 4, dept: 5, 'gpa.전과목': 9 }
    });
    expect(validateProfile(profile).valid).toBe(true);
    expect(profile.id).toBe('newprogram-2026');
    expect(profile.programLabel).toBe('새 프로그램');
  });

  it('만든 프로파일이 그 시트에 바로 맞는다', async () => {
    const grid = senjinhakGrid(2026);
    const profile = await buildProfile({
      program: 'newprogram', year: 2026, headerRows: 1, grid, columns: { univ: 4 }
    });
    const matched = await matchProfile(new ProfileSet([profile]), { grid });
    expect(matched.match).toBe('fingerprint');
  });
});
