import { describe, it, expect } from 'vitest';
import { bundledProfiles } from '../src/dict/header-profiles/index.js';
import { ProfileSet, validateProfile, isKnownFieldKey, sameMapping } from '../src/ingest/profile.js';

describe('동봉된 헤더 프로파일', () => {
  it('하나 이상 등록되어 있다', () => {
    expect(bundledProfiles.length).toBeGreaterThan(0);
  });

  it.each(bundledProfiles.map((profile) => [profile.id, profile]))('%s 가 검사를 통과한다', (id, profile) => {
    const { valid, problems } = validateProfile(profile);
    expect(problems).toEqual([]);
    expect(valid).toBe(true);
  });

  it('id가 서로 겹치지 않는다', () => {
    const ids = bundledProfiles.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모두 묶음에 등록된다', () => {
    const set = new ProfileSet(bundledProfiles);
    expect(set.rejected).toEqual([]);
    expect(set.profiles).toHaveLength(bundledProfiles.length);
  });

  it('쓰인 필드 키가 모두 공통 스키마에 있다', () => {
    for (const profile of bundledProfiles) {
      for (const key of Object.keys(profile.columns)) {
        expect(isKnownFieldKey(key), `${profile.id}: ${key}`).toBe(true);
      }
    }
  });

  it('지문이 서로 다르다', () => {
    // 두 프로그램의 헤더가 같을 리 없다. 같다면 생성이 잘못된 것이다
    const prints = bundledProfiles.map((profile) => profile.fingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('대학명 열을 반드시 갖는다', () => {
    for (const profile of bundledProfiles) {
      expect(profile.columns, profile.id).toHaveProperty('univ');
    }
  });

  it('지문으로 찾아 쓸 수 있다', () => {
    const set = new ProfileSet(bundledProfiles);
    for (const profile of bundledProfiles) {
      expect(set.select({ fingerprint: profile.fingerprint })?.profile.id).toBe(profile.id);
    }
  });
});

describe('지문이 같으면 매핑도 같다', () => {
  /*
   * 지문이 같다는 것은 머리글이 글자 하나까지 같다는 뜻이다. 그런데 매핑이 다르면
   * 둘 중 하나가 틀렸는데 어느 쪽인지 알 방법이 없다. 그런 짝이 동봉본에 들어오면
   * 사용자가 만나기 전에 여기서 멈춘다.
   */
  it('동봉된 프로파일에 어긋나는 짝이 없다', () => {
    const clashes = [];
    for (let i = 0; i < bundledProfiles.length; i += 1) {
      for (let j = i + 1; j < bundledProfiles.length; j += 1) {
        const left = bundledProfiles[i];
        const right = bundledProfiles[j];
        if (left.fingerprint !== right.fingerprint) continue;
        if (!sameMapping(left, right)) clashes.push(`${left.id} ↔ ${right.id}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('머리글 줄 수가 연도를 따르지 않는다', () => {
    // 줄 수는 지문에 딸린 속성이다. 같은 해에 1줄짜리와 2줄짜리가 함께 있을 수 있다
    const rows = new Set(bundledProfiles.map((profile) => profile.headerRows));
    expect(rows.size).toBeGreaterThan(1);
  });
});

describe('지문이 같은데 매핑이 다르면 멈춘다', () => {
  const base = {
    id: 'demo-a', program: 'demo', year: 2026, headerRows: 1,
    fingerprint: 'a'.repeat(64), columns: { univ: 0, dept: 1 }
  };

  it('어느 쪽도 고르지 않고 어긋난 id를 알린다', () => {
    const twisted = { ...base, id: 'demo-b', year: 2027, columns: { univ: 0, dept: 2 } };
    const found = new ProfileSet([base, twisted]).select({ fingerprint: base.fingerprint });
    expect(found.profile).toBeNull();
    expect(found.conflict.sort()).toEqual(['demo-a', 'demo-b']);
  });

  it('매핑이 같으면 그냥 쓴다 - 어느 것을 선택해도 결과가 같다', () => {
    const twin = { ...base, id: 'demo-b', year: 2027 };
    const found = new ProfileSet([base, twin]).select({ fingerprint: base.fingerprint });
    expect(found.profile).not.toBeNull();
    expect(found.conflict).toBeUndefined();
  });

  it('머리글 줄 수만 달라도 어긋난 것으로 본다', () => {
    const twisted = { ...base, id: 'demo-b', headerRows: 2 };
    expect(sameMapping(base, twisted)).toBe(false);
  });

  it('연도만 다른 것은 어긋난 것이 아니다 - year는 이름표일 뿐이다', () => {
    expect(sameMapping(base, { ...base, id: 'demo-b', year: 1999 })).toBe(true);
  });
});
