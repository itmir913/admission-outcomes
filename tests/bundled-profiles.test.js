import { describe, it, expect } from 'vitest';
import { bundledProfiles } from '../src/dict/header-profiles/index.js';
import { ProfileSet, validateProfile, isKnownFieldKey } from '../src/ingest/profile.js';

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

  it('학년도별로 찾아 쓸 수 있다', () => {
    const set = new ProfileSet(bundledProfiles);
    for (const profile of bundledProfiles) {
      const found = set.select({ fingerprint: profile.fingerprint, year: profile.year });
      expect(found?.profile.id).toBe(profile.id);
      expect(found?.match).toBe('year');
    }
  });

  it('이듬해 파일에 물려쓸 수 있다', () => {
    const set = new ProfileSet(bundledProfiles);
    for (const profile of bundledProfiles) {
      const found = set.select({ fingerprint: profile.fingerprint, year: profile.year + 1 });
      expect(found?.match).toBe('carried');
      expect(found?.profile.year).toBe(profile.year);
    }
  });
});
