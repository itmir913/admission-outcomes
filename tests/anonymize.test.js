import { describe, it, expect } from 'vitest';
import { identityKeys, assignStudentIds, ANON_ID_CHARS } from '../src/core/anonymize.js';

const entry = (cohortYear, identity) => ({ cohortYear, identity });
const 김가온 = { name: '김가온', hakbun: '30101', classNo: '1', number: '1' };
const 박서린 = { name: '박서린', hakbun: '30102', classNo: '1', number: '2' };

describe('식별 키 만들기', () => {
  it('주키가 있으면 주키만 만든다', () => {
    // 이름 키까지 만들면 이름이 같은 남남이 합쳐진다
    const keys = identityKeys(2025, 김가온);
    expect(keys.map((key) => key.kind)).toEqual(['hakbun', 'classNumber']);
  });

  it('주키가 없을 때만 이름 키를 만든다', () => {
    expect(identityKeys(2025, { name: '김가온' }).map((key) => key.kind)).toEqual(['name']);
    expect(identityKeys(2025, { name: '김가온', number: '1' }).map((key) => key.kind))
      .toEqual(['numberName', 'name']);
  });

  it('주키에는 이름을 넣지 않는다', () => {
    // 넣으면 같은 학번인데 표기가 다른 것만으로 한 학생이 둘로 갈라진다
    const withName = identityKeys(2025, { hakbun: '30101', name: '김가온' });
    const withoutName = identityKeys(2025, { hakbun: '30101' });
    expect(withoutName[0].text).toBe(withName[0].text);
  });

  it('반·번호 키에도 이름을 넣지 않는다', () => {
    const withName = identityKeys(2025, { classNo: '1', number: '1', name: '김가온' });
    const withoutName = identityKeys(2025, { classNo: '1', number: '1' });
    expect(withoutName[0].text).toBe(withName[0].text);
  });

  it('반이 없으면 번호만으로는 부족해 이름을 함께 쓴다', () => {
    // 반이 다른 1번들이 서로 겹친다
    const keys = identityKeys(2025, { number: '1', name: '김가온' });
    expect(keys.map((key) => key.kind)).toEqual(['numberName', 'name']);
  });

  it('문자열과 숫자로 적힌 같은 값을 같게 다룬다', () => {
    // 엑셀은 같은 반·번호를 파일마다 '01'로도 1로도 담는다
    const asText = identityKeys(2025, { classNo: '01', number: '07' });
    const asNumber = identityKeys(2025, { classNo: 1, number: 7 });
    expect(asNumber[0].text).toBe(asText[0].text);
  });

  it('전각 숫자와 반각 숫자를 같게 다룬다', () => {
    const fullwidth = identityKeys(2025, { hakbun: '３０１０１' });
    const halfwidth = identityKeys(2025, { hakbun: '30101' });
    expect(fullwidth[0].text).toBe(halfwidth[0].text);
  });

  it('강한 키부터 돌려준다', () => {
    const strengths = identityKeys(2025, 김가온).map((key) => key.strength);
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
  });

  it('모든 키에 고3 년도가 들어간다', () => {
    // 학번은 해마다 재사용되므로 연도가 없으면 다른 해 학생과 충돌한다
    const left = identityKeys(2024, 김가온);
    const right = identityKeys(2025, 김가온);
    for (let index = 0; index < left.length; index += 1) {
      expect(left[index].text).not.toBe(right[index].text);
    }
  });

  it('이름이 없어도 주키만으로 식별한다', () => {
    // (연도, 학번)이 주키다. 이름은 없어도 된다
    expect(identityKeys(2025, { hakbun: '30101' }).map((key) => key.kind)).toEqual(['hakbun']);
    expect(identityKeys(2025, { classNo: '1', number: '1' }).map((key) => key.kind)).toEqual(['classNumber']);
  });

  it('아무 식별 값도 없으면 키를 만들지 않는다', () => {
    expect(identityKeys(2025, {})).toEqual([]);
  });

  it('고3 년도가 없으면 키를 만들지 않는다', () => {
    expect(identityKeys(null, 김가온)).toEqual([]);
  });

  it('이름의 사이 공백을 무시한다', () => {
    // 파일마다 `홍 길동`, `홍길동`으로 다르게 적혀 있으면 한 사람이 둘로 갈라진다
    const spaced = identityKeys(2025, { name: '김 가 온', hakbun: '30101' });
    const plain = identityKeys(2025, { name: '김가온', hakbun: '30101' });
    expect(spaced[0].text).toBe(plain[0].text);
  });

  it('자모 분리형과 완성형을 같게 다룬다', () => {
    const composed = identityKeys(2025, { name: '김가온'.normalize('NFC'), hakbun: '30101' });
    const decomposed = identityKeys(2025, { name: '김가온'.normalize('NFD'), hakbun: '30101' });
    expect(decomposed[0].text).toBe(composed[0].text);
  });

  it('학번 키와 번호 키가 우연히 같아지지 않는다', () => {
    // 학번 7과 번호 7이 같은 키가 되면 남남이 한 사람이 된다
    const byHakbun = identityKeys(2025, { name: '김가온', hakbun: '7' });
    const byNumber = identityKeys(2025, { name: '김가온', number: '7' });
    expect(byHakbun[0].text).not.toBe(byNumber[0].text);
  });
});

describe('익명 ID 발급', () => {
  it('행마다 ID를 매긴다', async () => {
    const result = await assignStudentIds([entry(2025, 김가온), entry(2025, 박서린)]);
    expect(result.sids).toHaveLength(2);
    expect(result.sids[0]).not.toBe(result.sids[1]);
    expect(result.students).toHaveLength(2);
  });

  it('고3 년도를 접두사로 붙인다', async () => {
    const result = await assignStudentIds([entry(2025, 김가온)]);
    expect(result.sids[0]).toMatch(/^2025-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('혼동되는 글자를 쓰지 않는다', async () => {
    const result = await assignStudentIds(
      Array.from({ length: 40 }, (unused, index) => entry(2025, { name: `학생${index}`, hakbun: `301${index}` }))
    );
    for (const sid of result.sids) {
      expect(sid.slice(5)).not.toMatch(/[ILOU]/);
    }
  });

  it('같은 학생의 여러 지원 행이 한 ID로 묶인다', async () => {
    const result = await assignStudentIds([
      entry(2025, 김가온), entry(2025, 김가온), entry(2025, 김가온)
    ]);
    expect(new Set(result.sids).size).toBe(1);
    expect(result.students).toHaveLength(1);
  });

  it('같은 입력이면 언제나 같은 ID가 나온다', async () => {
    const first = await assignStudentIds([entry(2025, 김가온)]);
    const second = await assignStudentIds([entry(2025, 김가온)]);
    expect(second.sids[0]).toBe(first.sids[0]);
  });

  it('올린 순서가 달라도 같은 ID가 나온다', async () => {
    const forward = await assignStudentIds([entry(2025, 김가온), entry(2025, 박서린)]);
    const backward = await assignStudentIds([entry(2025, 박서린), entry(2025, 김가온)]);
    expect(backward.sids[1]).toBe(forward.sids[0]);
    expect(backward.sids[0]).toBe(forward.sids[1]);
  });

  it('고3 년도가 다르면 다른 학생이다', async () => {
    // 학번 30101은 해마다 재사용된다
    const result = await assignStudentIds([entry(2024, 김가온), entry(2025, 김가온)]);
    expect(result.sids[0]).not.toBe(result.sids[1]);
    expect(result.students).toHaveLength(2);
  });

  it('이름 원문을 결과 어디에도 남기지 않는다', async () => {
    const result = await assignStudentIds([entry(2025, 김가온)]);
    const dumped = JSON.stringify(result);
    expect(dumped).not.toContain('김가온');
    expect(dumped).not.toContain('30101');
  });
});

describe('파일마다 식별 열이 다를 때', () => {
  it('학번만 있는 파일과 반·번호만 있는 파일은 잇지 않는다', async () => {
    // 두 파일에 공통으로 있는 것은 이름뿐이다. 그런데 이름이 같다고 같은 사람이라는 보장이 없다.
    // 한 사람인지 동명이인 둘인지 자료만 봐서는 알 수 없으므로 합치지 않는다
    const result = await assignStudentIds([
      entry(2025, { name: '김가온', hakbun: '30101' }),
      entry(2025, { name: '김가온', classNo: '1', number: '1' })
    ]);
    expect(result.sids[0]).not.toBe(result.sids[1]);
    expect(result.students).toHaveLength(2);
  });

  it('한 행에 두 식별자가 함께 있으면 그 둘을 잇는다', async () => {
    // 학번과 반·번호가 같이 실린 행이 "이 둘은 한 사람"이라는 증거가 된다
    const result = await assignStudentIds([
      entry(2025, { classNo: '1', number: '5' }),
      entry(2025, { hakbun: '30105' }),
      entry(2025, { classNo: '1', number: '5', hakbun: '30105' })
    ]);
    expect(new Set(result.sids).size).toBe(1);
    expect(result.students).toHaveLength(1);
  });

  it('이어진 학생은 두 식별자의 키를 모두 갖는다', async () => {
    const result = await assignStudentIds([
      entry(2025, { classNo: '1', number: '5' }),
      entry(2025, { hakbun: '30105' }),
      entry(2025, { classNo: '1', number: '5', hakbun: '30105' })
    ]);
    expect(result.students[0].keyHashes).toHaveLength(2);
  });

  it('이은 뒤에 어느 쪽 식별자로 와도 같은 ID를 준다', async () => {
    // 잇지 못하면 같은 학생이 익명 ID를 둘 갖게 되고 스스로 낫지 않는다
    const linked = await assignStudentIds([
      entry(2025, { classNo: '1', number: '5' }),
      entry(2025, { hakbun: '30105' }),
      entry(2025, { classNo: '1', number: '5', hakbun: '30105' })
    ]);
    const later = await assignStudentIds(
      [entry(2025, { classNo: '1', number: '5' }), entry(2025, { hakbun: '30105' })],
      { existing: linked.students }
    );
    expect(later.sids[0]).toBe(later.sids[1]);
    expect(later.sids[0]).toBe(linked.sids[0]);
  });

  it('같은 학번이면 이름 표기가 달라도 한 사람이다', async () => {
    // 파일마다 오타나 표기 차이가 있다. 주키가 같으면 같은 사람이다
    const result = await assignStudentIds([
      entry(2025, { hakbun: '30101', name: '김가온' }),
      entry(2025, { hakbun: '30101', name: '김가온(전학)' })
    ]);
    expect(result.sids[0]).toBe(result.sids[1]);
    expect(result.students).toHaveLength(1);
  });

  it('이름이 아예 없는 행도 주키로 이어진다', async () => {
    const result = await assignStudentIds([
      entry(2025, { hakbun: '30101', name: '김가온' }),
      entry(2025, { hakbun: '30101' })
    ]);
    expect(result.sids[0]).toBe(result.sids[1]);
  });
});

describe('동명이인 — 잘못 합치지 않는다', () => {
  it('학번이 다른 동명이인을 한 사람으로 합치지 않는다', async () => {
    const result = await assignStudentIds([
      entry(2025, { name: '김가온', hakbun: '30101' }),
      entry(2025, { name: '김가온', hakbun: '30215' })
    ]);
    expect(result.sids[0]).not.toBe(result.sids[1]);
    expect(result.students).toHaveLength(2);
  });

  it('식별 열이 다른 동명이인을 합치지 않는다', async () => {
    // 학번으로 식별된 사람과 반·번호로 식별된 사람이 이름만 같은 경우.
    // 두 확인된 엑셀 양식이 서로 다른 열로 학생을 식별하므로 흔한 경우다
    const result = await assignStudentIds([
      entry(2025, { hakbun: '30101', name: '김민준' }),
      entry(2025, { classNo: '7', number: '12', name: '김민준' })
    ]);
    expect(result.sids[0]).not.toBe(result.sids[1]);
    expect(result.students).toHaveLength(2);
  });

  it('주키가 있는 행에는 이름만 있는 행을 붙이지 않는다', async () => {
    // 손으로 관리하는 추가합격 시트처럼 이름만 있는 행이 남의 이력에 섞이면 안 된다
    const result = await assignStudentIds([
      entry(2025, { name: '김가온', hakbun: '30101' }),
      entry(2025, { name: '김가온' })
    ]);
    expect(result.sids[0]).not.toBe(result.sids[1]);
    expect(result.students).toHaveLength(2);
  });

  it('이름만으로 식별한 행이 있으면 알린다', async () => {
    const result = await assignStudentIds([entry(2025, { name: '김가온' })]);
    const warning = result.warnings.find((item) => item.type === 'name-only-identity');
    expect(warning.count).toBe(1);
    expect(warning.message).toMatch(/동명이인이면 한 사람으로 묶입니다/);
  });

  it('주키가 없는 같은 이름끼리는 한 사람으로 본다', async () => {
    // 더 볼 것이 없다. 그래서 알린다
    const result = await assignStudentIds([
      entry(2025, { name: '김가온' }),
      entry(2025, { name: '김가온' })
    ]);
    expect(result.students).toHaveLength(1);
  });

  it('다른 해의 동명이인은 문제가 아니다', async () => {
    const result = await assignStudentIds([
      entry(2024, { name: '김가온', hakbun: '30101' }),
      entry(2025, { name: '김가온', hakbun: '30101' })
    ]);
    expect(result.students).toHaveLength(2);
  });

  it('이름만으로 기존 학생에 이어 붙이면 알린다', async () => {
    // 예전 자료에서도 그 이름이 유일했는지 확인할 방법이 없다
    const first = await assignStudentIds([entry(2025, { name: '김가온' })]);
    const second = await assignStudentIds(
      [entry(2025, { name: '김가온' })],
      { existing: first.students }
    );
    expect(second.warnings.find((item) => item.type === 'unverified-name-link').count).toBe(1);
  });
});

describe('식별할 수 없는 행', () => {
  it('식별 값이 하나도 없으면 ID를 주지 않는다', async () => {
    const result = await assignStudentIds([entry(2025, {})]);
    expect(result.sids[0]).toBeNull();
  });

  it('학번만 있어도 ID를 준다', async () => {
    const result = await assignStudentIds([entry(2025, { hakbun: '30101' })]);
    expect(result.sids[0]).toMatch(/^2025-/);
  });

  it('이름 없는 행이 있으면 알린다', async () => {
    const result = await assignStudentIds([entry(2025, {}), entry(2025, 김가온)]);
    const warning = result.warnings.find((item) => item.type === 'no-identity');
    expect(warning.count).toBe(1);
  });

  it('식별 못 한 행이 있어도 나머지는 정상으로 처리한다', async () => {
    const result = await assignStudentIds([entry(2025, {}), entry(2025, 김가온)]);
    expect(result.sids[0]).toBeNull();
    expect(result.sids[1]).toMatch(/^2025-/);
    expect(result.students).toHaveLength(1);
  });

  it('빈 입력을 견딘다', async () => {
    const result = await assignStudentIds([]);
    expect(result).toEqual({ sids: [], students: [], warnings: [] });
  });
});

describe('이어서 올리기', () => {
  it('이미 있던 학생은 원래 ID를 그대로 받는다', async () => {
    // 담임이 본 ID가 바뀌면 과거 상담 기록의 학생 참조가 끊긴다
    const first = await assignStudentIds([entry(2025, 김가온)]);
    const second = await assignStudentIds([entry(2025, 김가온)], { existing: first.students });
    expect(second.sids[0]).toBe(first.sids[0]);
    expect(second.students).toHaveLength(1);
  });

  it('나중 파일이 두 식별자를 함께 실어 오면 기존 학생과 이어진다', async () => {
    const first = await assignStudentIds([entry(2025, { hakbun: '30101' })]);
    const second = await assignStudentIds(
      [entry(2025, { hakbun: '30101', classNo: '1', number: '1' })],
      { existing: first.students }
    );
    expect(second.sids[0]).toBe(first.sids[0]);
    expect(second.students[0].keyHashes.length).toBeGreaterThan(first.students[0].keyHashes.length);
  });

  it('새 학생은 새 ID를 받는다', async () => {
    const first = await assignStudentIds([entry(2025, 김가온)]);
    const second = await assignStudentIds([entry(2025, 박서린)], { existing: first.students });
    expect(second.sids[0]).not.toBe(first.sids[0]);
    expect(second.students).toHaveLength(2);
  });

  it('새 연도를 더해도 기존 학생의 ID가 흔들리지 않는다', async () => {
    const first = await assignStudentIds([entry(2024, 김가온)]);
    const second = await assignStudentIds([entry(2025, 박서린)], { existing: first.students });
    const kept = second.students.find((student) => student.sid === first.sids[0]);
    expect(kept).toBeDefined();
    expect(kept.cohortYear).toBe(2024);
  });
});

describe('규모', () => {
  it('학년당 수백 명 규모에서 ID가 충돌하지 않는다', async () => {
    const entries = [];
    for (const year of [2021, 2022, 2023, 2024, 2025]) {
      for (let index = 0; index < 400; index += 1) {
        entries.push(entry(year, {
          name: `학생${year}_${index}`,
          hakbun: `3${String(index).padStart(4, '0')}`
        }));
      }
    }
    const result = await assignStudentIds(entries);
    expect(result.students).toHaveLength(2000);
    expect(new Set(result.sids).size).toBe(2000);
  });

  it('익명 ID 길이가 일정하다', async () => {
    const result = await assignStudentIds([
      entry(2025, { name: '가', hakbun: '1' }),
      entry(2025, { name: '나', hakbun: '2' })
    ]);
    for (const sid of result.sids) {
      expect(sid.split('-').slice(1).join('')).toHaveLength(ANON_ID_CHARS);
    }
  });
});
